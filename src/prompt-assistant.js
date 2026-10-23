import { applyCharacterScene, normalizeCharacterScene, normalizeCharacterDirections, profileContext } from './character-profiles.js';
import { withRequestTimeout } from './request-timeout.js';
import { normalizeAssistantPreset } from './assistant-presets.js';
import { normalizeTaskMessages, normalizeCharacterStates } from './assistant-workflow.js';
import { assistantResponseParameters, extractAssistantResponse } from './assistant-response.js';
import { ASSISTANT_MAX_TOKENS } from './assistant-limits.js';
import { normalizeTaskPrompts, renderTaskRules } from './assistant-rules.js';
import { normalizeCompatibilityProfiles, assistantRequestParameters } from './assistant-compatibility.js';

export const ASSISTANT_DEFAULTS = Object.freeze({
  source: 'tavern', apiTransport: 'direct', endpoint: '', model: '', tavernModel: '', keyRef: '', apiLink: null,
  temperature: 0.6, maxTokens: 4000, timeout: 120,
  presetMode: 'none', presetId: '', presetSelection: null,
  contextMessages: 8, contextCharacters: 24000, includeCharacters: true, includeWorld: true,
  format: 'auto', template: 'scene', customTemplate: '', appearance: '',
  autoPrompt: false, autoImage: false, frequency: 'scene', every: 3,
  count: 1, aspect: 'keep', composition: 'balanced',
  illustrationCount: 1, rememberState: false, responseMode: 'text', taskMessages: {}, taskPrompts: {},
  compatibilityProfiles: [], outputParameter: 'max_tokens', omitTemperature: false, contextWindow: 0, outputLimit: 0,
});
export const ASSISTANT_TEMPLATES = [
  ['scene', '剧情画面'], ['portrait', '人物肖像'], ['environment', '环境场景'], ['custom', '自定义'],
];
const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
const clamp = (value, min, max, fallback, integer = true) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, integer ? Math.round(number) : number)) : fallback;
};

export function normalizeAssistant(value = {}) {
  const result = { ...ASSISTANT_DEFAULTS, ...normalizeAssistantPreset(value) };
  for (const [key, options] of Object.entries({
    source: ['tavern', 'api'], apiTransport: ['direct', 'tavern'], format: ['auto', 'tags', 'natural'],
    template: ASSISTANT_TEMPLATES.map(([id]) => id), frequency: ['scene', 'each', 'interval'],
    aspect: ['keep', 'auto', 'portrait', 'landscape', 'square'],
    composition: ['balanced', 'closeup', 'fullbody', 'environment'],
    responseMode: ['text', 'json', 'tool'],
  })) if (options.includes(value[key])) result[key] = value[key];
  for (const key of ['includeCharacters', 'includeWorld', 'autoPrompt', 'autoImage', 'rememberState', 'omitTemperature']) {
    if (typeof value[key] === 'boolean') result[key] = value[key];
  }
  for (const [key, limit] of Object.entries({ endpoint: 512, model: 200, tavernModel: 200, customTemplate: 8000, appearance: 4000 })) {
    result[key] = text(value[key], limit);
  }
  result.keyRef = /^(?:tavern|browser):[a-f0-9-]{36}$/.test(value.keyRef) ? value.keyRef : '';
  if (value.apiLink && typeof value.apiLink === 'object') {
    const link = value.apiLink;
    if ([link.openaiRef, link.assistantRef].every((ref) => /^(?:tavern|browser):[a-f0-9-]{36}$/.test(ref) || ref === '')) {
      result.apiLink = { endpoint: text(link.endpoint, 512), openaiRef: link.openaiRef, assistantRef: link.assistantRef };
    }
  }
  for (const [key, min, max] of [
    ['maxTokens', 256, ASSISTANT_MAX_TOKENS], ['timeout', 15, 300], ['contextMessages', 1, 40],
    ['contextCharacters', 2000, 60000], ['every', 1, 50], ['count', 1, 4],
    ['illustrationCount', 1, 4],
  ]) result[key] = clamp(value[key] ?? result[key], min, max, result[key]);
  result.temperature = clamp(value.temperature ?? result.temperature, 0, 2, result.temperature, false);
  result.taskMessages = normalizeTaskMessages(value.taskMessages);
  result.taskPrompts = normalizeTaskPrompts(value.taskPrompts);
  result.compatibilityProfiles = normalizeCompatibilityProfiles(value.compatibilityProfiles);
  result.outputParameter = value.outputParameter === 'max_completion_tokens' ? value.outputParameter : 'max_tokens';
  result.contextWindow = clamp(value.contextWindow ?? 0, 0, 4000000, 0);
  result.outputLimit = clamp(value.outputLimit ?? 0, 0, ASSISTANT_MAX_TOKENS, 0);
  if (['text', 'json', 'tool'].includes(value.responseModeOverride)) result.responseModeOverride = value.responseModeOverride;
  return result;
}

