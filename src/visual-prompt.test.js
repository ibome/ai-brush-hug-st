import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePrompt, serializePrompt, findPromptItem } from './prompt-composer.js';
import { selectedPromptItems, copyPromptItems, copyPromptSelection, preserveGroupLabels, removePromptItems, groupPromptSelection, movePromptTo, setPromptWeight, visualPromptPreview } from './visual-prompt.js';
import { normalizeProfile, applyCharacterScene } from './character-profiles.js';

test('nested selection copies inherited weights once and removes without changing unselected data', () => {
  const items = parsePrompt('1.2::smile, {rain, fog}::, moon').items;
  const group = items[0], child = group.children[1].children[0], other = group.children[0];
  assert.equal(selectedPromptItems(items, [group.id, child.id]).length, 1);
  assert.equal(copyPromptItems(items, [child.id, other.id]), '1.2::smile::, 1.2::{rain}::');
  assert.equal(serializePrompt(removePromptItems(items, [child.id])), '1.2::smile, {fog}::, moon');
  assert.equal(serializePrompt(items), '1.2::smile, {rain, fog}::, moon');
});
test('drop reorder works at root and within groups without losing group weight', () => {
  const items = parsePrompt('1.2::smile, rain, fog::, moon').items;
  const moved = movePromptTo(items, items[1].id, { beforeId: items[0].id });
  assert.equal(serializePrompt(moved), 'moon, 1.2::smile, rain, fog::');
  const nested = movePromptTo(items, items[0].children[2].id, { parentId: items[0].id, beforeId: items[0].children[0].id });
  assert.equal(serializePrompt(nested), '1.2::fog, smile, rain::, moon');
  assert.equal(serializePrompt(items), '1.2::smile, rain, fog::, moon');
});
test('selected material groups and unchanged groups retain labels across reparsing', () => {
  const items = parsePrompt('{blue hair, green eyes}, moon').items;
  Object.assign(items[0], { name: '旅人外貌', color: 'green' });
  const chosen = copyPromptSelection(items, [items[0].id]);
  assert.equal(chosen[0].name, '旅人外貌');
  const next = preserveGroupLabels(chosen, parsePrompt('garden, {blue hair, green eyes}, ink').items);
  assert.equal(next[1].name, '旅人外貌'); assert.equal(next[1].color, 'green');
  assert.equal(serializePrompt(items), '{blue hair, green eyes}, moon');
});
test('moving into a group and moving out retain carried emphasis and empty destination ancestors', () => {
  const items = parsePrompt('{smile, rain}, moon').items;
  const nested = movePromptTo(items, items[1].id, { parentId: items[0].id });
  assert.equal(serializePrompt(nested), '{smile, rain, moon}');
  const outside = movePromptTo(nested, items[0].children[0].id);
  assert.equal(serializePrompt(outside), '{rain, moon}, {smile}');
  const single = parsePrompt('1.2::{smile, rain}::').items;
  const inner = single[0].children[0];
  const moved = movePromptTo(single, inner.children[0].id, { parentId: single[0].id });
  assert.equal(serializePrompt(moved), '1.2::{rain}, {smile}::');
  assert.ok(findPromptItem(moved, single[0].id));
});
test('moving a group into itself or descendants fails atomically', () => {
  const items = parsePrompt('1.2::smile, {rain, fog}::').items, before = serializePrompt(items);
  assert.throws(() => movePromptTo(items, items[0].id, { parentId: items[0].id }), /自身/);
  assert.throws(() => movePromptTo(items, items[0].id, { parentId: items[0].children[1].id }), /自身/);
  assert.equal(serializePrompt(items), before);
});
test('grouping nested siblings rebuilds parent scopes and rejects mixed levels', () => {
  const items = parsePrompt('{smile, rain, fog}, moon').items;
  const grouped = groupPromptSelection(items, items[0].children.slice(0, 2).map((item) => item.id), 'novelai');
  assert.equal(serializePrompt(grouped), '{1::smile, rain::, fog}, moon');
  assert.throws(() => groupPromptSelection(items, [items[0].children[0].id, items[1].id], 'novelai'), /同一层级/);
});
test('exact weight respects model grammar and rejects reset, nonfinite or unsupported syntax', () => {
  const item = parsePrompt('smile').items[0];
  assert.equal(setPromptWeight(item, 1.35, 'novelai').raw, '1.35::smile::');
  assert.equal(setPromptWeight(item, 0, 'sd').raw, '(smile:0)');
  assert.throws(() => setPromptWeight(item, 0, 'novelai'), /不可设为 0/);
  assert.throws(() => setPromptWeight(item, 0.001, 'novelai'), /不可设为 0/);
  assert.throws(() => setPromptWeight(item, 1.5, 'novelai', { numeric: false }), /增强/);
  assert.throws(() => setPromptWeight(item, Infinity, 'sd'), /范围/);
  assert.throws(() => setPromptWeight(parsePrompt('[cat|dog]').items[0], 1.3, 'sd'), /不支持/);
  assert.equal(item.raw, 'smile');
});
const role = normalizeProfile({ id: 'role-a', name: '旅人', enabled: true, tags: 'blue hair', negative: 'red eyes' });
const scene = { entries: [{ profileId: role.id, profile: role }] };
test('NovelAI preview exposes native role captions separately and preserves the original snapshot', () => {
  const snapshot = { provider: 'novelai', params: { model: 'nai-diffusion-4-5-full', positive: 'garden', negative: 'text', artist: 'watercolor' }, characterScene: scene };
  const before = structuredClone(snapshot);
  assert.deepEqual(visualPromptPreview(snapshot, { positive: 'forest' }), [
    { title: '主提示词', text: 'watercolor, forest' }, { title: '负面提示词', text: 'text' },
    { title: '旅人 · 角色正向', text: 'blue hair' }, { title: '旅人 · 角色负面', text: 'red eyes' },
  ]);
  assert.deepEqual(snapshot, before);
});
test('frozen and non-native role previews rebuild only once from edited shared prompts', () => {
  const snapshot = applyCharacterScene({ provider: 'openai', params: { model: 'gpt-image-2', artist: 'ink', positive: 'garden', negative: '' } }, scene);
  const blocks = visualPromptPreview(snapshot, { positive: 'forest' });
  assert.equal(blocks.length, 1);
  assert.equal((blocks[0].text.match(/Character 1/g) || []).length, 1);
  assert.match(blocks[0].text, /^ink\nforest\nCharacter 1/);
  assert.match(blocks[0].text, /Avoid for characters: red eyes/);
});
test('OpenAI compatible NAI negative and mapped ComfyUI preview follow provider capabilities', () => {
  assert.deepEqual(visualPromptPreview({ provider: 'openai', params: { model: 'nai-diffusion-4-5-full', artist: 'ink', positive: 'smile', negative: 'text' } }), [
    { title: '主提示词', text: 'ink\nsmile' }, { title: '负面提示词', text: 'text' },
  ]);
  assert.equal(visualPromptPreview({ provider: 'openai', params: { model: 'gpt-image-2', positive: 'smile', negative: 'text' } }).length, 1);
  const snapshot = { provider: 'comfyui', config: { mapping: { positive: '6.text' }, params: { positive: 'garden', negative: 'text' } } };
  assert.deepEqual(visualPromptPreview(snapshot), [{ title: '主提示词', text: 'garden' }]);
  snapshot.config.mapping.negative = '7.text';
  assert.equal(visualPromptPreview(snapshot).length, 2);
});
