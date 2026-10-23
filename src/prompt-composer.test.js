import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_TAGS } from './data/prompt-tags.js';
import { splitPrompt, parsePrompt, serializePrompt, appendPromptParts, deduplicatePrompt, emphasisFormat, adjustPromptWeight,
  promptLeaves, findPromptItem, updatePromptItem, movePromptItem, groupPromptItems, ungroupPromptItem,
  moveBetweenPrompts, numericPromptGroups } from './prompt-composer.js';

test('splits only outside weighted groups and preserves escaped delimiters and unknown words', () => {
  const source = String.raw`long_hair, {{smile, blue eyes}}, (night, rain:1.2), unknown\,token, 1.4::fog, moon::, aether \(genshin impact\)`;
  const parsed = parsePrompt(source, BUILTIN_TAGS);
  assert.equal(parsed.items.length, 6);
  assert.equal(parsed.items[0].name, '长发');
  assert.equal(parsed.items[1].raw, '{{smile, blue eyes}}');
  assert.equal(parsed.items[1].kind, 'group');
  assert.equal(parsed.items[1].syntax, 'novelai');
  assert.equal(parsed.items[3].raw, String.raw`unknown\,token`);
  assert.equal(parsed.items[4].raw, '1.4::fog, moon::');
  assert.equal(parsed.items[5].raw, String.raw`aether \(genshin impact\)`);
  assert.deepEqual(parsed.warnings, []);
});
test('Chinese punctuation and line breaks parse without dropping unknown text', () => {
  const parsed = parsePrompt('smile，unknown_token\nblue eyes', BUILTIN_TAGS);
  assert.deepEqual(parsed.items.map((row) => row.name), ['微笑', 'unknown_token', '蓝眼']);
  assert.equal(serializePrompt(parsed.items), 'smile, unknown_token, blue eyes');
});
test('unbalanced groups remain complete and produce a warning', () => {
  const result = splitPrompt('smile, {blue eyes, unknown');
  assert.deepEqual(result.parts, ['smile', '{blue eyes, unknown']);
  assert.ok(result.warnings.length);
  assert.equal(parsePrompt('1.4::fog, moon').items.length, 1);
  assert.ok(parsePrompt('1.4::fog, moon').warnings.length);
});
test('numeric NovelAI weights and SD weights are recognized without converting their syntax', () => {
  const parsed = parsePrompt('1.4::long_hair::, (blue eyes:1.2), [smile]', BUILTIN_TAGS);
  assert.deepEqual(parsed.items.map((row) => row.name), ['长发', '蓝眼', '微笑']);
  assert.deepEqual(parsed.items.map((row) => row.syntax), ['novelai', 'sd', 'novelai']);
  assert.equal(serializePrompt(parsed.items), '1.4::long_hair::, (blue eyes:1.2), [smile]');
});
test('emphasis controls preserve names, handle numeric weights and reject unsupported groups', () => {
  const [plain] = parsePrompt('long_hair', BUILTIN_TAGS).items;
  const stronger = adjustPromptWeight(plain, 1, 'novelai');
  assert.equal(stronger.raw, '{long_hair}');
  assert.equal(adjustPromptWeight(stronger, -1, 'novelai').raw, 'long_hair');
  assert.equal(adjustPromptWeight(plain, -1, 'novelai').raw, '[long_hair]');
  assert.equal(adjustPromptWeight(plain, 1, 'sd').raw, '(long_hair:1.1)');
  const [numeric] = parsePrompt('1.4::smile::').items;
  assert.equal(adjustPromptWeight(numeric, 1, 'novelai').raw, '1.5::smile::');
  assert.throws(() => adjustPromptWeight(plain, 1, 'plain'), /不支持/);
  assert.equal(adjustPromptWeight(parsePrompt('{smile, blue eyes}').items[0], 1, 'novelai').raw, '{{smile, blue eyes}}');
  assert.throws(() => adjustPromptWeight(parsePrompt('(smile:1.2)').items[0], 1, 'novelai'), /分组/);
});
test('emphasis format follows the actual model; ComfyUI does not assume a workflow grammar', () => {
  assert.equal(emphasisFormat({ provider: 'novelai' }), 'novelai');
  assert.equal(emphasisFormat({ provider: 'openai', params: { model: 'nai-diffusion-4-5-full' } }), 'novelai');
  assert.equal(emphasisFormat({ provider: 'openai', params: { model: 'gpt-image-2' } }), 'plain');
  assert.equal(emphasisFormat({ provider: 'comfyui' }), 'plain');
});
test('deduplication keeps the first weight and does not split multi-tag groups', () => {
  const parsed = parsePrompt('long_hair, {long hair}, {{smile, blue eyes}}, smile, SMILE');
  assert.ok(parsed.warnings.some((value) => value.includes('重复')));
  assert.equal(serializePrompt(deduplicatePrompt(parsed.items)), 'long_hair, {{smile, blue eyes}}, smile');
});
test('append is idempotent, preserves source whitespace and appends only new complete tags', () => {
  const before = 'Subject,  {{long_hair}},\n';
  assert.equal(appendPromptParts(before, 'long hair, smile, SMILE'), `${before} smile`);
  assert.equal(appendPromptParts(before, 'long hair'), before);
  assert.equal(appendPromptParts('', 'smile, smile, night'), 'smile, night');
});
test('parser supports large prompts without discarding words or executing markup', () => {
  const source = '<script>alert(1)</script>, ' + Array.from({ length: 1200 }, (_, i) => `unknown_${i}`).join(', ');
  const result = parsePrompt(source, BUILTIN_TAGS);
  assert.equal(result.items.length, 1201);
  assert.equal(result.items[0].raw, '<script>alert(1)</script>');
  assert.equal(serializePrompt(result.items), source);
});
test('nested numeric, bracket and SD groups preserve children and raw syntax', () => {
  const source = '1.2::smile, 1.4::blue eyes, long hair::::, {{night, [rain, fog]}}, ((moon, stars:1.1), sky:1.3)';
  const parsed = parsePrompt(source, BUILTIN_TAGS);
  assert.equal(parsed.items.length, 3);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.items[0].children[1].kind, 'group');
  assert.equal(parsed.items[0].children[1].weight, 1.4);
  assert.equal(parsed.items[1].children[1].weight, 1 / 1.05);
  assert.equal(parsed.items[2].children[0].syntax, 'sd');
  assert.equal(promptLeaves(parsed.items).length, 9);
  assert.equal(serializePrompt(parsed.items), source);
});
test('unsupported scheduling, alternation, mixed outer brackets and reset scopes remain opaque', () => {
  for (const source of ['[cat:dog:0.5]', '[cat|dog]', '(cat|dog, smile:1.2)', '1.2::cat|dog::', '{cat}{dog}', '{cat]}',
    '1.2::smile, 0::night']) {
    const result = parsePrompt(source);
    assert.equal(result.items[0].syntax, 'opaque', source);
    assert.equal(serializePrompt(result.items), source);
  }
  assert.equal(parsePrompt(String.raw`[a\:b]`).items[0].syntax, 'novelai');
});
test('legacy-compatible assertions preserve escaped pipes, colons and brackets in weighted prompts', () => {
  for (const [source, syntax, kind] of [
    [String.raw`1.2::cat\|dog::`, 'novelai', 'tag'],
    [String.raw`{cat\|dog}`, 'novelai', 'tag'],
    [String.raw`[cat\:dog]`, 'novelai', 'tag'],
    [String.raw`{cat\|dog, smile}`, 'novelai', 'group'],
    [String.raw`1.2::cat\|dog, smile::`, 'novelai', 'group'],
    [String.raw`(cat\|dog, smile:1.2)`, 'sd', 'group'],
    [String.raw`literal \{brace\}`, 'plain', 'tag'],
    [String.raw`literal \[bracket\]`, 'plain', 'tag'],
    ['literal {brace}', 'opaque', 'opaque'],
    ['[cat|dog]', 'opaque', 'opaque'],
    ['{|cat}', 'opaque', 'opaque'],
    ['[:cat]', 'opaque', 'opaque'],
    ['1.2::|cat::', 'opaque', 'opaque'],
  ]) {
    const result = parsePrompt(source);
    assert.equal(result.items[0].syntax, syntax, source);
    assert.equal(result.items[0].kind, kind, source);
    assert.equal(serializePrompt(result.items), source);
  }
});
test('editing and reordering nested children rebuilds all ancestor scopes without mutating the original', () => {
  const before = parsePrompt('1.2::smile, {rain, fog}::, moon').items;
  const child = before[0].children[1].children[0];
  const reordered = movePromptItem(before, child.id, 1);
  assert.equal(serializePrompt(reordered), '1.2::smile, {fog, rain}::, moon');
  assert.equal(serializePrompt(before), '1.2::smile, {rain, fog}::, moon');
  const changed = updatePromptItem(reordered, child.id, (item) => [adjustPromptWeight(item, 1, 'novelai')]);
  assert.equal(serializePrompt(changed), '1.2::smile, {fog, {rain}}::, moon');
  const removed = updatePromptItem(changed, child.id, () => []);
  assert.equal(serializePrompt(removed), '1.2::smile, {fog}::, moon');
  assert.equal(findPromptItem(removed, child.id), null);
  assert.equal(serializePrompt(updatePromptItem(removed, removed[0].children[1].children[0].id, () => [])), '1.2::smile::, moon');
});
test('group creation retains order, checks format, and limits nested scopes', () => {
  const items = parsePrompt('smile, rain, fog, moon').items;
  const grouped = groupPromptItems(items, [items[0].id, items[2].id], 'novelai');
  assert.equal(serializePrompt(grouped), '1::smile, fog::, rain, moon');
  assert.equal(serializePrompt(groupPromptItems(items, [items[0].id, items[1].id], 'novelai', { numeric: false })), '{smile, rain}, fog, moon');
  assert.equal(serializePrompt(groupPromptItems(items, [items[0].id, items[1].id], 'sd')), '(smile, rain:1), fog, moon');
  assert.throws(() => groupPromptItems(items, [items[0].id], 'sd'), /至少/);
  assert.throws(() => groupPromptItems(items, [items[0].id, items[1].id], 'plain'), /不支持/);
  let nested = items.slice(0, 2);
  for (let i = 0; i < 8; i++) {
    const extra = parsePrompt(`custom ${i}`).items[0];
    nested = groupPromptItems([...nested, extra], [...nested.map((row) => row.id), extra.id], 'sd');
  }
  const last = parsePrompt('last').items[0];
  assert.throws(() => groupPromptItems([...nested, last], [nested[0].id, last.id], 'sd'), /8 层/);
});
test('ungroup preserves outer emphasis on plain and already weighted children', () => {
  for (const [source, result] of [
    ['{smile, blue eyes}', '{smile}, {blue eyes}'],
    ['1.2::smile, 1.4::blue eyes::::', '1.2::smile::, 1.2::1.4::blue eyes::::'],
    ['(smile, (blue eyes:1.2):1.3)', '(smile:1.3), ((blue eyes:1.2):1.3)'],
  ]) {
    const group = parsePrompt(source, BUILTIN_TAGS).items[0];
    const ungrouped = ungroupPromptItem(group, BUILTIN_TAGS);
    assert.equal(serializePrompt(ungrouped), result);
    assert.deepEqual(promptLeaves(ungrouped).map((row) => row.tagId), ['builtin-smile', 'builtin-blue-eyes']);
  }
});
test('cross-column moves carry ancestor weights, preserve source data and reject any destination overlap', () => {
  const from = parsePrompt('1.2::smile, {rain, fog}::, moon').items, to = parsePrompt('stars').items;
  const id = from[0].children[1].children[0].id;
  const moved = moveBetweenPrompts(from, to, id);
  assert.equal(serializePrompt(moved.from), '1.2::smile, {fog}::, moon');
  assert.equal(serializePrompt(moved.to), 'stars, 1.2::{rain}::');
  assert.equal(serializePrompt(from), '1.2::smile, {rain, fog}::, moon');
  assert.throws(() => moveBetweenPrompts(from, parsePrompt('rain').items, id), /已包含/);
  assert.throws(() => moveBetweenPrompts(from, parsePrompt('{fog, stars}').items, from[0].id), /已包含/);
});
test('NovelAI numerical weights are gated to v4 models and adjustments never create reset syntax', () => {
  assert.equal(numericPromptGroups({ params: { model: 'nai-diffusion-4-5-full' } }), true);
  assert.equal(numericPromptGroups({ params: { model: 'nai-diffusion-3' } }), false);
  assert.equal(numericPromptGroups({ params: { model: 'gpt-image-2' } }), false);
  const [numeric] = parsePrompt('0.1::smile::').items;
  assert.equal(adjustPromptWeight(numeric, -1, 'novelai').raw, '-0.1::smile::');
  const [legacy] = parsePrompt('{smile, rain}').items;
  assert.equal(adjustPromptWeight({ ...legacy, numericAllowed: false }, -1, 'novelai').raw, 'smile, rain');
});
test('bounded parsing and rendering preserve deeply nested source instead of expanding without limit', () => {
  let source = 'smile, rain';
  for (let i = 0; i < 25; i++) source = `(moon, ${source}:1.1)`;
  const parsed = parsePrompt(source);
  assert.equal(serializePrompt(parsed.items), source);
  assert.ok(promptLeaves(parsed.items).some((row) => row.syntax === 'opaque'));
  assert.ok(promptLeaves(parsed.items).length < 15);
});
