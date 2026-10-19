import { randomUUID } from '../crypto-compat.js';
import { postWindowMessage } from '../host-compat.js';
import { escapeHtml, downloadJson } from '../config.js';
import { assistantHostRequest, credentialRequest, currentAccount, currentChat, extensionChatRequest, isInstalled, persistUIState, readUIState, storageKey, storageRequest } from '../runtime.js';
import { readBrowserCache, writeBrowserCache } from '../browser-cache.js';
import { apiError, publicExtensionTask } from '../extension-api.js';
import { createExtensionTaskService } from '../extension-tasks.js';
import { extensionCapabilities, extensionPresets, prepareExtensionSnapshot, publicImageParameters } from './extension-generation.js';
import { imageEditDraft, prepareImageEdit, imageEditMessages, applyImageRewrite, drawingSeed } from '../image-edit.js';
import { applyChatImageEdit, chatImageBelongsTo } from '../chat-image-actions.js';
import { renderImageEditor } from './image-editor.js';
import { NovelAIProcessingPanel } from './novelai-processing.js';
import { processingSnapshot, prepareProcessingSource, validateProcessingDraft, buildProcessingRequest,
  processingEndpoint, processingTitle, processingVariant } from '../novelai-processing.js';
import '../styles/novelai-processing.css';
import { AdvancedPanel } from './advanced.js';
import { BackupPanel } from './backup.js';
import { RELEASE } from '../release.js';
import { ChangelogPanel } from './changelog.js';
import { ComponentsPanel } from './components.js';
import { ReleasePanel } from './release-panel.js';
import { NetworkDiagnosticPanel } from './network-diagnostics.js';
import { DebugToolsPanel } from './debug-tools.js';
import { recentGenerationFailures } from '../debug-errors.js';
import '../styles/network-diagnostics.css';
import { ReferenceAssets, normalizeReferenceImage, assetBase64 } from '../reference-assets.js';
import { advancedOf, validateAdvanced, encodeVibe } from '../advanced-generation.js';
import { prepareAdvancedPayload, finishAdvancedImages } from '../advanced-payload.js';
import { watchComfyProgress } from '../comfy-advanced.js';
import '../styles/advanced.css';
import { groupVersions, currentDrawing, versionGroupId, editRelation, drawingGroups, validImageId } from '../../server/linghuashi-storage/image-versions.mjs';
import '../styles/image-editor.css';
import { normalizeAssistant, assistantConnectionSync, assistantModelNames, requestAssistantModels, buildAssistantMessages, parseAssistantResult, requestAssistantAPI, applyAssistantPlan } from '../prompt-assistant.js';
import { renderAssistant, assistantModelChoices } from './assistant.js';
import '../styles/assistant.css';
import { migrateProfileLibrary, normalizeProfileLibrary, normalizeProfile, effectiveProfiles, saveProfile, deleteProfile,
  updateProfileChat, resolveCharacterScene, applyCharacterScene, normalizeCharacterScene, restoreSceneProfiles } from '../character-profiles.js';
import { renderCharacters as renderCharacterPage, renderCharacterSelection } from './characters.js';
import { ProfileAIPanel } from './profile-ai.js';
import { requestAssistantText } from '../prompt-assistant.js';
import '../styles/characters.css';
import '../styles/profile-ai.css';
import { CONNECTION_PROVIDERS, normalizeConnection, normalizeConnections, resolvePresetConnection,
  saveConnectionProfile, deleteConnectionProfile, setCurrentConnection } from '../connections.js';
import { emptyArtist, normalizeArtistLibrary, saveArtist, importArtistLibrary, applyArtist } from '../artist-library.js';
import { renderArtists, renderArtistQuickPick } from './artists.js';
import { renderNamedConnections, renderPresetBinding } from './named-connections.js';
import '../styles/artists.css';
import { normalizeTagLibrary, allTagTemplates } from '../tag-library.js';
import { TagLibraryPanel, attachPromptTagButtons } from './tags.js';
import { visualPromptPreview } from '../visual-prompt.js';
import { WorkbenchPanel } from './workbench.js';
import { normalizeWorkbench, normalizeReviews, reviewValue, setReview, BATCH_LIMIT } from '../prompt-workbench.js';
import { normalizeVibeLibrary } from '../vibe-library.js';
import '../styles/workbench.css';
import '../styles/tags.css';
import '../styles/prompt-editor.css';
import { icon, paintIcons } from '../icons.js';
import { navigation, samples, styles } from './sample-data.js';
import { pluginIcon } from './branding.js';
import { characterThemeAccent, getCharacterTheme } from './appearance.js';
import { renderGenerationTransition } from './generation-transition.js';
import '../styles/generation-transition.css';
import { createFloatingMenu } from './floating-menu.js';
import { GenerationQueue, GenerationError, buildNovelAIRequest, submitGeneration, downloadResults, cancelComfyPending } from '../generation.js';
import { TaskPersistence, createBrowserTaskRequest } from '../task-persistence.js';
import '../styles/tasks.css';
import { validBinding } from '../chat.js';
import chibiEating from '../assets/themes/whale/whale-girl-eating.webp';
import chibiThinking from '../assets/themes/whale/whale-girl-thinking.webp';
import chibiSad from '../assets/themes/whale/whale-girl-sad.webp';
import chibiExcited from '../assets/themes/whale/whale-girl-excited.webp';
import chibiDeadpan from '../assets/themes/whale/whale-girl-deadpan.webp';
import claudeSmile from '../assets/themes/claude/claude-smile.webp';
import claudeReading from '../assets/themes/claude/claude-reading.webp';
import claudePuzzled from '../assets/themes/claude/claude-puzzled.webp';
import claudeSharing from '../assets/themes/claude/claude-sharing.webp';
import claudeCompanion from '../assets/themes/claude/claude-companion.webp';
import geminiGreeting from '../assets/themes/gemini/gemini-greeting.webp';
import geminiShy from '../assets/themes/gemini/gemini-shy.webp';
import geminiThinking from '../assets/themes/gemini/gemini-thinking.webp';
import geminiSmile from '../assets/themes/gemini/gemini-smile.webp';
import geminiReading from '../assets/themes/gemini/gemini-reading.webp';
import gptSmug from '../assets/themes/gpt/gpt-smug.webp';
import gptFocused from '../assets/themes/gpt/gpt-focused.webp';
import gptShy from '../assets/themes/gpt/gpt-shy.webp';
import gptDeadpan from '../assets/themes/gpt/gpt-deadpan.webp';
import gptWings from '../assets/themes/gpt/gpt-wings.webp';
import glmSmug from '../assets/themes/glm/glm-smug.webp';
import glmDisdain from '../assets/themes/glm/glm-disdain.webp';
import glmReport from '../assets/themes/glm/glm-report.webp';
import glmShy from '../assets/themes/glm/glm-shy.webp';
import glmSleepy from '../assets/themes/glm/glm-sleepy.webp';
import kimiPrism from '../assets/themes/kimi/kimi-prism.webp';
import kimiReading from '../assets/themes/kimi/kimi-reading.webp';
import kimiThinking from '../assets/themes/kimi/kimi-thinking.webp';
import kimiSmile from '../assets/themes/kimi/kimi-smile.webp';
import kimiMusic from '../assets/themes/kimi/kimi-music.webp';
import grokSarcastic from '../assets/themes/grok/grok-sarcastic.webp';
import grokPeace from '../assets/themes/grok/grok-peace.webp';
import grokRebellious from '../assets/themes/grok/grok-rebellious.webp';
import grokFocused from '../assets/themes/grok/grok-focused.webp';
import grokMischievous from '../assets/themes/grok/grok-mischievous.webp';
import doubaoPointing from '../assets/themes/doubao/doubao-pointing.webp';
import doubaoHeart from '../assets/themes/doubao/doubao-heart.webp';
import doubaoTsundere from '../assets/themes/doubao/doubao-tsundere.webp';
import doubaoFocused from '../assets/themes/doubao/doubao-focused.webp';
import doubaoShy from '../assets/themes/doubao/doubao-shy.webp';
import ancientCalm from '../assets/themes/ancient/ancient-calm.webp';
import ancientThinking from '../assets/themes/ancient/ancient-thinking.webp';
import ancientConcerned from '../assets/themes/ancient/ancient-concerned.webp';
import ancientSmile from '../assets/themes/ancient/ancient-smile.webp';
import ancientWaiting from '../assets/themes/ancient/ancient-waiting.webp';
import { GENERATION_MODES, SETTINGS_DEFAULTS, SETTING_LIMITS, normalizeSettings, renderSettings } from './settings.js';
import { identifySkService, probeService, resolveNovelAIService } from './connection.js';
import { NOVELAI_DEFAULTS, NOVELAI_MODELS, NOVELAI_SIZES, isNAI3, supportsVariety, normalizeNovelAI, normalizeNovelAIState, selectedNovelAIPreset, novelAIPresetDirty, loadNovelAIPreset, saveNovelAIPreset, renderNovelAIParameters, renderNovelAIPresets } from './novelai.js';
import { OPENAI_DEFAULTS, OPENAI_MODELS, normalizeOpenAI, normalizeOpenAIState, selectedOpenAIPreset, openAIPresetDirty, loadOpenAIPreset, saveOpenAIPreset, openAIURLs, openAISize, isOpenAINovelAI, usesGPTImage, openAIQualityOptions, buildOpenAIRequest, probeOpenAIModels, filterOpenAIModels, renderOpenAIModelItems, renderOpenAIParameters, renderOpenAIPresets } from './openai.js';
import { COMFY_FIELDS, parseWorkflow, newComfyConfig, autoMapWorkflow, mappingCandidates, normalizeComfyParams, normalizeComfyState, selectedComfyPreset, comfyPresetDirty, loadComfyPreset, saveComfyPreset, applyWorkflowParameters, normalizeComfyEndpoint, probeComfyUI, workflowWarnings, renderComfyWorkflow, renderComfyConnectionOptions, renderComfyService, renderComfyPresets } from './comfyui.js';
import { SDWEBUI_DEFAULTS, normalizeSDWebUI, sdwebuiBase, sdwebuiHeaders, probeSDWebUI, buildSDWebUIRequest, loraPrompt } from '../sdwebui.js';
import { normalizeSDWebUIState, selectedSDWebUIPreset, sdwebuiPresetDirty, loadSDWebUIPreset, saveSDWebUIPreset,
  renderSDWebUIConnection, renderSDWebUIParameters, renderSDWebUIPresets } from './sdwebui.js';
import { DrawingLibrary, normalizeSnapshot, captureSnapshot, restoreSnapshot, makeDrawing, hydrateDrawings, revokeDrawings, filterDrawings, drawingPage, renderDrawingManager, renderDrawingViewer, exportDrawings, importArchive, drawingFilename, saveBlob, formatBytes } from './drawings.js';
import '../styles/drawings.css';

const UI_STORAGE_NAME = 'tavern-draw-preview-ui-v1';
let configCacheAvailable = true;
const initial = {
  page: 'settings',
  ...SETTINGS_DEFAULTS,
  prompt: samples[0].prompt,
  negative: 'low quality, blurry, watermark',
  shape: 'landscape',
  steps: 28,
  cfg: 6,
  seed: -1,
  model: '自定义工作流',
  style: 'natural',
  character: '旅人',
  appearance: '短发，灰绿色眼睛，深色旅行披风，银色肩扣',
  outfit: '深色旅行披风',
  profile: '默认预设',
  sampler: 'Euler ancestral',
  scheduler: 'Karras',
  history: ['lake', 'mountain'],
  favorites: [],
  search: '',
  favoriteOnly: false,
};
let state;
let savedUI = {};
try {
  savedUI = readUIState(UI_STORAGE_NAME);
  state = { ...initial, ...savedUI };
} catch {
  state = { ...initial };
}
Object.assign(state, normalizeSettings(state));
normalizeNovelAIState(state);
normalizeComfyState(state);
normalizeOpenAIState(state);
normalizeSDWebUIState(state);
normalizeConnections(state);
state.artistLibrary = normalizeArtistLibrary(state.artistLibraryVersion === 1 ? state.artistLibrary
  : styles.map((style) => ({ id: style.id, name: style.title, category: '基础风格', artist: style.tags, target: 'all' })));
state.artistLibraryVersion = 1;
state.tagLibrary = normalizeTagLibrary(state.tagLibrary);
state.workbench = normalizeWorkbench(state.workbench);
state.drawingReviews = normalizeReviews(state.drawingReviews);
state.vibeLibrary = normalizeVibeLibrary(state.vibeLibrary);
if (!state.assistantDefaultsVersion) {
  if (state.assistant?.maxTokens === 1600) state.assistant.maxTokens = 4000;
  state.assistantDefaultsVersion = 1;
}
state.assistant = normalizeAssistant(state.assistant);
state.characterProfiles = migrateProfileLibrary(savedUI);
state.characterSceneOverride = normalizeCharacterScene(state.characterSceneOverride);
state.assistantInput = typeof state.assistantInput === 'string' ? state.assistantInput.slice(0, 32000) : '';
try { state.assistantDraft = state.assistantDraft ? parseAssistantResult(JSON.stringify(state.assistantDraft), { stored: true }) : null; }
catch { state.assistantDraft = null; }
state.history = Array.isArray(state.history) ? state.history.filter((id) => samples.some((sample) => sample.id === id)) : [...initial.history];
state.favorites = Array.isArray(state.favorites) ? state.favorites.filter((id) => samples.some((sample) => sample.id === id)) : [];
if (!state.settingsVersion) {
  state.page = 'settings';
  state.settingsVersion = 1;
}
if (state.page === 'preferences') state.page = 'settings';
delete state.single;
delete state.retention;
delete state.triggerTag;
let config;
let runtimeState = 'ready';
let toastTimer;
let progress = 0;
let activeSample = samples[0];
let activeDrawingId = null;
let drawings = [];
const drawingLibrary = new DrawingLibrary({ mode: () => state.cacheLocation });
const drawingUI = {
  filters: { source: 'all', start: '', end: '', search: '', favoriteOnly: false },
  page: 1, pageSize: 24, multiselect: false, selection: new Set(),
  busy: false, loading: true, error: '',
  exportOptions: { naming: 'index-title', metadata: 'keep' },
};
const viewerUI = { ids: [], index: 0, details: true, zoom: false, imageId: '', compare: false, compareId: '', review: false, reviewHistory: [] };
let imageEditorUI = null;
let activeJobId = null;
let generationVerified = null;
let libraryReady;
let libraryReload;
let cleanupBusy = false;
let serverPolicySignature;
let serverPolicyWork = Promise.resolve();
const CLEANUP_STORAGE = storageKey('linghuashi-last-cleanup');
let lastCleanup = Number(readBrowserCache(CLEANUP_STORAGE)) || Date.now();
let editPrompt = false;
let host;
let rendering = false;
let renderingEditor = false;
let floatingMenu;
const credentials = {
  novelai: { key: '', endpoint: '' },
  comfyui: { key: '', endpoint: '', auth: 'none' },
  openai: { key: '' },
  sdwebui: { key: '', endpoint: '', auth: 'none' },
};
const referenceAssets = new ReferenceAssets({ mode: () => state.cacheLocation });
function saveVibeLibrary(library) {
  const previous = state.vibeLibrary; state.vibeLibrary = library;
  try { persist(); } catch (error) { state.vibeLibrary = previous; throw error; }
}
const advancedPanel = new AdvancedPanel({
  assets: referenceAssets, getSnapshot: () => captureSnapshot(state),
  update: (snapshot) => {
    if (snapshot.provider === 'comfyui') state.comfyui = snapshot.config;
    else state[snapshot.provider] = snapshot.params;
    persist();
  },
  render: () => render(true), encode: encodeCurrentVibe, gallery: () => drawingGroups(drawings),
  useDrawing: materializeReferenceDrawing,
  getVibeLibrary: () => state.vibeLibrary, setVibeLibrary: saveVibeLibrary,
});
const editorAdvancedPanel = new AdvancedPanel({
  id: 'editor', assets: referenceAssets, getSnapshot: () => imageEditorUI?.draft || captureSnapshot(state),
  update: (snapshot) => { if (imageEditorUI) imageEditorUI.draft = snapshot; },
  render: () => { if (imageEditorUI) showImageEditor(); }, encode: encodeCurrentVibe,
  gallery: () => drawingGroups(drawings), useDrawing: materializeReferenceDrawing,
  getVibeLibrary: () => state.vibeLibrary, setVibeLibrary: saveVibeLibrary,
  disabled: () => !imageEditorUI || imageEditorUI.busy || imageEditorUI.submitting,
});
const processingPanel = new NovelAIProcessingPanel({
  storageLocation: () => state.cacheLocation, currentParams: () => state.novelai,
  service: () => {
    const service = resolveNovelAIService(credentials.novelai.key, credentials.novelai.endpoint);
    return { official: service.id === 'official', label: service.title || service.message || 'NovelAI 接口' };
  },
  closeTags: () => tagPanel.close(),
  openTags: ({ target, input, visual, params, apply, closed }) => tagPanel.open({
    target, visual, label: '图片增强草稿',
    getContext: () => ({ provider: 'novelai', params: params() }),
    getPreview: (edits) => visualPromptPreview({ provider: 'novelai', params: params() }, edits),
    insert: (next) => { apply(next); input.value = next[target]; }, closed,
  }),
  submit: enqueueProcessing,
});
const credentialState = Object.fromEntries(CONNECTION_PROVIDERS.map((provider) => [provider, {
  dirty: false, revision: 0, timer: null, writing: Promise.resolve(), message: '', error: false,
}]));
let presetBusy = false;
const artistUI = { search: '', category: '', favoriteOnly: false, mode: 'replace', quality: false, negative: false,
  dirty: false, draft: structuredClone(state.artistLibrary[0] || null), previewBusy: false };
function globalTagContext() {
  let params = state.provider === 'comfyui' ? state.comfyui.params : state[state.provider];
  const frozen = state.characterSceneOverride;
  if (frozen?.applied && (!state.characterSceneOverrideProvider || state.characterSceneOverrideProvider === state.provider)) {
    params = { ...params, positive: frozen.basePositive, negative: frozen.baseNegative };
  }
  return { provider: state.provider, params,
    mapping: state.comfyui.mapping };
}
function insertGlobalTags(params) {
  const previous = state.provider === 'comfyui' ? state.comfyui.params : state[state.provider];
  const previousScene = state.characterSceneOverride;
  if (state.provider === 'comfyui') state.comfyui.params = params;
  else state[state.provider] = params;
  if (previousScene?.applied && (!state.characterSceneOverrideProvider || state.characterSceneOverrideProvider === state.provider)) {
    state.characterSceneOverride = { ...previousScene, basePositive: params.positive, baseNegative: params.negative };
  }
  try { persist(); }
  catch (error) {
    if (state.provider === 'comfyui') state.comfyui.params = previous;
    else state[state.provider] = previous;
    state.characterSceneOverride = previousScene;
    throw error;
  }
  host.querySelectorAll('textarea[data-nai], textarea[data-openai], textarea[data-comfy], textarea[data-sdwebui]').forEach((input) => {
    const key = input.dataset.nai || input.dataset.openai || input.dataset.comfy || input.dataset.sdwebui;
    if (['positive', 'negative', 'artist'].includes(key)) input.value = params[key] || '';
  });
  if (state.provider === 'novelai') updateNovelAIDirty();
  else if (state.provider === 'openai') updateOpenAIDirty();
  else if (state.provider === 'sdwebui') updateSDWebUIDirty();
  else updateComfyDirty();
}
const tagPanel = new TagLibraryPanel({
  getLibrary: () => state.tagLibrary,
  setLibrary: (library) => {
    const previous = state.tagLibrary; state.tagLibrary = library;
    try { persist(); } catch (error) { state.tagLibrary = previous; throw error; }
  },
  getContext: globalTagContext, insert: insertGlobalTags, notify: toast,
});

function openPromptTools(target, input, visual = false) {
  let picker = { target, visual, getContext: globalTagContext, insert: insertGlobalTags,
    getPreview: (edits) => visualPromptPreview(captureSnapshot(state), edits),
    closed: () => { if (config && host) render(true); } };
  if (input.dataset.artistField) {
    const draft = artistUI.draft;
    picker = { ...picker, label: '画师串库草稿', previewTitle: '画风配方提示词',
      getContext: () => ({ provider: 'novelai', params: { model: 'nai-diffusion-4-5-full',
        positive: draft.quality, negative: draft.negative, artist: draft.artist },
      limits: { positive: 4000, negative: 12000, artist: 4000 } }),
      getPreview: null,
      insert: (params, fields) => {
        if (artistUI.draft !== draft) throw new Error('画师串草稿已改变，请重新打开');
        for (const field of Array.isArray(fields) ? fields : [fields]) draft[field === 'positive' ? 'quality' : field] = params[field];
        artistUI.dirty = true;
      } };
  } else if (input.dataset.profileField || input.dataset.profileOutfit) {
    const draft = profileUI.draft, outfit = input.dataset.profileOutfit
      ? draft?.outfits.find((row) => row.id === input.dataset.profileOutfit) : null;
    picker = { ...picker, label: outfit ? `${outfit.name} · 服装草稿` : `${draft.name} · 档案草稿`, previewTitle: '档案草稿提示词',
      getContext: () => ({ provider: 'novelai', params: { model: 'nai-diffusion-4-5-full',
        positive: outfit ? outfit.prompt : draft.tags, negative: outfit ? '' : draft.negative, artist: '' },
      allowedTargets: outfit ? ['positive'] : ['positive', 'negative'], limits: { positive: 4000, negative: 2000 } }),
      getPreview: null,
      insert: (params, fields) => {
        if (profileUI.draft !== draft || outfit && !draft.outfits.includes(outfit)) throw new Error('角色档案草稿已改变，请重新打开');
        for (const field of Array.isArray(fields) ? fields : [fields]) {
          if (outfit) outfit.prompt = params.positive;
          else draft[field === 'positive' ? 'tags' : field] = params[field];
        }
        profileUI.dirty = true;
      } };
  }
  tagPanel.open(picker);
}
let keyVisible = false;
let connectionStatus = { message: '等待输入秘钥', tone: 'neutral' };
const networkDiagnosticPanel = new NetworkDiagnosticPanel({
  context: () => networkContext(state.provider),
  onClose: () => debugToolsPanel.refresh(),
});
function networkContext(provider) {
  if (provider === 'assistant') return {
    provider, endpoint: state.assistant.endpoint, key: assistantUI.key,
    error: assistantUI.error || assistantUI.modelsError,
  };
  return {
    provider, ...state.connections[provider], ...credentials[provider],
    endpoint: provider === 'openai' ? state.openaiEndpoint : credentials[provider].endpoint,
    path: state.openaiPath, error: provider === state.provider && connectionStatus.tone === 'error' ? connectionStatus.message : '',
  };
}
window.addEventListener('pagehide', () => { networkDiagnosticPanel.close(); debugToolsPanel.stop(); });
let resolvedService = null;
let connectionController;
let connectionTimer;
let addressExpanded = false;
let novelaiAdvancedOpen = false;
let comfyProbe = null;
const comfyExpanded = { advanced: false, mapping: false, auth: false };
let openaiModels = [];
let sdwebuiProbe = null;
let sdwebuiAdvancedOpen = false;
const openaiModelUI = { fetched: false, open: false, query: '' };
let openaiAdvancedOpen = false;
let openaiTransportOpen = false;
const assistantUI = { busy: false, error: '', controller: null, key: '', keyVisible: false, keyStatus: '',
  keyDirty: false, keyRevision: 0, keyTimer: null, keyWriting: Promise.resolve(),
  models: [], modelsBusy: false, modelsStatus: '', modelsError: '', modelsOpen: false, modelsQuery: '',
  modelsController: null, tavernCurrent: '', modelSource: '', summary: null,
  binding: validBinding(state.assistantBinding) ? state.assistantBinding : null,
  requestId: typeof state.assistantRequestId === 'string' ? state.assistantRequestId : null };
const profileUI = { scope: 'global', draft: structuredClone(state.characterProfiles.profiles[0] || null),
  characters: [], dirty: false, busy: false, error: '' };
const profileAI = new ProfileAIPanel({
  library: () => state.characterProfiles,
  settings: () => normalizeAssistant(state.assistant),
  chatKey: () => currentChat().key || '',
  directory: () => assistantHostRequest('characters', {}, { timeout: 20 }),
  readSources: (avatars, signal) => assistantHostRequest('profile-sources', { avatars }, { signal, timeout: 20 }),
  generate: async (messages, signal) => {
    if (assistantUI.busy || imageEditorUI?.busy) throw new Error('文字助手正在处理其他任务，请稍后重试');
    await saveAssistantKey(); signal.throwIfAborted();
    const options = normalizeAssistant(state.assistant), identity = JSON.stringify(options);
    const raw = options.source === 'api'
      ? await requestAssistantText(options, assistantUI.key, messages, { signal })
      : await assistantHostRequest('text', { messages }, { signal, timeout: options.timeout });
    signal.throwIfAborted();
    if (identity !== JSON.stringify(normalizeAssistant(state.assistant))) throw new Error('文字模型配置已改变，请重新生成草稿');
    return raw;
  },
  promptTools: (picker) => tagPanel.open(picker),
  save: ({ library, profiles }) => {
    const previous = structuredClone(state);
    try { state.characterProfiles = library; useLiveCharacterScene(); persist(); }
    catch (error) { state = previous; throw error; }
    profileUI.scope = 'global'; loadProfileDraft(profiles[0].id); render();
    toast(`已保存 ${profiles.length} 个角色档案`);
  },
});
let apiEditRevision = 0;
let apiSyncWork = Promise.resolve();
const chatRequests = new Map();
const chatValidations = new Map();
const chatInbox = [];
let processingChat = false;
let tasksReady;
let taskError = '';
let taskRefreshing = false;
let taskRefreshWork;
const taskPersistence = new TaskPersistence({
  request: isInstalled() ? storageRequest : createBrowserTaskRequest(storageKey('linghuashi-tasks-v1')),
  settings: () => ({ generationMode: state.generationMode, queueInterval: state.queueInterval, concurrency: state.concurrency }),
  readKey: (provider, ref) => credentialRequest('read', provider, { ref }),
});
const taskQueue = new GenerationQueue({
  settings: () => state,
  run: runGeneration,
  changed: () => {
    const job = taskQueue.jobs.find((item) => item.id === activeJobId);
    if (job) runtimeState = ({ queued: 'queued', running: 'generating', completed: 'success', failed: 'error', cancelled: 'ready', paused: 'ready', uncertain: 'error' })[job.status] || 'ready';
    for (const item of taskQueue.jobs) reportChatTask(item);
    externalTaskService.report(chatPost);
    if (host) render();
  },
  cancel: cancelComfyPending,
  persistence: taskPersistence,
});
const externalTaskService = createExtensionTaskService({
  queue: taskQueue, state: () => state,
  ready: async () => { await libraryReady; await tasksReady; },
  refresh: async () => {
    if (workbenchPanel.ui.busy) throw apiError('BUSY', '正在保存组合任务，请稍后重试');
    await refreshTasks();
    if (taskError) throw apiError('STORAGE_UNAVAILABLE', taskError);
  },
  prepare: prepareExternalGeneration,
  create: async (plan, id) => {
    const record = await taskPersistence.create(plan, id);
    const chat = chatRequests.get(plan.chatRequestId);
    if (chat) chat.jobId = record.id;
    return record;
  },
  abandon: (plan, error) => {
    if (plan.chatRequestId) {
      chatPost('linghuashi:chat-task', { requestId: plan.chatRequestId, binding: plan.chatBinding,
        status: error.name === 'AbortError' ? 'cancelled' : 'failed', error: error.message });
      chatRequests.delete(plan.chatRequestId);
    }
  },
  result: async (job) => {
    const saved = await drawingLibrary.list(job.plan.storageLocation);
    const rows = (job.savedIds || []).map((id) => saved.find((row) => row.id === id));
    if (!rows.length || rows.some((row) => !row)) throw apiError('RESULT_UNAVAILABLE', '结果图片已清理或位于其他设备', job.id);
    return { task: publicExtensionTask(job), images: rows.map((row) => ({
      id: row.id, width: row.width, height: row.height, mime: row.blob.type,
      storageLocation: job.plan.storageLocation, parameters: publicImageParameters(row.snapshot),
      ...(job.plan.storageLocation === 'server' ? { url: row.srcURL, thumbnailUrl: row.thumbnailURL }
        : { blob: row.blob, thumbnail: row.thumbnail }),
    })) };
  },
  capabilities: () => extensionCapabilities(state, credentials),
  presets: (provider) => extensionPresets(state, provider),
});
const workbenchPanel = new WorkbenchPanel({
  getDraft: () => state.workbench,
  setDraft: (draft) => { const previous = state.workbench; state.workbench = draft; try { persist(); } catch (error) { state.workbench = previous; throw error; } },
  getSnapshot: () => captureSnapshot(state),
  cards: () => allTagTemplates(state.tagLibrary), artists: () => state.artistLibrary,
  identity: () => JSON.stringify([captureSnapshot(state), state.connections[state.provider], credentialState[state.provider].revision, state.cacheLocation]),
  submit: enqueueBatch, jobs: () => taskQueue.jobs, queue: taskQueue,
  saveCandidate: (name, row, preview) => {
    if (!row.candidate) throw new Error('候选组合不存在，请重新预览');
    const previous = state.artistLibrary;
    state.artistLibrary = saveArtist(previous, { id: randomUUID(), name, category: '画风探索',
      ...row.candidate, target: preview.rows[0].snapshot.provider });
    try { persist(); } catch (error) { state.artistLibrary = previous; throw error; }
  },
  render: () => render(true),
});
const backupPanel = new BackupPanel({
  getState: () => state, getLayout: () => config,
  assets: referenceAssets, library: drawingLibrary,
  ready: async () => { await libraryReady; await tasksReady; },
  flush: async () => {
    for (const provider of CONNECTION_PROVIDERS) await saveConnection(provider);
    await saveAssistantKey(); persist();
  },
  active: () => taskQueue.jobs.some((job) => ['running', 'queued'].includes(job.status))
    || assistantUI.busy || imageEditorUI?.busy || imageEditorUI?.submitting || processingPanel.busy || presetBusy || workbenchPanel.ui.busy,
  tasks: () => taskPersistence.list(),
  applyState: async (next) => {
    const previous = state;
    state = { ...next, page: 'settings' };
    try {
      // Refresh transient credentials before persist synchronizes connection fields.
      for (const provider of CONNECTION_PROVIDERS) {
        credentials[provider].endpoint = state.connections[provider].endpoint;
        credentials[provider].auth = state.connections[provider].auth || 'none';
      }
      await restoreCredentials(); persist();
    } catch (error) { state = previous; await restoreCredentials(); throw error; }
    artistUI.draft = structuredClone(state.artistLibrary[0] || null); artistUI.dirty = false;
    profileUI.draft = structuredClone(state.characterProfiles.profiles[0] || null); profileUI.dirty = false;
    generationVerified = null; resetConnection(); advancedPanel.resetMask();
    assistantUI.binding = null; assistantUI.requestId = null;
    delete state.assistantBinding; delete state.assistantRequestId;
  },
  applyLayout: async (value) => {
    if (value) {
      config = value;
      if (isInstalled()) postWindowMessage(window.parent, { type: 'linghuashi:restore-layout', layout: value });
    }
  },
  importParameters: (snapshot) => { restoreSnapshot(state, snapshot); persist(); showPage('generate'); },
  reload: async () => { serverPolicySignature = null; await reloadDrawings(); await syncStoragePolicy(); chatPost('linghuashi:images-changed'); },
  render: () => render(true), notify: toast,
});

