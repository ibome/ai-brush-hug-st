import test from 'node:test';
import assert from 'node:assert/strict';
import { applyChatImageEdit, applyChatImageStyle, chatImageBelongsTo, chatImagePrompt, chatImagePromptText, chatImageTaskBusy } from './chat-image-actions.js';
globalThis.window ||= { addEventListener() {} };
const { imageEditDraft, prepareImageEdit } = await import('./image-edit.js');
const { applyCharacterScene } = await import('./character-profiles.js');
const { normalizeSnapshot } = await import('./ui/drawings.js');
const { createChatPromptStyle, chatPromptText, normalizeChatPromptStyle } = await import('./chat-prompt-style.js');

test('uncertain image tasks permit a new version while active and recoverable failed tasks remain busy', () => {
  for (const status of ['uncertain', 'completed', 'cancelled']) {
    for (const execution of [undefined, { size: 1024 }]) {
      assert.equal(chatImageTaskBusy({ status, execution }), false);
    }
  }
  for (const status of ['queued', 'preparing', 'confirming', 'running', 'paused']) {
    assert.equal(chatImageTaskBusy({ status }), true);
  }
  assert.equal(chatImageTaskBusy({ status: 'failed', stage: 'waiting' }), true);
  assert.equal(chatImageTaskBusy({ status: 'failed', execution: { size: 1024 } }), true);
  assert.equal(chatImageTaskBusy({ status: 'failed', stage: 'rejected' }), false);
  assert.equal(chatImageTaskBusy(), false);
});

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

