import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {} };
const { settingsResetPatch, RESET_SCOPES } = await import('./settings-reset.js');
const { SETTINGS_DEFAULTS } = await import('./ui/settings.js');
const { normalizeNovelAIState, NOVELAI_DEFAULTS } = await import('./ui/novelai.js');
const { normalizeOpenAIState } = await import('./ui/openai.js');
const { normalizeComfyState } = await import('./ui/comfyui.js');
const { normalizeSDWebUIState } = await import('./ui/sdwebui.js');
const { normalizeConnections } = await import('./connections.js');
const { normalizeAssistant } = await import('./prompt-assistant.js');

const ref = 'tavern:88fe3a4a-29e0-4f67-bcab-100cad406186';
function fixture(provider = 'novelai') {
  const state = { ...SETTINGS_DEFAULTS, provider, characterTheme: 'gemini',
    cacheLocation: 'server', cacheDirectory: 'images/custom', auto: false, confirm: true, inline: false,
    triggerPrefix: '<draw>', triggerSuffix: '</draw>', concurrency: 12, generationMode: 'parallel',
    history: ['image-1'], favorites: ['image-1'], artistLibrary: [{ id: 'artist-1' }],
    characterProfiles: { profiles: [{ id: 'profile-1' }] }, comicLibrary: { projects: [{ id: 'comic-1' }] },
    tagLibrary: { custom: ['tag-1'] }, vibeLibrary: [{ id: 'vibe-1' }], assistantSchemes: [{ id: 'saved-scheme' }],
    assistantHistory: [{ id: 'history-1' }], assistantInput: 'keep input', assistantDraft: { scenes: ['keep'] },
    readerSettings: { fontSize: 20 } };
  normalizeNovelAIState(state); normalizeOpenAIState(state); normalizeComfyState(state); normalizeSDWebUIState(state);
  normalizeConnections(state);
  for (const connection of Object.values(state.connections)) {
    Object.assign(connection, { endpoint: 'https://fixture.example/custom/v1', keyRef: ref });
  }
  state.openaiEndpoint = state.connections.openai.endpoint;
  state.openaiPath = '/custom/images/generations'; state.openaiTimeout = 267;
  state.assistant = normalizeAssistant({ source: 'api', endpoint: 'https://text.example/v1', model: 'custom-model',
    apiTransport: 'tavern', keyRef: ref, maxTokens: 16000, temperature: 1.2, includeWorld: true,
    presetMode: 'current', customTemplate: 'custom', autoPrompt: true, autoImage: true, illustrateTemplate: 'default',
    taskMessages: { generate: [{ role: 'system', content: 'custom rule' }] },
    taskPrompts: { generate: { prefix: 'custom prefix', rules: 'custom rules' } } });
  return state;
}

test('general reset restores beginner defaults while keeping connection, theme and storage', () => {
  const state = fixture();
  const next = { ...state, ...settingsResetPatch(state, ['general']) };
  assert.equal(next.auto, true); assert.equal(next.confirm, false); assert.equal(next.inline, true);
  assert.equal(next.triggerPrefix, 'image###'); assert.equal(next.generationMode, 'queue');
  assert.equal(next.concurrency, 2); assert.equal(next.cleanupMode, 'manual');
  for (const key of ['provider', 'characterTheme', 'cacheLocation', 'cacheDirectory', 'connections', 'assistant']) {
    assert.strictEqual(next[key], state[key]);
  }
});

test('current NovelAI reset restores the built-in style and preserves the selected model', () => {
  const state = fixture();
  Object.assign(state.novelai, { model: 'nai-diffusion-3', artist: 'wrong style', negative: 'wrong negative', steps: 40 });
  state.novelaiPresetId = 'saved-preset';
  state.novelaiPresets.push({ id: 'saved-preset', name: 'keep', params: structuredClone(state.novelai) });
  const patch = settingsResetPatch(state, ['generation']);
  assert.equal(patch.novelai.artist, NOVELAI_DEFAULTS.artist);
  assert.equal(patch.novelai.negative, NOVELAI_DEFAULTS.negative);
  assert.equal(patch.novelai.steps, NOVELAI_DEFAULTS.steps);
  assert.equal(patch.novelai.model, 'nai-diffusion-3');
  assert.equal(patch.novelaiPresetId, 'default');
  assert.equal(patch.presetBindings.novelai, '');
  assert.equal(patch.novelaiPresets, undefined);
  assert.equal(patch.openai, undefined);
});

