import test from 'node:test';
import assert from 'node:assert/strict';
import { manualProfileSource, buildProfileMessages, parseProfileResult, profileProposal, applyProfileDrafts } from './profile-ai.js';
import { profileCardSources, createAssistantHost } from './assistant-host.js';
import { normalizeProfile, normalizeProfileLibrary } from './character-profiles.js';
import { requestAssistantText, requestAssistantAPI } from './prompt-assistant.js';

const source = { id: 'card-0', name: '同名角色', avatar: 'one.png', description: '黑色长发，金眼，白裙。' };
const response = (sourceId = source.id, patch = {}) => ({ sourceId, hair: 'long black hair', eyes: 'golden eyes',
  body: '', features: '', tags: '', negative: '', outfits: [{ name: '常服', prompt: 'white dress' }], notes: ['体型未说明'], ...patch });
const raw = (rows = [response()]) => JSON.stringify({ profiles: rows });
const parse = (rows, sources = [source]) => parseProfileResult(raw(rows), sources);
const target = () => normalizeProfile({ id: 'existing', name: '原档案', avatar: source.avatar,
  hair: 'silver hair', lockAppearance: false, lockOutfit: true, enabled: false,
  outfits: [{ id: 'old', name: '常服', prompt: 'blue dress' }, { id: 'other', name: '制服', prompt: 'uniform' }], defaultOutfitId: '',
  reference: { id: 'a'.repeat(64), location: 'server', name: 'ref', width: 512, height: 512, mime: 'image/png' } });
const db = (profiles = [target()]) => normalizeProfileLibrary({ profiles,
  chats: [{ chatKey: 'isolated', overrides: [{ ...target(), hair: 'chat hair' }] }] });
const merge = (mode) => ({ ...parse()[0], mode, targetId: 'existing' });

test('manual source and extraction prompts are bounded and separate material from instructions', () => {
  const manual = manualProfileSource('角色', '黑发；临时动作：挥手。');
  assert.equal(manual.avatar, '');
  const messages = buildProfileMessages([manual]);
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /Unknown or conflicting traits MUST be empty/);
  assert.match(messages[0].content, /temporary actions/);
  assert.match(messages[0].content, /untrusted/);
  assert.equal(JSON.parse(messages[1].content).CHARACTERS[0].sourceId, 'manual-0');
  assert.throws(() => manualProfileSource('', 'text'));
  assert.throws(() => manualProfileSource('name', 'x'.repeat(16001)));
  assert.throws(() => buildProfileMessages([]));
  assert.throws(() => buildProfileMessages(Array(7).fill(source)));
});

test('parsed drafts trust application source identities and never model avatars, IDs, locks or references', () => {
  const row = parse([response('card-0', { avatar: 'evil.png', id: 'existing', name: 'Wrong name', enabled: false,
    lockAppearance: false, reference: { id: 'external' }, api_key: 'discard' })])[0];
  assert.equal(row.draft.name, source.name); assert.equal(row.draft.avatar, source.avatar);
  assert.notEqual(row.draft.id, 'existing'); assert.equal(row.draft.enabled, true);
  assert.equal(row.draft.lockAppearance, true); assert.equal(row.draft.reference, null);
  assert.equal(row.draft.body, ''); assert.equal('api_key' in row.draft, false);
  assert.match(row.notes[0], /体型/);
});

test('same-name batch results are reordered by trusted sourceId, without cross-linking cards', () => {
  const second = { ...source, id: 'card-1', avatar: 'two.png' };
  const rows = parse([response('card-1', { hair: 'silver hair' }), response()], [source, second]);
  assert.equal(rows[0].draft.avatar, 'one.png'); assert.equal(rows[0].draft.hair, 'long black hair');
  assert.equal(rows[1].draft.avatar, 'two.png'); assert.equal(rows[1].draft.hair, 'silver hair');
  assert.notEqual(rows[0].draft.outfits[0].id, rows[1].draft.outfits[0].id);
});