const esc = escapeHtml;
const button = (name, label, action, classes = '', attrs = '') => `<button type="button" class="ui-button ${classes}" data-action="${action}" ${attrs}>${icon(name)}<span>${label}</span></button>`;
const iconButton = (name, title, action, attrs = '') => `<button type="button" class="ui-icon-button" data-action="${action}" title="${title}" aria-label="${title}" ${attrs}>${icon(name)}</button>`;
const field = (label, body, classes = '') => `<label class="ui-field ${classes}"><span>${label}</span>${body}</label>`;
const activeDrawing = () => drawings.find((item) => item.id === activeDrawingId);
const statusData = () => ({
  ready: { label: '就绪', icon: 'circle', class: 'neutral' },
  queued: { label: '排队中', icon: 'clock-3', class: 'warning' },
  generating: { label: '生成中', icon: 'loader-circle', class: 'accent' },
  success: { label: '已完成', icon: 'circle-check', class: 'accent' },
  error: { label: '生成失败', icon: 'circle-alert', class: 'danger' },
})[runtimeState];
const statusBadge = () => {
  const item = statusData();
  return `<span class="ui-status ${item.class}">${icon(item.icon, runtimeState === 'generating' ? 'spin' : '')}${item.label}</span>`;
};
const chibiImages = {
  whale: { eating: chibiEating, thinking: chibiThinking, sad: chibiSad, excited: chibiExcited, deadpan: chibiDeadpan },
  claude: { eating: claudeSmile, thinking: claudeReading, sad: claudePuzzled, excited: claudeSharing, deadpan: claudeCompanion },
  gemini: { eating: geminiGreeting, thinking: geminiThinking, sad: geminiShy, excited: geminiSmile, deadpan: geminiReading, heart: geminiShy },
  gpt: { eating: gptSmug, thinking: gptFocused, sad: gptDeadpan, excited: gptWings, deadpan: gptDeadpan, shy: gptShy },
  glm: { eating: glmSmug, thinking: glmReport, sad: glmDisdain, excited: glmShy, deadpan: glmSleepy },
  kimi: { eating: kimiPrism, thinking: kimiThinking, sad: kimiThinking, excited: kimiSmile, deadpan: kimiReading, music: kimiMusic },
  grok: { eating: grokSarcastic, thinking: grokFocused, sad: grokSarcastic, excited: grokPeace, deadpan: grokRebellious, mischievous: grokMischievous },
  doubao: { eating: doubaoPointing, thinking: doubaoFocused, sad: doubaoPointing, excited: doubaoHeart, deadpan: doubaoTsundere, shy: doubaoShy },
  ancient: { eating: ancientCalm, thinking: ancientThinking, sad: ancientConcerned, excited: ancientSmile, deadpan: ancientWaiting },
};
const statusPose = () => ({ ready: 'eating', queued: 'deadpan', generating: 'thinking', success: 'excited', error: 'sad' })[runtimeState] || 'thinking';
const chibi = (pose, classes = '') => `<img class="chibi-mascot ${classes}" data-chibi-pose="${pose}" data-mascot-theme="${state.characterTheme}" src="${chibiImages[state.characterTheme][pose]}" alt="" aria-hidden="true" width="180" height="200" decoding="async" draggable="false" />`;

function decoratePageHeading() {
  const title = host.querySelector('.page-heading > div:first-child');
  if (!title) return;
  const pose = state.page === 'generate'
    ? runtimeState === 'ready' ? 'thinking' : statusPose()
    : ({ settings: 'eating', connection: 'thinking', characters: ({ gemini: 'heart', gpt: 'shy', doubao: 'shy' })[state.characterTheme] || 'excited', styles: ({ kimi: 'music', grok: 'mischievous' })[state.characterTheme] || 'excited', gallery: 'excited' })[state.page] || 'eating';
  const group = document.createElement('div');
  group.className = 'heading-title';
  title.replaceWith(group);
  group.innerHTML = chibi(pose, 'heading-mascot');
  group.append(title);
}

function persist() {
  for (const provider of CONNECTION_PROVIDERS) syncConnection(provider);
  state.updatedAt = Date.now();
  const { storageUsage, storageStatus, ...saved } = state;
  const serialized = JSON.stringify(saved);
  if (serialized.length > 2000000) throw new Error('配置空间已满，请导出并精简预设或画师串库');
  configCacheAvailable = persistUIState(UI_STORAGE_NAME, saved, serialized);
}

function syncConnection(provider) {
  state.connections[provider] = normalizeConnection(provider, {
    ...state.connections[provider],
    ...(provider === 'openai' ? {
      endpoint: state.openaiEndpoint, path: state.openaiPath, timeout: state.openaiTimeout,
    } : {
      endpoint: credentials[provider].endpoint,
      ...(provider === 'comfyui' ? { auth: credentials.comfyui.auth, timeout: state.comfyTimeout } : {}),
      ...(provider === 'sdwebui' ? { auth: credentials.sdwebui.auth } : {}),
    }),
  });
}

export async function restoreCredentials() {
  await Promise.all(CONNECTION_PROVIDERS.map(async (provider) => {
    const saved = state.connections[provider];
    Object.assign(credentials[provider], { endpoint: saved.endpoint, auth: saved.auth || 'none' });
    if (provider === 'openai') {
      state.openaiEndpoint = saved.endpoint;
      state.openaiPath = saved.path;
      state.openaiTimeout = saved.timeout;
    } else if (provider === 'comfyui') state.comfyTimeout = saved.timeout;
    try {
      credentials[provider].key = await credentialRequest('read', provider, { ref: saved.keyRef });
      credentialState[provider].message = saved.keyRef ? '秘钥已保存' : '';
    } catch {
      credentialState[provider].message = '保存的秘钥无法读取，请重新填写';
      credentialState[provider].error = true;
    }
  }));
  try {
    assistantUI.key = await credentialRequest('read', 'assistant', { ref: state.assistant.keyRef });
    assistantUI.keyStatus = state.assistant.keyRef ? '秘钥已保存' : '';
  } catch { assistantUI.keyStatus = '助手秘钥无法读取，请重新填写'; }
  await syncAssistantConnection();
}

function resetAssistantModels() {
  assistantUI.modelsController?.abort();
  assistantUI.modelsController = null;
  assistantUI.modelsBusy = false;
  assistantUI.models = [];
  assistantUI.modelsStatus = '';
  assistantUI.modelsError = '';
  assistantUI.modelsOpen = false;
  assistantUI.modelsQuery = '';
  assistantUI.tavernCurrent = '';
  assistantUI.modelSource = '';
  refreshAssistantModels();
}

function refreshAssistantStatus() {
  const root = host?.querySelector('.assistant-workspace');
  if (!root) return;
  const updateText = (selector, value, hideEmpty = false) => {
    const node = host.querySelector(selector);
    if (!node) return;
    if (node.textContent !== value) node.textContent = value;
    if (hideEmpty) node.hidden = !value;
  };
  updateText('[data-assistant-key-status]', assistantUI.keyStatus);
  updateText('[data-assistant-model-status]', assistantUI.modelsBusy ? '正在读取模型列表…' : assistantUI.modelsStatus);
  updateText('[data-assistant-model-error]', assistantUI.modelsError, true);
  updateText('[data-assistant-error]', assistantUI.error, true);
  const status = host.querySelector('[data-assistant-state]');
  if (status && status.dataset.assistantState !== String(assistantUI.busy)) {
    status.dataset.assistantState = String(assistantUI.busy);
    status.className = `ui-status ${assistantUI.busy ? 'warning' : 'neutral'}`;
    status.innerHTML = `${icon(assistantUI.busy ? 'loader-circle' : 'sparkles', assistantUI.busy ? 'spin' : '')}${assistantUI.busy ? '正在处理' : '就绪'}`;
    paintIcons(status);
  }
  for (const action of ['generate', 'translate', 'polish', 'illustrate', 'use-current', 'apply', 'draw', 'copy', 'save-draft']) {
    const button = root.querySelector(`[data-action="assistant-${action}"]`);
    if (!button) continue;
    button.disabled = action === 'copy' ? !state.assistantDraft?.positive
      : assistantUI.busy || (['generate', 'translate', 'polish', 'illustrate', 'draw'].includes(action) && !state.enabled)
        || (['apply', 'draw'].includes(action) && !state.assistantDraft?.positive);
  }
  const cancel = root.querySelector('[data-action="assistant-cancel"]');
  if (cancel) cancel.hidden = !assistantUI.busy;
  const refresh = root.querySelector('[data-action="assistant-models"]');
  if (refresh) {
    refresh.disabled = assistantUI.modelsBusy;
    refresh.querySelector('svg')?.classList.toggle('spin', assistantUI.modelsBusy);
  }
  const key = root.querySelector('[data-assistant-key]');
  if (key) key.type = assistantUI.keyVisible ? 'text' : 'password';
  const reveal = root.querySelector('[data-action="assistant-toggle-key"]');
  const revealLabel = assistantUI.keyVisible ? '隐藏助手秘钥' : '显示助手秘钥';
  if (reveal && reveal.getAttribute('aria-label') !== revealLabel) {
    reveal.setAttribute('aria-label', revealLabel);
    reveal.title = assistantUI.keyVisible ? '隐藏秘钥' : '显示秘钥';
    reveal.innerHTML = icon(assistantUI.keyVisible ? 'eye-off' : 'eye');
    paintIcons(reveal);
  }
  const count = host.querySelector('.plugin-nav [data-page="gallery"] small');
  if (count) count.textContent = String(state.history.length);
  if (isInstalled()) {
    const chat = currentChat(), session = host.querySelector('.session-label');
    if (session && session.dataset.chatName !== chat.name) {
      session.dataset.chatName = chat.name;
      session.innerHTML = `${icon('message-square')}${escapeHtml(chat.name)}`;
      paintIcons(session);
    }
    updateText('.plugin-bottom .bottom-actions > span', `当前会话 · ${chat.count} 条消息`);
  }
}

function refreshAssistantModels() {
  refreshAssistantStatus();
  const picker = host?.querySelector('#assistant-model-picker');
  if (!picker) return;
  picker.hidden = !assistantUI.modelsOpen;
  host.querySelector('[data-action="assistant-toggle-models"]')?.setAttribute('aria-expanded', String(assistantUI.modelsOpen));
  const search = picker.querySelector('[data-assistant-model-search]');
  if (search.value !== assistantUI.modelsQuery) search.value = assistantUI.modelsQuery;
  const choices = assistantModelChoices(state.assistant, assistantUI);
  const list = picker.querySelector('[data-assistant-model-list]');
  list.innerHTML = choices.html;
  picker.querySelector('[data-assistant-model-count]').textContent = `匹配 ${choices.count} 个${choices.count > 100 ? ' · 显示前 100 个' : ''}`;
  paintIcons(list);
  const input = host.querySelector('#assistant-model-input');
  input.placeholder = state.assistant.source === 'api' ? '输入或选择模型'
    : assistantUI.tavernCurrent ? `跟随当前模型：${assistantUI.tavernCurrent}` : '跟随酒馆当前模型';
}

function syncAssistantConnection(origin) {
  const operation = apiSyncWork.then(async () => {
    const revision = apiEditRevision;
    const pairs = {
      openai: { endpoint: state.openaiEndpoint, key: credentials.openai.key,
        keyRef: state.connections.openai.keyRef, dirty: credentialState.openai.dirty },
      assistant: { endpoint: state.assistant.endpoint, key: assistantUI.key,
        keyRef: state.assistant.keyRef, dirty: assistantUI.keyDirty },
    };
    const plan = assistantConnectionSync({ ...pairs, link: state.assistant.apiLink, origin });
    if (!plan) return;
    const target = plan.target;
    const ref = target ? await credentialRequest('write', target, {
      key: plan.key, ref: pairs[target].keyRef,
    }) : '';
    if (revision !== apiEditRevision) return;
    if (target === 'assistant') {
      state.assistant.endpoint = plan.endpoint;
      state.assistant.keyRef = ref;
      assistantUI.key = plan.key.trim();
      assistantUI.keyStatus = ref ? '秘钥已保存 · 已同步 OpenAI 接口' : '当前助手秘钥已清空';
      if (state.assistant.source === 'api') resetAssistantModels();
    } else if (target === 'openai') {
      state.openaiEndpoint = plan.endpoint;
      credentials.openai.key = plan.key.trim();
      state.connections.openai.keyRef = ref;
      credentialState.openai.message = ref ? '秘钥已保存 · 已同步独立 API' : '当前秘钥已清空';
      credentialState.openai.error = false;
      if (state.provider === 'openai') resetConnection();
    }
    state.assistant.apiLink = { endpoint: plan.endpoint, openaiRef: state.connections.openai.keyRef,
      assistantRef: state.assistant.keyRef };
    persist();
    host?.querySelectorAll('[data-assistant="endpoint"]').forEach((node) => { node.value = state.assistant.endpoint; });
    host?.querySelectorAll('[data-assistant-key]').forEach((node) => { node.value = assistantUI.key; });
    host?.querySelectorAll('[data-assistant-key-status]').forEach((node) => { node.textContent = assistantUI.keyStatus; });
    host?.querySelectorAll('[data-openai-connection="endpoint"]').forEach((node) => { node.value = state.openaiEndpoint; });
    if (state.provider === 'openai') host?.querySelectorAll('[data-transient="key"]').forEach((node) => { node.value = credentials.openai.key; });
    updateCredentialStatus();
  });
  apiSyncWork = operation.catch(() => {});
  return operation;
}

function saveAssistantKey() {
  clearTimeout(assistantUI.keyTimer);
  const operation = assistantUI.keyWriting.then(async () => {
    if (!assistantUI.keyDirty) return;
    const revision = assistantUI.keyRevision;
    const ref = await credentialRequest('write', 'assistant', { key: assistantUI.key, ref: state.assistant.keyRef });
    if (revision !== assistantUI.keyRevision) return;
    state.assistant.keyRef = ref; assistantUI.keyDirty = false;
    assistantUI.keyStatus = ref ? '秘钥已保存' : '当前助手秘钥已清空';
    persist();
    host?.querySelectorAll('[data-assistant-key-status]').forEach((node) => { node.textContent = assistantUI.keyStatus; });
  });
  assistantUI.keyWriting = operation.catch(() => {});
  return operation.then(() => syncAssistantConnection('assistant'));
}

async function runPromptAssistant(operation, request) {
  if (assistantUI.busy) throw new Error('提示词助手正在处理，请稍候');
  if (!state.enabled) throw new Error('插件已关闭');
  const input = state.assistantInput.trim();
  if (operation !== 'illustrate' && !input) throw new Error('请先填写画面描述或提示词');
  const snapshot = captureSnapshot(state);
  const params = snapshot.params || snapshot.config.params;
  const profileLibrary = structuredClone(state.characterProfiles);
  const frozenScene = state.characterSceneOverride ? structuredClone(snapshot.characterScene) : null;
  const controller = request?.controller || new AbortController();
  assistantUI.busy = true; assistantUI.error = ''; assistantUI.controller = controller;
  render();
  try {
    await saveAssistantKey();
    const options = normalizeAssistant(state.assistant);
    const context = await assistantHostRequest('context', { binding: request?.binding, previous: request?.previous },
      { signal: controller.signal, timeout: options.timeout });
    if (operation === 'illustrate' && !context.target.trim()) throw new Error('请先打开包含角色回复的聊天');
    assistantUI.summary = context.summary;
    context.characterScene = frozenScene || resolveCharacterScene(profileLibrary,
      context.chatKey, context.characterAvatars);
    snapshot.characterScene = structuredClone(context.characterScene);
    const messages = buildAssistantMessages({ settings: options, operation, input, context,
      target: { provider: snapshot.provider, model: params.model } });
    const plan = options.source === 'api'
      ? await requestAssistantAPI(options, assistantUI.key, messages, { signal: controller.signal })
      : parseAssistantResult(await assistantHostRequest('text', { messages }, { signal: controller.signal, timeout: options.timeout }));
    if (context.characterScene?.entries.length) {
      // Freeze the saved profile data, never accept model-supplied profile snapshots.
      plan.characterScene = structuredClone(context.characterScene);
      plan.characters = context.characterScene.entries.map((entry) => ({
        profileId: entry.profileId, action: '', expression: '', appearance: '', outfit: '', negative: '',
        ...(plan.characters || []).find((item) => item.profileId === entry.profileId),
        ...(entry.action ? { action: entry.action } : {}),
        ...(entry.expression ? { expression: entry.expression } : {}),
      }));
    } else { delete plan.characterScene; delete plan.characters; }
    if (request && !await validateChatRequest(request)) throw new Error('原消息或自动配图设置已变化，操作已取消');
    controller.signal.throwIfAborted();
    state.assistantDraft = plan; persist();
    return { plan, options, snapshot };
  } catch (error) {
    assistantUI.error = controller.signal.aborted ? '操作已取消'
      : error.name === 'TimeoutError' ? '文字接口处理超时，请手动重试'
        : error instanceof TypeError ? '文字接口连接失败，请检查地址和跨域设置' : error.message;
    throw new Error(assistantUI.error);
  } finally { assistantUI.busy = false; assistantUI.controller = null; render(true); }
}

async function analyzeChat(request) {
  try {
    if (!await validateChatRequest(request)) throw new Error('原消息已变化');
    const result = await runPromptAssistant('illustrate', request);
    request.assistantPlan = result.plan; request.assistantOptions = result.options;
    request.assistantSnapshot = result.snapshot;
    const generating = result.plan.shouldDraw && !request.openEditor && normalizeAssistant(state.assistant).autoImage;
    if (request.openEditor) {
      assistantUI.binding = request.binding; assistantUI.requestId = request.requestId;
      state.assistantBinding = request.binding; state.assistantRequestId = request.requestId;
      state.assistantInput = result.plan.scene; persist(); showPage('assistant');
      chatPost('linghuashi:attention', { page: 'assistant' });
    }
    chatPost('linghuashi:chat-draft', { requestId: request.requestId, binding: request.binding, plan: result.plan, generating });
    if (generating) await enqueueGeneration(request);
  } catch (error) {
    chatPost('linghuashi:chat-task', { requestId: request.requestId, binding: request.binding,
      status: request.controller.signal.aborted ? 'cancelled' : 'failed', error: error.message });
  }
}

async function fetchAssistantModels(refresh = true) {
  if (assistantUI.modelsBusy) return;
  const source = state.assistant.source;
  const controller = new AbortController();
  assistantUI.modelsController = controller;
  assistantUI.modelsBusy = true; assistantUI.modelsError = '';
  refreshAssistantStatus();
  try {
    let models, message = '', current = '';
    if (source === 'tavern') {
      const data = await assistantHostRequest('models', { refresh }, { signal: controller.signal, timeout: 20 });
      models = assistantModelNames(data.models);
      current = data.current;
      message = data.message;
    } else {
      await saveAssistantKey();
      controller.signal.throwIfAborted();
      const revision = apiEditRevision;
      models = await requestAssistantModels(state.assistant, assistantUI.key, { signal: controller.signal });
      if (revision !== apiEditRevision) return;
    }
    if (controller.signal.aborted || assistantUI.modelsController !== controller || source !== state.assistant.source) return;
    assistantUI.models = models;
    assistantUI.tavernCurrent = current;
    assistantUI.modelSource = source;
    assistantUI.modelsStatus = [models.length ? `已读取 ${models.length} 个模型` : '', message].filter(Boolean).join(' · ');
    if (refresh) assistantUI.modelsOpen = true;
    if (refresh && models.length) toast(`已读取 ${models.length} 个模型`);
  } catch (error) {
    if (!controller.signal.aborted && assistantUI.modelsController === controller) assistantUI.modelsError = error.message;
  }
  finally {
    if (assistantUI.modelsController === controller) {
      assistantUI.modelsController = null;
      assistantUI.modelsBusy = false;
      refreshAssistantModels();
    }
  }
}

function applyAssistantToParameters() {
  const plan = state.assistantDraft;
  if (!plan?.positive) throw new Error('请先准备提示词');
  const snapshot = captureSnapshot(state);
  const params = snapshot.params || snapshot.config.params;
  params.positive = ''; params.negative = '';
  if (snapshot.characterScene) delete snapshot.characterScene.applied;
  restoreSnapshot(state, applyAssistantPlan(snapshot, plan, state.assistant));
  persist(); toast('助手提示词已载入当前生图参数');
}

function updateCredentialStatus() {
  const status = credentialState[state.provider];
  host?.querySelectorAll('[data-credential-status]').forEach((node) => {
    node.textContent = status.message;
    node.dataset.error = String(status.error);
  });
  if (host) {
    updateNovelAIDirty();
    updateOpenAIDirty();
    updateComfyDirty();
    updateSDWebUIDirty();
  }
}

function saveConnection(provider) {
  const current = credentialState[provider];
  clearTimeout(current.timer);
  const operation = current.writing.then(async () => {
    syncConnection(provider);
    if (!current.dirty) { persist(); return; }
    const key = credentials[provider].key;
    const revision = current.revision;
    current.message = '正在保存秘钥…';
    current.error = false;
    updateCredentialStatus();
    const ref = await credentialRequest('write', provider, { key, ref: state.connections[provider].keyRef });
    if (current.revision !== revision) return;
    state.connections[provider].keyRef = ref;
    current.dirty = false;
    current.message = ref ? '秘钥已保存' : '当前秘钥已清空';
    persist();
    updateCredentialStatus();
  });
  current.writing = operation.catch(() => {});
  return operation.then(() => provider === 'openai' ? syncAssistantConnection('openai') : undefined);
}

function scheduleConnectionSave(provider, immediate = false) {
  const current = credentialState[provider];
  clearTimeout(current.timer);
  current.timer = setTimeout(() => {
    void saveConnection(provider).catch(() => {
      current.message = '秘钥保存失败，请重试或点击保存预设';
      current.error = true;
      updateCredentialStatus();
    });
  }, immediate ? 0 : 400);
}

async function presetOperation(operation) {
  if (presetBusy) throw new Error('正在处理预设，请稍候');
  presetBusy = true;
  host.inert = true;
  try { return await operation(); }
  finally { presetBusy = false; host.inert = false; }
}

async function saveCurrentPreset(provider, name) {
  return presetOperation(async () => {
    await saveConnection(provider);
    const save = { novelai: saveNovelAIPreset, openai: saveOpenAIPreset, comfyui: saveComfyPreset, sdwebui: saveSDWebUIPreset }[provider];
    const preset = save(state, name);
    persist();
    updateCredentialStatus();
    return preset;
  });
}

async function loadCurrentPreset(provider, id) {
  return presetOperation(async () => {
    await saveConnection(provider);
    const list = state[{ novelai: 'novelaiPresets', openai: 'openaiPresets', comfyui: 'comfyPresets', sdwebui: 'sdwebuiPresets' }[provider]];
    const preset = list.find((item) => item.id === id);
    const connection = resolvePresetConnection(state, provider, preset);
    const key = connection
      ? await credentialRequest('read', provider, { ref: connection.keyRef }) : credentials[provider].key;
    const load = { novelai: loadNovelAIPreset, openai: loadOpenAIPreset, comfyui: loadComfyPreset, sdwebui: loadSDWebUIPreset }[provider];
    load(state, id);
    if (connection) {
      Object.assign(credentials[provider], {
        key, endpoint: state.connections[provider].endpoint, auth: state.connections[provider].auth || 'none',
      });
      credentialState[provider].message = key ? '秘钥已保存' : '';
      credentialState[provider].error = false;
    }
    keyVisible = false;
    if (provider === 'openai') {
      apiEditRevision++;
      await syncAssistantConnection('openai');
    }
    resetConnection();
    persist(); render(); checkConnection();
    toast(connection ? '关联接口、秘钥与参数已载入' : '参数已载入，当前接口与秘钥已保留');
  });
}

function renderPresets(actions = '') {
  return ({ novelai: renderNovelAIPresets, openai: renderOpenAIPresets, comfyui: renderComfyPresets, sdwebui: renderSDWebUIPresets })[state.provider](state, actions)
    + renderPresetBinding(state);
}

function renderKeyInput(placeholder, extra = '') {
  return `<div class="input-with-button credential-input"><input type="${keyVisible ? 'text' : 'password'}" data-transient="key" autocomplete="off" spellcheck="false" maxlength="4096" ${extra} placeholder="${placeholder}" value="${esc(credentials[state.provider].key)}" /><button type="button" class="ui-icon-button" data-action="toggle-key" title="${keyVisible ? '隐藏秘钥' : '显示秘钥'}" aria-label="${keyVisible ? '隐藏秘钥' : '显示秘钥'}" aria-pressed="${keyVisible}">${icon(keyVisible ? 'eye-off' : 'eye')}</button></div>`;
}

function updateTriggerFormat() {
  const example = host.querySelector('[data-trigger-format-example]');
  if (example) example.textContent = `${state.triggerPrefix}图片提示词${state.triggerSuffix}`;
}

function resultMedia(chat = false) {
  const job = taskQueue.jobs.find((item) => item.id === activeJobId);
  if (runtimeState === 'error') return `<div class="result-placeholder result-error">${chibi('sad', 'status-mascot')}<strong>生成失败</strong><span>${esc(job?.error || '服务暂时没有响应')}</span>${job?.execution ? button('download', '继续取图 / 保存', 'task-retry', 'secondary', `data-task="${job.id}"`) : button('refresh-cw', '重新生成', 'generate', 'secondary')}${button('scan', '打开调试工具', 'debug-tools', 'secondary')}</div>`;
  if (runtimeState === 'queued' || runtimeState === 'generating') {
    const previous = activeDrawing();
    const task = job || { status: runtimeState === 'queued' ? 'queued' : 'running', phase: 'submitting' };
    const actions = iconButton('x', '取消任务', 'cancel', task.phase === 'saving' ? 'disabled' : '');
    return `${previous ? `<button type="button" class="image-open" data-action="viewer" data-image="${previous.id}" aria-label="查看原图"><img src="${previous.src}" alt="${esc(previous.title)}" /></button>` : ''}${renderGenerationTransition({ theme: state.characterTheme, task, compact: Boolean(previous), remote: job?.remote === true, actions })}`;
  }
  if (isInstalled() && !activeDrawing()) return `<div class="result-placeholder">${chibi('thinking', 'status-mascot')}<strong>等待第一张绘图</strong>${button('plug', '接口配置', 'connection', 'secondary', 'data-page="connection"')}</div>`;
  const image = activeDrawing() || activeSample;
  return `<button type="button" class="image-open" data-action="viewer" ${image === activeSample ? '' : `data-image="${image.id}"`} aria-label="查看${esc(image.title)}大图"><img src="${image.src}" alt="${esc(image.title)}" /><span class="image-expand">${icon('expand')}</span></button>${!chat ? `<div class="image-caption"><span>${esc(image.title)}</span><span>${image.size}</span></div>` : ''}`;
}

