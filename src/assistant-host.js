import { bindSmartSlot, chatIdentity, digest, eligibleMessage } from './chat.js';
import { normalizeAssistant } from './prompt-assistant.js';
import { createTavernTextAccess } from './tavern-text.js';
import { assistantPresetDirectory, resolveAssistantPreset, validateAssistantMessages } from './assistant-presets.js';
import { evidencedCharacterStates } from './assistant-workflow.js';
import { readDrawingState, inspectDrawingState, reviseDrawingState, undoDrawingState } from './assistant-state.js';
import { assistantExecution } from './assistant-diagnostics.js';
import { selectAssistantMessages, validateContextSelection } from './assistant-context.js';
import { createAssistantRelay } from './assistant-relay.js';
import { comicSource } from './comic.js';

const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';

export function characterDirectory(context) {
  const group = context.groupId ? context.groups?.find((item) => String(item.id) === String(context.groupId)) : null;
  const current = group ? group.members || [] : [context.characters?.[context.characterId]?.avatar].filter(Boolean);
  return { chatKey: chatIdentity(context), name: text(group?.name || context.name2, 120),
    avatars: current, characters: (context.characters || []).filter((item) => typeof item.avatar === 'string')
      .slice(0, 1000).map((item) => ({ avatar: text(item.avatar, 512),
        name: text(item.data?.name || item.name || item.avatar, 120), current: current.includes(item.avatar) })) };
}

export async function profileCardSources(context, avatars) {
  if (!Array.isArray(avatars) || !avatars.length || avatars.length > 6
    || avatars.some((avatar) => typeof avatar !== 'string' || !avatar || avatar.length > 512)
    || new Set(avatars).size !== avatars.length) throw new Error('每次请选择 1 至 6 张不同角色卡');
  let total = 0;
  const sources = await Promise.all(avatars.map(async (avatar, index) => {
    const matches = (context.characters || []).filter((card) => card.avatar === avatar);
    if (matches.length !== 1) throw new Error('角色卡已删除或标识重复，请重新读取角色');
    const card = matches[0], data = card.data || card;
    const source = { id: `card-${index}`, avatar, name: text(data.name || card.name || avatar, 120) };
    for (const [key, limit] of [['description', 16000], ['personality', 4000], ['scenario', 4000]]) {
      const raw = data[key] || card[key] || '';
      if (typeof raw !== 'string' || raw.length > limit) throw new Error('角色卡设定过长，请复制需要的外观资料，改用粘贴设定');
      source[key] = raw;
      total += raw.length;
    }
    if (!source.description.trim() && !source.personality.trim() && !source.scenario.trim()) throw new Error(`${source.name} 的角色卡没有可读取的设定`);
    return { ...source, revision: await digest(JSON.stringify(source)) };
  }));
  if (total > 60000) throw new Error('角色资料总量过长，请减少一次选择的角色数量');
  return { chatKey: chatIdentity(context), sources };
}

export async function findBoundMessage(context, binding) {
  if (!binding || chatIdentity(context) !== binding.chatKey) return null;
  for (const message of context.chat || []) {
    if (!eligibleMessage(message) || (message.swipe_id || 0) !== binding.swipe) continue;
    if (await digest(message.mes) !== binding.branch) continue;
    const slot = await bindSmartSlot(context, message, binding.slot);
    if (slot?.binding.id === binding.id) return message;
  }
  return null;
}

export { readDrawingState };

