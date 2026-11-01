import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_TAGS, TAG_CATEGORIES } from './data/prompt-tags.js';
import { normalizeTagLibrary, searchTags, saveTag, importTags, appendTags, tagTargets, mergeTagLibraries,
  saveTagTemplate, allTags, allTagTemplates, setPromptText, applyPromptDrafts } from './tag-library.js';
import { safeTagSource, safeTagPreview, tagDetails } from './tag-details.js';

const library = () => normalizeTagLibrary({});
const custom = (value = {}) => ({ id: 'custom-fixture', name: '自家风格', en: 'fixture style', category: '自定义', aliases: ['水粉风'], ...value });
const context = (provider = 'novelai', params = {}, mapping = {}) => ({ provider,
  params: { positive: 'subject', negative: '', artist: '', model: 'gpt-image-2', ...params }, mapping });

test('starter vocabulary has stable unique IDs and categories', () => {
  assert.ok(BUILTIN_TAGS.length >= 1000);
  assert.equal(new Set(BUILTIN_TAGS.map((tag) => tag.id)).size, BUILTIN_TAGS.length);
  assert.equal(new Set(BUILTIN_TAGS.map((tag) => tag.en)).size, BUILTIN_TAGS.length);
  assert.ok(TAG_CATEGORIES.length >= 30);
  for (const tag of BUILTIN_TAGS) assert.ok(TAG_CATEGORIES.includes(tag.category));
});
test('Chinese, case insensitive English, underscores, aliases and multiple search terms work', () => {
  const find = (search, category = '') => searchTags(library(), { search, category });
  assert.ok(find('马尾').some((tag) => tag.en === 'ponytail'));
  assert.equal(find('LONG_HAIR')[0].en, 'long hair');
  assert.equal(find('精灵耳')[0].en, 'pointy ears');
  assert.ok(find('long hair', '发型').some((row) => row.en === 'long hair'));
  assert.equal(find('马尾', '负面词').length, 0);
});
test('expanded dictionary preserves old IDs and useful aliases and adds scene and gesture terms', () => {
  for (const [search, en] of [['公主切', 'hime cut'], ['发尾挑染', 'colored tips'], ['中分', 'parted hair'],
    ['摸头', 'headpat'], ['客栈', 'inn'], ['筷子', 'chopsticks'], ['古琴', 'guqin']]) {
    assert.ok(searchTags(library(), { search }).some((row) => row.en === en));
  }
  assert.equal(BUILTIN_TAGS.find((row) => row.en === 'long hair').id, 'builtin-long-hair');
});
test('new builtins do not erase existing user wording, categories or favorites', () => {
  const migrated = normalizeTagLibrary({ version: 1, custom: [custom({ en: 'hime_cut', name: '我的姬发式', aliases: ['自家叫法'] })],
    favorites: ['custom-fixture'], recent: ['custom-fixture'] });
  assert.equal(migrated.custom.length, 1);
  assert.equal(allTags(migrated).filter((row) => /hime[ _]cut/.test(row.en)).length, 1);
  assert.equal(searchTags(migrated, { search: '自家叫法' })[0].name, '我的姬发式');
  assert.deepEqual(migrated.favorites, ['custom-fixture']);
});
test('prompt replacement validates the target and preserves unrelated parameters', () => {
  const before = context('novelai', { keyRef: 'fixture-ref', width: 832, positive: 'original', seed: 42 });
  const after = setPromptText(before, '{smile}, unknown_token');
  assert.deepEqual(after, { ...before.params, positive: '{smile}, unknown_token' });
  assert.equal(before.params.positive, 'original');
  assert.throws(() => setPromptText(context('openai'), 'blurry', 'negative'), /不支持/);
});
test('append treats weighted and underscore spellings as existing without rewriting the original', () => {
  const original = 'long_hair, {{smile}}, (blue eyes:1.2)';
  assert.equal(appendTags(context('novelai', { positive: original }), [{ en: 'long hair' }, { en: 'smile' }, { en: 'blue eyes' }]).positive, original);
});
test('custom templates survive refresh, older imports and idempotent export imports', () => {
  let saved = saveTagTemplate(library(), { id: 'template-fixture', name: '雨夜', category: '场景',
    positive: 'street, night, rain', negative: 'blurry', artist: 'watercolor' });
  saved = normalizeTagLibrary(JSON.parse(JSON.stringify(saved)));
  const restored = importTags(library(), { format: 'linghuashi-tags', version: 2, library: saved });
  assert.deepEqual(importTags(restored, { format: 'linghuashi-tags', version: 2, library: saved }), restored);
  assert.equal(importTags(restored, { format: 'linghuashi-tags', version: 1,
    library: { custom: [], favorites: [], recent: [] } }).templates.length, 1);
  assert.ok(allTagTemplates(restored).some((row) => row.name === '古风书房'));
  assert.equal(restored.templates[0].negative, 'blurry');
});
test('template merge handles ID and name collisions without replacing saved combinations', () => {
  const first = saveTagTemplate(library(), { id: 'template-fixture', name: '组合', positive: 'first' });
  const second = saveTagTemplate(library(), { id: 'template-fixture', name: '组合', positive: 'second' });
  const merged = mergeTagLibraries(first, second);
  assert.equal(merged.templates.length, 2);
  assert.equal(merged.templates[1].name, '组合 (2)');
  assert.notEqual(merged.templates[0].id, merged.templates[1].id);
  assert.equal(first.templates[0].positive, 'first');
  assert.deepEqual(mergeTagLibraries(merged, second), merged);
});
test('oversized and invalid template imports fail atomically', () => {
  const before = library();
  assert.throws(() => saveTagTemplate(before, { name: 'too long', positive: 'x'.repeat(12001) }), /长度/);
  assert.throws(() => importTags(before, { format: 'linghuashi-tags', version: 2,
    library: { custom: [], templates: [{ id: 'template-fixture', name: '', positive: 'smile' }] } }), /组合模板/);
  assert.throws(() => importTags(before, { format: 'linghuashi-tags', version: 2,
    library: { custom: [], templates: [{ id: 'template-fixture', name: '超长', positive: 'x'.repeat(12001) }] } }), /长度/);
  assert.throws(() => importTags(before, { format: 'linghuashi-tags', version: 2,
    library: { custom: [], templates: Array.from({ length: 101 }, () => ({ name: 'x', positive: 'x' })) } }));
  assert.deepEqual(before.templates, []);
});
test('importing older custom wording that is now built in retains its metadata', () => {
  const restored = importTags(library(), { format: 'linghuashi-tags', version: 1,
    library: { custom: [custom({ en: 'hime_cut', name: '我的姬切', aliases: ['私人名称'] })],
      favorites: ['custom-fixture'], recent: ['custom-fixture'] } });
  assert.equal(restored.custom[0].name, '我的姬切');
  assert.equal(searchTags(restored, { search: '私人名称' }).length, 1);
  assert.deepEqual(importTags(restored, { format: 'linghuashi-tags', version: 1, library: restored }), restored);
});
test('a valid dictionary near the shared byte limit does not lose entries on refresh', () => {
  const rows = Array.from({ length: 300 }, (_, i) => custom({ id: `custom-${i}`, name: 'n'.repeat(80),
    en: `fixture ${i} ${'e'.repeat(170)}`, category: 'c'.repeat(30), aliases: Array.from({ length: 16 }, (_, j) => `${j}${'a'.repeat(29)}`) }));
  const raw = { version: 2, custom: rows, templates: [], favorites: [], recent: [] };
  const size = new TextEncoder().encode(JSON.stringify(raw)).length;
  assert.ok(size > 250000 && size < 300000, String(size));
  assert.equal(normalizeTagLibrary(raw).custom.length, rows.length);
  assert.equal(importTags(library(), { format: 'linghuashi-tags', version: 2, library: raw }).custom.length, rows.length);
});
test('save and refresh retain custom entries, favorites and recent while stripping unknown fields', () => {
  const saved = saveTag(library(), { ...custom(), key: 'private', favorite: true });
  saved.favorites = ['custom-fixture', 'builtin-smile', 'invalid'];
  saved.recent = ['custom-fixture', 'custom-fixture', 'invalid'];
  const restored = normalizeTagLibrary(JSON.parse(JSON.stringify(saved)));
  assert.equal(searchTags(restored, { search: '水粉风' })[0].id, 'custom-fixture');
  assert.deepEqual(restored.favorites, ['custom-fixture', 'builtin-smile']);
  assert.deepEqual(restored.recent, ['custom-fixture']);
  assert.equal(searchTags(restored, { view: 'favorites' }).length, 2);
  assert.equal(searchTags(restored, { view: 'recent' }).length, 1);
  assert.ok(!JSON.stringify(restored).includes('private'));
});
test('duplicate builtins, invalid entries, over-limit imports are rejected atomically', () => {
  const before = library();
  assert.throws(() => saveTag(before, custom({ en: 'LONG_HAIR' })), /相同/);
  assert.throws(() => saveTag(before, custom({ en: '' })), /填写/);
  assert.throws(() => importTags(before, { format: 'other' }));
  assert.throws(() => importTags(before, { format: 'linghuashi-tags', version: 1,
    library: { custom: [custom(), custom()] } }), /重复/);
  assert.throws(() => importTags(before, { format: 'linghuashi-tags', version: 1,
    library: { custom: Array.from({ length: 501 }, (_, i) => custom({ id: `custom-${i}`, en: `fixture ${i}` })) } }));
  assert.equal(before.custom.length, 0);
});
test('import is idempotent and remaps colliding custom IDs and favorites', () => {
  const before = saveTag(library(), custom());
  const incoming = saveTag(library(), custom({ en: 'second style' }));
  incoming.favorites = ['custom-fixture']; incoming.recent = ['custom-fixture'];
  const first = mergeTagLibraries(before, incoming);
  assert.equal(first.custom.length, 2);
  assert.notEqual(first.custom[1].id, 'custom-fixture');
  assert.deepEqual(first.favorites, [first.custom[1].id]);
  assert.deepEqual(mergeTagLibraries(first, incoming), first);
});
test('append preserves original text, weighted groups and removes repeat additions', () => {
  const original = context('novelai', { positive: 'Subject,  {smile, blue eyes},\n' });
  const next = appendTags(original, [{ en: 'long hair' }, { en: 'LONG HAIR' }]);
  assert.ok(next.positive.startsWith(original.params.positive));
  assert.equal(next.positive, 'Subject,  {smile, blue eyes},\n long hair');
  assert.equal(appendTags(context('novelai', next), [{ en: 'long hair' }]).positive, next.positive);
  assert.equal(original.params.positive, 'Subject,  {smile, blue eyes},\n');
});
test('negative capability and ComfyUI mapping are validated without changing source parameters', () => {
  assert.throws(() => appendTags(context('openai'), [{ en: 'blurry' }], 'negative'), /不支持/);
  assert.equal(appendTags(context('openai', { model: 'nai-diffusion-4-5-full' }), [{ en: 'blurry' }], 'negative').negative, 'blurry');
  assert.throws(() => appendTags(context('comfyui'), [{ en: 'smile' }]), /映射/);
  assert.throws(() => appendTags(context('comfyui', {}, { positive: '6.text' }), [{ en: 'blurry' }], 'negative'), /映射/);
  assert.equal(appendTags(context('comfyui', {}, { positive: '6.text' }), [{ en: 'smile' }]).positive, 'subject, smile');
  assert.equal(tagTargets(context('comfyui')).length, 2);
});
test('prompt length caps reject instead of truncating; editor copies leave globals untouched', () => {
  const global = context('novelai', { positive: 'x'.repeat(11999) });
  assert.throws(() => appendTags(global, [{ en: 'smile' }]), /12000/);
  assert.throws(() => appendTags(context('openai', { artist: 'x'.repeat(4000) }), [{ en: 'watercolor' }], 'artist'), /4000/);
  const draft = structuredClone(global); draft.params.positive = 'editor only';
  draft.params = appendTags(draft, [{ en: 'smile' }]);
  assert.equal(draft.params.positive, 'editor only, smile');
  assert.equal(global.params.positive.length, 11999);
});
test('paired apply validates both baselines before changing anything and preserves other parameters', () => {
  const before = context('novelai', { positive: 'subject', negative: 'blurry', seed: 123, keyRef: 'fixture' });
  const drafts = { positive: { baseline: 'subject', text: 'smile' }, negative: { baseline: 'blurry', text: 'text' } };
  assert.deepEqual(applyPromptDrafts(before, drafts, ['positive', 'negative']), { ...before.params, positive: 'smile', negative: 'text' });
  drafts.negative.baseline = 'stale';
  assert.throws(() => applyPromptDrafts(before, drafts, ['positive', 'negative']), /其他位置/);
  assert.equal(before.params.positive, 'subject');
  drafts.negative = { baseline: 'blurry', text: 'x'.repeat(12001) };
  assert.throws(() => applyPromptDrafts(before, drafts, ['positive', 'negative']), /12000/);
  assert.equal(before.params.negative, 'blurry');
});
test('paired apply rejects unavailable fields on OpenAI and unmapped ComfyUI workflows', () => {
  const drafts = { positive: { baseline: 'subject', text: 'smile' }, negative: { baseline: '', text: 'blurry' } };
  assert.throws(() => applyPromptDrafts(context('openai'), drafts, ['positive', 'negative']), /不支持/);
  assert.throws(() => applyPromptDrafts(context('comfyui', {}, { positive: '6.text' }), drafts, ['positive', 'negative']), /映射/);
  assert.equal(applyPromptDrafts(context('openai', { model: 'nai-diffusion-4-5-full' }), drafts, ['positive', 'negative']).negative, 'blurry');
  const role = { ...context(), limits: { positive: 12000, negative: 4000 } };
  drafts.negative.text = 'x'.repeat(4001);
  assert.throws(() => applyPromptDrafts(role, drafts, ['positive', 'negative']), /4000/);
});
test('custom tag definitions, source and previews survive refresh and idempotent import', () => {
  const saved = saveTag(library(), custom({ description: '自定义水粉笔触', source: 'https://example.test/wiki?tracking=1',
    preview: 'data:image/webp;base64,UklGRg==' }));
  const restored = normalizeTagLibrary(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.custom[0].description, '自定义水粉笔触');
  assert.equal(restored.custom[0].source, 'https://example.test/wiki');
  assert.equal(restored.custom[0].preview, 'data:image/webp;base64,UklGRg==');
  const imported = importTags(library(), { format: 'linghuashi-tags', version: 2, library: restored });
  assert.deepEqual(imported, restored);
  assert.deepEqual(importTags(imported, { format: 'linghuashi-tags', version: 2, library: restored }), restored);
});
test('invalid source protocols, oversized metadata, SVG and remote previews are rejected atomically', () => {
  const before = library();
  for (const metadata of [{ description: 'x'.repeat(1001) }, { source: 'http://example.test' },
    { source: 'https://user:pass@example.test' }, { source: 'javascript:alert(1)' },
    { preview: 'data:image/svg+xml;base64,PHN2Zz4=' }, { preview: 'https://example.test/image.png' },
    { preview: `data:image/png;base64,${'A'.repeat(60000)}` }]) {
    assert.throws(() => saveTag(before, custom(metadata)));
    assert.throws(() => importTags(before, { format: 'linghuashi-tags', version: 2,
      library: { custom: [custom(metadata)] } }));
  }
  assert.equal(before.custom.length, 0);
  assert.equal(safeTagSource('javascript:alert(1)'), '');
  assert.equal(safeTagPreview('data:image/svg+xml;base64,PHN2Zz4='), '');
});
test('tag details distinguish specific definitions, category guidance and illustrative examples', () => {
  const find = (en) => BUILTIN_TAGS.find((tag) => tag.en === en);
  assert.match(tagDetails(find('hime cut')).description, /鬓发/);
  assert.equal(tagDetails(find('hime cut')).descriptionType, '标签释义');
  assert.equal(tagDetails(find('short twintails')).descriptionType, '分类提示');
  assert.ok(tagDetails(find('long hair')).preview.endsWith('claude-reading.webp'));
  assert.equal(tagDetails(find('long hair')).previewLabel, '主题插画示例');
  assert.ok(tagDetails(find('long hair')).wiki.startsWith('https://danbooru.donmai.us/wiki_pages/'));
  assert.equal(tagDetails(custom({ description: '自己的备注' })).wiki, '');
});
