import test from 'node:test';
import assert from 'node:assert/strict';
import { applyChatImageEdit, applyChatImageStyle, chatImageBelongsTo, chatImagePrompt, chatImagePromptText } from './chat-image-actions.js';
globalThis.window ||= { addEventListener() {} };
const { imageEditDraft, prepareImageEdit } = await import('./image-edit.js');
const { applyCharacterScene } = await import('./character-profiles.js');

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

test('chat repeat uses current artist and negatives while preserving the original scene and generation settings', () => {
  const original = { provider: 'novelai', params: { model: 'nai-diffusion-4-5-full', seed: 17,
    positive: 'temple, moonlight', negative: 'old negative', artist: 'old artist', width: 832, height: 1216, steps: 28 } };
  const current = { provider: 'novelai', params: { model: 'nai-diffusion-3', seed: 999,
    positive: 'unrelated workshop scene', artist: '2::artist:new::', negative: 'new negative', width: 1024, height: 1024 } };
  const before = structuredClone(original), currentBefore = structuredClone(current);
  const styled = applyChatImageStyle(imageEditDraft(original), current);
  const result = prepareImageEdit(applyChatImageEdit(styled, undefined, true, () => 23));
  assert.equal(result.params.artist, '2::artist:new::');
  assert.equal(result.params.negative, 'new negative');
  for (const key of ['positive', 'model', 'width', 'height', 'steps']) assert.equal(result.params[key], original.params[key]);
  assert.equal(result.params.seed, 23);
  assert.deepEqual(original, before);
  assert.deepEqual(current, currentBefore);
});

test('clearing artist or negative in current settings also clears it for the next chat repeat', () => {
  for (const provider of ['novelai', 'openai', 'sdwebui']) {
    const draft = { provider, params: { positive: 'garden', artist: 'old artist', negative: 'old negative' } };
    const result = applyChatImageStyle(draft, { provider, params: { artist: '', negative: '' } });
    assert.equal(result.params.artist, '');
    assert.equal(result.params.negative, '');
    assert.equal(result.params.positive, 'garden');
  }
});

test('ComfyUI chat repeat reads current negative without replacing the original workflow or its mapping', () => {
  const draft = { provider: 'comfyui', config: { graph: { old: {} }, mapping: { seed: '3.inputs.seed' },
    params: { positive: 'garden', negative: 'old negative', seed: 17 } } };
  const result = applyChatImageEdit(applyChatImageStyle(draft, { provider: 'comfyui',
    config: { graph: { other: {} }, mapping: {}, params: { positive: 'other scene', negative: 'new negative' } } }),
  undefined, true, () => 23);
  assert.deepEqual(result.config.graph, draft.config.graph);
  assert.deepEqual(result.config.mapping, draft.config.mapping);
  assert.equal(result.config.params.positive, 'garden');
  assert.equal(result.config.params.negative, 'new negative');
  assert.equal(result.config.params.seed, 23);
  assert.throws(() => applyChatImageStyle(draft, { provider: 'openai', params: {} }), /模式不一致/);
});

test('legacy example prefixes are removed without replacing the actual scene or deleting an example-only prompt', () => {
  const example = 'a quiet alpine lake, mountain chalet';
  const current = { provider: 'novelai', params: { artist: 'new artist', negative: 'new negative' } };
  for (const positive of [`${example}, temple, moonlight`, 'temple, moonlight', example]) {
    const draft = { provider: 'novelai', params: { positive } };
    const result = applyChatImageStyle(draft, current, example);
    assert.equal(result.params.positive, positive === example ? example : 'temple, moonlight');
    assert.equal(draft.params.positive, positive);
  }
});

test('chat repeat updates global negatives once and preserves the original character directions', () => {
  const original = applyCharacterScene({ provider: 'novelai', params: { model: 'nai-diffusion-3',
    positive: 'temple, moonlight', negative: 'old negative', artist: 'old artist', seed: 17 } },
  { entries: [{ profileId: 'a', profile: { id: 'a', name: 'A', tags: 'black hair', negative: 'red hair' } }] });
  const current = { provider: 'novelai', params: { artist: 'new artist', negative: 'new negative' } };
  const next = prepareImageEdit(applyChatImageStyle(imageEditDraft(original), current));
  assert.equal(next.characterScene.baseNegative, 'new negative');
  assert.deepEqual(next.characterScene.characterPrompts, original.characterScene.characterPrompts);
  assert.equal(next.params.negative, 'new negative, red hair');
  assert.equal(next.params.positive.match(/black hair/g).length, 1);
  const edited = prepareImageEdit(applyChatImageEdit(imageEditDraft(original),
    { positive: 'library', negative: 'explicit image-only negative' }));
  assert.equal(edited.characterScene.baseNegative, 'explicit image-only negative');
  assert.equal(edited.params.artist, 'old artist');
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