export async function saveDrawingState(context, binding, states, scene, characters) {
  const message = await findBoundMessage(context, binding);
  if (!message) throw new Error('原消息已变化，角色状态未写入');
  if (scene && scene.chatKey !== binding.chatKey) throw new Error('角色状态不属于当前聊天');
  const clean = evidencedCharacterStates(states, message.mes, scene, characters);
  if (!clean.length) return { saved: 0 };
  if (!await findBoundMessage(context, binding)) throw new Error('原消息已变化，角色状态未写入');
  if (typeof context.saveChat !== 'function') throw new Error('当前酒馆不支持保存角色状态');
  const previous = message.extra?.linghuashiDrawingState;
  message.extra ||= {};
  message.extra.linghuashiDrawingState = { version: 1, chatKey: binding.chatKey,
    branch: binding.branch, swipe: binding.swipe, characters: clean,
    ...(previous?.chatKey === binding.chatKey && previous.branch === binding.branch && previous.swipe === binding.swipe && previous.manual
      ? { manual: previous.manual } : {}) };
  try { await context.saveChat(); }
  catch (error) {
    if (previous === undefined) delete message.extra.linghuashiDrawingState;
    else message.extra.linghuashiDrawingState = previous;
    throw new Error('角色状态保存失败，请重试');
  }
  return { saved: clean.length };
}

export async function clearDrawingState(context, chatKey) {
  if (!chatKey || chatIdentity(context) !== chatKey) throw new Error('聊天已切换，请重新读取状态');
  if (typeof context.saveChat !== 'function') throw new Error('当前酒馆不支持保存角色状态');
  const changed = (context.chat || []).filter((message) => message?.extra?.linghuashiDrawingState)
    .map((message) => [message, message.extra.linghuashiDrawingState]);
  for (const [message] of changed) delete message.extra.linghuashiDrawingState;
  try { await context.saveChat(); }
  catch {
    for (const [message, saved] of changed) message.extra.linghuashiDrawingState = saved;
    throw new Error('角色状态清除失败，请重试');
  }
  return { cleared: changed.length };
}

export async function collectAssistantContext(context, options, binding, previous, signal, selection) {
  const settings = normalizeAssistant(options);
  const message = binding ? await findBoundMessage(context, binding)
    : [...(context.chat || [])].reverse().find(eligibleMessage);
  if (binding && !message) throw new Error('原消息已变化，请在当前回复上重新配图');
  const index = message ? context.chat.indexOf(message) : context.chat?.length - 1;
  const picked = await selectAssistantMessages(context, index, settings, selection);
  const { messages } = picked;
  const targetBinding = message ? (await bindSmartSlot(context, message))?.binding : null;
  const group = context.groupId ? context.groups?.find((item) => String(item.id) === String(context.groupId)) : null;
  const character = context.characters?.[context.characterId];
  const selectedCharacters = group
    ? (context.characters || []).filter((item) => group.members?.includes(item.avatar)).slice(0, 16)
    : character ? [character] : [];
  let characterBudget = 12000;
  const characters = settings.includeCharacters ? selectedCharacters.map((item) => {
    const data = item.data || item;
    const result = { name: text(data.name || item.name, 120) };
    for (const key of ['description', 'personality', 'scenario']) {
      result[key] = text(data[key] || item[key], Math.min(4000, characterBudget));
      characterBudget -= result[key].length;
    }
    return result;
  }) : [];
  let world = '';
  let worldOriginalCharacters = 0;
  if (settings.includeWorld && message) {
    if (typeof context.getWorldInfoPrompt !== 'function') throw new Error('当前酒馆不支持世界书提取，请关闭“参考世界书”后重试');
    const data = character?.data || character || {};
    const info = await context.getWorldInfoPrompt(
      messages.map((item) => `${item.name}: ${item.content}`).reverse(),
      Math.min(Number(context.maxContext) || 8192, 16000), true,
      { personaDescription: '', characterDescription: text(data.description, 4000),
        characterPersonality: text(data.personality, 4000), characterDepthPrompt: '',
        scenario: text(data.scenario, 4000), creatorNotes: '', trigger: 'normal' },
    );
    const parts = [info.worldInfoString, ...(info.worldInfoDepth || []).map((item) => item.entries?.join('\n') || ''),
      ...(info.worldInfoExamples || []).map((item) => item.content || ''), ...(info.anBefore || []), ...(info.anAfter || [])];
    const all = parts.filter((part) => typeof part === 'string').join('\n');
    worldOriginalCharacters = all.length;
    world = all.slice(0, 12000);
  }
  signal?.throwIfAborted();
  if (binding && !await findBoundMessage(context, binding)) throw new Error('原消息已变化，提取已取消');
  if (targetBinding && !await findBoundMessage(context, targetBinding)) throw new Error('目标消息已变化，请重新读取上下文');
  await validateContextSelection(context, picked.contextSelection);
  return { chatKey: chatIdentity(context), characterAvatars: characterDirectory(context).avatars,
    targetBinding, ...picked,
    drawingState: settings.rememberState ? await readDrawingState(context, index) : [],
    target: text(message?.mes, 32000), messages, characters, world, previous: previous || null,
    summary: { messages: messages.length, characters: characters.length, worldCharacters: world.length },
    truncation: { target: Math.max(0, (message?.mes?.length || 0) - 32000),
      world: Math.max(0, worldOriginalCharacters - world.length),
      characters: settings.includeCharacters ? Math.max(0, selectedCharacters.reduce((sum, item) =>
        sum + ['description', 'personality', 'scenario'].reduce((count, key) => count + String(item.data?.[key] || item[key] || '').length, 0), 0) - (12000 - characterBudget)) : 0 } };
}

