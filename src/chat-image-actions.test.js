import test from 'node:test';
import assert from 'node:assert/strict';
import { applyChatImageEdit, chatImageBelongsTo, chatImagePrompt, chatImagePromptText } from './chat-image-actions.js';

test('image operations require the same chat, message, branch, swipe and slot', () => {
  const binding = { id: 'image-slot', chatKey: 'chat-a', branch: 'text-hash', swipe: 0, slot: 1 };
  assert.equal(chatImageBelongsTo({ chatBinding: binding }, { ...binding }), true);
  for (const key of Object.keys(binding)) {
    assert.equal(chatImageBelongsTo({ chatBinding: binding }, { ...binding, [key]: 'different' }), false);
  }
  assert.equal(chatImageBelongsTo({}, binding), false);
});

test('prompt editing uses the base scene instead of merged character text', () => {
  const row = { snapshot: { params: { positive: 'garden\nCharacter 1: green hair', negative: 'blur, bad hands' },
    characterScene: { applied: true, basePositive: 'garden', baseNegative: 'blur' } } };
  assert.deepEqual(chatImagePrompt(row), { positive: 'garden', negative: 'blur' });
  assert.deepEqual(chatImagePrompt({ snapshot: { config: { params: { positive: 'forest' } } } }),
    { positive: 'forest', negative: '' });
});

test('copy includes the actual global prompts, artist and native character prompts', () => {
  const text = chatImagePromptText({ snapshot: { provider: 'novelai',
    params: { model: 'nai-diffusion-4-5-full', artist: 'artist:test', positive: 'masterpiece, garden', negative: 'blur' },
    characterScene: { applied: true, characterPrompts: [{ name: 'A', positive: 'green hair', negative: 'bad hands' }] } } });
  for (const value of ['artist:test', 'masterpiece, garden', 'blur', 'green hair', 'bad hands']) assert.ok(text.includes(value));
  const legacy = chatImagePromptText({ snapshot: { provider: 'novelai',
    params: { model: 'nai-diffusion-3', positive: 'garden\nCharacter 1: green hair' },
    characterScene: { applied: true, characterPrompts: [{ positive: 'green hair' }] } } });
  assert.equal(legacy.match(/green hair/g).length, 1);
  assert.equal(chatImagePromptText({}), '');
});

test('NovelAI repeat gets a new seed and retains all other frozen parameters', () => {
  const draft = { provider: 'novelai', params: { seed: 17, positive: 'garden', negative: 'blur',
    artist: 'artist:test', width: 832, height: 1216, steps: 28 }, characterScene: { basePositive: 'garden' } };
  const before = structuredClone(draft);
  const next = applyChatImageEdit(draft, undefined, true, () => 17);
  assert.equal(next.params.seed, 18);
  assert.deepEqual({ ...next.params, seed: 17 }, draft.params);
  assert.deepEqual(next.characterScene, draft.characterScene);
  assert.deepEqual(draft, before);
  assert.equal(applyChatImageEdit({ provider: 'novelai', params: { seed: 4294967295 } }, undefined, true,
    () => 4294967295).params.seed, 0);
});

test('OpenAI repeat only randomizes an explicit seed and preserves other extra parameters', () => {
  const draft = { provider: 'openai', params: { positive: 'garden', extra: '{"seed":5,"quality":"high"}' } };
  assert.deepEqual(JSON.parse(applyChatImageEdit(draft, undefined, true, () => 9).params.extra), { seed: 9, quality: 'high' });
  const seedless = applyChatImageEdit({ provider: 'openai', params: { extra: '{"quality":"high"}' } }, undefined, true);
  assert.deepEqual(JSON.parse(seedless.params.extra), { quality: 'high' });
});

test('ComfyUI repeat requires seed mapping; prompt edits retain the original seed and source', () => {
  const draft = { provider: 'comfyui', config: { mapping: {}, params: { seed: 17, positive: 'garden', negative: 'blur' } } };
  assert.throws(() => applyChatImageEdit(draft, undefined, true), /随机种子/);
  draft.config.mapping.seed = '3.inputs.seed';
  assert.equal(applyChatImageEdit(draft, undefined, true, () => 23).config.params.seed, 23);
  const result = applyChatImageEdit(draft, { positive: ' library ', negative: ' bad hands ' });
  assert.deepEqual(result.config.params, { seed: 17, positive: 'library', negative: 'bad hands' });
  assert.equal(draft.config.params.positive, 'garden');
});

test('invalid or oversized prompt edits fail before changing a source snapshot', () => {
  const draft = { provider: 'novelai', params: { positive: 'garden' } };
  for (const edits of [null, { positive: '', negative: '' }, { positive: 'x'.repeat(32001), negative: '' },
    { positive: 'garden', negative: 17 }]) assert.throws(() => applyChatImageEdit(draft, edits), /正向提示词/);
  assert.equal(draft.params.positive, 'garden');
});