test('strict parser rejects partial batches, duplicates, unknown sources, invalid fields and oversized output', () => {
  assert.throws(() => parse([]), /数量/);
  assert.throws(() => parse([response('unknown')]), /未知/);
  assert.throws(() => parse([response(), response()], [source, { ...source, id: 'card-1' }]), /重复/);
  for (const patch of [{ hair: null }, { hair: 'x'.repeat(801) }, { outfits: [{}] }, { notes: 'text' },
    { outfits: [response().outfits[0], response().outfits[0]] }]) assert.throws(() => parse([response('card-0', patch)]));
  assert.throws(() => parseProfileResult('x'.repeat(100001), [source]));
  assert.throws(() => parseProfileResult('{"profiles":[', [source]), /JSON/);
  assert.equal(parseProfileResult('```json\n' + raw() + '\n```', [source]).length, 1);
});

test('fill mode retains populated traits, outfits, explicit no-outfit, locks, references and chat overrides', () => {
  const previous = db(), row = merge('fill');
  const result = applyProfileDrafts(previous, [row], previous.profiles);
  const next = result.profiles[0];
  assert.equal(next.hair, 'silver hair'); assert.equal(next.eyes, 'golden eyes'); assert.equal(next.name, '原档案');
  assert.equal(next.lockAppearance, false); assert.equal(next.lockOutfit, true); assert.equal(next.enabled, false);
  assert.deepEqual(next.reference, previous.profiles[0].reference);
  assert.ok(next.reference);
  assert.deepEqual(next.outfits, previous.profiles[0].outfits); assert.equal(next.defaultOutfitId, '');
  assert.deepEqual(result.library.chats, previous.chats);
  assert.equal(previous.profiles[0].eyes, '');
});

test('update mode obeys per-field selection and merges matching outfits without removing unrelated outfits', () => {
  const row = merge('update'); row.selected = ['hair', 'outfits'];
  row.draft.eyes = ''; // Missing model data never erases a field.
  const result = profileProposal(row, [target()]);
  assert.equal(result.profile.hair, 'long black hair'); assert.equal(result.profile.name, '原档案');
  assert.equal(result.profile.avatar, source.avatar); assert.equal(result.profile.outfits[0].id, 'old');
  assert.equal(result.profile.outfits[0].prompt, 'white dress'); assert.equal(result.profile.outfits[1].prompt, 'uniform');
  assert.equal(result.profile.defaultOutfitId, '');
  assert.ok(result.changes.find((change) => change.key === 'hair' && change.before === 'silver hair'));
});

test('new mode creates another profile; card association never merges merely by equal name', () => {
  const previous = db(), row = parse()[0];
  const result = applyProfileDrafts(previous, [row], previous.profiles);
  assert.equal(result.library.profiles.length, 2);
  assert.equal(result.library.profiles[0].hair, 'silver hair');
  row.mode = 'update'; row.targetId = 'unlinked';
  assert.throws(() => profileProposal(row, [normalizeProfile({ id: 'unlinked', name: source.name, avatar: 'two.png' })]), /不一致/);
});

test('save detects changed/deleted targets, duplicate targets and capacity before any library mutation', () => {
  const previous = db(), row = merge('update'), changed = structuredClone(previous);
  changed.profiles[0].eyes = 'blue eyes';
  assert.throws(() => applyProfileDrafts(changed, [row], previous.profiles), /已变化/);
  assert.throws(() => applyProfileDrafts(db([]), [row], previous.profiles), /已变化/);
  assert.throws(() => applyProfileDrafts(previous, [row, { ...row }], previous.profiles), /同一个/);
  const full = db(Array.from({ length: 100 }, (_, index) => normalizeProfile({ id: `p${index}`, name: `P${index}` })));
  assert.throws(() => applyProfileDrafts(full, parse(), full.profiles), /100/);
  assert.equal(full.profiles.length, 100);
  row.included = false;
  assert.throws(() => applyProfileDrafts(previous, [row], previous.profiles), /至少/);
  assert.equal(previous.profiles[0].hair, 'silver hair');
});

test('outfit overflow or ambiguity prevents merges and blank draft clothes do not silently disappear', () => {
  const row = merge('update'), profile = target();
  profile.outfits = Array.from({ length: 20 }, (_, index) => ({ id: `o${index}`, name: `衣服${index}`, prompt: 'dress' }));
  assert.throws(() => profileProposal(row, [profile]), /20/);
  profile.outfits = [{ id: 'a', name: '常服', prompt: 'a' }, { id: 'b', name: '常服', prompt: 'b' }];
  assert.throws(() => profileProposal(row, [profile]), /重名/);
  row.draft.outfits[0].prompt = '';
  assert.throws(() => profileProposal(row, [target()]), /补全/);
});