export function assistantURLs(endpoint) {
  const value = endpoint.trim();
  let url;
  try { url = new URL(value); } catch { throw new Error('请填写完整的文字接口地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('文字接口地址需使用 HTTP 或 HTTPS，且不能包含账号、查询参数或片段');
  }
  let path = url.pathname.replace(/\/+$/, '');
  path = path.replace(/\/(?:chat\/completions|images\/generations|models)$/, '');
  if (!/\/v\d+(?:beta\d*)?$/.test(path)) path += '/v1';
  return { base: `${url.origin}${path}`, completions: `${url.origin}${path}/chat/completions`, models: `${url.origin}${path}/models` };
}

export function assistantConnectionSync({ openai, assistant, link, origin }) {
  const pairs = { openai, assistant };
  const base = (pair) => {
    try { return assistantURLs(pair.endpoint).base; } catch { return ''; }
  };
  const complete = (pair) => Boolean(base(pair) && pair.key.trim() && !pair.dirty);
  const linkedTarget = (name) => link && !pairs[name].dirty && base(pairs[name]) === link.endpoint
    && pairs[name].keyRef === link[`${name}Ref`];
  const target = origin === 'openai' ? 'assistant' : origin === 'assistant' ? 'openai' : null;
  if (target && !pairs[origin].dirty && linkedTarget(target) && base(pairs[origin])) {
    if (base(pairs[target]) === base(pairs[origin]) && pairs[target].key.trim() === pairs[origin].key.trim()) {
      return { source: origin, target: null, endpoint: base(pairs[origin]) };
    }
    return { source: origin, target, endpoint: base(pairs[origin]), key: pairs[origin].key };
  }
  const source = origin || (complete(openai) ? 'openai' : complete(assistant) ? 'assistant' : null);
  if (!source || !complete(pairs[source])) return null;
  const other = source === 'openai' ? 'assistant' : 'openai';
  if (pairs[other].dirty) return null;
  if (!pairs[other].keyRef && !pairs[other].key.trim() || !base(pairs[other]) && pairs[other].key.trim() === pairs[source].key.trim()) {
    return { source, target: other, endpoint: base(pairs[source]), key: pairs[source].key };
  }
  if (base(pairs[other]) === base(pairs[source]) && pairs[other].key.trim() === pairs[source].key.trim()) {
    return { source, target: null, endpoint: base(pairs[source]) };
  }
  return null;
}

export function assistantModelNames(data) {
  const list = Array.isArray(data) ? data : data?.data || data?.models;
  return Array.isArray(list) ? [...new Set(list.map((item) => typeof item === 'string' ? item : item?.id || item?.name)
    .filter((id) => typeof id === 'string' && id.trim() && id.length <= 200).map((id) => id.trim()))].sort() : [];
}

export async function requestAssistantModels(settings, key, { signal, fetcher = fetch, relay } = {}) {
  const options = normalizeAssistant(settings);
  if (options.apiTransport === 'tavern') {
    if (!relay) throw new Error('酒馆转发需在酒馆内使用，请选择设备直连');
    return relay('models', { settings: options, key }, { signal, timeout: 20 });
  }
  const url = assistantURLs(settings.endpoint).models;
  if (globalThis.location?.protocol === 'https:' && new URL(url).protocol === 'http:') {
    throw new Error('HTTPS 酒馆需使用 HTTPS 文字接口');
  }
  return withRequestTimeout(signal, 15000, '模型列表读取超时，请手动重试', async (requestSignal) => {
    try {
      const response = await fetcher(url, {
        headers: { Accept: 'application/json', ...(key.trim() ? { Authorization: `Bearer ${key.trim()}` } : {}) },
        credentials: 'omit', signal: requestSignal,
      });
      if (!response.ok) throw new Error(({
        401: '文字接口鉴权失败，请检查助手 API Key',
        403: '文字模型列表访问被拒绝，请检查接口权限',
        429: '模型列表请求过于频繁，请稍后手动重试',
      })[response.status] || `模型列表读取失败（HTTP ${response.status}）`);
      let data;
      try { data = await response.json(); }
      catch (error) {
        if (requestSignal.aborted) throw error;
        throw new Error('模型列表返回格式不正确，可手动填写模型名');
      }
      requestSignal.throwIfAborted();
      const models = assistantModelNames(data);
      if (!models.length) throw new Error('接口模型列表为空，可手动填写模型名');
      return models;
    } catch (error) {
      if (requestSignal.aborted) throw error;
      if (error instanceof TypeError) throw new Error('模型列表连接失败，请检查文字接口地址、当前设备网络与跨域设置；也可手动填写模型名');
      throw error;
    }
  });
}

export function promptFormat(provider, model, choice = 'auto') {
  if (choice !== 'auto') return choice;
  return provider === 'novelai' || /nai-diffusion/i.test(model || '') || ['comfyui', 'sdwebui'].includes(provider) ? 'tags' : 'natural';
}

export function buildAssistantMessages({ settings, operation = 'generate', ruleTask = operation, input = '', context = {}, target = {} }) {
  const options = normalizeAssistant(settings);
  if (!['generate', 'translate', 'polish', 'illustrate'].includes(operation)) throw new Error('未知提示词操作');
  const format = promptFormat(target.provider, target.model, options.format);
  const task = {
    generate: 'Turn the description into an image prompt.',
    translate: 'Translate the input into an English image prompt. Preserve its meaning; do not add story details.',
    polish: 'Improve clarity and composition of the existing prompt without changing identity, scene or intent.',
    illustrate: `Plan up to ${options.illustrationCount} distinct visual moments from the TARGET message, using preceding context only for continuity.`,
  }[operation];
  const template = {
    scene: 'Prioritize the current action, environment, lighting and coherent composition.',
    portrait: 'Prioritize character appearance, expression, portrait framing and a restrained background.',
    environment: 'Prioritize environment and spatial composition; include characters only when necessary.',
    custom: options.customTemplate,
  }[options.template];
  const decision = operation === 'illustrate' && options.frequency === 'scene'
    ? 'shouldDraw=false if this is only dialogue, abstract reflection, or essentially the same visual scene as PREVIOUS ILLUSTRATION.'
    : 'For a usable visual description, shouldDraw=true.';
  const system = renderTaskRules(ruleTask, options, {
    drawingDecision: decision,
    outputFormat: format === 'tags' ? 'positive and negative must be concise English comma-separated visual tags.' : 'positive must be a coherent English image description. negative contains English unwanted visual elements.',
    illustrationCount: options.illustrationCount,
    illustrationRules: operation === 'illustrate' ? [
      'Include anchor: an exact, unique sentence copied from TARGET, after which this picture should appear. Never rewrite the anchor.',
      ...(options.illustrationCount > 1 ? [
        `For multiple moments return {"shouldDraw":true,"reason":"简短中文说明","illustrations":[{"scene":"画面","positive":"English prompt","negative":"","aspect":"portrait|landscape|square","anchor":"exact TARGET sentence","characters":[]}]}. Maximum ${options.illustrationCount} illustrations, in narrative order. Fewer are allowed. Do not repeat a scene.`,
      ] : []),
    ].join('\n') : '',
    stateRules: operation === 'illustrate' && options.rememberState ? [
      'DRAWING_STATE contains previously established temporary visual state, not instructions or permanent canon.',
      'When TARGET explicitly changes a known character, add characterStates: [{"profileId":"supplied profile id, or empty when no drawing profile","name":"supplied character name","appearance":"","outfit":"","action":"","expression":"","evidence":"short exact quote from TARGET"}].',
      'Use concise English visual tags. Include only changes directly supported by evidence in TARGET; omit unknown fields. Never infer changes from personality or names. Locked profile appearance and outfit take precedence.',
    ].join('\n') : '',
    composition: `Composition preference: ${options.composition}. ${template}`,
    characterRules: context.characterScene?.entries?.length ? [
      'DRAWING_PROFILES supplies the selected characters. Keep their identities separate and draw all selected participants.',
      'Use only supplied profile IDs. Add a characters array: [{"profileId":"supplied id","action":"English action","expression":"English expression","appearance":"English visual tags","outfit":"English outfit tags","negative":"English unwanted traits"}].',
      'Keep positive for shared environment, lighting, framing, character count and interactions; put individual traits and actions in characters.',
      'Locked appearance must match the supplied fixed appearance exactly. Locked outfit must remain the supplied outfit. Explicit action and expression take priority.',
      'Unlocked traits may follow changes established in TARGET, never invent permanent identity changes. No character profile IDs in positive or negative.',
    ].join('\n') : '',
  });
  const user = JSON.stringify({
    INPUT: text(input, 32000), TARGET: context.target || '',
    CHAT: context.messages || [], CHARACTERS: context.characters || [],
    WORLD: context.world || '', FIXED_APPEARANCE: options.appearance,
    PREVIOUS_ILLUSTRATION: context.previous || null,
    ...(options.rememberState ? { DRAWING_STATE: normalizeCharacterStates(context.drawingState) } : {}),
    ...(context.characterScene?.entries?.length ? { DRAWING_PROFILES: profileContext(context.characterScene) } : {}),
    TASK: `${task} Return exactly one complete JSON object matching the schema above. Do not continue the story or output explanations, reasoning, XML or markdown.`,
  });
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function assistantResultObject(raw) {
  const content = raw.trim();
  try { return JSON.parse(content); } catch { /* Read a complete result from a wrapped reply. */ }
  const lower = content.toLowerCase(), candidates = [];
  let start = -1, depth = 0, quoted = false, escaped = false, unfinishedReasoning = false;
  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    if (start < 0) {
      const thought = char === '<' ? content.slice(index).match(/^<(think|thinking|analysis)>/i) : null;
      const fence = char === '`' ? content.slice(index).match(/^```(?:analysis|thinking|think)\s/i) : null;
      if (thought || fence) {
        const closing = thought ? `</${thought[1].toLowerCase()}>` : '```';
        const end = lower.indexOf(closing, index + (thought || fence)[0].length);
        if (end < 0) { unfinishedReasoning = true; break; }
        index = end + closing.length - 1;
        continue;
      }
      if (char === '{') { start = index; depth = 1; quoted = false; escaped = false; }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === '{') depth++;
    else if (char === '}') depth--;
    if (depth !== 0) continue;
    try {
      const candidate = JSON.parse(content.slice(start, index + 1));
      if (candidate && typeof candidate.shouldDraw === 'boolean') candidates.push(candidate);
    } catch { /* Never repair or execute malformed model output. */ }
    start = -1;
    if (candidates.length > 1) throw new Error('文字模型返回多个配图 JSON，无法确定结果，请调整预设的输出要求');
  }
  if (candidates.length === 1) return candidates[0];
  const detail = unfinishedReasoning ? '思考内容未结束，可能已达到输出上限'
    : start >= 0 ? 'JSON 未闭合，可能被截断' : '未找到完整的配图 JSON';
  throw new Error(`文字模型未返回所需的 JSON 格式（${detail}；返回 ${raw.length} 字符），请核对模型回复与预设的输出要求`);
}

export function parseAssistantResult(raw, { stored = false, editable = false } = {}) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > (stored ? 2000000 : 100000)) throw new Error('文字模型没有返回有效结果');
  try {
    const result = assistantResultObject(raw);
    if (!result || Array.isArray(result) || typeof result !== 'object' || typeof result.shouldDraw !== 'boolean') {
      throw new Error('文字模型返回的配图结构不完整');
    }
    const cleanShot = (shot) => {
      if (!shot || typeof shot !== 'object' || Array.isArray(shot)) throw new Error('模型返回的配图画面格式无效');
      const positive = text(shot.positive, 32000).trim();
      if (result.shouldDraw && !positive && !(stored && editable)) throw new Error('文字模型没有给出正向提示词');
      if (typeof shot.positive === 'string' && shot.positive.length > 32000
        || typeof shot.negative === 'string' && shot.negative.length > 32000
        || typeof shot.anchor === 'string' && shot.anchor.length > 1000) throw new Error('模型返回的提示词或定位句过长');
      return {
        shouldDraw: result.shouldDraw, reason: text(shot.reason || result.reason, 500), scene: text(shot.scene, 2000),
        positive, negative: text(shot.negative, 32000).trim(),
        ...(text(shot.anchor, 1000).trim() ? { anchor: text(shot.anchor, 1000).trim() } : {}),
        aspect: ['portrait', 'landscape', 'square'].includes(shot.aspect) ? shot.aspect : 'square',
        ...(Array.isArray(shot.characters) ? { characters: normalizeCharacterDirections(shot.characters) } : {}),
      };
    };
    let shots;
    if (result.illustrations !== undefined) {
      if (!Array.isArray(result.illustrations) || result.illustrations.length > 4
        || result.shouldDraw && !result.illustrations.length) throw new Error('配图规划需包含 1 至 4 个完整画面');
      shots = result.illustrations.map(cleanShot);
      if (!stored && shots.length > 1 && shots.some((shot) => !shot.anchor)) throw new Error('多图规划缺少原文定位句，请重新分析');
    }
    const first = shots?.[0] || cleanShot(result);
    return {
      ...first, shouldDraw: result.shouldDraw, reason: text(result.reason || first.reason, 500),
      ...(shots?.length ? { illustrations: shots } : {}),
      ...(Array.isArray(result.characterStates) ? { characterStates: normalizeCharacterStates(result.characterStates) } : {}),
      ...(result.characterScene ? { characterScene: normalizeCharacterScene(result.characterScene) } : {}),
    };
  } catch (error) {
    // Keep failed live output available to the local viewer without serializing it into task errors.
    if (!stored) Object.defineProperty(error, 'assistantResponse', { value: raw });
    throw error;
  }
}