export function createAssistantHost({ getContext, settings, post, isBusy = () => false, textAccess, reader, relay }) {
  textAccess ||= createTavernTextAccess({ getContext });
  relay ||= createAssistantRelay({ getContext });
  const active = new Map();
  let textBusy = false;
  let stateWriting = false;
  let stateUndo = null;
  let destroyed = false;
  async function receive(data) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(data.requestId || '')) return;
    if (data.action === 'cancel') { active.get(data.requestId)?.abort(); return; }
    if (active.has(data.requestId) || active.size >= 4 || destroyed) return;
    const controller = new AbortController();
    let execution, writingState = false;
    active.set(data.requestId, controller);
    try {
      let value;
      const options = normalizeAssistant(settings());
      if (['state-save', 'state-clear', 'state-edit', 'state-remove', 'state-undo'].includes(data.action)) {
        if (stateWriting || textBusy || isBusy()) throw new Error('当前任务尚未完成，请稍后修改角色状态');
        stateWriting = true; writingState = true;
      }
      if (['reader-read', 'reader-validate', 'reader-image'].includes(data.action)) {
        if (!reader) throw new Error('当前宿主不支持图文阅读');
        value = await reader(data.action, data, controller.signal);
      } else if (data.action === 'comic-source') {
        if (isBusy()) throw new Error('酒馆正在输出回复，请等待完成后读取剧情');
        value = comicSource(getContext(), data.range);
      } else if (data.action === 'context') {
        value = await collectAssistantContext(getContext(), options, data.binding, data.previous, controller.signal, data.contextSelection);
      } else if (data.action === 'context-validate') {
        await validateContextSelection(getContext(), data.contextSelection);
        if (data.binding && !await findBoundMessage(getContext(), data.binding)) throw new Error('原消息已变化，请重新分析');
        value = { valid: true };
      } else if (data.action === 'characters') {
        value = characterDirectory(getContext());
      } else if (data.action === 'profile-sources') {
        value = await profileCardSources(getContext(), data.avatars);
      } else if (data.action === 'models') {
        value = await textAccess.models({ refresh: data.refresh === true, signal: controller.signal });
      } else if (['relay-models', 'relay-text', 'relay-probe'].includes(data.action)) {
        const action = data.action.slice(6);
        const result = await relay.request(action, data, { signal: controller.signal,
          onExecution: (value) => { execution = assistantExecution({ ...execution, ...value }); } });
        value = action === 'text' ? { text: result, execution: assistantExecution(execution) } : result;
      } else if (data.action === 'presets') {
        value = assistantPresetDirectory(getContext());
      } else if (data.action === 'preset') {
        value = resolveAssistantPreset(getContext(), data.settings || options);
      } else if (data.action === 'state-read') {
        if (stateWriting) throw new Error('角色状态正在保存，请稍后读取');
        value = await inspectDrawingState(getContext());
        value.canUndo = stateUndo?.chatKey === value.chatKey && stateUndo.revision === value.revision;
      } else if (data.action === 'state-save') {
        if (!options.rememberState) throw new Error('动态角色状态已关闭');
        value = await saveDrawingState(getContext(), data.binding, data.states, data.scene, data.characters);
      } else if (data.action === 'state-clear') {
        if (data.revision && (await inspectDrawingState(getContext())).revision !== data.revision) {
          throw new Error('聊天或角色状态已变化，请重新读取状态');
        }
        value = await clearDrawingState(getContext(), data.chatKey);
        stateUndo = null;
      } else if (data.action === 'state-edit' || data.action === 'state-remove') {
        const result = await reviseDrawingState(getContext(), data, data.action === 'state-remove');
        stateUndo = result.undo; value = { ...result.inspection, canUndo: true };
      } else if (data.action === 'state-undo') {
        value = { ...await undoDrawingState(getContext(), data, stateUndo), canUndo: false };
        stateUndo = null;
      } else if (data.action === 'text') {
        if (textBusy || isBusy()) throw new Error('酒馆文字模型正在使用，请等待当前回复完成后重试');
        if (!validateAssistantMessages(data.messages)) {
          throw new Error('提示词助手请求格式无效');
        }
        textBusy = true;
        try {
          const taskOptions = data.taskOptions && typeof data.taskOptions === 'object' ? normalizeAssistant({
            ...options, ...Object.fromEntries(['maxTokens', 'responseMode', 'tavernModel']
              .filter((key) => Object.hasOwn(data.taskOptions, key)).map((key) => [key, data.taskOptions[key]])),
          }) : options;
          const generate = async () => {
            controller.signal.throwIfAborted();
            if (isBusy()) throw new Error('酒馆正在生成回复，请稍后重试');
            const raw = await textAccess.generate(data.messages, taskOptions, controller.signal, data.diagnostics === true
              ? { onExecution: (value) => { execution = assistantExecution({ ...execution, ...value }); } } : {});
            return data.diagnostics === true ? { text: raw, execution: assistantExecution(execution) } : raw;
          };
          value = globalThis.navigator?.locks
            ? await navigator.locks.request('linghuashi-tavern-text', { ifAvailable: true }, (lock) => {
              if (!lock) throw new Error('提示词助手正在其他页面使用酒馆文字模型');
              return generate();
            }) : await generate();
        } finally { textBusy = false; }
      } else throw new Error('未知助手操作');
      controller.signal.throwIfAborted();
      if (!destroyed) post('linghuashi:assistant-result', { requestId: data.requestId, value });
    } catch (error) {
      if (!destroyed) post('linghuashi:assistant-result', { requestId: data.requestId,
        error: controller.signal.aborted ? '提示词助手操作已取消' : String(data.action).startsWith('relay-') && !error.assistantRelay && !error.assistantDiagnostic
          ? error.name === 'TimeoutError' ? '酒馆转发请求超时，请检查酒馆服务器网络后手动重试'
            : '酒馆转发未完成，请检查独立 API 配置与酒馆服务器网络后重试' : data.action === 'text' && !error.assistantDiagnostic
          ? '酒馆文字模型调用失败，请检查连接、额度，或等待当前文字任务结束后重试' : error.message,
        ...(data.diagnostics === true && execution ? { execution: assistantExecution(execution) } : {}),
        ...(!controller.signal.aborted && error.assistantDiagnostic && typeof error.assistantResponse === 'string'
          && error.assistantResponse.length <= 100000 ? { failedResponse: error.assistantResponse } : {}) });
    } finally { if (writingState) stateWriting = false; active.delete(data.requestId); }
  }
  return { receive, destroy() { destroyed = true; for (const controller of active.values()) controller.abort(); active.clear(); } };
}