function renderGenerate() {
  const novelai = state.provider === 'novelai';
  const openai = state.provider === 'openai';
  const session = isInstalled() ? `${esc(currentChat().name)} <span> / </span> ${currentChat().count} 条消息` : '林间的旅人 <span> / </span> 当前会话';
  return `<div class="page-heading"><div><h1>生图工坊</h1><p>${session}</p></div><div class="heading-actions">${iconButton('plug', '接口配置', 'connection', 'data-page="connection"')}</div></div>
    <div class="generation-workspace">
      <section class="prompt-area">
        ${renderPresets(`<button type="button" class="ui-button secondary" data-page="batch">${icon('grid-2x2')}组合生图</button>`)}
        ${field('生图接口', `<select data-setting="provider">${GENERATION_MODES.map((mode) => `<option value="${mode.id}" ${state.provider === mode.id ? 'selected' : ''}>${mode.title}</option>`).join('')}</select>`)}
        ${renderNamedConnections(state)}
        ${renderArtistQuickPick(state)}
        ${advancedPanel.html()}
        ${novelai ? renderNovelAIParameters(state, novelaiAdvancedOpen) : openai ? renderOpenAIParameters(state, openaiModels, openaiAdvancedOpen, { ...openaiModelUI, loading: connectionStatus.tone === 'pending' }) : state.provider === 'sdwebui' ? renderSDWebUIParameters(state, sdwebuiProbe, sdwebuiAdvancedOpen) : renderComfyWorkflow(state, comfyProbe, comfyExpanded)}
        ${renderCharacterSelection(state, currentChat(), { frozen: Boolean(state.characterSceneOverride?.entries?.length) })}
      </section>
      <section class="result-area">
        <div class="field-heading"><h2>生成结果</h2>${statusBadge()}</div>
        <div class="result-frame${runtimeState === 'queued' || runtimeState === 'generating' ? ' result-frame--pending' : ''}">${resultMedia()}</div>
        <div class="result-actions"><span>${activeDrawing()?.demo ? '示例图片' : activeDrawing() ? '当前图片' : ''}</span><div>${iconButton('star', '收藏图片', 'favorite', `aria-pressed="${activeDrawing()?.favorite || false}"`)}${iconButton('arrow-down-to-line', '下载图片', 'download')}${iconButton('expand', '查看大图', 'viewer')}</div></div>
        ${renderResultDetails()}
        <div class="recent-heading"><h2>最近图片</h2><button type="button" class="text-button" data-page="gallery">绘图管理${icon('arrow-right')}</button></div>
        <div class="recent-images">${drawings.slice(0, 3).map((item) => `<button type="button" data-drawing="${item.id}" class="${activeDrawingId === item.id ? 'selected' : ''}" aria-label="查看${esc(item.title)}"><img src="${item.thumbSrc}" alt="${esc(item.title)}" /></button>`).join('')}</div>
      </section>
    </div>${renderTasks()}`;
}

function taskPhase(phase) {
  return ({ waiting: '等待调度', preparing: '正在读取参考素材', submitting: '正在提交请求', generating: '服务正在生成', retrieving: '正在读取生成结果',
    downloading: '正在下载图片', saving: '正在存入绘图管理', done: '已保存' })[phase] || '服务正在生成';
}

function renderTasks() {
  const labels = { queued: '等待中', running: '运行中', completed: '已完成', failed: '失败', cancelled: '已取消', paused: '等待继续', uncertain: '结果待核对' };
  return `<section class="generation-tasks" aria-label="生图任务">
    <div class="field-heading"><h2>任务与请求记录</h2><div class="task-actions">${iconButton('refresh-cw', '刷新任务记录', 'task-refresh')}${iconButton('trash-2', '清理已完成和已关闭记录', 'task-clear')}${iconButton('download', '导出请求记录', 'task-export')}</div></div>
    ${taskError ? `<p class="task-empty" role="status">${esc(taskError)}</p>` : ''}
    ${taskQueue.jobs.length ? `<div class="task-list">${[...taskQueue.jobs].reverse().map((job) => `<div class="task-row">
      <div><strong>${job.plan.snapshot?.novelaiProcessing ? `${esc(processingTitle(job.plan.snapshot.novelaiProcessing))} · ` : ''}${esc(job.plan.model)}</strong><span>${labels[job.status]}${job.remote ? ' · 其他页面执行中' : ''} · ${esc(job.error || taskPhase(job.phase))}${job.imageCount ? ` · ${job.imageCount} 张` : ''}</span><span>${job.plan.snapshot?.extensionRequest ? `来自 ${esc(job.plan.snapshot.extensionRequest.source.name)} · ` : ''}${job.plan.storageLocation === 'server' ? '酒馆服务器' : '浏览器图片库'} · ${new Date(job.createdAt).toLocaleString()}</span></div>
      ${job.finishedAt && job.startedAt ? `<span class="task-duration">${((job.finishedAt - job.startedAt) / 1000).toFixed(1)} 秒</span>` : ''}
      <div class="task-actions">${(['failed', 'paused'].includes(job.status) || job.status === 'uncertain' && job.execution) && (job.execution || job.stage === 'waiting') ? iconButton(job.execution ? 'download' : 'play', job.execution ? '继续取图或保存' : '继续提交此任务', 'task-retry', `data-task="${job.id}"`) : ''}
      ${iconButton('sliders-horizontal', '载入此任务的参数', 'task-parameters', `data-task="${job.id}"`)}
      ${['queued', 'running', 'paused', 'failed', 'uncertain'].includes(job.status) ? iconButton('x', job.status === 'uncertain' ? '关闭记录' : '取消此任务', 'task-cancel', `data-task="${job.id}" ${job.phase === 'saving' && job.status === 'running' ? 'disabled' : ''}`) : ''}</div>
    </div>`).join('')}</div>` : '<p class="task-empty">暂无请求</p>'}</section>`;
}

function renderResultDetails() {
  const currentJob = taskQueue.jobs.find((job) => job.id === activeJobId);
  const item = ['queued', 'generating', 'error'].includes(runtimeState) ? null : activeDrawing();
  const snapshot = item?.snapshot || currentJob?.plan.snapshot || captureSnapshot(state);
  const params = snapshot.params || snapshot.config.params;
  const rows = snapshot.provider === 'openai' ? [
    ['模型', params.model], ['尺寸', item?.size || openAISize(params).replace('x', ' × ').replace('auto', '自动')],
    ['质量 / 请求张数', `${params.quality} · ${params.n} 张`],
  ] : snapshot.provider === 'novelai' ? [
    ['模型', NOVELAI_MODELS.find((model) => model.id === params.model)?.title || params.model],
    ['尺寸', item?.size || `${params.width} × ${params.height}`],
    ['采样', `${params.steps} steps · CFG ${params.scale}`],
  ] : [
    ['模型', params.model || params.checkpoint || snapshot.config?.name || '跟随服务当前模型'],
    ['尺寸', item?.size || `${params.width} × ${params.height}`],
    ['采样', `${params.steps} steps · CFG ${params.cfg}`],
  ];
  return `<div class="result-details">${rows.map(([label, value]) => `<div><span>${label}</span><strong>${esc(value)}</strong></div>`).join('')}</div>`;
}