export async function requestAssistantText(settings, key, messages, { signal, fetcher = fetch, onExecution, relay } = {}) {
  const options = normalizeAssistant(settings);
  const execution = (value) => { try { onExecution?.(value); } catch {} };
  if (!options.model.trim()) throw new Error('请填写提示词助手的文字模型');
  if (!key.trim()) throw new Error('请填写提示词助手的 API Key');
  if (options.apiTransport === 'tavern') {
    if (!relay) throw new Error('酒馆转发需在酒馆内使用，请选择设备直连');
    execution({ model: options.model.trim(), source: 'openai-compatible', route: 'independent-tavern' });
    const result = await relay('text', { settings: options, key, messages, diagnostics: true }, { signal, timeout: options.timeout });
    execution(result.execution);
    return result.text;
  }
  const url = assistantURLs(options.endpoint).completions;
  if (globalThis.location?.protocol === 'https:' && new URL(url).protocol === 'http:') throw new Error('HTTPS 酒馆需使用 HTTPS 文字接口');
  execution({ model: options.model.trim(), source: 'openai-compatible', route: 'independent-api' });
  return withRequestTimeout(signal, options.timeout * 1000, '文字接口请求超时，请稍后手动重试', async (requestSignal) => {
    let response;
    try { response = await fetcher(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}` },
      body: JSON.stringify({ model: options.model.trim(), messages, ...assistantRequestParameters(options),
        stream: false, ...assistantResponseParameters(options.responseMode) }),
      credentials: 'omit', signal: requestSignal,
    }); } catch (error) {
      if (!requestSignal.aborted && error instanceof TypeError) {
        throw new Error('文字接口连接失败，请检查接口地址、当前设备网络与跨域设置；可点击“检测助手网络”定位');
      }
      throw error;
    }
    execution({ httpStatus: response.status });
    if (!response.ok) {
      throw new Error(({ 401: '文字接口鉴权失败，请检查 Key', 403: '文字模型访问被拒绝', 429: '文字接口限流，请稍后手动重试' })[response.status] || `文字接口请求失败（${response.status}）`);
    }
    let data;
    try { data = await response.json(); }
    catch (error) {
      if (requestSignal.aborted) throw error;
      throw new Error('文字接口返回格式不正确，请检查地址是否为 OpenAI 兼容聊天补全接口');
    }
    return extractAssistantResponse(data);
  });
}

export async function requestAssistantAPI(settings, key, messages, options) {
  return parseAssistantResult(await requestAssistantText(settings, key, messages, options));
}

export function applyAssistantPlan(snapshot, plan, settings) {
  const options = normalizeAssistant(settings);
  const result = structuredClone(snapshot);
  const params = result.params || result.config.params;
  // A loaded image keeps its original base prompt separately from attributed character prompts.
  if (result.characterScene?.applied) {
    params.positive = result.characterScene.basePositive;
    params.negative = result.characterScene.baseNegative;
    delete result.characterScene.applied;
  }
  const naturalOpenAI = result.provider === 'openai' && !/nai-diffusion/i.test(params.model || '');
  const existing = params.positive?.trim() || '';
  const alreadyApplied = existing === plan.positive.trim()
    || naturalOpenAI && existing === `${plan.positive.trim()}\nAvoid: ${params.negative?.trim() || ''}`;
  params.positive = [alreadyApplied ? '' : existing, plan.positive.trim()].filter(Boolean).join(', ');
  params.negative = [...new Set([params.negative?.trim(), plan.negative.trim()].filter(Boolean))].join(', ');
  if (naturalOpenAI && params.negative) {
    params.positive += `\nAvoid: ${params.negative}`;
  }
  if (params.positive.length > 32000 || params.negative.length > 32000) throw new Error('合并后的提示词超过 32000 字符');
  if (result.provider === 'novelai') params.nSamples = options.count;
  else if (result.provider === 'openai') params.n = options.count;
  else if (result.provider === 'sdwebui') params.batch = options.count;
  else {
    if (!result.config.mapping.positive) throw new Error('请先映射 ComfyUI 的正向提示词节点');
    if (options.count > 1 && !result.config.mapping.batchSize) throw new Error('多张配图需要映射 ComfyUI 批次数量节点');
    if (result.config.mapping.batchSize) params.batchSize = options.count;
  }
  const aspect = options.aspect === 'auto' ? plan.aspect : options.aspect;
  if (aspect !== 'keep') {
    const sizes = { portrait: [832, 1216], landscape: [1216, 832], square: [1024, 1024] };
    const [width, height] = sizes[aspect] || sizes.square;
    if (result.provider === 'openai' && !/nai-diffusion/i.test(params.model || '')) {
      params.size = { portrait: '1024x1536', landscape: '1536x1024', square: '1024x1024' }[aspect];
      if (/dall-e-3/i.test(params.model || '')) params.size = { portrait: '1024x1792', landscape: '1792x1024', square: '1024x1024' }[aspect];
      if (/dall-e-2/i.test(params.model || '')) params.size = '1024x1024';
    } else {
      if (result.provider === 'comfyui' && (!result.config.mapping.width || !result.config.mapping.height)) {
        throw new Error('指定画幅需要映射 ComfyUI 的宽度和高度节点');
      }
      params.width = width; params.height = height;
      if (result.provider === 'openai') params.size = 'custom';
    }
  }
  return applyCharacterScene(result, plan.characterScene || result.characterScene, plan.characters);
}