test('source collector reads exactly selected avatar IDs, supports groups and detects card edits', async () => {
  const context = { characters: [
    { avatar: 'one.png', data: { name: '同名', description: 'black hair' } },
    { avatar: 'two.png', data: { name: '同名', description: 'silver hair' } },
    { avatar: 'private.png', data: { name: '未选择', description: 'unused' } },
  ] };
  const before = await profileCardSources(context, ['two.png', 'one.png']);
  assert.deepEqual(before.sources.map((row) => row.avatar), ['two.png', 'one.png']);
  assert.equal(JSON.stringify(before).includes('unused'), false);
  context.characters[1].data.description = 'new hair';
  const after = await profileCardSources(context, ['two.png', 'one.png']);
  assert.notEqual(after.sources[0].revision, before.sources[0].revision);
  assert.equal(after.sources[1].revision, before.sources[1].revision);
  await assert.rejects(() => profileCardSources(context, ['missing.png']), /删除/);
  await assert.rejects(() => profileCardSources(context, ['one.png', 'one.png']), /不同/);
  context.characters[0].data.description = 'x'.repeat(16001);
  await assert.rejects(() => profileCardSources(context, ['one.png']), /过长/);
});

test('source collector refuses empty cards and total overflow, without reading world books', async () => {
  const context = { characters: [{ avatar: 'blank.png', data: { name: 'blank' } }],
    getWorldInfoPrompt() { throw new Error('Must not read world books'); } };
  await assert.rejects(() => profileCardSources(context, ['blank.png']), /没有/);
  context.characters = Array.from({ length: 5 }, (_, index) => ({ avatar: `c${index}`, data: { description: 'x'.repeat(14000) } }));
  await assert.rejects(() => profileCardSources(context, context.characters.map((card) => card.avatar)), /总量/);
});

test('host bridge routes source reads and discards cancelled text responses', async () => {
  const posts = [];
  let complete;
  const host = createAssistantHost({ getContext: () => ({ characters: [{ avatar: 'a', description: 'black hair' }] }),
    settings: () => ({}), post: (type, data) => posts.push({ type, data }),
    textAccess: { generate: () => new Promise((resolve) => { complete = resolve; }) } });
  await host.receive({ action: 'profile-sources', requestId: 'source-1', avatars: ['a'] });
  assert.equal(posts[0].data.value.sources[0].avatar, 'a');
  const work = host.receive({ action: 'text', requestId: 'text-1', messages: buildProfileMessages([source]) });
  await host.receive({ action: 'cancel', requestId: 'text-1' });
  complete(raw()); await work;
  assert.equal(posts.at(-1).data.value, undefined);
  assert.match(posts.at(-1).data.error, /取消/);
  host.destroy();
});

test('shared API transport keeps URL normalization, custom model, max tokens and split text content', async () => {
  let sent;
  const fetcher = async (url, request) => {
    sent = { url, ...JSON.parse(request.body) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: [{ type: 'text', text: raw().slice(0, 10) }, { type: 'text', text: raw().slice(10) }] } }] }) };
  };
  const result = await requestAssistantText({ endpoint: 'https://text.invalid/v1/', model: 'chosen-model' }, 'fixture', buildProfileMessages([source]), { fetcher });
  assert.equal(parseProfileResult(result, [source]).length, 1);
  assert.equal(sent.url, 'https://text.invalid/v1/chat/completions'); assert.equal(sent.model, 'chosen-model'); assert.equal(sent.max_tokens, 4000);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => requestAssistantText({ endpoint: 'https://text.invalid', model: 'model' }, 'fixture', [], { fetcher, signal: controller.signal }));
});

test('existing assistant API still parses storyboard plans with the shared transport', async () => {
  const plan = { shouldDraw: true, positive: 'a bird', negative: '', scene: '', aspect: 'square' };
  const result = await requestAssistantAPI({ endpoint: 'https://text.invalid', model: 'model' }, 'fixture', [],
    { fetcher: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(plan) } }] }) }) });
  assert.equal(result.positive, 'a bird'); assert.equal(result.shouldDraw, true);
});