test('OpenAI reset keeps custom model and request compatibility while clearing image references', () => {
  const state = fixture('openai');
  Object.assign(state.openai, { model: 'my-image-model', parameterMode: 'basic', responseFormat: 'url',
    extra: '{"custom_required":true}', width: 2048, artist: 'wrong' });
  Object.assign(state.openai.advanced, { mode: 'inpaint', editPath: '/custom/edits', openAIEditEnabled: true });
  const { openai } = settingsResetPatch(state, ['generation']);
  assert.equal(openai.model, 'my-image-model'); assert.equal(openai.parameterMode, 'basic');
  assert.equal(openai.extra, '{"custom_required":true}'); assert.equal(openai.responseFormat, 'url');
  assert.equal(openai.advanced.editPath, '/custom/edits'); assert.equal(openai.advanced.openAIEditEnabled, true);
  assert.equal(openai.advanced.mode, 'text'); assert.equal(openai.advanced.source, null);
});

test('ComfyUI reset keeps the workflow, mapping and selected checkpoint', () => {
  const state = fixture('comfyui');
  Object.assign(state.comfyui.params, { checkpoint: 'custom.safetensors', vae: 'custom-vae.safetensors', steps: 50 });
  state.comfyui.name = 'My workflow';
  const { comfyui } = settingsResetPatch(state, ['generation']);
  for (const key of ['name', 'graph', 'mapping', 'outputNode']) assert.deepEqual(comfyui[key], state.comfyui[key]);
  assert.equal(comfyui.params.checkpoint, 'custom.safetensors');
  assert.equal(comfyui.params.vae, 'custom-vae.safetensors');
  assert.notEqual(comfyui.params.steps, 50); assert.equal(comfyui.advanced.mode, 'text');
});

test('SDWebUI reset retains its model and VAE', () => {
  const state = fixture('sdwebui');
  Object.assign(state.sdwebui, { model: 'custom checkpoint', vae: 'custom vae', steps: 90 });
  const { sdwebui } = settingsResetPatch(state, ['generation']);
  assert.equal(sdwebui.model, 'custom checkpoint'); assert.equal(sdwebui.vae, 'custom vae');
  assert.notEqual(sdwebui.steps, 90);
});

test('assistant reset is opt-in and retains API compatibility and credentials', () => {
  assert.equal(RESET_SCOPES.find((scope) => scope.id === 'assistant').checked, false);
  const state = fixture();
  Object.assign(state.assistant, { responseMode: 'tool', responseModeOverride: 'json',
    outputParameter: 'max_completion_tokens', omitTemperature: true, outputLimit: 32000 });
  assert.equal(settingsResetPatch(state, ['general', 'generation']).assistant, undefined);
  const patch = settingsResetPatch(state, ['assistant']);
  for (const key of ['source', 'endpoint', 'model', 'apiTransport', 'keyRef', 'responseMode',
    'responseModeOverride', 'outputParameter', 'omitTemperature', 'outputLimit']) {
    assert.equal(patch.assistant[key], state.assistant[key]);
  }
  assert.equal(patch.assistant.maxTokens, 4000); assert.equal(patch.assistant.includeWorld, false);
  assert.equal(patch.assistant.autoImage, false); assert.equal(patch.assistant.presetMode, 'none');
  assert.deepEqual(patch.assistant.taskPrompts, {}); assert.deepEqual(patch.assistant.taskMessages, {});
  assert.equal(patch.assistantSchemeId, '');
});

test('all reset scopes leave credentials, preset libraries and stored works untouched without mutating input', () => {
  for (const provider of ['novelai', 'openai', 'comfyui', 'sdwebui']) {
    const state = fixture(provider), before = structuredClone(state);
    const patch = settingsResetPatch(state, RESET_SCOPES.map((scope) => scope.id));
    const next = { ...state, ...patch };
    for (const key of ['connections', 'connectionProfiles', 'connectionProfileIds', 'openaiEndpoint',
      'openaiPath', 'openaiTimeout', 'novelaiPresets', 'openaiPresets', 'comfyPresets', 'sdwebuiPresets',
      'history', 'favorites', 'artistLibrary', 'characterProfiles', 'comicLibrary', 'vibeLibrary', 'tagLibrary',
      'assistantSchemes', 'assistantInput', 'assistantDraft', 'assistantHistory', 'readerSettings']) {
      assert.strictEqual(next[key], state[key], key);
    }
    assert.deepEqual(state, before);
  }
});

test('generation reset removes only an applicable frozen character scene', () => {
  const state = fixture();
  state.characterSceneOverride = { entries: [{ id: 'character-1' }] };
  state.characterSceneOverrideProvider = 'openai';
  assert.equal(settingsResetPatch(state, ['generation']).characterSceneOverride, undefined);
  state.characterSceneOverrideProvider = 'novelai';
  assert.equal(settingsResetPatch(state, ['generation']).characterSceneOverride, null);
  assert.equal(settingsResetPatch(state, ['assistant']).characterSceneOverride, undefined);
});

test('reset rejects empty or unknown scopes and invalid generation modes', () => {
  for (const scopes of [[], ['unknown'], null, ['general', 'unknown']]) {
    assert.throws(() => settingsResetPatch(fixture(), scopes), /重置范围/);
  }
  assert.throws(() => settingsResetPatch({ provider: 'unknown' }, ['generation']), /模式无效/);
});