test('chat repeat uses current preset prompts while preserving the original scene and generation settings', () => {
  const original = { provider: 'novelai', params: { model: 'nai-diffusion-4-5-full', seed: 17,
    positive: 'temple, moonlight', negative: 'old negative', artist: 'old artist', width: 832, height: 1216, steps: 28 } };
  const current = { provider: 'novelai', params: { model: 'nai-diffusion-3', seed: 999,
    positive: 'watercolor, soft lighting', artist: '2::artist:new::', negative: 'new negative', width: 1024, height: 1024 } };
  const before = structuredClone(original), currentBefore = structuredClone(current);
  const styled = applyChatImageStyle(imageEditDraft(original), current);
  const result = prepareImageEdit(applyChatImageEdit(styled, undefined, true, () => 23));
  assert.equal(result.params.artist, '2::artist:new::');
  assert.equal(result.params.negative, 'new negative');
  assert.equal(result.params.positive, 'watercolor, soft lighting, temple, moonlight');
  for (const key of ['model', 'width', 'height', 'steps']) assert.equal(result.params[key], original.params[key]);
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

test('ComfyUI chat repeat reads current positive and negative without replacing the original workflow or its mapping', () => {
  const draft = { provider: 'comfyui', config: { graph: { old: {} }, mapping: { seed: '3.inputs.seed' },
    params: { positive: 'garden', negative: 'old negative', seed: 17 } } };
  const result = applyChatImageEdit(applyChatImageStyle(draft, { provider: 'comfyui',
    config: { graph: { other: {} }, mapping: {}, params: { positive: 'other scene', negative: 'new negative' } } }),
  undefined, true, () => 23);
  assert.deepEqual(result.config.graph, draft.config.graph);
  assert.deepEqual(result.config.mapping, draft.config.mapping);
  assert.equal(result.config.params.positive, 'other scene, garden');
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

test('switching presets repeatedly replaces the recorded prefix without accumulating old styles', () => {
  const original = { provider: 'novelai', params: { positive: 'oil painting, temple, moonlight', artist: 'oil artist', negative: 'old negative' },
    chatPromptStyle: createChatPromptStyle('oil painting', 'temple, moonlight') };
  let snapshot = original;
  for (const [prefix, artist, negative] of [['watercolor', 'new artist', 'new negative'], ['clean line art', '', ''], ['', '', '']]) {
    snapshot = prepareImageEdit(applyChatImageStyle(imageEditDraft(snapshot),
      { provider: 'novelai', params: { positive: prefix, artist, negative } }));
    assert.equal(snapshot.params.positive, [prefix, 'temple, moonlight'].filter(Boolean).join(', '));
    assert.equal(snapshot.params.artist, artist);
    assert.equal(snapshot.params.negative, negative);
    assert.equal(snapshot.chatPromptStyle.scene, 'temple, moonlight');
    assert.equal(snapshot.chatPromptStyle.prefix, prefix);
    assert.deepEqual(normalizeSnapshot(JSON.parse(JSON.stringify(snapshot))).chatPromptStyle, snapshot.chatPromptStyle);
  }
  assert.equal(original.params.positive, 'oil painting, temple, moonlight');
});

test('legacy chat snapshots recover only an exact tagged scene and replace the old preset prefix', () => {
  const current = { provider: 'novelai', params: { positive: 'watercolor', artist: 'new artist', negative: '' } };
  for (const positive of ['oil painting, temple, moonlight', 'temple, moonlight']) {
    const result = applyChatImageStyle({ provider: 'novelai', params: { positive } }, current, '', 'temple, moonlight');
    assert.equal(result.params.positive, 'watercolor, temple, moonlight');
    assert.equal(result.chatPromptStyle.scene, 'temple, moonlight');
  }
  const edited = applyChatImageStyle({ provider: 'novelai', params: { positive: 'library, open book' } },
    current, '', 'temple, moonlight');
  assert.equal(edited.params.positive, 'watercolor, library, open book');
  const repeated = applyChatImageStyle({ provider: 'novelai', params: { positive: 'watercolor, library, open book' } },
    current, '', 'temple, moonlight');
  assert.equal(repeated.params.positive, 'watercolor, library, open book');
});

test('preset switching retains edited scenes and frozen character directions on native and legacy NAI models', () => {
  for (const model of ['nai-diffusion-3', 'nai-diffusion-4-5-full']) {
    const original = applyCharacterScene({ provider: 'novelai',
      params: { model, positive: 'oil painting, garden', negative: 'old negative', artist: 'old artist' },
      chatPromptStyle: createChatPromptStyle('oil painting', 'garden') },
    { entries: [{ profileId: 'a', profile: { id: 'a', name: 'A', tags: 'black hair', negative: 'red hair' } }] });
    const edited = prepareImageEdit(applyChatImageEdit(imageEditDraft(original),
      { positive: 'oil painting, library', negative: 'edited negative' }));
    const switched = prepareImageEdit(applyChatImageStyle(imageEditDraft(edited),
      { provider: 'novelai', params: { positive: 'watercolor', artist: '', negative: 'new negative' } }, '', 'garden'));
    assert.equal(switched.characterScene.basePositive, 'watercolor, library');
    assert.equal(switched.characterScene.baseNegative, 'new negative');
    assert.deepEqual(switched.characterScene.characterPrompts, original.characterScene.characterPrompts);
    assert.deepEqual(normalizeSnapshot(switched).chatPromptStyle, createChatPromptStyle('watercolor', 'library'));
    const next = prepareImageEdit(applyChatImageStyle(imageEditDraft(switched),
      { provider: 'novelai', params: { positive: 'ink sketch', artist: '', negative: '' } }));
    assert.equal(next.characterScene.basePositive, 'ink sketch, library');
    assert.equal(next.params.positive.match(/black hair/g)?.length || 0, model === 'nai-diffusion-3' ? 1 : 0);
    assert.ok(!next.params.positive.includes('oil painting'));
    assert.ok(!next.params.positive.includes('watercolor'));
  }
});

test('an explicitly replaced scene stays intact and original-style rerolls retain all prompt fields', () => {
  const original = { provider: 'novelai', params: { seed: 17, positive: 'oil painting, garden', negative: 'blur', artist: 'old artist' },
    chatPromptStyle: createChatPromptStyle('oil painting', 'garden') };
  const edited = prepareImageEdit(applyChatImageEdit(imageEditDraft(original),
    { positive: 'snowy mountain, sunset', negative: '' }));
  assert.deepEqual(edited.chatPromptStyle, createChatPromptStyle('', 'snowy mountain, sunset'));
  const repeat = prepareImageEdit(applyChatImageEdit(imageEditDraft(original), undefined, true, () => 23));
  assert.equal(repeat.params.positive, original.params.positive);
  assert.equal(repeat.params.negative, original.params.negative);
  assert.equal(repeat.params.artist, original.params.artist);
  assert.equal(repeat.params.seed, 23);
});

test('chat prompt provenance rejects mismatched or oversized imports and never adds the example to a reroll', () => {
  for (const value of [null, { version: 2, prefix: '', scene: 'garden' }, { version: 1, prefix: '', scene: '' },
    { version: 1, prefix: 'x'.repeat(16000), scene: 'x'.repeat(16000) },
    { version: 1, prefix: 1, scene: 'garden' }]) {
    assert.equal(normalizeChatPromptStyle(value, 'garden'), null);
  }
  const stale = { provider: 'novelai', params: { positive: 'library' }, chatPromptStyle: createChatPromptStyle('old style', 'garden') };
  assert.equal(normalizeSnapshot(stale).chatPromptStyle, undefined);
  assert.equal(normalizeChatPromptStyle(createChatPromptStyle('', 'garden'), 17), null);
  const example = 'a quiet alpine lake, mountain chalet';
  const repeated = applyChatImageStyle({ provider: 'novelai', params: { positive: 'garden' } },
    { provider: 'novelai', params: { positive: example, artist: '', negative: '' } }, example);
  assert.equal(repeated.params.positive, 'garden');
  assert.equal(chatPromptText(repeated.chatPromptStyle), 'garden');
  assert.throws(() => applyChatImageStyle({ provider: 'openai', params: { positive: 'x'.repeat(20000) } },
    { provider: 'openai', params: { positive: 'y'.repeat(20000) } }), /32000/);
});

test('importing an image as current parameters does not add a second copy of its scene on reroll', () => {
  const original = { provider: 'novelai', params: { positive: 'oil painting, garden', negative: '', artist: '' },
    chatPromptStyle: createChatPromptStyle('oil painting', 'garden') };
  const result = applyChatImageStyle(imageEditDraft(original), original);
  assert.equal(result.params.positive, 'oil painting, garden');
  assert.deepEqual(result.chatPromptStyle, original.chatPromptStyle);
});