function renderConnection() {
  const novelai = state.provider === 'novelai';
  const openai = state.provider === 'openai';
  const current = credentials[state.provider];
  return `<div class="page-heading"><div><h1>接口配置</h1><p>生图服务与模型配置</p></div>${statusBadge()}</div>
    <section class="settings-content">
      ${renderPresets()}
      <div class="provider-options">${GENERATION_MODES.map((mode) => `<button type="button" data-provider="${mode.id}" class="${state.provider === mode.id ? 'selected' : ''}" aria-pressed="${state.provider === mode.id}">${icon(mode.icon)}<span><strong>${mode.title}</strong><small>${mode.subtitle}</small></span>${icon('check')}</button>`).join('')}</div>
      ${renderNamedConnections(state, true)}
      ${novelai ? `<p class="provider-website">官方网站：<a href="https://novelai.net/" target="_blank" rel="noopener noreferrer">https://novelai.net/${icon('external-link')}</a></p>` : openai ? renderOpenAIConnection() : state.provider === 'sdwebui' ? renderSDWebUIConnection({ ...state.connections.sdwebui, ...current }, renderKeyInput(current.auth === 'basic' ? 'SDWebUI 密码' : '访问令牌')) : `${field('ComfyUI 服务地址', `<input type="url" data-transient="endpoint" placeholder="https://你的域名/comfyui" value="${esc(current.endpoint)}" />`)}<p class="comfy-note">填写 ComfyUI 服务的根地址；127.0.0.1 指当前浏览器所在电脑。远程服务需允许当前页面跨域访问，HTTPS 页面建议使用 HTTPS 服务地址。</p>${renderComfyConnectionOptions(state, current, comfyExpanded.auth, keyVisible)}`}
      ${novelai ? field('API Key', renderKeyInput('pst- / sk- / STD- 秘钥', 'aria-describedby="novelai-key-help"')) : ''}
      ${state.provider === 'sdwebui' ? '' : '<p class="credential-status" data-credential-status role="status" aria-live="polite"></p>'}
      ${novelai ? `<div class="connection-help" id="novelai-key-help"><p>支持自动识别官方秘钥(pst-xxxx)和部分第三方秘钥(常用为sk-xxxx)</p><p>支持蛋糕生图、砂糖绘画；砂糖同时支持 STD 开头的秘钥。</p></div>
      <details class="advanced-options endpoint-options" ${addressExpanded ? 'open' : ''}><summary>${icon('link')}第三方接口地址(可选)${icon('chevron-down')}</summary><div>${field('第三方接口地址(可选)', `<input type="url" autocomplete="off" data-transient="endpoint" placeholder="https://第三方域名" value="${esc(current.endpoint)}" />`)}<p class="endpoint-help">留空自动识别；填写后优先用于第三方秘钥。pst- 秘钥始终使用官方接口。</p></div></details>` : ''}
      <div class="connection-actions" ${openai ? 'data-openai-connection-actions' : ''}><span id="connection-status" data-connection-status role="status" aria-live="polite"></span><div class="connection-buttons">${button('scan', '打开调试工具', 'network-diagnostics', 'secondary', 'hidden')}${button('plug', '测试连接', 'test-connection', 'secondary')}</div></div>
      <p class="resolved-endpoint" data-resolved-endpoint></p>
      ${advancedPanel.html()}
      ${novelai ? `<div class="section-rule"></div>${renderNovelAIParameters(state, novelaiAdvancedOpen)}` : ''}
      ${openai ? `<div class="section-rule"></div>${renderOpenAIParameters(state, openaiModels, openaiAdvancedOpen, { ...openaiModelUI, loading: connectionStatus.tone === 'pending' })}` : state.provider === 'sdwebui' ? `<div class="section-rule"></div>${renderSDWebUIParameters(state, sdwebuiProbe, sdwebuiAdvancedOpen)}` : !novelai ? `${renderComfyService(comfyProbe)}<div class="section-rule"></div>${renderComfyWorkflow(state, comfyProbe, comfyExpanded)}` : ''}
    </section>`;
}

function renderOpenAIConnection() {
  return `${field('接口地址', `<input type="url" data-openai-connection="endpoint" autocomplete="off" spellcheck="false" maxlength="512" placeholder="https://api.openai.com/v1" value="${esc(state.openaiEndpoint)}" />`)}
    ${field('API Key', renderKeyInput('sk-...'))}
    <details class="advanced-options openai-transport" ${openaiTransportOpen ? 'open' : ''}><summary>${icon('sliders-horizontal')}连接选项${icon('chevron-down')}</summary>
      <div class="two-field-row">${field('生图路径', `<input data-openai-connection="path" value="${esc(state.openaiPath)}" maxlength="200" spellcheck="false" />`)}${field('请求超时 (秒)', `<input type="number" data-openai-connection="timeout" min="5" max="600" step="1" value="${state.openaiTimeout}" />`)}</div>
      ${button('file-json', '查看生图请求', 'openai-request-preview', 'secondary')}
    </details>`;
}

function updateOpenAIDirty() {
  host.querySelectorAll('[data-openai-dirty]').forEach((node) => {
    const dirty = openAIPresetDirty(state);
    node.textContent = dirty ? '有未保存修改' : '已保存';
    node.dataset.dirty = String(dirty);
  });
  let error = '';
  try { buildOpenAIRequest(state.openai); } catch (issue) { error = issue.message; }
  host.querySelectorAll('[data-openai-validation]').forEach((node) => {
    node.textContent = error; node.hidden = !error;
  });
  if (state.provider === 'openai') {
    host.querySelectorAll('[data-action="generate"]').forEach((node) => {
      node.disabled = Boolean(error) || !state.enabled;
    });
  }
}

function syncOpenAIModelSelection() {
  host.querySelectorAll('.openai-model-item').forEach((item) => {
    const name = item.querySelector('[data-action="openai-select-model"]');
    const selected = name.dataset.openaiModelId === state.openai.model;
    item.classList.toggle('selected', selected);
    name.setAttribute('aria-pressed', String(selected));
  });
}

function updateOpenAIModelList() {
  const panel = host?.querySelector('.openai-model-panel');
  if (!panel) return;
  const available = openaiModelUI.fetched ? openaiModels : OPENAI_MODELS;
  const filtered = filterOpenAIModels(available, openaiModelUI.query);
  panel.hidden = !openaiModelUI.open;
  panel.querySelector('[data-openai-model-title]').textContent = openaiModelUI.fetched ? '可用模型' : '常用模型';
  panel.querySelector('[data-openai-model-count]').textContent = `${openaiModelUI.query.trim() ? `${filtered.length} / ${available.length}` : available.length} 个`;
  panel.querySelector('[data-openai-model-grid]').innerHTML = renderOpenAIModelItems(available, state.openai.model, openaiModelUI.query, openaiModelUI.fetched);
  panel.querySelector('[data-openai-model-search]').value = openaiModelUI.query;
  const toggle = host.querySelector('[data-action="openai-toggle-models"]');
  toggle.setAttribute('aria-expanded', String(openaiModelUI.open));
  toggle.title = toggle.ariaLabel = openaiModelUI.open ? '收起模型列表' : '展开模型列表';
  updateOpenAIModelStatus();
  paintIcons();
}

function updateOpenAIModelStatus() {
  const summary = host.querySelector('[data-openai-model-summary]');
  if (!summary) return;
  const pending = state.provider === 'openai' && connectionStatus.tone === 'pending';
  summary.textContent = pending ? '获取中…' : openaiModelUI.fetched ? `已获取 ${openaiModels.length} 个` : '尚未获取';
  host.querySelector('[data-action="openai-fetch-models"]').disabled = pending;
  host.querySelector('.openai-model-panel').setAttribute('aria-busy', String(pending));
  const feedback = host.querySelector('[data-openai-model-feedback]');
  feedback.hidden = connectionStatus.tone !== 'error';
  feedback.textContent = connectionStatus.tone === 'error' ? connectionStatus.message : '';
}

async function copyOpenAIModel(model, selecting = false) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(model);
    toast(selecting ? '模型已选中并复制' : '模型名已复制');
  } catch {
    toast(selecting ? '模型已选中，浏览器未允许复制' : '复制失败，请手动复制模型名');
  }
}

function commitOpenAIFields() {
  state.openai = normalizeOpenAI(state.openai);
  persist();
  const quality = host.querySelector('[data-openai="quality"]');
  if (quality) quality.innerHTML = openAIQualityOptions(state.openai).map(([id, title]) => `<option value="${id}">${title}</option>`).join('');
  const gpt = usesGPTImage(state.openai), nai = isOpenAINovelAI(state.openai.model);
  host.querySelectorAll('[data-openai-negative-field]').forEach((field) => { field.hidden = !nai; });
  host.querySelectorAll('[data-openai]').forEach((input) => {
    const key = input.dataset.openai;
    input.value = state.openai[key];
    if (['outputFormat', 'background', 'moderation'].includes(key)) input.disabled = !gpt;
    if (key === 'compression') input.disabled = !gpt || state.openai.outputFormat === 'png';
    if (key === 'responseFormat') input.disabled = gpt;
    if (key === 'negative') input.disabled = !nai;
  });
  const details = host.querySelector('.result-details');
  if (state.provider === 'openai' && details) details.outerHTML = renderResultDetails();
  updateOpenAIDirty();
  syncOpenAIModelSelection();
}

function openOpenAIPresetDialog(deleting = false) {
  commitOpenAIFields();
  const selected = selectedOpenAIPreset(state);
  if (deleting && selected.id === 'default') return;
  const overlay = document.getElementById('overlay-root');
  overlay.innerHTML = `<dialog class="nai-preset-dialog" aria-labelledby="openai-dialog-title"><form>
    <header><h2 id="openai-dialog-title">${deleting ? '删除预设' : '另存为预设'}</h2>${iconButton('x', '关闭', 'close-openai-dialog')}</header>
    ${deleting ? `<p>删除预设“${esc(selected.name)}”？当前参数会保留。</p>` : field('预设名称', `<input name="name" maxlength="40" required autocomplete="off" placeholder="输入预设名称" value="${selected.id === 'default' ? '' : esc(`${selected.name} 副本`.slice(0, 40))}" />`)}
    <p class="nai-dialog-error" role="alert"></p>
    <footer>${button('x', '取消', 'close-openai-dialog', 'secondary')}<button type="submit" class="ui-button primary">${icon(deleting ? 'trash-2' : 'save')}<span>${deleting ? '删除预设' : '保存新预设'}</span></button></footer>
  </form></dialog>`;
  const dialog = overlay.querySelector('dialog');
  dialog.querySelectorAll('[data-action="close-openai-dialog"]').forEach((node) => node.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (presetBusy) return;
    const name = new FormData(event.target).get('name');
    const previous = JSON.stringify({ presets: state.openaiPresets, id: state.openaiPresetId });
    event.target.inert = true;
    try {
      if (deleting) {
        state.openaiPresets = state.openaiPresets.filter((preset) => preset.id !== selected.id);
        state.openaiPresetId = 'default';
      } else await saveCurrentPreset('openai', name);
      persist(); dialog.close(); render();
      host.querySelector('[data-openai-preset]')?.focus({ preventScroll: true });
      toast(deleting ? '预设已删除，当前参数已保留' : '新预设已保存');
    } catch (error) {
      const snapshot = JSON.parse(previous);
      state.openaiPresets = snapshot.presets; state.openaiPresetId = snapshot.id;
      dialog.querySelector('.nai-dialog-error').textContent = error.message;
    } finally { event.target.inert = false; }
  });
  paintIcons(); dialog.showModal();
}

function showOpenAIRequest() {
  try {
    commitOpenAIFields();
    const urls = openAIURLs(state.openaiEndpoint, state.openaiPath);
    const body = buildOpenAIRequest(state.openai);
    const overlay = document.getElementById('overlay-root');
    overlay.innerHTML = `<dialog class="nai-preset-dialog openai-request-dialog" aria-label="生图请求"><header><h2>生图请求</h2>${iconButton('x', '关闭', 'close-request')}</header><p>POST ${esc(urls.generation)}</p><pre>${esc(JSON.stringify(body, null, 2))}</pre></dialog>`;
    const dialog = overlay.querySelector('dialog');
    dialog.querySelector('[data-action="close-request"]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    paintIcons(); dialog.showModal();
  } catch (error) { toast(error.message); }
}

function updateNovelAIDirty() {
  host.querySelectorAll('[data-nai-dirty]').forEach((node) => {
    const dirty = novelAIPresetDirty(state);
    node.textContent = dirty ? '有未保存修改' : '已保存';
    node.dataset.dirty = String(dirty);
  });
}

function commitNovelAIFields() {
  state.novelai = normalizeNovelAI(state.novelai);
  persist();
  host.querySelectorAll('[data-nai]').forEach((input) => {
    const key = input.dataset.nai;
    if (!Object.hasOwn(NOVELAI_DEFAULTS, key)) return;
    if (input.type === 'checkbox') input.checked = state.novelai[key];
    else input.value = state.novelai[key];
    if (key === 'sm') input.disabled = !isNAI3(state.novelai.model);
    if (key === 'smDyn') input.disabled = !isNAI3(state.novelai.model) || !state.novelai.sm;
    if (key === 'variety') input.disabled = !supportsVariety(state.novelai.model);
    input.closest('.nai-toggle')?.classList.toggle('is-disabled', input.disabled);
  });
  const size = NOVELAI_SIZES.find((item) => item.width === state.novelai.width && item.height === state.novelai.height);
  host.querySelectorAll('[data-nai-size]').forEach((input) => { input.value = size?.id || 'custom'; });
  updateNovelAIDirty();
}

function openNovelAIPresetDialog(mode = 'save') {
  const selected = selectedNovelAIPreset(state);
  const deleting = mode === 'delete';
  if (deleting && selected.id === 'default') return;
  const overlay = document.getElementById('overlay-root');
  overlay.innerHTML = `<dialog class="nai-preset-dialog" aria-labelledby="nai-dialog-title"><form>
    <header><h2 id="nai-dialog-title">${deleting ? '删除预设' : '另存为预设'}</h2>${iconButton('x', '关闭', 'close-preset-dialog')}</header>
    ${deleting ? `<p>删除预设“${esc(selected.name)}”？当前参数会保留。</p>` : field('预设名称', `<input name="name" maxlength="40" required autocomplete="off" placeholder="输入预设名称" value="${selected.id === 'default' ? '' : esc(`${selected.name} 副本`.slice(0, 40))}" />`)}
    <p class="nai-dialog-error" role="alert"></p>
    <footer>${button('x', '取消', 'close-preset-dialog', 'secondary')}<button type="submit" class="ui-button primary">${icon(deleting ? 'trash-2' : 'save')}<span>${deleting ? '删除预设' : '保存新预设'}</span></button></footer>
  </form></dialog>`;
  const dialog = overlay.querySelector('dialog');
  dialog.querySelectorAll('[data-action="close-preset-dialog"]').forEach((node) => node.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (presetBusy) return;
    const name = new FormData(event.target).get('name');
    const previous = JSON.stringify({ presets: state.novelaiPresets, id: state.novelaiPresetId });
    event.target.inert = true;
    try {
      if (deleting) {
        state.novelaiPresets = state.novelaiPresets.filter((preset) => preset.id !== selected.id);
        state.novelaiPresetId = 'default';
      } else {
        await saveCurrentPreset('novelai', name);
      }
      persist();
      dialog.close();
      render();
      host.querySelector('[data-nai-preset]')?.focus({ preventScroll: true });
      toast(deleting ? '预设已删除，当前参数已保留' : '新预设已保存');
    } catch (error) {
      const snapshot = JSON.parse(previous);
      state.novelaiPresets = snapshot.presets; state.novelaiPresetId = snapshot.id;
      dialog.querySelector('.nai-dialog-error').textContent = error.message;
    } finally { event.target.inert = false; }
  });
  paintIcons();
  dialog.showModal();
}

function updateComfyDirty() {
  host.querySelectorAll('[data-comfy-dirty]').forEach((node) => {
    const dirty = comfyPresetDirty(state);
    node.textContent = dirty ? '有未保存修改' : '已保存';
    node.dataset.dirty = String(dirty);
  });
  host.querySelectorAll('.comfy-warning').forEach((node) => {
    const warnings = workflowWarnings(state.comfyui, comfyProbe?.objectInfo);
    node.innerHTML = warnings.map((item) => `<p>${esc(item)}</p>`).join('');
    node.hidden = !warnings.length;
  });
}

function commitComfyFields() {
  state.comfyui.params = normalizeComfyParams(state.comfyui.params);
  persist();
  host.querySelectorAll('[data-comfy]').forEach((input) => {
    input.value = state.comfyui.params[input.dataset.comfy];
  });
  updateComfyDirty();
}

function changeComfy(operation, message) {
  const snapshot = JSON.stringify({ config: state.comfyui, presets: state.comfyPresets, id: state.comfyPresetId });
  try {
    operation();
    persist();
    render();
    if (message) toast(message);
    return true;
  } catch (error) {
    const previous = JSON.parse(snapshot);
    state.comfyui = previous.config;
    state.comfyPresets = previous.presets;
    state.comfyPresetId = previous.id;
    toast(error.name === 'QuotaExceededError' ? '浏览器配置空间不足，请导出并删除一些预设后重试' : error.message);
    return false;
  }
}

function openComfyPresetDialog(deleting = false) {
  commitComfyFields();
  const selected = selectedComfyPreset(state);
  if (deleting && selected.id === 'default') return;
  const overlay = document.getElementById('overlay-root');
  overlay.innerHTML = `<dialog class="nai-preset-dialog" aria-labelledby="comfy-dialog-title"><form>
    <header><h2 id="comfy-dialog-title">${deleting ? '删除工作流预设' : '另存为工作流预设'}</h2>${iconButton('x', '关闭', 'close-comfy-dialog')}</header>
    ${deleting ? `<p>删除预设“${esc(selected.name)}”？当前工作流与参数会保留。</p>` : field('预设名称', `<input name="name" maxlength="40" required autocomplete="off" placeholder="输入预设名称" value="${selected.id === 'default' ? '' : esc(`${selected.name} 副本`.slice(0, 40))}" />`)}
    <p class="nai-dialog-error" role="alert"></p>
    <footer>${button('x', '取消', 'close-comfy-dialog', 'secondary')}<button type="submit" class="ui-button primary">${icon(deleting ? 'trash-2' : 'save')}<span>${deleting ? '删除预设' : '保存新预设'}</span></button></footer>
  </form></dialog>`;
  const dialog = overlay.querySelector('dialog');
  dialog.querySelectorAll('[data-action="close-comfy-dialog"]').forEach((node) => node.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (presetBusy) return;
    const name = new FormData(event.target).get('name');
    const previous = JSON.stringify({ presets: state.comfyPresets, id: state.comfyPresetId });
    event.target.inert = true;
    try {
      if (deleting) {
        state.comfyPresets = state.comfyPresets.filter((preset) => preset.id !== selected.id);
        state.comfyPresetId = 'default';
      } else await saveCurrentPreset('comfyui', name);
      persist(); dialog.close(); render();
      host.querySelector('[data-comfy-preset]')?.focus({ preventScroll: true });
      toast(deleting ? '预设已删除，当前工作流已保留' : '工作流预设已保存');
    } catch (error) {
      const snapshot = JSON.parse(previous);
      state.comfyPresets = snapshot.presets; state.comfyPresetId = snapshot.id;
      dialog.querySelector('.nai-dialog-error').textContent = error.name === 'QuotaExceededError' ? '浏览器配置空间不足，请先删除一些预设' : error.message;
    } finally { event.target.inert = false; }
  });
  paintIcons(); dialog.showModal();
}

function importComfyWorkflow() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      if (file.size > 512 * 1024) throw new Error('工作流文件需小于 512 KB');
      const graph = parseWorkflow(await file.text());
      changeComfy(() => {
        state.comfyui = newComfyConfig(graph, file.name.replace(/\.json$/i, ''));
        state.comfyPresetId = 'default';
      }, '工作流已导入，可检查参数和节点映射');
    } catch (error) { toast(error.message); }
  });
  input.click();
}

function exportComfyWorkflow() {
  try {
    commitComfyFields();
    const graph = applyWorkflowParameters(state.comfyui);
    const url = URL.createObjectURL(new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'linghuashi-comfyui-api.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('已导出应用当前参数的 API 工作流');
  } catch (error) { toast(error.message); }
}

function updateConnectionStatus() {
  updateOpenAIModelStatus();
  const status = host.querySelector('[data-connection-status]');
  if (!status) return;
  status.textContent = state.provider === 'openai' && connectionStatus.message.includes('生图')
    ? connectionStatus.message.replace(/生图已验证|生图权限尚未验证/g, openAIGenerationVerified() ? '生图已验证' : '生图权限尚未验证')
    : connectionStatus.message;
  status.dataset.tone = connectionStatus.tone;
  const endpoint = host.querySelector('[data-resolved-endpoint]');
  endpoint.textContent = resolvedService ? `${resolvedService.title} · ${resolvedService.endpoint}` : '';
  endpoint.hidden = !resolvedService;
  host.querySelector('[data-action="test-connection"]').disabled = connectionStatus.tone === 'pending';
  const diagnostics = host.querySelector('[data-action="network-diagnostics"]');
  if (diagnostics) diagnostics.hidden = connectionStatus.tone !== 'error';
  const fetchModels = host.querySelector('[data-action="openai-fetch-models"]');
  if (fetchModels) fetchModels.disabled = connectionStatus.tone === 'pending';
}

function updateSDWebUIDirty() {
  host?.querySelectorAll('[data-sdwebui-dirty]').forEach((node) => { node.textContent = sdwebuiPresetDirty(state) ? '有未保存修改' : '已保存'; });
}

function commitSDWebUIFields() {
  state.sdwebui = normalizeSDWebUI(state.sdwebui);
  host?.querySelectorAll('[data-sdwebui]').forEach((node) => {
    if (node.type === 'checkbox') node.checked = state.sdwebui[node.dataset.sdwebui];
    else node.value = state.sdwebui[node.dataset.sdwebui];
  });
  persist(); updateSDWebUIDirty();
}

function openSDWebUIPresetDialog(deleting = false) {
  const selected = selectedSDWebUIPreset(state);
  if (deleting && selected.id === 'default') return;
  const overlay = document.getElementById('overlay-root');
  overlay.innerHTML = `<dialog class="nai-preset-dialog" aria-label="${deleting ? '删除预设' : '另存为预设'}"><form>
    <header><h2>${deleting ? '删除预设' : '另存为预设'}</h2>${iconButton('x', '关闭', 'sdwebui-dialog-close')}</header>
    ${deleting ? `<p>删除“${esc(selected.name)}”？当前参数保留。</p>` : field('预设名称', '<input name="name" maxlength="40" required autocomplete="off" />')}
    <p class="nai-dialog-error" role="alert"></p><footer>${button('x', '取消', 'sdwebui-dialog-close', 'secondary')}
    <button type="submit" class="ui-button primary">${icon(deleting ? 'trash-2' : 'save')}<span>${deleting ? '删除' : '保存新预设'}</span></button></footer></form></dialog>`;
  const dialog = overlay.querySelector('dialog');
  dialog.querySelectorAll('[data-action="sdwebui-dialog-close"]').forEach((node) => node.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const previous = structuredClone({ presets: state.sdwebuiPresets, id: state.sdwebuiPresetId });
    try {
      if (deleting) { state.sdwebuiPresets = state.sdwebuiPresets.filter((item) => item.id !== selected.id); state.sdwebuiPresetId = 'default'; persist(); }
      else await saveCurrentPreset('sdwebui', String(new FormData(event.target).get('name')));
      dialog.close(); render(); toast(deleting ? '预设已删除' : '预设已保存');
    } catch (error) {
      state.sdwebuiPresets = previous.presets; state.sdwebuiPresetId = previous.id;
      dialog.querySelector('.nai-dialog-error').textContent = error.message;
    }
  });
  paintIcons(); dialog.showModal();
}

async function checkSDWebUIConnection(test) {
  if (!test) {
    connectionStatus = { message: credentials.sdwebui.endpoint.trim() ? '地址已填写，尚未测试' : '等待输入 SDWebUI 服务地址', tone: 'neutral' };
    updateConnectionStatus(); return;
  }
  const controller = new AbortController(); connectionController = controller;
  const timeout = setTimeout(() => controller.abort(), 20000);
  connectionStatus = { message: '正在读取模型、LoRA 和参数列表…', tone: 'pending' }; updateConnectionStatus();
  try {
    const base = sdwebuiBase(credentials.sdwebui.endpoint);
    if (location.protocol === 'https:' && new URL(base).protocol === 'http:'
      && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)) throw new Error('当前酒馆使用 HTTPS，请为远程 SDWebUI 配置 HTTPS 地址');
    const result = await probeSDWebUI(base, state.connections.sdwebui, credentials.sdwebui.key, { signal: controller.signal });
    if (connectionController !== controller || state.provider !== 'sdwebui') return;
    sdwebuiProbe = result;
    Object.assign(state.connections.sdwebui, { textTaskId: result.textTaskId, imageTaskId: result.imageTaskId, progressMode: result.progressMode });
    persist();
    connectionStatus = { message: `SDWebUI 已连接 · ${result.models.length} 个模型${result.unavailable.length ? ' · 部分可选列表不可用' : ''}`, tone: 'success' };
    render();
  } catch (error) {
    if (connectionController !== controller) return;
    connectionStatus = { message: controller.signal.aborted ? '连接超时，请检查服务地址和网络'
      : error instanceof TypeError ? '无法连接 SDWebUI，请检查地址、HTTPS 和跨域设置' : error.message, tone: 'error' };
  } finally {
    clearTimeout(timeout);
    if (connectionController === controller) { connectionController = null; updateConnectionStatus(); }
  }
}

function resetConnection({ keepOpenAIModels = false } = {}) {
  clearTimeout(connectionTimer);
  connectionController?.abort();
  connectionController = null;
  resolvedService = null;
  comfyProbe = null;
  sdwebuiProbe = null;
  if (!keepOpenAIModels) {
    openaiModels = [];
    Object.assign(openaiModelUI, { fetched: false, open: false, query: '' });
  }
  host?.querySelector('.comfy-service')?.remove();
  if (host) updateComfyDirty();
  connectionStatus = { message: state.provider === 'novelai' ? '等待输入秘钥' : '尚未测试', tone: 'neutral' };
  if (host && !keepOpenAIModels) updateOpenAIModelList();
}

async function checkComfyConnection(current, test) {
  if (!test) {
    connectionStatus = { message: current.endpoint.trim() ? '地址已填写，尚未测试' : '等待输入 ComfyUI 服务地址', tone: 'neutral' };
    updateConnectionStatus();
    return;
  }
  const controller = new AbortController();
  connectionController = controller;
  const timeout = setTimeout(() => controller.abort(), state.comfyTimeout * 1000);
  connectionStatus = { message: '正在读取服务、节点与队列信息…', tone: 'pending' };
  updateConnectionStatus();
  try {
    const result = await probeComfyUI(current.endpoint, current.key, { signal: controller.signal, auth: current.auth });
    if (connectionController !== controller || state.provider !== 'comfyui') return;
    comfyProbe = result;
    connectionStatus = { message: result.warnings.length ? 'ComfyUI 已连接，部分信息未读取' : 'ComfyUI 已连接', tone: 'success' };
    render();
  } catch (error) {
    if (connectionController !== controller) return;
    connectionStatus = { message: controller.signal.aborted ? '连接超时，请检查服务地址和网络' : error instanceof TypeError ? '连接失败，请检查 HTTPS、跨域设置和服务地址' : error.message, tone: 'error' };
  } finally {
    clearTimeout(timeout);
    if (connectionController === controller) {
      connectionController = null;
      updateConnectionStatus();
    }
  }
}

async function checkConnection(test = false, keepModels = false) {
  resetConnection({ keepOpenAIModels: state.provider === 'openai' && (test || keepModels) });
  const provider = state.provider;
  const current = { ...credentials[provider] };
  if (provider === 'openai') {
    return checkOpenAIConnection(test);
  }
  if (provider === 'comfyui') {
    return checkComfyConnection(current, test);
  }
  if (provider === 'sdwebui') return checkSDWebUIConnection(test);
  const route = resolveNovelAIService(current.key, current.endpoint);
  if (route.kind !== 'resolved' && route.kind !== 'identify') {
    connectionStatus = { message: route.message, tone: route.kind === 'error' ? 'error' : 'neutral' };
    updateConnectionStatus();
    return;
  }
  if (route.kind === 'resolved') resolvedService = route;
  if (route.kind === 'resolved' && !test) {
    connectionStatus = { message: `已选择${route.title}，尚未鉴权`, tone: 'neutral' };
    updateConnectionStatus();
    return;
  }
  if (route.id === 'custom') {
    connectionStatus = { message: '已使用手动地址；该第三方暂不支持无扣费连接测试', tone: 'neutral' };
    updateConnectionStatus();
    return;
  }
  const controller = new AbortController();
  connectionController = controller;
  const timeout = setTimeout(() => controller.abort(), 12000);
  connectionStatus = { message: route.kind === 'identify' ? route.message : '正在验证秘钥…', tone: 'pending' };
  updateConnectionStatus();
  try {
    if (route.kind === 'identify') {
      resolvedService = await identifySkService(current.key, { signal: controller.signal });
    } else {
      const result = await probeService(route, current.key, { signal: controller.signal });
      if (!result.valid) throw new Error(result.rejected ? '秘钥未通过鉴权，请检查是否有效' : '接口未返回有效鉴权结果，请稍后重试');
    }
    if (connectionController !== controller) return;
    connectionStatus = { message: `${resolvedService.title} · 鉴权通过`, tone: 'success' };
  } catch (error) {
    if (connectionController !== controller) return;
    resolvedService = null;
    connectionStatus = { message: controller.signal.aborted ? '连接超时，请检查网络后重试' : error instanceof TypeError ? '无法连接接口，请检查网络或跨域设置' : error.message, tone: 'error' };
  } finally {
    clearTimeout(timeout);
    if (connectionController === controller) {
      connectionController = null;
      updateConnectionStatus();
    }
  }
}

async function checkOpenAIConnection(test) {
  let urls;
  try {
    urls = openAIURLs(state.openaiEndpoint, state.openaiPath);
    resolvedService = { title: 'OpenAI兼容', endpoint: urls.generation };
  } catch (error) {
    connectionStatus = { message: error.message, tone: 'error' };
    updateConnectionStatus(); return;
  }
  const key = credentials.openai.key;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(urls.base).hostname);
  if (!key.trim() && !local) {
    connectionStatus = { message: '等待输入 API Key', tone: 'neutral' };
    updateConnectionStatus(); return;
  }
  if (!test) {
    connectionStatus = { message: '地址已填写，尚未测试', tone: 'neutral' };
    updateConnectionStatus(); return;
  }
  const controller = new AbortController();
  connectionController = controller;
  const timeout = setTimeout(() => controller.abort(), Math.min(30, state.openaiTimeout) * 1000);
  connectionStatus = { message: '正在获取模型列表…', tone: 'pending' };
  updateConnectionStatus();
  try {
    const result = await probeOpenAIModels(urls.base, key, { signal: controller.signal });
    if (connectionController !== controller || state.provider !== 'openai') return;
    openaiModels = result.models;
    Object.assign(openaiModelUI, { fetched: true, open: true });
    connectionStatus = { message: `接口已响应 · ${result.models.length} 个模型；${openAIGenerationVerified() ? '生图已验证' : '生图权限尚未验证'}`, tone: 'success' };
    render();
  } catch (error) {
    if (connectionController !== controller) return;
    connectionStatus = { message: controller.signal.aborted ? '连接超时，请检查地址和网络'
      : error instanceof TypeError ? '连接失败，请检查 HTTPS、跨域设置和接口地址' : error.message, tone: 'error' };
  } finally {
    clearTimeout(timeout);
    if (connectionController === controller) {
      connectionController = null; updateConnectionStatus();
    }
  }
}

function renderCharacters() {
  return renderCharacterPage(state, profileUI, currentChat());
}

function loadProfileDraft(profileId = profileUI.draft?.id) {
  const profiles = profileUI.scope === 'chat' ? effectiveProfiles(state.characterProfiles, currentChat().key) : state.characterProfiles.profiles;
  profileUI.draft = structuredClone(profiles.find((item) => item.id === profileId) || profiles[0] || null);
  profileUI.dirty = false; profileUI.error = ''; profileUI.chatKey = currentChat().key || '';
}

function discardProfileChanges() {
  return !profileUI.dirty || window.confirm('放弃当前档案尚未保存的修改？');
}

function useLiveCharacterScene() {
  const frozen = state.characterSceneOverride;
  if (frozen?.applied && (!state.characterSceneOverrideProvider || state.characterSceneOverrideProvider === state.provider)) {
    const params = state.provider === 'comfyui' ? state.comfyui.params : state[state.provider];
    params.positive = frozen.basePositive; params.negative = frozen.baseNegative;
  }
  state.characterSceneOverride = null;
  state.characterSceneOverrideProvider = '';
  if (frozen && state.provider === 'comfyui') state.comfyui.params.characterPrompts = '[]';
}

async function refreshProfileCards() {
  if (profileUI.busy) return;
  profileUI.busy = true; profileUI.error = '';
  try {
    const data = await assistantHostRequest('characters', {}, { timeout: 20 });
    profileUI.characters = data.characters;
  } catch (error) { profileUI.error = error.message; }
  finally { profileUI.busy = false; render(); }
}

function saveProfileParticipants(selection) {
  const key = currentChat().key;
  if (key) state.characterProfiles = updateProfileChat(state.characterProfiles, key, { selection });
  else state.characterProfiles.selection = selection || [];
  useLiveCharacterScene(); persist();
  host?.querySelectorAll('[data-profile-auto]').forEach((node) => { node.checked = selection === null; });
}

function setProfileParticipant(profileId, checked) {
  const chat = currentChat();
  const scene = resolveCharacterScene(state.characterProfiles, chat.key, chat.avatars);
  const selection = scene.entries.map(({ profile, ...entry }) => entry).filter((entry) => entry.profileId !== profileId);
  if (checked) {
    if (selection.length >= 6) throw new Error('一幅画最多选择 6 个角色');
    const profile = effectiveProfiles(state.characterProfiles, chat.key).find((item) => item.id === profileId);
    selection.push({ profileId, outfitId: profile.defaultOutfitId, position: 'auto' });
  }
  saveProfileParticipants(selection);
}

async function importProfiles(file) {
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('档案文件需小于 2 MB');
    const raw = JSON.parse(await file.text());
    if (raw.version !== 1 || !Array.isArray(raw.profiles)) throw new Error('请选择灵画师导出的角色档案 JSON');
    const imported = normalizeProfileLibrary(raw);
    if (!imported.profiles.length) throw new Error('文件中没有有效角色档案');
    if (!discardProfileChanges()) return;
    const collisions = imported.profiles.filter((profile) => state.characterProfiles.profiles.some((item) => item.id === profile.id));
    if (collisions.length && !window.confirm(`导入将覆盖 ${collisions.length} 个同 ID 全局档案，继续？`)) return;
    let next = state.characterProfiles;
    for (const profile of imported.profiles) next = saveProfile(next, profile);
    state.characterProfiles = next; useLiveCharacterScene(); profileUI.scope = 'global';
    loadProfileDraft(imported.profiles[0].id); persist(); render(); toast(`已导入 ${imported.profiles.length} 个档案`);
  } catch (error) { toast(`档案导入失败：${error.message}`); }
}

function renderStyles() {
  return renderArtists(state, artistUI);
}

async function switchConnectionProfile(id) {
  const provider = state.provider;
  if (!id) { state.connectionProfileIds[provider] = ''; persist(); render(); return; }
  await presetOperation(async () => {
    await saveConnection(provider);
    const entry = state.connectionProfiles[provider].find((item) => item.id === id);
    if (!entry) throw new Error('接口配置不存在');
    const key = await credentialRequest('read', provider, { ref: entry.connection.keyRef });
    setCurrentConnection(state, provider, entry.connection);
    state.connectionProfileIds[provider] = id;
    Object.assign(credentials[provider], { key, endpoint: entry.connection.endpoint, auth: entry.connection.auth || 'none' });
    credentialState[provider].revision++;
    credentialState[provider].dirty = false;
    credentialState[provider].error = false;
    credentialState[provider].message = key ? '秘钥已保存' : '';
    keyVisible = false;
    resetConnection();
    if (provider === 'openai') { apiEditRevision++; await syncAssistantConnection('openai'); }
    persist(); render(); checkConnection();
    toast(`已切换到 ${entry.name}`);
  });
}

function connectionDialog(action) {
  const provider = state.provider, id = state.connectionProfileIds[provider];
  const selected = state.connectionProfiles[provider].find((entry) => entry.id === id);
  const title = ({ new: '新增接口', copy: '复制当前连接', rename: '重命名接口', delete: '删除接口配置' })[action];
  if (['rename', 'delete'].includes(action) && !selected) return;
  const overlay = document.getElementById('overlay-root');
  overlay.innerHTML = `<dialog class="nai-preset-dialog" aria-label="${title}"><form><header><h2>${title}</h2>${iconButton('x', '关闭', 'connection-dialog-close')}</header>
    ${action === 'delete' ? `<p>删除“${esc(selected.name)}”？绑定此接口的参数预设将改为仅载入参数，当前连接保留。</p>`
      : field('接口名称', `<input name="name" maxlength="40" required value="${esc(action === 'rename' ? selected.name : action === 'copy' ? `${selected?.name || '当前接口'} 副本` : '')}" />`)}
    <p class="nai-dialog-error" role="alert"></p><footer>${button('x', '取消', 'connection-dialog-close', 'secondary')}<button type="submit" class="ui-button primary">${icon(action === 'delete' ? 'trash-2' : 'save')}<span>${action === 'delete' ? '删除' : '保存'}</span></button></footer></form></dialog>`;
  const dialog = overlay.querySelector('dialog');
  dialog.querySelectorAll('[data-action="connection-dialog-close"]').forEach((node) => node.onclick = () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.querySelector('form').onsubmit = async (event) => {
    event.preventDefault();
    const submit = dialog.querySelector('[type="submit"]');
    if (submit.disabled || presetBusy) return;
    submit.disabled = true;
    let previous;
    try {
      await presetOperation(async () => {
        await saveConnection(provider);
        previous = structuredClone(state);
        if (action === 'delete') deleteConnectionProfile(state, provider, id);
        else if (action === 'rename') {
          const name = dialog.querySelector('[name="name"]').value.trim();
          if (!name || state.connectionProfiles[provider].some((entry) => entry.id !== id && entry.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('名称为空或已存在');
          selected.name = name;
        } else saveConnectionProfile(state, provider, dialog.querySelector('[name="name"]').value);
        persist();
      });
      dialog.close(); render(); toast(action === 'delete' ? '接口配置已删除' : '接口配置已保存');
    } catch (error) {
      if (previous) state = previous;
      dialog.querySelector('.nai-dialog-error').textContent = error.message;
    } finally { submit.disabled = false; }
  };
  paintIcons(); dialog.showModal();
}

function discardArtistChanges() {
  return !artistUI.dirty || window.confirm('画师串有未保存修改，放弃这些修改？');
}

function artistDraft(value) {
  artistUI.draft = structuredClone(value);
  artistUI.dirty = !state.artistLibrary.some((entry) => entry.id === value?.id);
}

function saveArtistDraft() {
  const previous = state.artistLibrary;
  state.artistLibrary = saveArtist(previous, artistUI.draft);
  try { persist(); }
  catch (error) { state.artistLibrary = previous; throw error; }
  artistUI.draft = structuredClone(state.artistLibrary.find((entry) => entry.id === artistUI.draft.id));
  artistUI.dirty = false; render(); toast('画师串已保存');
}

function artistFileInput(action) {
  if (artistUI.previewBusy) return;
  const input = document.createElement('input');
  input.type = 'file'; input.accept = action === 'import' ? '.json,application/json' : 'image/png,image/jpeg,image/webp';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const draftId = artistUI.draft?.id;
    try {
      if (action === 'import') {
        if (file.size > 1024 * 1024) throw new Error('导入文件需小于 1 MB');
        if (!discardArtistChanges()) return;
        const previous = state.artistLibrary;
        state.artistLibrary = importArtistLibrary(previous, JSON.parse(await file.text()));
        try { persist(); } catch (error) { state.artistLibrary = previous; throw error; }
        artistDraft(state.artistLibrary.at(-1)); render(); toast('画师串已导入，同名项已另存');
      } else {
        if (file.size > 8 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择小于 8 MB 的 PNG、JPG 或 WebP');
        artistUI.previewBusy = true;
        const bitmap = await createImageBitmap(file);
        try {
          if (bitmap.width * bitmap.height > 40000000) throw new Error('预览图像素过大，请先缩小');
          const canvas = document.createElement('canvas');
          const scale = Math.min(1, 192 / Math.max(bitmap.width, bitmap.height));
          canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const preview = canvas.toDataURL('image/webp', .7);
          if (preview.length > 60000) throw new Error('预览图压缩后仍过大，请换一张图片');
          if (artistUI.draft?.id !== draftId) return;
          artistUI.draft.preview = preview; artistUI.dirty = true; render(true);
        } finally { bitmap.close(); }
      }
    } catch (error) { toast(`操作失败：${error.message}`); }
    finally { artistUI.previewBusy = false; }
  };
  input.click();
}

function applyArtistEntry(entry, options = artistUI) {
  if (!entry) throw new Error('请选择画师串');
  applyArtist(state, entry, options);
  persist(); render(); toast('画风已载入当前生图参数');
}

function renderGallery() {
  return renderDrawingManager(drawings, drawingUI);
}

const releasePanel = new ReleasePanel({
  getTheme: () => state.characterTheme,
  onChange: refreshUpdateNavigation,
  beforeUpdate: async () => {
    await backupPanel.flush();
    await backupPanel.ready();
    if (backupPanel.active() || backupPanel.ui.busy) throw new Error('请等待当前生图、助手、编辑或备份任务完成后再更新');
    const records = await backupPanel.tasks();
    if (records.rows.some((row) => ['running', 'queued'].includes(row.status))) throw new Error('同账号仍有执行中或排队任务，请完成后再更新');
  },
});
const changelogPanel = new ChangelogPanel(releasePanel);
const componentsPanel = new ComponentsPanel();
const debugToolsPanel = new DebugToolsPanel({
  provider: state.provider, network: networkDiagnosticPanel, networkContext, failures: recentGenerationFailures,
  storageContext: () => {
    const params = state.provider === 'comfyui' ? state.comfyui.params : state[state.provider];
    return {
      storageLocation: state.cacheLocation, configCacheAvailable,
      runtime: { running: taskQueue.running, queued: taskQueue.jobs.filter((row) => row.status === 'queued').length,
        generationMode: state.generationMode, concurrency: state.concurrency, width: params?.width, height: params?.height, samples: params?.nSamples || params?.n || 1 },
      databases: [
        { id: 'drawings', name: storageKey('linghuashi-drawings-v1'), stores: ['drawings', 'meta'] },
        { id: 'tasks', name: storageKey('linghuashi-tasks-v1'), stores: ['tasks'] },
        { id: 'references', name: storageKey(`linghuashi-references-${currentAccount()}`), stores: ['assets'] },
      ],
      ...(isInstalled() ? { serverStatus: () => storageRequest('diagnostics/status') } : {}),
    };
  },
});

function refreshUpdateNavigation() {
  const button = host?.querySelector('.plugin-nav > button[data-page="changelog"]');
  const badge = button?.querySelector('[data-release-nav-badge]');
  if (!badge) return;
  badge.hidden = !releasePanel.hasUpdate;
  if (releasePanel.hasUpdate) {
    const description = `发现新版本 v${releasePanel.state.release.version}，点击查看更新动态`;
    button.title = description;
    button.setAttribute('aria-description', description);
  } else {
    button.removeAttribute('title');
    button.removeAttribute('aria-description');
  }
}

function renderConsole() {
  const renderer = { settings: () => renderSettings(state, backupPanel.html()), assistant: () => renderAssistant(state, assistantUI), generate: renderGenerate, batch: () => workbenchPanel.html() + renderTasks(), connection: renderConnection, characters: renderCharacters, styles: renderStyles, tags: () => tagPanel.html(), gallery: renderGallery, components: () => componentsPanel.html(), debug: () => debugToolsPanel.html(), changelog: () => changelogPanel.html() }[state.page] || (() => renderSettings(state, backupPanel.html()));
  const navigationPage = state.page === 'batch' ? 'generate' : state.page;
  const busy = ['queued', 'generating'].includes(runtimeState);
  const sessionName = isInstalled() ? esc(currentChat().name) : '林间的旅人';
  const sessionCount = isInstalled() ? currentChat().count : 12;
  return `<div class="plugin-shell">
    <header class="plugin-header"><div class="plugin-brand"><span class="brand-mark">${pluginIcon(state.characterTheme)}</span><div class="brand-copy"><strong>${esc(config.name)}</strong><span class="brand-subtitle">一款对萌新友好的生图扩展插件，愿世间充满和平友爱~</span></div></div><div class="plugin-header-right"><span class="session-label">${icon('message-square')}${sessionName}</span>${iconButton('more-horizontal', '更多操作', 'more')}</div></header>
    <div class="plugin-body"><nav class="plugin-nav" aria-label="插件导航"><span class="nav-caption">工作空间</span>${navigation.map((item) => `<button type="button" data-page="${item.id}" class="${navigationPage === item.id ? 'active' : ''}" aria-current="${navigationPage === item.id ? 'page' : 'false'}">${icon(item.icon)}<span>${item.title}</span>${item.id === 'gallery' ? `<small>${state.history.length}</small>` : item.id === 'changelog' ? '<span class="nav-update-alert" data-release-nav-badge aria-hidden="true" hidden>!</span>' : ''}</button>`).join('')}<div class="nav-bottom"><span class="connection-dot"></span><span>生图工坊</span><small>${RELEASE.version}</small></div></nav><main class="plugin-content">${configCacheAvailable ? '' : `<p class="configuration-cache-status" role="status">${icon('database')}<span>${isInstalled() ? '浏览器设置缓存不可用；配置将继续同步到当前酒馆账号。' : '浏览器设置缓存不可用；本次修改仅在当前页面保留，请导出备份。'}</span></p>`}${renderer()}</main></div>
    <footer class="plugin-bottom"><span>${icon(state.enabled ? 'circle-check' : 'circle')}${!state.enabled ? '插件已关闭' : state.page === 'generate' ? GENERATION_MODES.find((mode) => mode.id === state.provider)?.title || '自定义接口' : '配置已载入'}</span><div class="bottom-actions"><span>当前会话 · ${sessionCount} 条消息</span>${state.page === 'generate' ? button('sparkles', !state.enabled ? '插件已关闭' : busy ? '加入队列' : '生成图像', 'generate', 'primary', !state.enabled ? 'disabled' : '') : ''}</div></footer>
  </div>`;
}

function renderChatBrand() {
  return `${pluginIcon(state.characterTheme, 'chat-plugin-logo')}<span class="chat-brand-copy"><strong>${esc(config.name)}</strong><span class="scene-name">晨雾湖畔</span></span>`;
}

function renderChat() {
  return `<div class="chat-shell">
    <header class="chat-header"><div>${iconButton('arrow-left', '返回设置控制台', 'console')}<div class="chat-avatar">${icon('user-round')}</div><div><strong>林间的旅人</strong><span>单人聊天</span></div></div><div>${iconButton('settings-2', '打开生图设置', 'console')}${iconButton('more-horizontal', '会话选项', 'more')}</div></header>
    <main class="chat-messages">
      <div class="chat-date"><span>今天 · 20:30</span></div>
      <article class="chat-message user-message"><div class="message-avatar">${icon('user-round')}</div><div class="message-body"><div class="message-meta"><strong>你</strong><time>20:30</time></div><p>我们沿着山路走了一会儿。前面那片湖，看起来很安静。</p></div></article>
      <article class="chat-message character-message"><div class="message-avatar character">${icon('sparkles')}</div><div class="message-body"><div class="message-meta"><strong>旅人</strong><time>20:31</time><span>#12</span></div><p>他停下脚步，拨开眼前低垂的枝叶。</p><p>薄雾在湖面缓缓散开，远山映在水里。岸边的木屋亮着暖色的灯，松林间传来很轻的风声。</p><p class="dialogue">“今晚就在这里歇一歇吧。”</p>
        <section class="chat-image-card"><div class="chat-image-heading"><span>${renderChatBrand()}</span><div class="chat-drawing-status">${chibi(statusPose(), 'chat-mascot')}${statusBadge()}</div></div><div class="chat-image-content">${resultMedia(true)}</div>
          <div class="chat-card-actions"><button type="button" class="text-button" data-action="edit-prompt">${icon('sliders-horizontal')}提示词</button><div>${iconButton('star', '收藏图片', 'favorite')}${iconButton('arrow-down-to-line', '下载图片', 'download')}${iconButton('refresh-cw', '重新生成', 'generate')}</div></div>
          ${editPrompt ? `<div class="chat-prompt-editor"><textarea aria-label="聊天图片提示词" ${state.provider === 'novelai' ? 'data-nai="positive"' : state.provider === 'openai' ? 'data-openai="positive"' : state.provider === 'sdwebui' ? 'data-sdwebui="positive"' : `data-comfy="positive" ${state.comfyui.mapping.positive ? '' : 'disabled'}`}>${esc(state.provider === 'comfyui' ? state.comfyui.params.positive : state[state.provider].positive)}</textarea>${state.provider === 'openai' && isOpenAINovelAI(state.openai.model) ? field('负面提示词', `<textarea rows="3" aria-label="聊天图片负面提示词" data-openai="negative" maxlength="32000" spellcheck="false">${esc(state.openai.negative)}</textarea>`) : ''}${button('sparkles', '生成图像', 'generate', 'primary')}</div>` : ''}
        </section><div class="message-tools">${iconButton('copy', '复制消息', 'copy-message')}${iconButton('refresh-cw', '重新生成图片', 'generate')}<span>1 / 1</span></div>
      </div></article>
    </main>
    <form class="chat-composer"><textarea id="chat-input" rows="1" aria-label="发送消息" placeholder="继续这段故事..." maxlength="2000"></textarea><button type="submit" class="send-button" aria-label="发送消息" title="发送消息">${icon('send')}</button></form>
  </div>`;
}

function applyTokens() {
  const appearance = getCharacterTheme(state.characterTheme);
  document.documentElement.dataset.theme = config.theme;
  document.documentElement.dataset.characterTheme = appearance.id;
  document.documentElement.dataset.navigation = config.navigation;
  document.documentElement.dataset.density = config.density;
  document.documentElement.style.setProperty('--accent-selected', characterThemeAccent(appearance.id, config.accent));
  document.documentElement.style.setProperty('--sidebar-width', `${config.sidebarWidth}px`);
  document.documentElement.style.setProperty('--radius', `${config.radius}px`);
  document.documentElement.style.setProperty('--font-size', `${config.fontSize}px`);
  document.documentElement.style.setProperty('--chat-image-width', `${config.imageWidth}%`);
  document.documentElement.style.colorScheme = config.theme;
  if (window.parent !== window) postWindowMessage(window.parent, { type: 'draw-lab:appearance', characterTheme: appearance.id });
}

function render(force = false) {
  if (!config || rendering) return;
  const samePage = host.dataset.renderedPage === state.page && host.dataset.renderedSurface === config.surface;
  // Background task polling must not replace the mobile form or its native picker.
  if (!force && samePage && state.page === 'assistant' && config.surface === 'console') {
    refreshAssistantStatus();
    return;
  }
  if (!force && advancedPanel.ui.painting) return;
  const editing = document.activeElement;
  if (!force && host.dataset.renderedPage === state.page
    && editing?.matches('[data-advanced-field], [data-vibe-field], [data-lora-field], [data-mask-brush]')
    && !['checkbox', 'select-one'].includes(editing.type)) return;
  if (!force && host.dataset.renderedPage === 'settings' && state.page === 'settings'
    && editing?.matches('[data-backup-field="password"]')) return;
  if (!force && host.dataset.renderedPage === 'styles' && state.page === 'styles'
    && editing?.matches('[data-artist-field], [data-artist-search]')) return;
  if (!force && host.dataset.renderedPage === 'tags' && state.page === 'tags'
    && editing?.closest('[data-tag-root]')) return;
  if (!force && host.dataset.renderedPage === 'batch' && state.page === 'batch'
    && editing?.closest('[data-batch-root]')) return;
  if (!force && host.dataset.renderedPage === state.page && ['characters', 'assistant'].includes(state.page)
    && editing?.matches('input[data-profile-field], textarea[data-profile-field], [data-profile-outfit], input[data-participant-field], [data-assistant-character]')
    && !['checkbox', 'select-one'].includes(editing.type)) return;
  rendering = true;
  try {
  floatingMenu?.destroy();
  floatingMenu = null;
  const content = host.querySelector('.plugin-content');
  const scrollTop = content?.scrollTop || 0;
  const navScroll = host.querySelector('.plugin-nav')?.scrollLeft || 0;
  changelogPanel.capture(host);
  applyTokens();
  host.innerHTML = config.surface === 'chat' ? renderChat() : renderConsole();
  decoratePageHeading();
  updateConnectionStatus();
  updateCredentialStatus();
  host.dataset.renderedPage = state.page;
  host.dataset.renderedSurface = config.surface;
  if (samePage) host.querySelector('.plugin-content')?.scrollTo(0, scrollTop);
  if (!state.enabled) {
    host.querySelectorAll('button[data-action="generate"]').forEach((button) => {
      button.disabled = true;
      button.title = '插件已关闭';
    });
  }
  if (state.enabled && state.floatingBall && config.surface === 'chat') {
    host.insertAdjacentHTML('beforeend', `<button type="button" class="plugin-floating-ball" data-action="floating-menu" title="打开${esc(config.name)}菜单" aria-label="打开${esc(config.name)}菜单">${pluginIcon(state.characterTheme)}</button>`);
    floatingMenu = createFloatingMenu({
      button: host.querySelector('.plugin-floating-ball'), container: host,
      onSettings: showSettings,
      onHide: () => setFloatingBall(false),
    });
    floatingMenu.update({ characterTheme: state.characterTheme, theme: config.theme });
  }
  paintIcons();
  // Icon widths must be final before restoring a horizontally scrolled mobile nav.
  host.querySelector('.plugin-nav')?.scrollTo({ left: navScroll, top: 0, behavior: 'instant' });
  refreshUpdateNavigation();
  advancedPanel.objectInfo = comfyProbe?.objectInfo;
  advancedPanel.bind(host);
  backupPanel.bind(host);
  changelogPanel.bind(host);
  componentsPanel.bind(host);
  debugToolsPanel.bind(host);
  tagPanel.bind(host);
  workbenchPanel.bind(host);
  attachPromptTagButtons(host, openPromptTools);
  } finally { rendering = false; }
}

export function applyConfig(next) {
  const previous = config;
  config = next;
  if ((!previous || previous.state !== next.state) && !taskQueue.running) {
    runtimeState = next.state;
    progress = next.state === 'generating' ? 48 : 0;
  }
  if (!previous || previous.surface !== next.surface || previous.state !== next.state) {
    render();
  } else {
    applyTokens();
    host.querySelectorAll('.brand-copy > strong').forEach((node) => { node.textContent = config.name; });
    const heading = host.querySelector('.chat-image-heading > span');
    if (heading) {
      heading.innerHTML = renderChatBrand();
      paintIcons();
    }
    const ball = host.querySelector('.plugin-floating-ball');
    if (ball) {
      ball.title = `打开${config.name}菜单`;
      ball.setAttribute('aria-label', ball.title);
    }
    floatingMenu?.update({ characterTheme: state.characterTheme, theme: config.theme });
  }
}

export function showSettings() {
  const changedSurface = config.surface !== 'console';
  config = { ...config, surface: 'console' };
  state.page = 'settings';
  persist();
  render();
  if (changedSurface && window.parent !== window) {
    postWindowMessage(window.parent, { type: 'draw-lab:surface', surface: 'console' });
  }
}

export function showPage(page) {
  if (page === 'updates') {
    releasePanel.open = true;
    showPage('changelog');
    host?.querySelector('[data-release-fold]')?.scrollIntoView({ block: 'start' });
    return;
  }
  if (!['settings', 'generate', 'batch', 'gallery', 'assistant', 'characters', 'styles', 'tags', 'connection', 'components', 'debug', 'changelog'].includes(page)) return;
  if (page === 'changelog' && releasePanel.hasUpdate) releasePanel.open = true;
  state.page = page;
  persist(); render(page === 'assistant');
  if (page === 'assistant' && state.assistant.source === 'tavern' && isInstalled()) void fetchAssistantModels(false);
  if (page === 'characters') void refreshProfileCards();
}

export function setFloatingBall(visible) {
  if (typeof visible !== 'boolean' || state.floatingBall === visible) return;
  state.floatingBall = visible;
  persist();
  render();
}

export function applyHostContext(chat) {
  if (!isInstalled()) return;
  const changed = currentChat().key !== chat?.key;
  window.__LINGHUASHI_ENV__.chat = chat;
  if (changed) {
    profileAI.invalidate();
    useLiveCharacterScene();
    if (profileUI.scope === 'chat' && !profileUI.dirty) loadProfileDraft();
    if (state.page === 'characters') void refreshProfileCards();
  }
  render(changed);
}

function toast(message) {
  const root = document.getElementById('toast-root');
  root.innerHTML = `<div class="ui-toast">${icon('circle-check')}<span>${esc(message)}</span></div>`;
  paintIcons();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => root.replaceChildren(), 2200);
}

async function reloadDrawings() {
  const load = async () => {
    const location = state.cacheLocation;
    const rows = await drawingLibrary.list(location);
    if (location !== state.cacheLocation) return;
    const existingIds = new Set(rows.map((row) => row.id));
    state.drawingReviews = normalizeReviews(Object.fromEntries(Object.entries(state.drawingReviews)
      .filter(([key]) => !key.startsWith(`${location}:`) || existingIds.has(key.slice(location.length + 1)))));
    const next = hydrateDrawings(rows).map((row) => ({ ...row, rating: reviewValue(state.drawingReviews, location, row.id) })).sort((left, right) => right.createdAt - left.createdAt);
    const previous = drawings;
    const selectedGroups = new Set(previous.filter((row) => drawingUI.selection.has(row.id)).map(versionGroupId));
    drawings = next;
    state.history = drawings.map((item) => item.id);
    state.favorites = drawings.filter((item) => item.favorite).map((item) => item.id);
    state.storageUsage = formatBytes(rows.reduce((sum, item) => sum + item.blob.size + item.thumbnail.size, 0));
    drawingUI.storageLocation = location;
    state.storageStatus = location === 'server' ? drawingLibrary.server.stats?.enhanced
      ? '已连接 · 当前酒馆账号 · 服务器增强可用' : '已连接 · 当前酒馆账号 · 内置存储' : '';
    if (location === 'server' && drawingLibrary.server.stats?.pendingFiles) {
      state.storageStatus = `${drawingLibrary.server.stats.pendingFiles} 张图片的磁盘文件待清理，可点击检查存储`;
    }
    drawingUI.selection = new Set(drawingGroups(drawings).filter((row) => selectedGroups.has(versionGroupId(row))).map((row) => row.id));
    drawingUI.page = drawingPage(filterDrawings(drawings, drawingUI.filters), drawingUI.page, drawingUI.pageSize).page;
    if (!activeDrawing()) activeDrawingId = drawings[0]?.id || null;
    persist();
    drawingUI.loading = false;
    drawingUI.error = '';
    render();
    if (document.querySelector('.drawing-viewer')) {
      viewerUI.ids = viewerUI.ids.filter((id) => currentDrawing(drawings, id));
      viewerUI.index = Math.min(viewerUI.index, viewerUI.ids.length - 1);
      if (viewerUI.ids.length) showDrawingViewer();
      else closeDrawingViewer();
    }
    revokeDrawings(previous);
  };
  libraryReload = (libraryReload || Promise.resolve()).catch(() => {}).then(load);
  return libraryReload;
}

async function initializeDrawings() {
  try {
    await drawingLibrary.open();
    writeBrowserCache(CLEANUP_STORAGE, String(lastCleanup));
    if (!await drawingLibrary.hasSeed()) {
      const rows = [];
      for (const [index, sample] of (isInstalled() ? [] : samples).entries()) {
        if (!state.history.includes(sample.id)) continue;
        const response = await fetch(sample.src);
        if (!response.ok) throw new Error('示例图片未加载，请刷新重试');
        const snapshot = index === 0
          ? captureSnapshot({ provider: 'novelai', novelai: { ...NOVELAI_DEFAULTS, positive: sample.prompt, width: 1216, height: 832, seed: 8566257 } })
          : captureSnapshot({ provider: 'comfyui', comfyui: newComfyConfig(undefined, '示例风景工作流') });
        if (snapshot.provider === 'comfyui') Object.assign(snapshot.config.params, { positive: sample.prompt, width: 1216, height: 832, seed: 542123 });
        rows.push(await makeDrawing(await response.blob(), { id: `demo-${sample.id}`, title: sample.title, snapshot, createdAt: Date.now() - index * 3600000, favorite: state.favorites.includes(sample.id), demo: true }));
      }
      await drawingLibrary.seed(rows);
    }
    if (state.cacheLocation === 'server') await syncStoragePolicy();
    await reloadDrawings();
    await cleanupDrawings();
    setInterval(() => { void cleanupDrawings(); }, 60000);
    return true;
  } catch (error) {
    drawingUI.loading = false;
    drawingUI.error = `图片存储无法读取：${error.message}`;
    render();
    return false;
  }
}

async function cleanupDrawings() {
  if (cleanupBusy || !drawingLibrary.db || !state.enabled || backupPanel.ui.busy) return;
  cleanupBusy = true;
  try {
    if (state.cacheLocation === 'server') await syncStoragePolicy();
    const plan = await drawingLibrary.cleanup(state, lastCleanup);
    if (plan.due) {
      lastCleanup = Date.now();
      writeBrowserCache(CLEANUP_STORAGE, String(lastCleanup));
    }
    if (plan.ids.length) {
      await reloadDrawings();
      toast(`已自动清理 ${plan.ids.length} 张未收藏图片`);
    }
  } catch {
    toast(`自动清理失败，请检查${state.cacheLocation === 'server' ? '酒馆服务器' : '浏览器'}图片存储`);
  } finally { cleanupBusy = false; }
}

function syncStoragePolicy() {
  if (!isInstalled() || (state.cacheLocation !== 'server' && !serverPolicySignature)) return Promise.resolve();
  const settings = { enabled: state.enabled, cacheLocation: state.cacheLocation, cleanupMode: state.cleanupMode,
    cleanupInterval: state.cleanupInterval, cleanupUnit: state.cleanupUnit,
    cleanupMaxImages: state.cleanupMaxImages, cleanupOlderThanDays: state.cleanupOlderThanDays };
  const serialized = JSON.stringify(settings);
  serverPolicyWork = serverPolicyWork.catch(() => {}).then(async () => {
    if (serverPolicySignature === serialized) return;
    await drawingLibrary.syncPolicy(settings);
    serverPolicySignature = serialized;
  });
  return serverPolicyWork;
}

async function switchImageStorage(location) {
  if (location === state.cacheLocation || drawingUI.busy) return;
  await drawingOperation(async () => {
    if (location === 'server') await drawingLibrary.list('server');
    const previous = state.cacheLocation;
    state.cacheLocation = location;
    try {
      await syncStoragePolicy();
      drawingUI.filters = { source: 'all', start: '', end: '', search: '', favoriteOnly: false };
      drawingUI.selection.clear(); drawingUI.page = 1;
      await reloadDrawings();
      persist();
      toast(`图片存储已切换为${location === 'server' ? '酒馆服务器' : '浏览器'}`);
    } catch (error) {
      state.cacheLocation = previous;
      persist();
      await reloadDrawings().catch(() => {});
      throw error;
    }
  });
}

async function migrateBrowserImages() {
  await drawingOperation(async () => {
    const rows = (await drawingLibrary.list('browser')).filter((row) => !row.demo);
    if (!rows.length) { toast('当前浏览器没有可迁移的图片'); return; }
    if (!window.confirm(`将 ${rows.length} 张浏览器图片和参数复制到当前酒馆账号。原浏览器图片保留；再次迁移会跳过已保存的图片。继续吗？`)) return;
    let completed = 0;
    for (const row of rows) {
      try {
        await drawingLibrary.add([row], 'server');
        const rating = reviewValue(state.drawingReviews, 'browser', row.id);
        if (rating !== 'unrated') state.drawingReviews = setReview(state.drawingReviews, 'server', row.id, rating);
        completed++;
      }
      catch (error) {
        await reloadDrawings();
        throw new Error(`已迁移 ${completed}/${rows.length} 张；${error.message}。可再次点击迁移继续`);
      }
    }
    await reloadDrawings();
    toast(`已迁移 ${completed} 张图片，浏览器原图已保留`);
  });
}

async function drawingOperation(operation) {
  if (drawingUI.busy) return;
  if (!await libraryReady && !drawingLibrary.db) { toast('图片存储尚未就绪，请刷新页面重试'); return; }
  drawingUI.busy = true; drawingUI.error = ''; render();
  try { await operation(); }
  catch (error) {
    drawingUI.error = error.name === 'QuotaExceededError' ? '浏览器存储空间不足，请先导出并清理图片' : error.message;
    toast(drawingUI.error);
  } finally { drawingUI.busy = false; render(); }
}

function drawingTargets() {
  const selected = drawingUI.selection.size ? drawings.filter((item) => drawingUI.selection.has(item.id)) : filterDrawings(drawings, drawingUI.filters);
  const groups = new Set(selected.map(versionGroupId));
  return drawings.filter((item) => groups.has(versionGroupId(item)));
}

function importDrawingFiles() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.png,.jpg,.jpeg,.webp,.zip'; input.multiple = true;
  input.addEventListener('change', () => {
    const files = [...input.files];
    if (!files.length) return;
    drawingOperation(async () => {
      if (files.length > 500) throw new Error('一次最多导入 500 个文件');
      if (files.reduce((sum, file) => sum + file.size, 0) > 200 * 1024 * 1024) throw new Error('一次导入的文件总量需在 200 MB 以内');
      const rows = [];
      let duplicate = 0;
      const ids = new Set(drawings.map((item) => item.id));
      for (const file of files) {
        const imported = /\.zip$/i.test(file.name) ? await importArchive(file) : [await makeDrawing(file, { title: file.name.replace(/\.[^.]+$/, '') })];
        for (const item of imported) {
          if (ids.has(item.id)) { duplicate++; continue; }
          ids.add(item.id); rows.push(item);
          const maximum = state.cacheLocation === 'server' ? 10000 : 500;
          if (rows.length + drawings.length > maximum) throw new Error(`最多保存 ${maximum} 张图片，请先导出并清理一些图片`);
        }
      }
      if (rows.length) {
        await drawingLibrary.add(rows);
        for (const row of rows) if (row.rating && row.rating !== 'unrated') state.drawingReviews = setReview(state.drawingReviews, state.cacheLocation, row.id, row.rating);
        persist();
      }
      const warnings = rows.filter((item) => item.warning);
      drawingUI.page = 1;
      drawingUI.filters = { source: 'all', start: '', end: '', search: '', favoriteOnly: false };
      await reloadDrawings();
      toast(`已导入 ${rows.length} 张图片${duplicate ? `，跳过 ${duplicate} 张重复记录` : ''}${warnings.length ? `；${warnings.length} 张图片的参数无法读取` : ''}`);
    });
  });
  input.click();
}

function deleteDrawingsDialog(ids, title = '删除图片') {
  if (!ids.length || drawingUI.busy) return;
  const overlay = document.getElementById('overlay-root');
  const location = state.cacheLocation;
  const referenced = drawings.filter((item) => ids.includes(item.id) && item.chatBinding).length;
  overlay.innerHTML = `<dialog class="nai-preset-dialog" aria-labelledby="drawing-delete-title"><form>
    <header><h2 id="drawing-delete-title">${title}</h2>${iconButton('x', '关闭', 'drawing-close-delete')}</header>
    <p>将从${location === 'server' ? '酒馆服务器' : '浏览器'}删除 ${ids.length} 张图片及对应参数记录。</p>
    ${referenced ? `<p>包含 ${referenced} 个聊天图片版本。剩余版本会继续显示；整个图组删除后，该位置的图片将无法显示。</p>` : ''}
    <footer>${button('x', '取消', 'drawing-close-delete', 'secondary')}<button type="submit" class="ui-button drawing-delete">${icon('trash-2')}<span>删除 ${ids.length} 张</span></button></footer>
    </form></dialog>`;
  const dialog = overlay.querySelector('dialog');
  dialog.querySelectorAll('[data-action="drawing-close-delete"]').forEach((node) => node.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault(); dialog.close();
    drawingOperation(async () => {
      if (state.cacheLocation !== location) throw new Error('存储位置已变化，请重新选择图片');
      const result = await drawingLibrary.remove(ids, referenced > 0);
      await reloadDrawings();
      notifyImagesChanged();
      toast(`已删除 ${ids.length} 张图片${result?.pendingFiles ? '，磁盘文件将在清理任务中重试删除' : ''}`);
    });
  });
  paintIcons(); dialog.showModal();
}

function closeDrawingViewer() {
  document.getElementById('overlay-root').replaceChildren();
  host.querySelector(`[data-action="viewer"][data-image="${viewerUI.imageId}"]`)?.focus({ preventScroll: true });
}

function markReviewed(rating, undo = false) {
  const item = viewedDrawing();
  if (!item || drawingUI.busy) return;
  const entry = undo ? viewerUI.reviewHistory.at(-1) : { id: item.id, location: state.cacheLocation, before: item.rating || 'unrated' };
  if (!entry || entry.location !== state.cacheLocation) return;
  const previous = state.drawingReviews;
  try {
    state.drawingReviews = setReview(previous, entry.location, entry.id, undo ? entry.before : rating);
    persist();
    for (const row of drawings) row.rating = reviewValue(state.drawingReviews, state.cacheLocation, row.id);
    if (undo) {
      viewerUI.reviewHistory.pop();
      const index = viewerUI.ids.findIndex((id) => groupVersions(drawings, id).some((row) => row.id === entry.id));
      if (index >= 0) viewerUI.index = index;
      viewerUI.imageId = entry.id;
    } else {
      viewerUI.reviewHistory.push(entry);
      if (viewerUI.reviewHistory.length > 100) viewerUI.reviewHistory.shift();
      if (viewerUI.review && viewerUI.index < viewerUI.ids.length - 1) { viewerUI.index++; viewerUI.imageId = ''; }
    }
    render(); showDrawingViewer();
  } catch (error) { state.drawingReviews = previous; toast(error.message); }
}

function viewedDrawing() {
  const versions = groupVersions(drawings, viewerUI.ids[viewerUI.index]);
  return versions.find((row) => row.id === viewerUI.imageId) || currentDrawing(versions, viewerUI.ids[viewerUI.index]);
}

function showDrawingViewer() {
  const item = viewedDrawing();
  if (!item) return;
  viewerUI.imageId = item.id;
  viewerUI.versions = groupVersions(drawings, item.id);
  viewerUI.currentId = currentDrawing(drawings, item.id)?.id;
  viewerUI.seed = drawingSeed(item);
  if (!viewerUI.versions.some((row) => row.id === viewerUI.compareId && row.id !== item.id)) {
    viewerUI.compareId = viewerUI.versions.find((row) => row.id !== item.id)?.id || '';
  }
  const overlay = document.getElementById('overlay-root');
  overlay.innerHTML = renderDrawingViewer(item, viewerUI.index, viewerUI.ids.length, viewerUI);
  const dialog = overlay.querySelector('dialog');
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  paintIcons(); dialog.showModal();
}

function restoreViewerParameters() {
  const item = viewedDrawing();
  if (!item?.snapshot) return;
  const previous = { provider: state.provider, novelai: state.novelai, comfyui: state.comfyui, openai: state.openai, sdwebui: state.sdwebui,
    characterSceneOverride: state.characterSceneOverride, characterSceneOverrideProvider: state.characterSceneOverrideProvider };
  try {
    const message = restoreSnapshot(state, item.snapshot);
    persist();
    resetConnection({ keepOpenAIModels: previous.provider === 'openai' && state.provider === 'openai' });
    activeDrawingId = item.id;
    state.page = 'connection';
    persist(); closeDrawingViewer();
    config = { ...config, surface: 'console' };
    render();
    if (window.parent !== window) postWindowMessage(window.parent, { type: 'draw-lab:surface', surface: 'console' });
    toast(message);
  } catch (error) { Object.assign(state, previous); toast(error.message); }
}

function notifyImagesChanged() {
  chatPost('linghuashi:images-changed', {});
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(`linghuashi-chat:${currentAccount()}`);
    channel.postMessage({ type: 'images-changed' });
    channel.close();
  }
}

function closeImageEditor() {
  tagPanel.close();
  imageEditorUI?.controller?.abort();
  imageEditorUI = null;
  document.getElementById('overlay-root').replaceChildren();
}

function openImageEditor(item) {
  try {
    editorAdvancedPanel.resetMask();
    imageEditorUI = { id: item.id, location: state.cacheLocation, draft: imageEditDraft(item.snapshot),
      note: '', instruction: '', error: '', busy: false, submitting: false, advanced: false };
    showImageEditor();
  } catch (error) { imageEditorUI = null; toast(error.message); }
}

async function attachEditorSource(mode) {
  const ui = imageEditorUI;
  if (!ui) return;
  await editorAdvancedPanel.perform(async () => {
    await editorAdvancedPanel.attach('source', await materializeReferenceDrawing(ui.id));
    if (imageEditorUI !== ui) return;
    const draftAdvanced = advancedOf(ui.draft);
    draftAdvanced.mode = mode;
    if (ui.draft.provider === 'comfyui') ui.draft.config.advanced = draftAdvanced;
    else ui.draft.params.advanced = draftAdvanced;
  });
}

async function enqueueProcessing(draft, item, storageLocation) {
  if (state.cacheLocation !== storageLocation) throw new Error('存储位置已变化，请重新打开原图');
  if (!state.enabled || backupPanel.ui.restoring) throw new Error('请启用插件并完成配置恢复');
  const service = resolveNovelAIService(credentials.novelai.key, credentials.novelai.endpoint);
  if (!credentials.novelai.key.trim()) throw new Error('请先在接口配置填写 NovelAI 秘钥');
  if (service.kind !== 'identify' && service.kind !== 'resolved') throw new Error(service.message);
  if (service.id !== 'official' && !draft.allowThirdParty) throw new Error('请先勾选尝试当前第三方接口');
  const dimensions = validateProcessingDraft(draft, item);
  const parent = drawings.find((row) => row.id === item.id);
  if (!parent) throw new Error('来源图片已删除，请刷新图库');
  const materialized = await drawingLibrary.materialize(parent);
  const prepared = await prepareProcessingSource(materialized.blob, dimensions);
  if (state.cacheLocation !== storageLocation || !drawings.some((row) => row.id === item.id)) throw new Error('原图或存储位置已变化，请重新打开');
  const asset = await referenceAssets.put(prepared.blob, { ...prepared, name: parent.title }, storageLocation);
  const snapshot = processingSnapshot(draft, asset, item);
  const relation = editRelation(parent, processingTitle(snapshot.novelaiProcessing));
  relation.number = Math.max(...groupVersions(drawings, parent.id).map((row) => row.version?.number || 1)) + 1;
  const job = await enqueueGeneration(undefined, undefined, { snapshot, relation, storageLocation, chatBinding: parent.chatBinding });
  if (!job) throw new Error('未能加入图片处理任务，请检查插件开关和接口配置');
  toast('已加入图片处理任务，完成后保存为新版本');
}

async function materializeReferenceDrawing(id) {
  const row = drawings.find((item) => item.id === id);
  if (!row) throw new Error('图片已删除，请刷新绘图管理');
  const materialized = await drawingLibrary.materialize(row);
  const normalized = await normalizeReferenceImage(materialized.blob);
  normalized.name = row.title;
  return normalized;
}

async function encodeCurrentVibe(entry, model) {
  const credential = credentials.novelai;
  if (!state.enabled || !credential.key.trim()) throw new Error('请启用插件并配置 NovelAI 秘钥');
  let service = resolveNovelAIService(credential.key, credential.endpoint);
  if (service.kind === 'identify') service = await identifySkService(credential.key, { signal: AbortSignal.timeout(12000) });
  if (service.kind !== 'resolved') throw new Error(service.message);
  const image = assetBase64(new Uint8Array(await (await referenceAssets.get(entry.image)).arrayBuffer()));
  return encodeVibe({ endpoint: service.endpoint, key: credential.key, model, image, information: entry.information,
    signal: AbortSignal.timeout(120000) });
}

async function useViewerReference(kind) {
  const row = viewedDrawing();
  if (!row) return;
  try {
    const image = await materializeReferenceDrawing(row.id);
    closeDrawingViewer();
    const snapshot = captureSnapshot(state), advanced = advancedOf(snapshot);
    advanced.mode = kind === 'source' ? 'image' : 'reference';
    if (['comfyui', 'sdwebui'].includes(snapshot.provider) && kind !== 'source') throw new Error('当前模式请使用图生图或局部重绘');
    if (snapshot.provider === 'novelai' && kind !== 'source') advanced.referenceKind = 'vibe';
    if (snapshot.provider === 'comfyui') state.comfyui.advanced = advanced;
    else state[snapshot.provider].advanced = advanced;
    await advancedPanel.attach(kind === 'source' ? 'source' : snapshot.provider === 'novelai' ? 'vibe' : 'reference', image);
    persist(); showPage('generate');
  } catch (error) { toast(error.message); }
}

function showImageEditor() {
  if (renderingEditor) return;
  const ui = imageEditorUI, item = drawings.find((row) => row.id === ui?.id);
  if (!ui || !item) { closeImageEditor(); return; }
  renderingEditor = true;
  try {
  const overlay = document.getElementById('overlay-root');
  const scrollTop = overlay.querySelector('.image-editor-body')?.scrollTop || 0;
  overlay.innerHTML = renderImageEditor(item, ui, editorAdvancedPanel.html());
  const dialog = overlay.querySelector('dialog');
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeImageEditor(); });
  const params = () => ui.draft.params || ui.draft.config.params;
  const single = dialog.querySelector('[data-nai="nSamples"], [data-openai="n"], [data-comfy="batch"], [data-sdwebui="batch"]');
  if (single) { single.value = '1'; single.disabled = true; }
  const negative = dialog.querySelector('[data-openai-negative-field]');
  if (negative && isOpenAINovelAI(params().model)) {
    negative.hidden = false; negative.querySelector('textarea').disabled = ui.busy || ui.submitting;
  }
  dialog.addEventListener('input', (event) => {
    const target = event.target, key = target.dataset.nai || target.dataset.openai || target.dataset.comfy || target.dataset.sdwebui;
    if (key) params()[key] = target.type === 'checkbox' ? target.checked : target.type === 'number' ? Number(target.value) : target.value;
    if (target.hasAttribute('data-image-edit-instruction')) ui.instruction = target.value;
    if (target.hasAttribute('data-image-edit-note')) ui.note = target.value;
    if (target.dataset.imageEditRole !== undefined) {
      const role = ui.draft.characterScene.characterPrompts[Number(target.dataset.imageEditRole)];
      role[target.dataset.roleField] = target.value;
    }
  });
  dialog.addEventListener('change', (event) => {
    const target = event.target;
    if (target.hasAttribute('data-nai-size') && target.value !== 'custom') {
      const size = NOVELAI_SIZES.find((row) => row.id === target.value);
      Object.assign(params(), { width: size.width, height: size.height });
      showImageEditor();
    } else if (['model', 'size', 'parameterMode', 'outputFormat', 'sm'].includes(target.dataset.nai || target.dataset.openai)) {
      ui.draft = normalizeSnapshot(ui.draft); showImageEditor();
    }
  });
  dialog.querySelectorAll('details').forEach((node) => node.addEventListener('toggle', () => { ui.advanced = node.open; }));
  dialog.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'image-edit-close') closeImageEditor();
    else if (action === 'image-edit-reset') { ui.draft = imageEditDraft(item.snapshot); ui.error = ''; showImageEditor(); }
    else if (action === 'image-edit-cancel') ui.controller?.abort();
    else if (action === 'image-edit-rewrite') void rewriteImage();
    else if (action === 'image-edit-generate') void generateImageVersion();
    else if (action === 'image-edit-enhance') processingPanel.open(item);
    else if (action === 'image-edit-source' || action === 'image-edit-inpaint') {
      void attachEditorSource(action === 'image-edit-inpaint' ? 'inpaint' : 'image');
    }
    else if (['nai-swap-size', 'openai-swap-size', 'sdwebui-swap-size'].includes(action)) {
      [params().width, params().height] = [params().height, params().width]; showImageEditor();
    } else if (action === 'sdwebui-insert-lora') {
      try {
        const token = loraPrompt(dialog.querySelector('[data-sdwebui-lora]').value, Number(dialog.querySelector('[data-sdwebui-lora-weight]').value));
        if (params().positive.length + token.length + 2 > 12000) throw new Error('正向提示词超过 12000 字符');
        params().positive = [params().positive.trim(), token].filter(Boolean).join(', '); showImageEditor();
      } catch (error) { toast(error.message); }
    } else if (['nai-random-seed', 'comfy-random-seed'].includes(action)) {
      params().seed = crypto.getRandomValues(new Uint32Array(1))[0]; showImageEditor();
    }
  });
  editorAdvancedPanel.objectInfo = comfyProbe?.objectInfo;
  editorAdvancedPanel.bind(overlay);
  if (!ui.busy && !ui.submitting) attachPromptTagButtons(dialog, (target, input, visual = false) => {
    const roleIndex = input.dataset.imageEditRole;
    const role = roleIndex !== undefined ? ui.draft.characterScene.characterPrompts[Number(roleIndex)] : null;
    tagPanel.open({
      target, visual, label: role ? `${role.name} · 本图角色` : '单图编辑草稿',
      getContext: () => ({ provider: role ? 'novelai' : ui.draft.provider,
        params: role ? { ...role, model: params().model } : params(), mapping: ui.draft.config?.mapping,
        allowedTargets: role ? ['positive', 'negative'] : undefined,
        limits: role ? { positive: 12000, negative: 4000 } : undefined }),
      getPreview: (edits) => {
        const snapshot = structuredClone(ui.draft);
        if (role) Object.assign(snapshot.characterScene.characterPrompts[Number(roleIndex)], edits);
        return visualPromptPreview(snapshot, role ? {} : edits);
      },
      insert: (next, field) => {
        if (imageEditorUI !== ui || ui.busy || ui.submitting) throw new Error('当前图片草稿已关闭或正在处理');
        if (role) for (const key of Array.isArray(field) ? field : [field]) role[key] = next[key];
        else if (ui.draft.provider === 'comfyui') ui.draft.config.params = next;
        else ui.draft.params = next;
        input.value = next[target];
      },
      closed: () => { if (imageEditorUI === ui) showImageEditor(); },
    });
  });
  paintIcons(); dialog.showModal();
  dialog.querySelector('.image-editor-body').scrollTop = scrollTop;
  } finally { renderingEditor = false; }
}

async function rewriteImage() {
  const ui = imageEditorUI;
  if (!ui || ui.busy || ui.submitting) return;
  const controller = new AbortController();
  ui.busy = true; ui.error = ''; ui.controller = controller;
  const draft = structuredClone(ui.draft), instruction = ui.instruction;
  showImageEditor();
  try {
    if (!state.enabled) throw new Error('插件已关闭');
    await saveAssistantKey();
    const options = normalizeAssistant(state.assistant), messages = imageEditMessages(draft, instruction, options);
    const plan = options.source === 'api'
      ? await requestAssistantAPI(options, assistantUI.key, messages, { signal: controller.signal })
      : parseAssistantResult(await assistantHostRequest('text', { messages }, { signal: controller.signal, timeout: options.timeout }));
    controller.signal.throwIfAborted();
    if (imageEditorUI === ui) {
      ui.draft = applyImageRewrite(draft, plan);
      if (!ui.note) ui.note = instruction.slice(0, 1000);
    }
  } catch (error) { ui.error = controller.signal.aborted ? '处理已取消，原参数已保留' : error.message; }
  finally { ui.busy = false; ui.controller = null; if (imageEditorUI === ui) showImageEditor(); }
}

async function generateImageVersion() {
  const ui = imageEditorUI;
  if (!ui || ui.busy || ui.submitting) return;
  ui.error = '';
  try {
    await editorAdvancedPanel.beforeGenerate();
    ui.submitting = true; showImageEditor();
    if (state.cacheLocation !== ui.location) throw new Error('存储位置已变化，请重新打开原图');
    const parent = drawings.find((row) => row.id === ui.id);
    if (!parent) throw new Error('来源图片已删除，请刷新图库');
    const snapshot = prepareImageEdit(ui.draft);
    const relation = editRelation(parent, ui.note);
    relation.number = Math.max(...groupVersions(drawings, parent.id).map((row) => row.version?.number || 1)) + 1;
    const job = await enqueueGeneration(undefined, undefined, { snapshot, relation,
      chatBinding: parent.chatBinding, storageLocation: ui.location });
    if (!job) throw new Error('未能加入重绘任务，请检查接口配置或插件开关');
    closeImageEditor();
    toast('已加入重绘任务，完成后保存为新版本');
  } catch (error) { ui.error = error.message; }
  finally { ui.submitting = false; if (imageEditorUI === ui) showImageEditor(); }
}

async function toggleDrawingFavorite(imageId) {
  const item = drawings.find((row) => row.id === (imageId || activeDrawingId));
  if (!item) { toast('请先将图片保存到绘图管理'); return; }
  await drawingOperation(async () => {
    await drawingLibrary.setFavorite(item.id, !item.favorite);
    await reloadDrawings();
    toast(item.favorite ? '已取消收藏' : '已加入收藏');
  });
}

function openAIIdentity() {
  return JSON.stringify([state.openaiEndpoint.trim(), state.openaiPath.trim(), state.openai.model.trim(), credentials.openai.key.trim()]);
}

function openAIGenerationVerified() {
  return generationVerified !== null && generationVerified === openAIIdentity();
}

async function prepareGenerationPlan(snapshot, credential, connection, imageEdit) {
  const provider = snapshot.provider;
  const params = snapshot.params || snapshot.config.params;
  let body, url, base, outputNode;
  const headers = {};
  const advanced = snapshot.novelaiProcessing ? { mode: 'text' } : validateAdvanced(snapshot);
  if (provider === 'novelai') {
    if (!credential.key.trim()) throw new GenerationError('请先在接口配置填写 NovelAI 秘钥');
    let service = resolveNovelAIService(credential.key, credential.endpoint);
    if (service.kind === 'identify') {
      service = { kind: 'resolved', ...await identifySkService(credential.key, { signal: AbortSignal.timeout(12000) }) };
    } else if (service.kind !== 'resolved') throw new GenerationError(service.message);
    if (snapshot.novelaiProcessing) {
      const processing = buildProcessingRequest(snapshot);
      url = `${processingEndpoint(service, snapshot.novelaiProcessing)}${processing.path}`;
      body = processing.body;
    } else {
      url = `${service.endpoint}/ai/generate-image`;
      body = buildNovelAIRequest(params, snapshot.characterScene?.characterPrompts);
    }
    headers.Authorization = `Bearer ${credential.key.trim()}`;
  } else if (provider === 'openai') {
    url = openAIURLs(connection.endpoint, connection.path).generation;
    if (advanced.mode !== 'text') url = openAIURLs(connection.endpoint, advanced.editPath).generation;
    if (!credential.key.trim() && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
      throw new GenerationError('请先在接口配置填写 API Key');
    }
    if (credential.key.trim()) headers.Authorization = `Bearer ${credential.key.trim()}`;
    body = buildOpenAIRequest(params);
    if ((imageEdit || advanced.mode !== 'text') && !isOpenAINovelAI(params.model) && params.negative.trim()) body.prompt += `\nAvoid: ${params.negative.trim()}`;
  } else if (provider === 'sdwebui') {
    base = sdwebuiBase(credential.endpoint);
    if (location.protocol === 'https:' && new URL(base).protocol === 'http:'
      && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)) throw new GenerationError('当前酒馆使用 HTTPS，请为远程 SDWebUI 配置 HTTPS 地址');
    Object.assign(headers, sdwebuiHeaders(connection, credential.key));
    const request = buildSDWebUIRequest(snapshot);
    url = `${base}${request.path}`; body = request.body;
  } else {
    base = normalizeComfyEndpoint(credential.endpoint);
    if (location.protocol === 'https:' && new URL(base).protocol === 'http:') {
      throw new GenerationError('当前酒馆使用 HTTPS，请为 ComfyUI 配置 HTTPS 地址');
    }
    if (credential.auth === 'bearer') {
      if (!credential.key.trim()) throw new GenerationError('请填写 ComfyUI 访问令牌');
      headers.Authorization = `Bearer ${credential.key.trim()}`;
    }
    url = `${base}/prompt`;
    const config = structuredClone(snapshot.config);
    if (advanced.mode !== 'text' && config.mapping.image) config.params.image = 'reference.png';
    body = { prompt: applyWorkflowParameters(config), client_id: randomUUID() };
    outputNode = snapshot.config.outputNode;
  }
  return {
    provider, model: snapshot.novelaiProcessing?.kind === 'upscale' ? body.model : params.model || params.checkpoint || snapshot.config?.name || 'SDWebUI 当前模型',
    snapshot, headers, body, url, base, outputNode,
    timeout: ['openai', 'sdwebui'].includes(provider) ? connection.timeout : 600,
    ...(provider === 'sdwebui' ? { auth: connection.auth, username: connection.username,
      sdTaskIdSupported: advanced.mode === 'text' ? connection.textTaskId : advanced.mode !== 'upscale' && connection.imageTaskId,
      sdProgressMode: connection.progressMode } : {}),
    identity: provider === 'openai' ? JSON.stringify([connection.endpoint.trim(), connection.path.trim(), params.model.trim(), credential.key.trim()]) : null,
    identityFields: provider === 'openai' ? [connection.endpoint.trim(), connection.path.trim(), params.model.trim()] : [],
  };
}

async function runGeneration(job) {
  const stopProgress = watchComfyProgress(job);
  try {
  if (!job.saved) {
    if (job.plan.chatRequestId && !job.execution && !await validateChatRequest(chatRequests.get(job.plan.chatRequestId))) {
      job.status = 'cancelled';
      throw new GenerationError('原聊天或提示词已变化，任务已取消');
    }
    job.failurePhase = 'preparing';
    job.preparePayload = () => prepareAdvancedPayload(job, referenceAssets);
    await submitGeneration(job);
    job.failurePhase = 'retrieving';
    job.phase = 'retrieving'; job.notify();
    const downloaded = await downloadResults(job);
    job.failurePhase = 'image-processing';
    const received = await finishAdvancedImages(job, downloaded, referenceAssets);
    const results = job.plan.imageEdit && !job.plan.snapshot.novelaiProcessing ? received.slice(0, 1) : received;
    job.controller.signal.throwIfAborted();
    job.phase = 'saving'; job.notify();
    job.failurePhase = 'task-state';
    await job.checkpoint?.({ stage: 'saving', imageCount: results.length });
    job.failurePhase = 'image-processing';
    if (!job.rows) {
      const rows = [];
      for (const [index, result] of results.entries()) {
        const snapshot = structuredClone(job.plan.snapshot);
        const processing = snapshot.novelaiProcessing;
        const variant = processingVariant(processing, index, results.length, result.filename);
        if (processing) processing.variant = variant;
        const params = snapshot.params || snapshot.config.params;
        if (snapshot.provider === 'sdwebui' && result.model) params.model = result.model;
        if (results.length > 1 && Object.hasOwn(params, 'seed')) params.seed = -1;
        if (Number.isSafeInteger(result.seed) && result.seed >= 0) {
          if (snapshot.provider === 'openai') params.extra = JSON.stringify({ ...JSON.parse(params.extra || '{}'), seed: result.seed });
          else params.seed = result.seed;
        }
        const row = await makeDrawing(result.blob, {
          id: `${job.id}-${index}`, createdAt: job.createdAt,
          title: processing ? `${processingTitle(processing)}${variant ? ` · ${variant}` : ''}`
            : `${params.positive.trim().slice(0, 40) || '绘图'}${results.length > 1 ? ` · ${index + 1}` : ''}`,
          snapshot, batchId: job.id, chatBinding: job.plan.chatBinding,
          ...(job.plan.imageEdit ? { version: { ...job.plan.imageEdit,
            number: job.plan.imageEdit.number + index,
            note: [job.plan.imageEdit.note, variant].filter(Boolean).join(' · ') } } : {}),
        });
        rows.push(row);
      }
      job.rows = rows;
    }
    if (job.plan.provider === 'openai') generationVerified = job.plan.identity;
    job.controller.signal.throwIfAborted();
    job.failurePhase = 'saving';
    if (!job.plan.imageEdit) await cleanupDrawings();
    await drawingLibrary.add(job.rows, job.plan.storageLocation, { requestId: job.plan.chatRequestId });
    job.saved = true; job.imageCount = job.rows.length;
    job.savedIds = job.rows.map((row) => row.id);
  }
  activeDrawingId = job.savedIds[0];
  if (job.plan.provider === 'openai' && state.provider === 'openai' && openAIGenerationVerified()) {
    connectionStatus = { message: '图片已返回 · 生图已验证', tone: 'success' };
  }
  job.failurePhase = 'refreshing';
  await reloadDrawings();
  if (job.plan.imageEdit) notifyImagesChanged();
  toast(`已${job.plan.snapshot.novelaiProcessing ? '处理' : '生成'}并保存 ${job.imageCount} 张图片`);
  delete job.rows;
  } finally { stopProgress(); delete job.preparePayload; }
}

function chatPost(type, value) {
  if (isInstalled()) postWindowMessage(window.parent, { type, ...value });
}

function reportChatTask(job) {
  const request = chatRequests.get(job.plan.chatRequestId);
  if (!request) return;
  const data = {
    requestId: request.requestId, binding: request.binding,
    status: ['paused', 'uncertain'].includes(job.status) ? 'failed' : job.status, phase: job.phase,
    progress: job.progress,
    error: job.status === 'paused' ? '任务已恢复，等待手动继续' : job.error || '',
    recoverable: ['paused', 'failed'].includes(job.status) && (Boolean(job.execution) || job.stage === 'waiting'),
    savedIds: job.savedIds || [],
    ...(request.quickImage ? { imageId: job.plan.imageEdit.parentId, id: job.id, execution: Boolean(job.execution) } : {}),
  };
  const serialized = JSON.stringify(data);
  if (request.lastReport === serialized) return;
  request.lastReport = serialized;
  chatPost('linghuashi:chat-task', data);
}

async function validateChatRequest(request) {
  if (!request || request.controller.signal.aborted || !state.enabled) return false;
  const validationId = randomUUID();
  return new Promise((resolve) => {
    const finish = (valid) => {
      clearTimeout(timer);
      request.controller.signal.removeEventListener('abort', cancelled);
      chatValidations.delete(validationId);
      resolve(valid);
    };
    const cancelled = () => finish(false);
    const timer = setTimeout(() => finish(false), 5000);
    chatValidations.set(validationId, finish);
    request.controller.signal.addEventListener('abort', cancelled, { once: true });
    chatPost('linghuashi:chat-validate', { validationId, requestId: request.requestId, binding: request.restored ? request.binding : undefined, automatic: request.automatic });
  });
}

export function receiveChatCommand(data) {
  if (!isInstalled()) return;
  if (data.type === 'linghuashi:chat-valid') {
    chatValidations.get(data.validationId)?.(data.valid === true);
    return;
  }
  if (data.type === 'linghuashi:chat-images-changed') {
    void libraryReady.then(reloadDrawings).catch((error) => toast(error.message)); return;
  }
  if (data.type === 'linghuashi:chat-image-open') {
    if (!validBinding(data.binding) || !validImageId(data.id)
      || !['view', 'edit', 'source', 'inpaint', 'enhance', 'restore'].includes(data.action)) return;
    void openChatImage(data).catch((error) => toast(error.message)); return;
  }
  if (data.type === 'linghuashi:chat-image-control') {
    if (!validBinding(data.binding) || !/^[a-f0-9-]{36}$/.test(data.taskId || '')
      || !['recover', 'cancel'].includes(data.action)) return;
    void (async () => {
      await tasksReady; await refreshTasks();
      const job = taskQueue.jobs.find((row) => row.id === data.taskId);
      if (!job?.plan.imageEdit || job.plan.chatBinding?.id !== data.binding.id) throw new Error('配图任务已变化，请刷新聊天');
      if (data.action === 'cancel') taskQueue.cancel(job.id);
      else taskQueue.retry(job.id);
    })().catch((error) => toast(error.message));
    return;
  }
  if (data.type === 'linghuashi:chat-image-generate') {
    if (!validBinding(data.binding) || !validImageId(data.imageId)
      || !/^[a-f0-9-]{36}$/.test(data.requestId || '') || chatRequests.has(data.requestId)
      || !['browser', 'server'].includes(data.storageLocation)) return;
    if (chatInbox.length >= 32) {
      chatPost('linghuashi:chat-task', { requestId: data.requestId, imageId: data.imageId, status: 'failed', error: '生图队列已满，请稍后重试' }); return;
    }
    const request = { ...data, quickImage: true, automatic: false, controller: new AbortController() };
    chatRequests.set(request.requestId, request); chatInbox.push(request); void processChatInbox(); return;
  }
  if (['linghuashi:chat-view', 'linghuashi:chat-edit'].includes(data.type) && typeof data.id === 'string') {
    void libraryReady.then(async () => {
      await reloadDrawings();
      showPage('gallery');
      if (data.type === 'linghuashi:chat-edit') {
        const item = drawings.find((row) => row.id === data.id) || currentDrawing(drawings, data.id);
        if (item) openImageEditor(item); else toast('图片已删除或位于其他存储位置');
      } else openViewer(data.id);
    }).catch((error) => toast(error.message));
    return;
  }
  if (data.type === 'linghuashi:chat-assistant-open') {
    if (!validBinding(data.binding)) return;
    try {
      state.assistantDraft = parseAssistantResult(JSON.stringify(data.plan), { stored: true });
      assistantUI.binding = data.binding; assistantUI.requestId = data.requestId;
      state.assistantBinding = data.binding; state.assistantRequestId = data.requestId;
      state.assistantInput = state.assistantDraft.scene; assistantUI.error = '';
      persist(); showPage('assistant');
    } catch (error) { toast(error.message); }
    return;
  }
  if (['linghuashi:chat-assist', 'linghuashi:chat-draft-generate'].includes(data.type)) {
    if (!validBinding(data.binding) || data.binding.kind !== 'smart'
      || !/^[A-Za-z0-9_-]{1,80}$/.test(data.requestId || '') || chatRequests.has(data.requestId)) return;
    if (chatInbox.length >= 32) {
      chatPost('linghuashi:chat-task', { requestId: data.requestId, status: 'failed', error: '助手队列已满，请稍后重试' });
      return;
    }
    const request = { ...data, automatic: data.automatic === true, controller: new AbortController() };
    if (data.type === 'linghuashi:chat-draft-generate') {
      try { request.assistantPlan = parseAssistantResult(JSON.stringify(data.plan), { stored: true }); }
      catch (error) {
        chatPost('linghuashi:chat-task', { requestId: data.requestId, status: 'failed', error: error.message }); return;
      }
      request.assistantOptions = normalizeAssistant(state.assistant);
    }
    chatRequests.set(request.requestId, request); chatInbox.push(request);
    void processChatInbox(); return;
  }
  if (data.type === 'linghuashi:chat-generate') {
    if (!validBinding(data.binding) || typeof data.prompt !== 'string' || !data.prompt.trim()
      || data.prompt.length > 32000 || typeof data.requestId !== 'string'
      || !/^[A-Za-z0-9_-]{1,80}$/.test(data.requestId) || chatRequests.has(data.requestId)) return;
    if (chatInbox.length >= 32) {
      chatPost('linghuashi:chat-task', { requestId: data.requestId, status: 'failed', error: '确认队列已满，请稍后重试' });
      return;
    }
    const request = { ...data, automatic: data.automatic === true, controller: new AbortController() };
    chatRequests.set(request.requestId, request);
    chatInbox.push(request);
    void processChatInbox();
    return;
  }
  const request = chatRequests.get(data.requestId);
  if (!request && data.type === 'linghuashi:chat-recover') {
    void (async () => {
      await tasksReady;
      await libraryReady;
      await refreshTasks();
      const restored = chatRequests.get(data.requestId);
      const recovered = taskQueue.jobs.find((item) => item.id === restored?.jobId);
      if (recovered) taskQueue.retry(recovered.id);
      else toast('未找到可恢复任务，请打开生图工坊核对记录');
    })();
    return;
  }
  if (!request) return;
  const job = taskQueue.jobs.find((item) => item.id === request.jobId);
  if (data.type === 'linghuashi:chat-cancel') {
    if (data.pendingOnly && job?.status === 'running') return;
    request.controller.abort();
    if (job) taskQueue.cancel(job.id);
    else {
      request.dialog?.close();
      chatPost('linghuashi:chat-task', { requestId: request.requestId, status: 'cancelled' });
    }
  }
  if (data.type === 'linghuashi:chat-recover' && job && ['failed', 'paused'].includes(job.status)) {
    // Recovery downloads the accepted result; it never creates another billable request.
    void Promise.resolve(libraryReady).then(() => taskQueue.retry(job.id));
  }
}

async function processChatInbox() {
  if (processingChat) return;
  processingChat = true;
  try {
    while (chatInbox.length) {
      const request = chatInbox.shift();
      if (request.controller.signal.aborted) continue;
      await libraryReady;
      while (document.getElementById('overlay-root').childElementCount && !request.controller.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (request.controller.signal.aborted) continue;
      if (request.type === 'linghuashi:chat-assist') await analyzeChat(request);
      else if (request.quickImage) await enqueueChatImage(request);
      else await enqueueGeneration(request);
    }
  } finally { processingChat = false; }
}

async function openChatImage(data) {
  await libraryReady;
  if (state.cacheLocation !== data.storageLocation) {
    throw new Error(`这张配图保存在${data.storageLocation === 'server' ? '酒馆服务器' : '浏览器'}，请先在插件设置切换图片缓存位置`);
  }
  if (document.getElementById('overlay-root').childElementCount || processingPanel.dialog) throw new Error('请先完成或关闭当前编辑窗口');
  await reloadDrawings();
  const item = drawings.find((row) => row.id === data.id);
  if (!chatImageBelongsTo(item, data.binding)) throw new Error('图片已删除或配图关联已变化，请刷新聊天');
  if (data.action === 'restore') {
    const previous = { provider: state.provider, novelai: state.novelai, comfyui: state.comfyui, openai: state.openai, sdwebui: state.sdwebui,
      characterSceneOverride: state.characterSceneOverride, characterSceneOverrideProvider: state.characterSceneOverrideProvider };
    try {
      const message = restoreSnapshot(state, item.snapshot);
      persist(); resetConnection(); activeDrawingId = item.id; showPage('generate'); toast(message);
    } catch (error) { Object.assign(state, previous); throw error; }
  } else if (data.action === 'view') openViewer(item.id);
  else if (data.action === 'enhance') processingPanel.open(item);
  else {
    openImageEditor(item);
    if (data.action === 'source' || data.action === 'inpaint') await attachEditorSource(data.action === 'source' ? 'image' : 'inpaint');
  }
}

async function enqueueChatImage(request) {
  try {
    const rows = await drawingLibrary.list(request.storageLocation);
    const parent = rows.find((row) => row.id === request.imageId);
    if (!chatImageBelongsTo(parent, request.binding) || !await validateChatRequest(request)) throw new Error('原消息或图片已变化，请重新打开配图');
    const draft = applyChatImageEdit(imageEditDraft(parent.snapshot), request.edits, request.randomize === true);
    const snapshot = prepareImageEdit(draft), relation = editRelation(parent, request.edits ? '聊天修改提示词' : '聊天再画一张');
    relation.number = Math.max(...groupVersions(rows, parent.id).map((row) => row.version?.number || 1)) + 1;
    await enqueueGeneration(request, undefined, { snapshot, relation, chatBinding: parent.chatBinding, storageLocation: request.storageLocation });
  } catch (error) {
    chatPost('linghuashi:chat-task', { requestId: request.requestId, imageId: request.imageId, binding: request.binding,
      status: request.controller.signal.aborted ? 'cancelled' : 'failed', error: error.message });
  }
}

function confirmGeneration(snapshot, request) {
  const params = snapshot.params || snapshot.config.params;
  const overlay = document.getElementById('overlay-root');
  return new Promise((resolve) => {
    overlay.innerHTML = `<dialog class="nai-preset-dialog generation-confirm" aria-label="确认生图提示词"><form>
      <header><h2>确认生图提示词</h2>${iconButton('x', '关闭', 'generation-close')}</header>
      <p>${request?.binding ? `聊天配图 ${request.binding.slot + 1} · ` : request?.external ? `来自 ${esc(request.external)} · ` : ''}${esc(params.model || params.checkpoint || snapshot.config.name)} · ${params.n || params.nSamples || params.batchSize || 1} 张</p>
      ${field('正向提示词', `<textarea name="positive" rows="5" maxlength="32000" ${snapshot.provider === 'comfyui' && !snapshot.config.mapping.positive ? 'readonly' : ''}>${esc(params.positive)}</textarea>`)}
      <footer>${button('x', '取消', 'generation-close', 'secondary')}<button type="submit" class="ui-button primary">${icon('sparkles')}<span>确认生成</span></button></footer>
    </form></dialog>`;
    const dialog = overlay.querySelector('dialog');
    if (request) request.dialog = dialog;
    let confirmed = false;
    const abort = () => dialog.close();
    request?.controller.signal.addEventListener('abort', abort, { once: true });
    dialog.querySelectorAll('[data-action="generation-close"]').forEach((node) => node.addEventListener('click', abort));
    dialog.addEventListener('close', () => {
      request?.controller.signal.removeEventListener('abort', abort);
      if (request) delete request.dialog;
      dialog.remove(); resolve(confirmed);
    }, { once: true });
    dialog.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      params.positive = String(new FormData(event.target).get('positive')).trim();
      if (!params.positive) return;
      confirmed = true; dialog.close();
    });
    paintIcons(); dialog.showModal();
    if (request) {
      if (!request.external) chatPost('linghuashi:chat-task', { requestId: request.requestId, status: 'confirming' });
      chatPost('linghuashi:attention', {});
    }
    if (request?.controller.signal.aborted) dialog.close();
  });
}

async function prepareExternalGeneration(options, metadata, signal, id) {
  if (backupPanel.ui.busy || backupPanel.ui.restoring) throw apiError('BUSY', '备份或恢复正在进行，请稍后重试');
  if (drawingUI.loading || !drawingLibrary.db) throw apiError('STORAGE_UNAVAILABLE', '图片存储尚未准备好');
  const { snapshot, connection, useCurrentConnection } = prepareExtensionSnapshot(state, options);
  const provider = snapshot.provider, params = snapshot.params || snapshot.config.params;
  const storageLocation = options.storageLocation || state.cacheLocation;
  if (storageLocation === 'server') await drawingLibrary.list('server');
  const credential = useCurrentConnection ? { ...credentials[provider] }
    : { endpoint: connection.endpoint, auth: connection.auth || 'none',
      key: connection.keyRef ? await credentialRequest('read', provider, { ref: connection.keyRef }) : '' };
  if (useCurrentConnection && provider === 'openai') Object.assign(connection, {
    endpoint: state.openaiEndpoint, path: state.openaiPath, timeout: state.openaiTimeout,
  });
  if (params.seed === -1) params.seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const scene = snapshot.characterScene;
  if (scene?.chatKey && scene.chatKey !== currentChat().key) throw apiError('CHAT_TARGET_INVALID', '角色档案属于另一聊天');
  let prepared = applyCharacterScene(snapshot, scene);
  if (state.confirm) {
    if (document.getElementById('overlay-root').childElementCount) throw apiError('BUSY', '请先处理当前编辑窗口');
    const controller = { signal };
    if (!await confirmGeneration(prepared, { external: metadata.source.name, controller })) throw apiError('CANCELLED', '已取消生图');
  }
  signal.throwIfAborted();
  const plan = await prepareGenerationPlan(prepared, credential, connection, { external: true });
  plan.keyRef = plan.headers.Authorization ? await credentialRequest('write', provider, { key: credential.key, ref: connection.keyRef }) : '';
  plan.storageLocation = storageLocation;
  if (options.chat) {
    if (storageLocation !== state.cacheLocation) throw apiError('CHAT_TARGET_INVALID', '聊天配图须使用当前图片存储位置');
    signal.throwIfAborted();
    const target = await extensionChatRequest({ chat: options.chat, taskId: id, storageLocation });
    plan.chatRequestId = id; plan.chatBinding = target.binding;
    const controller = new AbortController(), abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const request = { requestId: id, binding: target.binding, automatic: false, controller, external: true };
    chatRequests.set(id, request);
    const valid = await validateChatRequest(request);
    signal.removeEventListener('abort', abort);
    if (signal.aborted || !valid) {
      chatPost('linghuashi:chat-task', { requestId: id, binding: target.binding, status: 'cancelled' });
      chatRequests.delete(id);
      throw apiError(signal.aborted ? 'CANCELLED' : 'CHAT_TARGET_INVALID', '原消息或回复分支已变化');
    }
  }
  return plan;
}

export function receiveExtensionCommand(data) {
  if (!isInstalled() || typeof data.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(data.requestId)) return;
  if (data.type === 'linghuashi:extension-abort') { externalTaskService.abort(data.requestId); return; }
  void externalTaskService.dispatch(data).then(
    (value) => chatPost('linghuashi:extension-response', { requestId: data.requestId, value }),
    (error) => chatPost('linghuashi:extension-response', { requestId: data.requestId,
      error: { code: error.code || (error.name === 'AbortError' ? 'CANCELLED' : 'REQUEST_FAILED'),
        message: String(error.message || '扩展调用失败').replace(/\b(?:pst-|sk-|STD-)[A-Za-z0-9_-]+/g, '[已隐藏]').slice(0, 500),
        ...(error.taskId ? { taskId: error.taskId } : {}) } }),
  );
}

async function enqueueGeneration(request, assistantResult, imageEdit) {
  if (backupPanel.ui.restoring) throw new GenerationError('配置正在恢复，请完成后再生图');
  const report = (status, error = '') => {
    if (request) chatPost('linghuashi:chat-task', { requestId: request.requestId, status, error,
      ...(request.quickImage ? { imageId: request.imageId, binding: request.binding } : {}) });
    else if (error && imageEdit) throw new Error(error);
    else if (error) toast(error);
  };
  if (workbenchPanel.ui.busy) { report('failed', '正在保存组合任务，请稍后提交'); return; }
  if (!state.enabled) { report('cancelled'); return; }
  if (drawingUI.loading || !drawingLibrary.db) { report('failed', '图片存储尚未准备好，请稍后重试'); return; }
  const storageLocation = imageEdit?.storageLocation || request?.storageLocation || state.cacheLocation;
  if (storageLocation === 'server') {
    try { await drawingLibrary.list('server'); }
    catch (error) { report('failed', error.message); return; }
  }
  let snapshot = imageEdit ? structuredClone(imageEdit.snapshot)
    : request?.assistantSnapshot ? structuredClone(request.assistantSnapshot) : captureSnapshot(state);
  delete snapshot.extensionRequest;
  const assistantPlan = request?.assistantPlan || assistantResult?.plan;
  if (assistantPlan) {
    try {
      snapshot = applyAssistantPlan(snapshot, assistantPlan, request?.assistantOptions || assistantResult?.options || state.assistant);
      snapshot.assistant = assistantPlan;
    } catch (error) { report('failed', error.message); return; }
  }
  const params = snapshot.params || snapshot.config.params;
  if (request) {
    if (!await validateChatRequest(request)) { report('cancelled'); return; }
  }
  if (request && !imageEdit) {
    if (snapshot.provider === 'comfyui' && !snapshot.config.mapping.positive) {
      report('failed', '请先为 ComfyUI 工作流映射正向提示词节点'); return;
    }
    if (!assistantPlan) {
      if (snapshot.characterScene?.applied) {
        params.positive = snapshot.characterScene.basePositive;
        params.negative = snapshot.characterScene.baseNegative;
        delete snapshot.characterScene.applied;
      }
      params.positive = [params.positive.trim(), request.prompt.trim()].filter(Boolean).join(', ');
    }
    if (params.positive.length > 32000) { report('failed', '合并后的提示词超过 32000 字符'); return; }
  }
  if (params.seed === -1) params.seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const credential = { ...credentials[snapshot.provider] };
  const connection = snapshot.provider === 'sdwebui' ? structuredClone(state.connections.sdwebui)
    : { endpoint: state.openaiEndpoint, path: state.openaiPath, timeout: state.openaiTimeout };
  try {
    await tasksReady;
    const scene = snapshot.characterScene;
    if (request && scene?.chatKey && scene.chatKey !== request.binding.chatKey) {
      throw new Error('角色档案快照属于另一聊天，请重新准备提示词');
    }
    if (!imageEdit) snapshot = applyCharacterScene(snapshot, scene, assistantPlan?.characters);
    if ((!imageEdit || request?.quickImage && !request.edits) && state.confirm) {
      const confirmation = request?.quickImage ? imageEditDraft(snapshot) : snapshot;
      if (!await confirmGeneration(confirmation, request)) { report('cancelled'); return; }
      if (request?.quickImage) snapshot = prepareImageEdit(confirmation);
    }
    await saveConnection(snapshot.provider);
    const plan = await prepareGenerationPlan(snapshot, credential, connection, imageEdit);
    plan.keyRef = plan.headers.Authorization ? await credentialRequest('write', snapshot.provider, {
      key: credential.key, ref: state.connections[snapshot.provider].keyRef,
    }) : '';
    plan.storageLocation = storageLocation;
    if (imageEdit) { plan.imageEdit = imageEdit.relation; plan.chatBinding = imageEdit.chatBinding || null; }
    if (!state.enabled || (request && !await validateChatRequest(request))) { report('cancelled'); return; }
    if (request) {
      plan.chatRequestId = request.requestId;
      plan.chatBinding = request.binding;
    }
    const record = await taskPersistence.create(plan);
    const job = taskQueue.add(plan, { id: record.id });
    if (request) request.jobId = job.id;
    activeJobId = job.id;
    runtimeState = job.status === 'running' ? 'generating' : 'queued';
    render();
    return job;
  } catch (error) {
    report(request?.controller.signal.aborted ? 'cancelled' : 'failed',
      error.name === 'TimeoutError' ? '服务识别超时，请重试' : error instanceof TypeError ? '连接失败，请检查服务地址和跨域设置' : error.message);
  }
}

async function enqueueBatch(preview) {
  const ids = [], plans = [];
  if (!state.enabled || backupPanel.ui.restoring) throw new Error('请先启用插件并完成配置恢复');
  if (!preview?.rows?.length || preview.rows.length > BATCH_LIMIT) throw new Error('请先预览组合');
  await libraryReady; await tasksReady;
  if (!drawingLibrary.db || drawingUI.loading) throw new Error('图片存储尚未准备好');
  if (taskQueue.jobs.filter((job) => ['queued', 'running'].includes(job.status)).length + preview.rows.length > BATCH_LIMIT) {
    throw new Error('加上现有等待和运行任务后超过 32 个，请先等待完成');
  }
  const provider = preview.rows[0].snapshot.provider, storageLocation = state.cacheLocation;
  if (provider !== state.provider) throw new Error('生图模式已变化，请重新预览');
  const credential = { ...credentials[provider] };
  const connection = provider === 'sdwebui' ? structuredClone(state.connections.sdwebui)
    : { endpoint: state.openaiEndpoint, path: state.openaiPath, timeout: state.openaiTimeout };
  const groupId = randomUUID(), createdAt = Date.now();
  if (advancedOf(preview.rows[0].snapshot).mode === 'inpaint' && advancedPanel.ui.dirty) throw new Error('蒙版有未保存修改，请回生图工坊保存后重新预览');
  await advancedPanel.beforeGenerate();
  if (storageLocation === 'server') await drawingLibrary.list('server');
  await saveConnection(provider);
  const keyRef = credential.key.trim() ? await credentialRequest('write', provider, { key: credential.key, ref: state.connections[provider].keyRef }) : '';
  if (provider === 'novelai' && resolveNovelAIService(credential.key, credential.endpoint).kind === 'identify') {
    const service = await identifySkService(credential.key, { signal: AbortSignal.timeout(12000) });
    credential.endpoint = service.endpoint;
  }
  for (const row of preview.rows) {
    let snapshot = structuredClone(row.snapshot);
    snapshot = applyCharacterScene(snapshot, snapshot.characterScene);
    snapshot.experiment = { id: groupId, mode: preview.mode, index: row.index, label: row.label, createdAt };
    const plan = await prepareGenerationPlan(snapshot, credential, connection);
    plan.keyRef = keyRef; plan.storageLocation = storageLocation; plans.push(plan);
  }
  const created = [];
  try {
    for (const plan of plans) {
      const record = await taskPersistence.create(plan);
      created.push({ plan, id: record.id }); ids.push(record.id);
    }
  } catch (error) {
    for (const row of created) { const job = taskQueue.add(row.plan, { id: row.id, defer: true }); job.status = 'paused'; }
    return { ids, error: `任务保存中断：${error.message}。已保存 ${ids.length} 个，暂未提交，可在任务记录中核对后继续。` };
  }
  if (!state.enabled || state.cacheLocation !== storageLocation) {
    for (const row of created) { const job = taskQueue.add(row.plan, { id: row.id, defer: true }); job.status = 'paused'; }
    return { ids, error: '配置发生变化，任务已保存为等待继续，请在任务记录中核对' };
  }
  for (const row of created) taskQueue.add(row.plan, { id: row.id, defer: true });
  activeJobId = ids[0]; taskQueue.pump(); render();
  return { ids };
}

async function refreshTasks() {
  if (taskRefreshing) return taskRefreshWork;
  if (workbenchPanel.ui.busy) return;
  taskRefreshing = true;
  taskRefreshWork = (async () => {
  try {
    const result = await taskPersistence.list();
    for (const row of result.rows) {
      if (row.plan.chatRequestId && !chatRequests.has(row.plan.chatRequestId)) {
        chatRequests.set(row.plan.chatRequestId, {
          requestId: row.plan.chatRequestId, binding: row.plan.chatBinding,
          jobId: row.id, automatic: false, restored: true, controller: new AbortController(),
          quickImage: Boolean(row.plan.imageEdit), imageId: row.plan.imageEdit?.parentId,
        });
      }
    }
    taskError = '';
    taskQueue.restore(result.rows);
  } catch (error) { taskError = `任务记录暂时无法读取：${error.message}`; }
  finally { taskRefreshing = false; if (host) render(); }
  })();
  return taskRefreshWork;
}

function generate() {
  if (document.getElementById('overlay-root').childElementCount) { toast('请先处理当前窗口'); return; }
  void advancedPanel.beforeGenerate().then(() => enqueueGeneration()).catch((error) => toast(error.message));
}

function openViewer(imageId) {
  const item = drawings.find((row) => row.id === (imageId || activeDrawingId)) || currentDrawing(drawings, imageId);
  if (!item) { toast('图片尚未存入绘图管理'); return; }
  const filtered = state.page === 'gallery' ? filterDrawings(drawings, drawingUI.filters) : drawingGroups(drawings);
  viewerUI.ids = filtered.map(versionGroupId);
  if (!viewerUI.ids.includes(versionGroupId(item))) viewerUI.ids.push(versionGroupId(item));
  viewerUI.index = viewerUI.ids.indexOf(versionGroupId(item));
  viewerUI.imageId = item.id; viewerUI.compare = false;
  viewerUI.review = false;
  viewerUI.details = window.innerWidth > 720;
  viewerUI.zoom = false;
  showDrawingViewer();
}

async function downloadImage(imageId) {
  const item = drawings.find((row) => row.id === (imageId || activeDrawingId));
  if (item) {
    await drawingOperation(async () => {
      const loaded = await drawingLibrary.materialize(item);
      saveBlob(loaded.blob, drawingFilename(loaded));
    });
    return;
  }
  const sample = samples.find((item) => item.id === imageId) || activeSample;
  const link = document.createElement('a');
  link.href = sample.src;
  link.download = `${config.name}-${sample.title}.jpg`;
  link.click();
}

export function mountPlugin(root, next) {
  host = root;
  config = next;
  runtimeState = next.state;
  persist();
  render();
  if (state.page === 'assistant' && state.assistant.source === 'tavern' && isInstalled()) void fetchAssistantModels(false);
  if (state.page === 'characters') void refreshProfileCards();
  libraryReady = initializeDrawings();
  tasksReady = refreshTasks();
  const taskSync = setInterval(() => { void refreshTasks(); }, 8000);
  window.addEventListener('pagehide', () => clearInterval(taskSync), { once: true });
  if (typeof BroadcastChannel !== 'undefined') {
    const imageSync = new BroadcastChannel(`linghuashi-chat:${currentAccount()}`);
    imageSync.onmessage = (event) => {
      if (event.data?.type === 'images-changed') void libraryReady.then(reloadDrawings).catch((error) => toast(error.message));
    };
    window.addEventListener('pagehide', () => imageSync.close(), { once: true });
  }
  host.addEventListener('click', async (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.page) {
      if (state.page === 'styles' && artistUI.dirty && target.dataset.page !== 'styles' && !discardArtistChanges()) return;
      if (state.page === 'styles' && target.dataset.page !== 'styles' && artistUI.dirty) {
        artistDraft(state.artistLibrary.find((entry) => entry.id === artistUI.draft?.id) || state.artistLibrary[0] || null);
        artistUI.dirty = false;
      }
      showPage(target.dataset.page);
      return;
    }
    if (target.dataset.artistSelect) {
      if (discardArtistChanges()) { artistDraft(state.artistLibrary.find((entry) => entry.id === target.dataset.artistSelect)); render(); }
      return;
    }
    if (target.dataset.profileSelect || target.dataset.profileScope) {
      if (!discardProfileChanges()) return;
      if (target.dataset.profileScope) profileUI.scope = target.dataset.profileScope;
      loadProfileDraft(target.dataset.profileSelect); render(); return;
    }
    if (target.dataset.choice && ['generationMode', 'cacheLocation'].includes(target.dataset.choice)) {
      if (target.dataset.choice === 'cacheLocation') { await switchImageStorage(target.dataset.value); return; }
      state[target.dataset.choice] = target.dataset.value;
      Object.assign(state, normalizeSettings(state));
      try { await taskPersistence.configure(); }
      catch (error) { toast(`调度设置未能同步：${error.message}`); }
      persist(); render(); taskQueue.pump(); return;
    }
    if (target.dataset.shape) { state.shape = target.dataset.shape; persist(); render(); return; }
    if (target.dataset.provider) { keyVisible = false; state.provider = target.dataset.provider; Object.assign(state, normalizeSettings(state)); resetConnection(); persist(); render(); checkConnection(); return; }
    if (target.dataset.style) { state.style = target.dataset.style; persist(); render(); return; }
    if (target.dataset.drawing) { activeDrawingId = target.dataset.drawing; activeJobId = null; runtimeState = 'success'; render(); return; }
    if (target.dataset.sample) { activeSample = samples.find((item) => item.id === target.dataset.sample); runtimeState = 'success'; render(); return; }
    switch (target.dataset.action) {
      case 'connection-new': case 'connection-copy': case 'connection-rename': case 'connection-delete':
        connectionDialog(target.dataset.action.replace('connection-', '')); break;
      case 'connection-save':
        try {
          await presetOperation(async () => {
            const provider = state.provider; await saveConnection(provider);
            const selected = state.connectionProfiles[provider].find((entry) => entry.id === state.connectionProfileIds[provider]);
            if (!selected) throw new Error('请先新增接口');
            saveConnectionProfile(state, provider, selected.name, selected.id); persist();
          });
          render(); toast('接口配置已更新');
        } catch (error) { toast(error.message); }
        break;
      case 'artist-new': case 'artist-capture': case 'artist-copy':
        if (!discardArtistChanges()) break;
        if (target.dataset.action === 'artist-copy') artistDraft({ ...artistUI.draft, id: randomUUID(), name: `${artistUI.draft?.name || '画风'} 副本`.slice(0, 40) });
        else if (target.dataset.action === 'artist-capture') {
          const params = state.provider === 'comfyui' ? state.comfyui.params : state[state.provider];
          artistDraft({ ...emptyArtist(), target: state.provider, artist: state.provider === 'comfyui' ? params.positive : params.artist, negative: params.negative });
        } else artistDraft(emptyArtist());
        render(); break;
      case 'artist-save':
        try { saveArtistDraft(); } catch (error) { toast(error.message); } break;
      case 'artist-delete':
        if (window.confirm(`删除“${artistUI.draft.name}”？`)) {
          const previous = state.artistLibrary;
          state.artistLibrary = previous.filter((entry) => entry.id !== artistUI.draft.id);
          try { persist(); artistDraft(state.artistLibrary[0] || null); artistUI.dirty = false; render(); }
          catch (error) { state.artistLibrary = previous; toast(error.message); }
        } break;
      case 'artist-import': artistFileInput('import'); break;
      case 'artist-export': downloadJson('linghuashi-artists.json', { format: 'linghuashi-artists', version: 1, entries: state.artistLibrary }); break;
      case 'artist-preview': artistFileInput('preview'); break;
      case 'artist-preview-clear': artistUI.draft.preview = ''; artistUI.dirty = true; render(); break;
      case 'artist-apply':
        try { applyArtistEntry(artistUI.draft); } catch (error) { toast(error.message); } break;
      case 'artist-quick-apply':
        try { applyArtistEntry(state.artistLibrary.find((entry) => entry.id === host.querySelector('[data-artist-quick]').value),
          { mode: 'replace', quality: false, negative: false }); } catch (error) { toast(error.message); } break;
      case 'assistant-generate': case 'assistant-translate': case 'assistant-polish':
        assistantUI.binding = null; assistantUI.requestId = null;
        delete state.assistantBinding; delete state.assistantRequestId;
        try { await runPromptAssistant(target.dataset.action.replace('assistant-', '')); }
        catch (error) { toast(error.message); } break;
      case 'assistant-illustrate':
        if (!isInstalled()) { toast('当前消息配图需要在酒馆内使用'); break; }
        chatPost('linghuashi:chat-current-assist', {}); break;
      case 'assistant-use-current': {
        const snapshot = captureSnapshot(state);
        state.assistantInput = (snapshot.params || snapshot.config.params).positive;
        persist(); render(true); break;
      }
      case 'assistant-cancel': assistantUI.controller?.abort(); break;
      case 'assistant-toggle-key':
        assistantUI.keyVisible = !assistantUI.keyVisible; refreshAssistantStatus(); break;
      case 'assistant-toggle-models':
        assistantUI.modelsOpen = !assistantUI.modelsOpen; refreshAssistantModels(); break;
      case 'assistant-pick-model': {
        const model = assistantUI.models[Number(target.dataset.assistantModelIndex)];
        if (!model) break;
        const key = state.assistant.source === 'api' ? 'model' : 'tavernModel';
        state.assistant[key] = model; persist();
        host.querySelector('#assistant-model-input').value = model;
        assistantUI.modelsOpen = false; refreshAssistantModels(); break;
      }
      case 'assistant-models': await fetchAssistantModels(); break;
      case 'assistant-network': networkDiagnosticPanel.open(networkContext('assistant')); break;
      case 'assistant-apply':
        try { applyAssistantToParameters(); render(); } catch (error) { toast(error.message); } break;
      case 'assistant-copy':
        try { await navigator.clipboard.writeText(state.assistantDraft?.positive || ''); toast('提示词已复制'); }
        catch { toast('复制失败，请选择提示词后复制'); } break;
      case 'assistant-save-draft':
        if (assistantUI.binding) chatPost('linghuashi:chat-draft', {
          requestId: assistantUI.requestId, binding: assistantUI.binding,
          plan: { ...state.assistantDraft, shouldDraw: Boolean(state.assistantDraft?.positive?.trim()) },
        }); break;
      case 'assistant-draw': {
        const plan = state.assistantDraft;
        if (!plan?.positive.trim()) { toast('请先准备提示词'); break; }
        if (assistantUI.binding) {
          chatPost('linghuashi:chat-draft-submit', { requestId: assistantUI.requestId, binding: assistantUI.binding, plan: { ...plan, shouldDraw: true } });
        } else await enqueueGeneration(undefined, { plan, options: normalizeAssistant(state.assistant) });
        break;
      }
      case 'sdwebui-fetch-models': void checkConnection(true); break;
      case 'sdwebui-load-preset':
        try { await loadCurrentPreset('sdwebui', state.sdwebuiPresetId); } catch (error) { toast(error.message); render(); } break;
      case 'sdwebui-save-as': openSDWebUIPresetDialog(); break;
      case 'sdwebui-save-preset':
        commitSDWebUIFields();
        if (state.sdwebuiPresetId === 'default') openSDWebUIPresetDialog();
        else try { await saveCurrentPreset('sdwebui'); toast('预设已更新'); } catch (error) { toast(error.message); }
        break;
      case 'sdwebui-delete-preset': openSDWebUIPresetDialog(true); break;
      case 'sdwebui-swap-size':
        [state.sdwebui.width, state.sdwebui.height] = [state.sdwebui.height, state.sdwebui.width]; commitSDWebUIFields(); break;
      case 'sdwebui-insert-lora':
        try {
          const token = loraPrompt(host.querySelector('[data-sdwebui-lora]').value, Number(host.querySelector('[data-sdwebui-lora-weight]').value));
          if (state.sdwebui.positive.length + token.length + 2 > 12000) throw new Error('正向提示词超过 12000 字符');
          state.sdwebui.positive = [state.sdwebui.positive.trim(), token].filter(Boolean).join(', '); commitSDWebUIFields();
        } catch (error) { toast(error.message); }
        break;
      case 'openai-fetch-models': checkConnection(true); break;
      case 'openai-toggle-models':
        openaiModelUI.open = !openaiModelUI.open; updateOpenAIModelList(); break;
      case 'openai-select-model': {
        const model = target.dataset.openaiModelId;
        state.openai.model = model;
        commitOpenAIFields();
        render();
        copyOpenAIModel(model, true);
        break;
      }
      case 'openai-copy-model': copyOpenAIModel(target.dataset.openaiModelId); break;
      case 'openai-request-preview': showOpenAIRequest(); break;
      case 'toggle-key': {
        keyVisible = !keyVisible;
        const input = host.querySelector('[data-transient="key"]');
        input.type = keyVisible ? 'text' : 'password';
        target.title = target.ariaLabel = keyVisible ? '隐藏秘钥' : '显示秘钥';
        target.setAttribute('aria-pressed', String(keyVisible));
        target.innerHTML = icon(keyVisible ? 'eye-off' : 'eye'); paintIcons(); break;
      }
      case 'openai-load-preset':
        try { await loadCurrentPreset('openai', state.openaiPresetId); } catch (error) { toast(error.message); render(); } break;
      case 'openai-save-as': openOpenAIPresetDialog(); break;
      case 'openai-save-preset':
        commitOpenAIFields();
        if (state.openaiPresetId === 'default') openOpenAIPresetDialog();
        else {
          try { await saveCurrentPreset('openai'); toast('预设已更新'); }
          catch (error) { toast(error.message); }
        }
        break;
      case 'openai-delete-preset': openOpenAIPresetDialog(true); break;
      case 'openai-swap-size':
        [state.openai.width, state.openai.height] = [state.openai.height, state.openai.width]; commitOpenAIFields(); break;
      case 'drawing-import': importDrawingFiles(); break;
      case 'storage-migrate': void migrateBrowserImages(); break;
      case 'storage-audit':
        void drawingOperation(async () => {
          const result = await storageRequest('audit');
          state.storageStatus = result.missing.length || result.orphans || result.pendingFiles
            ? `缺失文件 ${result.missing.length} 张 · 无对应记录文件 ${result.orphans} 个 · 待删除 ${result.pendingFiles} 张`
            : '检查完成 · 图片记录与磁盘文件一致';
          await reloadDrawings();
          state.storageStatus = result.missing.length || result.orphans || result.pendingFiles
            ? `缺失文件 ${result.missing.length} 张 · 无对应记录文件 ${result.orphans} 个 · 待删除 ${result.pendingFiles} 张`
            : '检查完成 · 图片记录与磁盘文件一致';
          toast(state.storageStatus);
        }); break;
      case 'drawing-refresh': drawingOperation(async () => { await reloadDrawings(); toast('图片列表已刷新'); }); break;
      case 'drawing-reset-filters':
        drawingUI.filters = { source: 'all', start: '', end: '', search: '', favoriteOnly: false };
        drawingUI.page = 1; drawingUI.error = ''; drawingUI.selection.clear(); render(); break;
      case 'drawing-multiselect':
        drawingUI.multiselect = !drawingUI.multiselect;
        if (!drawingUI.multiselect) drawingUI.selection.clear();
        render(); break;
      case 'drawing-review': {
        const groups = new Set(drawingTargets().map(versionGroupId));
        viewerUI.ids = drawingGroups(drawings).filter((row) => groups.has(versionGroupId(row))).map(versionGroupId);
        viewerUI.index = 0; viewerUI.imageId = '';
        viewerUI.review = true; viewerUI.details = false; viewerUI.zoom = false;
        if (viewerUI.ids.length) showDrawingViewer();
        break;
      }
      case 'drawing-clear-selection': drawingUI.selection.clear(); render(); break;
      case 'drawing-export': case 'drawing-download-all': {
        const items = drawingTargets();
        const withParameters = target.dataset.action === 'drawing-export';
        drawingOperation(async () => {
          const loaded = [];
          if (items.reduce((sum, row) => sum + row.blob.size, 0) > 200 * 1024 * 1024) throw new Error('导出包超过 200 MB，请分批导出');
          for (const item of items) loaded.push({ ...await drawingLibrary.materialize(item), rating: item.rating });
          saveBlob(await exportDrawings(loaded, withParameters, drawingUI.exportOptions), withParameters ? 'linghuashi-drawings.zip' : 'linghuashi-images.zip');
          toast(withParameters ? `已导出 ${items.length} 张原图及参数` : `已打包 ${items.length} 张原图`);
        }); break;
      }
      case 'drawing-delete': {
        const filtered = filterDrawings(drawings, drawingUI.filters);
        const selected = drawingUI.selection.size ? drawings.filter((row) => drawingUI.selection.has(row.id)) : drawingPage(filtered, drawingUI.page, drawingUI.pageSize).items;
        const groups = new Set(selected.map(versionGroupId));
        const ids = drawings.filter((row) => groups.has(versionGroupId(row))).map((row) => row.id);
        deleteDrawingsDialog(ids, drawingUI.selection.size ? '删除所选图组' : '删除本页图组'); break;
      }
      case 'drawing-prev-page': drawingUI.page--; render(); break;
      case 'drawing-next-page': drawingUI.page++; render(); break;
      case 'workflow-import': importComfyWorkflow(); break;
      case 'workflow-export': exportComfyWorkflow(); break;
      case 'comfy-save-as': openComfyPresetDialog(); break;
      case 'comfy-save-preset':
        commitComfyFields();
        if (state.comfyPresetId === 'default') openComfyPresetDialog();
        else {
          try { await saveCurrentPreset('comfyui'); toast('工作流预设已更新'); }
          catch (error) { toast(error.message); }
        }
        break;
      case 'comfy-load-preset':
        try { await loadCurrentPreset('comfyui', state.comfyPresetId); } catch (error) { toast(error.message); render(); } break;
      case 'comfy-delete-preset': openComfyPresetDialog(true); break;
      case 'comfy-auto-map':
        changeComfy(() => { state.comfyui.mapping = autoMapWorkflow(state.comfyui.graph); }, '已重新识别节点映射，当前参数已保留');
        break;
      case 'comfy-random-seed':
        state.comfyui.params.seed = crypto.getRandomValues(new Uint32Array(1))[0]; commitComfyFields(); break;
      case 'comfy-locate-node': {
        const mapping = state.comfyui.mapping[target.dataset.mappingKey];
        if (!mapping) { toast('此参数尚未映射'); break; }
        const details = host.querySelector('.advanced-node-list');
        if (details) details.open = true;
        host.querySelectorAll('[data-node-row]').forEach((row) => {
          row.classList.toggle('is-located', row.dataset.nodeRow === mapping.node);
          if (row.dataset.nodeRow === mapping.node) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
        break;
      }
      case 'nai-load-preset':
        try { await loadCurrentPreset('novelai', state.novelaiPresetId); } catch (error) { toast(error.message); render(); } break;
      case 'nai-save-as': commitNovelAIFields(); openNovelAIPresetDialog(); break;
      case 'nai-save-preset':
        commitNovelAIFields();
        if (state.novelaiPresetId === 'default') openNovelAIPresetDialog();
        else {
          try { await saveCurrentPreset('novelai'); toast('预设已更新'); }
          catch (error) { toast(error.message); }
        }
        break;
      case 'nai-delete-preset': openNovelAIPresetDialog('delete'); break;
      case 'nai-swap-size':
        [state.novelai.width, state.novelai.height] = [state.novelai.height, state.novelai.width]; commitNovelAIFields(); break;
      case 'nai-random-seed':
        state.novelai.seed = crypto.getRandomValues(new Uint32Array(1))[0]; commitNovelAIFields(); break;
      case 'generate': generate(); break;
      case 'clear-cache':
        deleteDrawingsDialog(drawings.map((item) => item.id), state.cacheLocation === 'server' ? '清空服务器图片' : '清空浏览器图片'); break;
      case 'cancel': taskQueue.cancel(activeJobId); toast('已停止等待或取图；服务已开始的生成可能继续运行'); break;
      case 'task-cancel': taskQueue.cancel(target.dataset.task); break;
      case 'task-retry':
        await libraryReady;
        activeJobId = target.dataset.task; taskQueue.retry(activeJobId); break;
      case 'task-refresh': await refreshTasks(); break;
      case 'task-clear':
        try { const result = await taskPersistence.clear(); await refreshTasks(); toast(`已清理 ${result.cleared} 条任务记录`); }
        catch (error) { toast(error.message); }
        break;
      case 'task-parameters': {
        const job = taskQueue.jobs.find((item) => item.id === target.dataset.task);
        if (job) { restoreSnapshot(state, job.plan.snapshot); state.page = 'connection'; persist(); render(); }
        break;
      }
      case 'task-export':
        saveBlob(new Blob([JSON.stringify(taskQueue.records(), null, 2)], { type: 'application/json' }), 'linghuashi-requests.json'); break;
      case 'viewer':
        if (drawingUI.multiselect && state.page === 'gallery' && target.dataset.image) {
          const id = target.dataset.image;
          if (drawingUI.selection.has(id)) drawingUI.selection.delete(id); else drawingUI.selection.add(id);
          render();
        } else openViewer(target.dataset.image);
        break;
      case 'download': downloadImage(target.dataset.image); break;
      case 'favorite': toggleDrawingFavorite(target.dataset.image); break;
      case 'random-seed': state.seed = Math.floor(Math.random() * 1000000000); persist(); render(); break;
      case 'organize': state.prompt = [...new Set(state.prompt.split(',').map((tag) => tag.trim()).filter(Boolean))].join(', '); persist(); render(); toast('提示词已整理'); break;
      case 'test-connection': checkConnection(true); break;
      case 'network-diagnostics': debugToolsPanel.selectProvider(state.provider); showPage('debug'); break;
      case 'debug-tools': showPage('debug'); break;
      case 'save-character':
        try {
          if (!profileUI.draft?.name.trim()) throw new Error('请填写档案名称');
          if (profileUI.scope === 'chat' && profileUI.chatKey !== currentChat().key) throw new Error('聊天已切换，请重新选择档案后保存');
          state.characterProfiles = saveProfile(state.characterProfiles, profileUI.draft, profileUI.scope === 'chat' ? currentChat().key : '');
          useLiveCharacterScene(); loadProfileDraft(); persist(); render(); toast('角色档案已保存');
        } catch (error) { profileUI.error = error.message; render(); } break;
      case 'profile-ai-open':
        if (!discardProfileChanges()) break;
        loadProfileDraft(); await profileAI.open(); break;
      case 'save-preset': persist(); toast('已保存'); break;
      case 'edit-prompt': editPrompt = !editPrompt; render(); break;
      case 'floating-menu': floatingMenu?.toggle(); break;
      case 'settings': showSettings(); break;
      case 'console':
        config = { ...config, surface: 'console' };
        state.page = 'generate'; persist(); render();
        if (window.parent !== window) postWindowMessage(window.parent, { type: 'draw-lab:surface', surface: 'console' });
        break;
      case 'new-character':
        if (!discardProfileChanges()) break;
        profileUI.scope = 'global';
        profileUI.draft = normalizeProfile({ id: randomUUID(), name: '新角色' });
        profileUI.dirty = true; profileUI.error = ''; render(); host.querySelector('[data-profile-field="name"]')?.focus(); break;
      case 'profiles-open': showPage('characters'); break;
      case 'profile-reference-upload': host.querySelector('[data-profile-reference-file]')?.click(); break;
      case 'profile-reference-remove':
        if (profileUI.draft) { profileUI.draft.reference = null; profileUI.dirty = true; render(); }
        break;
      case 'profile-reference-use':
        if (profileUI.draft?.reference) {
          state.provider = 'novelai';
          state.novelai.advanced = { ...state.novelai.advanced, mode: 'reference', referenceKind: 'character', character: profileUI.draft.reference };
          persist(); showPage('generate');
        }
        break;
      case 'profile-refresh-cards': await refreshProfileCards(); break;
      case 'profile-live-scene': useLiveCharacterScene(); persist(); render(); break;
      case 'profile-discard': loadProfileDraft(); render(); break;
      case 'profile-new-outfit': {
        const draft = profileUI.draft;
        if (!draft || draft.outfits.length >= 20) break;
        const outfit = { id: randomUUID(), name: '新服装', prompt: '' };
        draft.outfits.push(outfit); if (!draft.defaultOutfitId) draft.defaultOutfitId = outfit.id;
        profileUI.dirty = true; render(); break;
      }
      case 'profile-delete-outfit':
        if (profileUI.draft) {
          profileUI.draft.outfits = profileUI.draft.outfits.filter((item) => item.id !== target.dataset.outfitId);
          if (profileUI.draft.defaultOutfitId === target.dataset.outfitId) profileUI.draft.defaultOutfitId = '';
          profileUI.dirty = true; render();
        } break;
      case 'profile-clear-override': {
        if (!discardProfileChanges()) break;
        const key = currentChat().key, chat = state.characterProfiles.chats.find((item) => item.chatKey === key);
        state.characterProfiles = updateProfileChat(state.characterProfiles, key, {
          overrides: chat.overrides.filter((item) => item.id !== profileUI.draft.id),
        });
        useLiveCharacterScene(); loadProfileDraft(); persist(); render(); break;
      }
      case 'profile-delete':
        if (window.confirm(`删除“${profileUI.draft.name}”及其聊天覆盖？已保存图片的角色快照会保留。`)) {
          state.characterProfiles = deleteProfile(state.characterProfiles, profileUI.draft.id);
          useLiveCharacterScene(); loadProfileDraft(); persist(); render(); toast('档案已删除');
        } break;
      case 'profile-export':
        downloadJson('灵画师-角色档案.json', { version: 1, profiles: profileUI.scope === 'chat'
          ? effectiveProfiles(state.characterProfiles, currentChat().key) : state.characterProfiles.profiles }); break;
      case 'profile-import': host.querySelector('[data-profile-import]')?.click(); break;
      case 'new-style': toast('预设编辑区已打开'); host.querySelector('[data-transient="style-tags"]')?.focus(); break;
      case 'more': toast('当前为界面预览'); break;
      case 'copy-message':
        navigator.clipboard?.writeText('薄雾在湖面缓缓散开，远山映在水里。').then(() => toast('消息已复制')).catch(() => toast('复制失败'));
        break;
    }
  });
  host.addEventListener('keydown', (event) => {
    if (event.target.matches('[data-openai="model"]') && event.key === 'ArrowDown') {
      event.preventDefault();
      openaiModelUI.open = true;
      updateOpenAIModelList();
      host.querySelector('[data-openai-model-search]')?.focus({ preventScroll: true });
    } else if (event.key === 'Escape' && event.target.closest('.openai-model-panel')) {
      event.preventDefault();
      openaiModelUI.open = false;
      updateOpenAIModelList();
      host.querySelector('[data-action="openai-toggle-models"]')?.focus({ preventScroll: true });
    }
  });
  host.addEventListener('input', (event) => {
    if (event.target.dataset.artistField && artistUI.draft) {
      artistUI.draft[event.target.dataset.artistField] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
      artistUI.dirty = true; return;
    }
    if (event.target.matches('[data-artist-search]')) {
      artistUI.search = event.target.value;
      const position = event.target.selectionStart;
      render(true);
      const input = host.querySelector('[data-artist-search]');
      input.focus(); if (input.type !== 'search') input.setSelectionRange(position, position);
      return;
    }
    if (event.target.dataset.profileField && profileUI.draft) {
      if (event.target.type === 'checkbox' || event.target.tagName === 'SELECT') return;
      profileUI.draft[event.target.dataset.profileField] = event.target.value;
      profileUI.dirty = true; return;
    }
    if (event.target.dataset.profileOutfit && profileUI.draft) {
      const outfit = profileUI.draft.outfits.find((item) => item.id === event.target.dataset.profileOutfit);
      if (outfit) { outfit[event.target.dataset.outfitField] = event.target.value; profileUI.dirty = true; }
      return;
    }
    if (event.target.dataset.participantField && event.target.tagName !== 'SELECT') {
      const chat = currentChat(), scene = resolveCharacterScene(state.characterProfiles, chat.key, chat.avatars);
      const selection = scene.entries.map(({ profile, ...entry }) => entry);
      const entry = selection.find((item) => item.profileId === event.target.dataset.profileId);
      if (entry) { entry[event.target.dataset.participantField] = event.target.value; saveProfileParticipants(selection); }
      return;
    }
    if (event.target.dataset.assistantCharacter && state.assistantDraft) {
      const entry = state.assistantDraft.characters?.find((item) => item.profileId === event.target.dataset.assistantCharacter);
      if (entry) {
        const key = event.target.dataset.characterResult;
        entry[key] = event.target.value;
        const sceneEntry = state.assistantDraft.characterScene?.entries.find((item) => item.profileId === entry.profileId);
        if (sceneEntry && ['action', 'expression'].includes(key)) sceneEntry[key] = event.target.value;
        persist();
      }
      return;
    }
    if (event.target.matches('[data-assistant-model-search]')) {
      assistantUI.modelsQuery = event.target.value;
      refreshAssistantModels(); return;
    }
    if (event.target.matches('[data-assistant-key]')) {
      apiEditRevision++;
      resetAssistantModels();
      assistantUI.key = event.target.value; assistantUI.keyDirty = true; assistantUI.keyRevision++;
      assistantUI.keyStatus = '秘钥待保存'; clearTimeout(assistantUI.keyTimer);
      assistantUI.keyTimer = setTimeout(() => { void saveAssistantKey().catch(() => {
        assistantUI.keyStatus = '助手秘钥保存失败，请重试'; render();
      }); }, 400);
      return;
    }
    if (event.target.matches('[data-assistant-input]')) {
      state.assistantInput = event.target.value; persist(); return;
    }
    if (event.target.dataset.assistantResult && state.assistantDraft) {
      state.assistantDraft[event.target.dataset.assistantResult] = event.target.value; persist();
      for (const action of ['assistant-draw', 'assistant-apply', 'assistant-copy']) {
        const command = host.querySelector(`[data-action="${action}"]`);
        if (command) command.disabled = !state.assistantDraft.positive.trim() || assistantUI.busy || action === 'assistant-draw' && !state.enabled;
      }
      return;
    }
    if (event.target.dataset.assistant) {
      const key = event.target.dataset.assistant;
      if (key === 'endpoint') { apiEditRevision++; resetAssistantModels(); }
      if (key === 'source') resetAssistantModels();
      state.assistant[key] = event.target.type === 'checkbox' ? event.target.checked
        : event.target.type === 'number' ? Number(event.target.value) : event.target.value;
      state.assistant = normalizeAssistant(state.assistant); persist(); return;
    }
    if (event.target.matches('[data-openai-model-search]')) {
      openaiModelUI.query = event.target.value;
      updateOpenAIModelList(); return;
    }
    const sdKey = event.target.dataset.sdwebui;
    if (sdKey && Object.hasOwn(SDWEBUI_DEFAULTS, sdKey) && !event.target.disabled) {
      state.sdwebui[sdKey] = event.target.type === 'checkbox' ? event.target.checked
        : typeof SDWEBUI_DEFAULTS[sdKey] === 'number' ? Number(event.target.value) : event.target.value;
      persist(); updateSDWebUIDirty(); return;
    }
    const sdConnectionKey = event.target.dataset.sdwebuiConnection;
    if (['auth', 'username', 'timeout'].includes(sdConnectionKey)) {
      state.connections.sdwebui[sdConnectionKey] = event.target.value;
      if (sdConnectionKey === 'auth') credentials.sdwebui.auth = event.target.value;
      if (sdConnectionKey !== 'timeout') Object.assign(state.connections.sdwebui, { textTaskId: false, imageTaskId: false, progressMode: 'none' });
      persist(); resetConnection(); updateConnectionStatus(); return;
    }
    const openaiKey = event.target.dataset.openai;
    if (openaiKey && Object.hasOwn(OPENAI_DEFAULTS, openaiKey) && !event.target.disabled) {
      state.openai[openaiKey] = event.target.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value;
      persist(); updateOpenAIDirty(); updateConnectionStatus(); return;
    }
    const connectionKey = event.target.dataset.openaiConnection;
    if (['endpoint', 'path', 'timeout'].includes(connectionKey)) {
      if (connectionKey === 'endpoint') {
        apiEditRevision++;
        if (state.assistant.source === 'api') resetAssistantModels();
      }
      state[{ endpoint: 'openaiEndpoint', path: 'openaiPath', timeout: 'openaiTimeout' }[connectionKey]] = event.target.value;
      persist(); checkConnection(false, connectionKey !== 'endpoint'); return;
    }
    const comfyKey = event.target.dataset.comfy;
    if (comfyKey && Object.hasOwn(COMFY_FIELDS, comfyKey) && !event.target.disabled) {
      state.comfyui.params[comfyKey] = event.target.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value;
      persist(); updateComfyDirty();
      return;
    }
    const naiKey = event.target.dataset.nai;
    if (naiKey && Object.hasOwn(NOVELAI_DEFAULTS, naiKey)) {
      state.novelai[naiKey] = event.target.type === 'checkbox' ? event.target.checked
        : event.target.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value;
      if (event.target.type === 'checkbox') commitNovelAIFields();
      else { persist(); updateNovelAIDirty(); }
      return;
    }
    const transient = event.target.dataset.transient;
    if (['key', 'endpoint'].includes(transient)) {
      credentials[state.provider][transient] = event.target.value;
      if (state.provider === 'sdwebui') Object.assign(state.connections.sdwebui, { textTaskId: false, imageTaskId: false, progressMode: 'none' });
      if (transient === 'key') {
        if (state.provider === 'openai') {
          apiEditRevision++;
          if (state.assistant.source === 'api') resetAssistantModels();
        }
        const current = credentialState[state.provider];
        current.dirty = true; current.revision++; current.error = false;
        current.message = '秘钥待保存';
        scheduleConnectionSave(state.provider);
        updateCredentialStatus();
      } else { persist(); updateCredentialStatus(); }
      resetConnection();
      const route = state.provider === 'novelai'
        ? resolveNovelAIService(credentials.novelai.key, credentials.novelai.endpoint)
        : null;
      if (route?.kind === 'identify') {
        connectionStatus = { message: '等待自动识别蛋糕 / 砂糖秘钥…', tone: 'neutral' };
        connectionTimer = setTimeout(() => checkConnection(), 800);
        updateConnectionStatus();
      } else {
        checkConnection();
      }
      return;
    }
    const key = event.target.dataset.setting;
    if (!key || !Object.hasOwn(state, key)) return;
    state[key] = event.target.type === 'checkbox' ? event.target.checked : event.target.type === 'number' ? Number(event.target.value) : event.target.value;
    if (Object.hasOwn(SETTINGS_DEFAULTS, key) && !['triggerPrefix', 'triggerSuffix'].includes(key)) Object.assign(state, normalizeSettings(state));
    if (key === 'provider') { keyVisible = false; resetConnection(); checkConnection(); }
    persist();
    if (['triggerPrefix', 'triggerSuffix'].includes(key)) updateTriggerFormat();
    if (key === 'enabled' || key === 'floatingBall') {
      if (!state.enabled) {
        for (const request of chatRequests.values()) {
          if (!request.jobId) receiveChatCommand({ type: 'linghuashi:chat-cancel', requestId: request.requestId });
        }
        taskQueue.cancelAll();
        runtimeState = 'ready';
        document.getElementById('overlay-root').replaceChildren();
      }
      if (state.enabled) taskQueue.pump();
      if (key === 'enabled') void syncStoragePolicy().catch((error) => toast(error.message));
      render();
      return;
    }
    if (key === 'prompt') host.querySelectorAll('[data-prompt-count]').forEach((node) => { node.textContent = `${state.prompt.length} 字符`; });
    if (key === 'search') {
      const focus = event.target;
      const position = focus.selectionStart;
      render();
      const input = host.querySelector('[data-setting="search"]');
      input.focus(); input.setSelectionRange(position, position);
    }
  });
  host.addEventListener('toggle', (event) => {
    if (event.target.matches('.sdwebui-advanced') && host.contains(event.target)) sdwebuiAdvancedOpen = event.target.open;
    if (event.target.matches('.openai-advanced') && host.contains(event.target)) openaiAdvancedOpen = event.target.open;
    if (event.target.matches('.openai-transport') && host.contains(event.target)) openaiTransportOpen = event.target.open;
    if (event.target.matches('.endpoint-options') && host.contains(event.target)) addressExpanded = event.target.open;
    if (event.target.matches('.nai-advanced') && host.contains(event.target)) novelaiAdvancedOpen = event.target.open;
    for (const key of ['advanced', 'mapping', 'auth']) {
      if (event.target.matches(`.comfy-${key}`) && host.contains(event.target)) comfyExpanded[key] = event.target.open;
    }
  }, true);
  host.addEventListener('change', async (event) => {
    if (event.target.dataset.drawingExport) {
      drawingUI.exportOptions[event.target.dataset.drawingExport] = event.target.value;
      return;
    }
    if (event.target.matches('[data-profile-reference-file]')) {
      const draft = profileUI.draft;
      if (!draft) return;
      try {
        const normalized = await normalizeReferenceImage(event.target.files[0]);
        const asset = await referenceAssets.put(normalized.blob, normalized);
        if (profileUI.draft === draft) { draft.reference = asset; profileUI.dirty = true; render(true); }
      } catch (error) { toast(error.message); }
      return;
    }
    if (event.target.dataset.artistField && artistUI.draft) {
      artistUI.draft[event.target.dataset.artistField] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
      artistUI.dirty = true; return;
    }
    if (event.target.matches('[data-connection-profile]')) {
      try { await switchConnectionProfile(event.target.value); } catch (error) { toast(error.message); render(); }
      return;
    }
    if (event.target.matches('[data-preset-binding]')) {
      state.presetBindings[state.provider] = event.target.value; persist(); updateCredentialStatus(); return;
    }
    if (event.target.matches('[data-artist-category], [data-artist-favorites]')) {
      if (event.target.hasAttribute('data-artist-category')) artistUI.category = event.target.value;
      else artistUI.favoriteOnly = event.target.checked;
      render(); return;
    }
    if (event.target.matches('[data-artist-mode], [data-artist-quality], [data-artist-negative]')) {
      if (event.target.hasAttribute('data-artist-mode')) artistUI.mode = event.target.value;
      else artistUI[event.target.hasAttribute('data-artist-quality') ? 'quality' : 'negative'] = event.target.checked;
      return;
    }
    if (event.target.matches('[data-profile-import]')) { await importProfiles(event.target.files[0]); return; }
    if (event.target.dataset.profileField && profileUI.draft) {
      const key = event.target.dataset.profileField;
      if (event.target.type === 'checkbox' || event.target.tagName === 'SELECT') {
        profileUI.draft[key] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
        profileUI.dirty = true;
      }
      return;
    }
    if (event.target.hasAttribute('data-profile-participant') || event.target.hasAttribute('data-profile-auto')
      || event.target.dataset.participantField) {
      // Text edits already save on input; replacing the DOM on blur would swallow a navigation click.
      if (event.target.dataset.participantField && event.target.tagName !== 'SELECT') return;
      try {
        if (event.target.hasAttribute('data-profile-auto')) {
          const chat = currentChat();
          saveProfileParticipants(event.target.checked ? null : resolveCharacterScene(state.characterProfiles, chat.key, chat.avatars).entries.map(({ profile, ...entry }) => entry));
        } else if (event.target.hasAttribute('data-profile-participant')) {
          setProfileParticipant(event.target.dataset.profileParticipant, event.target.checked);
        } else if (event.target.tagName === 'SELECT') {
          const chat = currentChat(), selection = resolveCharacterScene(state.characterProfiles, chat.key, chat.avatars).entries.map(({ profile, ...entry }) => entry);
          const entry = selection.find((item) => item.profileId === event.target.dataset.profileId);
          if (entry) { entry[event.target.dataset.participantField] = event.target.value; saveProfileParticipants(selection); }
        }
      } catch (error) { toast(error.message); }
      render(state.page === 'assistant'); return;
    }
    if (event.target.matches('[data-assistant-key]')) {
      try { await saveAssistantKey(); } catch { assistantUI.keyStatus = '助手秘钥保存失败，请重试'; render(); }
      return;
    }
    if (event.target.dataset.assistant) {
      const key = event.target.dataset.assistant;
      if (key === 'endpoint' || key === 'source') {
        try { await syncAssistantConnection(key === 'endpoint' ? 'assistant' : undefined); }
        catch { assistantUI.keyStatus = '接口同步失败，请重试'; }
      }
      if (['source', 'template', 'frequency'].includes(key)) render(true);
      else if (event.target.type === 'number') event.target.value = state.assistant[key];
      if (key === 'source' && state.assistant.source === 'tavern' && isInstalled()) void fetchAssistantModels(false);
      return;
    }
    if (event.target.matches('[data-transient="key"]')) {
      scheduleConnectionSave(state.provider, true); return;
    }
    if (event.target.dataset.sdwebui) {
      commitSDWebUIFields(); return;
    }
    if (event.target.dataset.sdwebuiConnection) {
      persist(); keyVisible = false;
      if (event.target.dataset.sdwebuiConnection === 'auth') render();
      else if (event.target.dataset.sdwebuiConnection === 'timeout') event.target.value = state.connections.sdwebui.timeout;
      return;
    }
    if (event.target.matches('[data-sdwebui-preset]')) {
      try { await loadCurrentPreset('sdwebui', event.target.value); } catch (error) { toast(error.message); render(); }
      return;
    }
    if (event.target.dataset.openai) {
      const key = event.target.dataset.openai;
      commitOpenAIFields();
      if (['size', 'model'].includes(key)) {
        render();
        host.querySelector(`[data-openai="${key}"]`)?.focus({ preventScroll: true });
      }
      return;
    }
    if (event.target.dataset.openaiConnection) {
      normalizeOpenAIState(state);
      const key = event.target.dataset.openaiConnection;
      event.target.value = state[{ endpoint: 'openaiEndpoint', path: 'openaiPath', timeout: 'openaiTimeout' }[key]];
      persist();
      if (key === 'endpoint') {
        try { await syncAssistantConnection('openai'); } catch { toast('接口同步失败，请重试'); }
      }
      checkConnection(false, key !== 'endpoint'); return;
    }
    if (event.target.matches('[data-openai-preset]')) {
      try { await loadCurrentPreset('openai', event.target.value); } catch (error) { toast(error.message); render(); }
      host.querySelector('[data-openai-preset]')?.focus({ preventScroll: true });
      return;
    }
    if (event.target.matches('[data-drawing-select]')) {
      const id = event.target.dataset.drawingSelect;
      if (event.target.checked) drawingUI.selection.add(id); else drawingUI.selection.delete(id);
      render(); return;
    }
    if (event.target.matches('[data-drawing-select-page]')) {
      const checked = event.target.checked;
      drawingPage(filterDrawings(drawings, drawingUI.filters), drawingUI.page, drawingUI.pageSize).items.forEach((item) => {
        if (checked) drawingUI.selection.add(item.id); else drawingUI.selection.delete(item.id);
      });
      render(); return;
    }
    if (event.target.matches('[data-drawing-page-size]')) {
      drawingUI.pageSize = Number(event.target.value); drawingUI.page = 1; render(); return;
    }
    if (event.target.dataset.comfy) {
      commitComfyFields();
      return;
    }
    if (event.target.matches('[data-comfy-preset]')) {
      try { await loadCurrentPreset('comfyui', event.target.value); } catch (error) { toast(error.message); render(); }
      host.querySelector('[data-comfy-preset]')?.focus({ preventScroll: true });
      return;
    }
    if (event.target.matches('[data-comfy-map]')) {
      const key = event.target.dataset.comfyMap;
      const mapping = mappingCandidates(state.comfyui.graph, key).find((item) => item.token === event.target.value);
      const duplicate = mapping && Object.entries(state.comfyui.mapping).some(([otherKey, item]) => otherKey !== key && item.node === mapping.node && item.input === mapping.input);
      if (duplicate) { toast('该节点输入已被其他参数使用，请先取消原映射'); render(); return; }
      changeComfy(() => {
        if (mapping) {
          state.comfyui.mapping[key] = { node: mapping.node, input: mapping.input };
          state.comfyui.params[key] = state.comfyui.graph[mapping.node].inputs[mapping.input];
          state.comfyui.params = normalizeComfyParams(state.comfyui.params);
        } else delete state.comfyui.mapping[key];
      });
      host.querySelector(`[data-comfy-map="${key}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (event.target.matches('[data-comfy-output]')) {
      state.comfyui.outputNode = event.target.value; persist(); updateComfyDirty(); return;
    }
    if (event.target.matches('[data-comfy-auth]')) {
      credentials.comfyui.auth = event.target.value;
      persist(); resetConnection(); render(); checkConnection(); return;
    }
    if (event.target.matches('[data-comfy-timeout]')) {
      state.comfyTimeout = Math.max(5, Math.min(120, Math.round(Number(event.target.value) || 15)));
      event.target.value = state.comfyTimeout; persist(); resetConnection(); updateConnectionStatus(); return;
    }
    if (event.target.dataset.nai) {
      commitNovelAIFields();
      if (event.target.dataset.nai === 'model') {
        render();
        host.querySelector('[data-nai="model"]')?.focus({ preventScroll: true });
      }
      return;
    }
    if (event.target.matches('[data-nai-size]')) {
      const size = NOVELAI_SIZES.find((item) => item.id === event.target.value);
      if (size) { state.novelai.width = size.width; state.novelai.height = size.height; commitNovelAIFields(); }
      else host.querySelector('[data-nai="width"]').focus();
      return;
    }
    if (event.target.matches('[data-nai-preset]')) {
      try { await loadCurrentPreset('novelai', event.target.value); } catch (error) { toast(error.message); render(); }
      host.querySelector('[data-nai-preset]')?.focus({ preventScroll: true });
      return;
    }
    const key = event.target.dataset.setting;
    if (['triggerPrefix', 'triggerSuffix'].includes(key)) {
      Object.assign(state, normalizeSettings(state));
      event.target.value = state[key];
      persist(); updateTriggerFormat();
    } else if (Object.hasOwn(SETTING_LIMITS, key) || ['cacheDirectory', 'cleanupMode', 'cleanupUnit'].includes(key)) {
      Object.assign(state, normalizeSettings(state));
      persist(); render();
      host.querySelector(`[data-setting="${key}"]`)?.focus({ preventScroll: true });
      if (key.startsWith('cleanup')) void syncStoragePolicy().catch((error) => toast(error.message));
    } else if (key === 'characterTheme') {
      render();
      host.querySelector('[data-setting="characterTheme"]')?.focus({ preventScroll: true });
    } else if (['provider', 'style', 'favoriteOnly'].includes(key)) render();
    if (['generationMode', 'queueInterval', 'concurrency'].includes(key)) {
      try { await taskPersistence.configure(); }
      catch (error) { toast(`调度设置未能同步：${error.message}`); }
    }
    if (['generationMode', 'queueInterval', 'concurrency', 'enabled'].includes(key)) taskQueue.pump();
  });
  host.addEventListener('submit', (event) => {
    if (event.target.matches('[data-drawing-filters]')) {
      event.preventDefault();
      const values = new FormData(event.target);
      const start = String(values.get('start') || '');
      const end = String(values.get('end') || '');
      if (start && end && start > end) { drawingUI.error = '开始日期不能晚于结束日期'; render(); return; }
      drawingUI.filters = { source: String(values.get('source')), start, end, search: String(values.get('search') || ''), favoriteOnly: values.has('favoriteOnly'), chatKey: String(values.get('chatKey') || ''), rating: String(values.get('rating') || '') };
      drawingUI.page = 1; drawingUI.error = ''; drawingUI.selection.clear(); render();
      return;
    }
    if (!event.target.matches('.chat-composer')) return;
    event.preventDefault();
    const input = host.querySelector('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    const article = document.createElement('article');
    article.className = 'chat-message user-message';
    article.innerHTML = `<div class="message-avatar">${icon('user-round')}</div><div class="message-body"><div class="message-meta"><strong>你</strong><time>刚刚</time></div><p>${esc(text)}</p></div>`;
    host.querySelector('.chat-messages').append(article);
    input.value = ''; article.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); paintIcons();
  });
  document.getElementById('overlay-root').addEventListener('click', (event) => {
    const action = event.target.closest('button[data-action]')?.dataset.action;
    if (action === 'close-viewer') closeDrawingViewer();
    if (action === 'viewer-review') markReviewed(event.target.closest('[data-rating]').dataset.rating);
    if (action === 'viewer-review-undo') markReviewed('unrated', true);
    if (action === 'download') downloadImage(event.target.closest('[data-image]')?.dataset.image);
    if (action === 'viewer-prev' || action === 'viewer-next') {
      viewerUI.index = (viewerUI.index + (action === 'viewer-prev' ? -1 : 1) + viewerUI.ids.length) % viewerUI.ids.length;
      viewerUI.imageId = ''; viewerUI.compare = false;
      viewerUI.zoom = false; showDrawingViewer();
    }
    if (action === 'viewer-details') { viewerUI.details = !viewerUI.details; showDrawingViewer(); }
    if (action === 'viewer-zoom') { viewerUI.zoom = !viewerUI.zoom; showDrawingViewer(); }
    if (action === 'viewer-restore') restoreViewerParameters();
    if (action === 'viewer-edit') openImageEditor(viewedDrawing());
    if (action === 'viewer-enhance') processingPanel.open(viewedDrawing());
    if (action === 'viewer-source') void useViewerReference('source');
    if (action === 'viewer-reference') void useViewerReference('reference');
    if (action === 'version-view' || action === 'version-prev' || action === 'version-next') {
      const versions = groupVersions(drawings, viewerUI.ids[viewerUI.index]);
      const index = versions.findIndex((row) => row.id === viewerUI.imageId);
      viewerUI.imageId = action === 'version-view' ? event.target.closest('[data-image]').dataset.image
        : versions[index + (action === 'version-prev' ? -1 : 1)]?.id || viewerUI.imageId;
      viewerUI.zoom = false; showDrawingViewer();
    }
    if (action === 'version-select') {
      const item = viewedDrawing();
      void drawingOperation(async () => {
        await drawingLibrary.selectVersion(item.id); await reloadDrawings(); notifyImagesChanged(); toast('当前版本已更新');
      });
    }
    if (action === 'version-compare') { viewerUI.compare = !viewerUI.compare; viewerUI.zoom = false; showDrawingViewer(); }
    if (action === 'version-copy-seed') {
      const seed = drawingSeed(viewedDrawing());
      if (seed !== null) void navigator.clipboard.writeText(String(seed)).then(() => toast('种子已复制'), () => toast('复制失败，请在参数中查看种子'));
    }
    if (action === 'version-delete') deleteDrawingsDialog([viewedDrawing().id], '删除这个版本');
    if (action === 'version-delete-group') deleteDrawingsDialog(groupVersions(drawings, viewedDrawing().id).map((row) => row.id), '删除整个图组');
    if (action === 'viewer-restore-profiles') {
      const item = viewedDrawing();
      const key = currentChat().key || '';
      if (!discardProfileChanges()) return;
      if (!window.confirm(`将图片中的角色档案恢复到${key ? '当前聊天覆盖' : '全局档案'}？同 ID 的档案会被覆盖。`)) return;
      try {
        state.characterProfiles = restoreSceneProfiles(state.characterProfiles, item.snapshot.characterScene, key);
        useLiveCharacterScene(); profileUI.scope = key ? 'chat' : 'global';
        loadProfileDraft(); persist(); closeDrawingViewer(); showPage('characters'); toast('图片角色档案已恢复');
      } catch (error) { toast(error.message); }
    }
    if (action === 'favorite') toggleDrawingFavorite(event.target.closest('[data-image]')?.dataset.image);
  });
  document.getElementById('overlay-root').addEventListener('change', (event) => {
    if (event.target.hasAttribute('data-viewer-version')) { viewerUI.imageId = event.target.value; viewerUI.zoom = false; showDrawingViewer(); }
    if (event.target.hasAttribute('data-viewer-compare')) { viewerUI.compareId = event.target.value; showDrawingViewer(); }
  });
  document.addEventListener('keydown', (event) => {
    if (document.querySelector('.novelai-processing-dialog[open], .tag-picker[open], .profile-ai-dialog[open], .network-diagnostic-dialog[open]')) return;
    if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (document.querySelector('.drawing-viewer') && viewerUI.review && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const rating = ({ '0': 'unrated', '1': 'best', '2': 'usable', '3': 'reject' })[event.key];
      if (rating) { event.preventDefault(); markReviewed(rating); return; }
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); markReviewed('unrated', true); return; }
    }
    if (document.querySelector('.drawing-viewer') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      viewerUI.index = (viewerUI.index + (event.key === 'ArrowLeft' ? -1 : 1) + viewerUI.ids.length) % viewerUI.ids.length;
      viewerUI.imageId = ''; viewerUI.compare = false;
      viewerUI.zoom = false; showDrawingViewer(); return;
    }
    if (event.key === 'Escape') {
      if (imageEditorUI) { closeImageEditor(); return; }
      const overlay = document.getElementById('overlay-root');
      const dialogs = overlay.querySelectorAll('dialog');
      if (dialogs.length) dialogs.forEach((dialog) => dialog.close());
      else overlay.replaceChildren();
    }
  });
}
