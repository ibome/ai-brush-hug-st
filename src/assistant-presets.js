const APIS = ['openai', 'sysprompt'];
const LABELS = { openai: '聊天补全', sysprompt: '系统提示词' };
const MAX_ENTRIES = 128;
const idFor = (api, name) => JSON.stringify([api, name]);

export function parseAssistantPresetId(value) {
  try {
    const pair = JSON.parse(value);
    if (Array.isArray(pair) && pair.length === 2 && APIS.includes(pair[0])
      && typeof pair[1] === 'string' && pair[1].length > 0 && pair[1].length <= 500) return pair;
  } catch { /* Invalid or removed preset identity. */ }
  return null;
}

export function normalizeAssistantPreset(value = {}) {
  const presetMode = ['none', 'current', 'named'].includes(value.presetMode) ? value.presetMode : 'none';
  const presetId = parseAssistantPresetId(value.presetId) ? value.presetId : '';
  const selection = value.presetSelection;
  const presetSelection = selection && parseAssistantPresetId(selection.id) && Array.isArray(selection.entries)
    && selection.entries.length <= MAX_ENTRIES && selection.entries.every((id) => typeof id === 'string' && id.length <= 500)
    ? { id: selection.id, entries: [...new Set(selection.entries)] } : null;
  return { presetMode, presetId, presetSelection };
}

function managerFor(context, api) {
  if (typeof context.getPresetManager !== 'function') return null;
  try { return context.getPresetManager(api) || null; } catch { return null; }
}

function namesFor(manager) {
  const list = manager.getPresetList?.();
  if (list?.preset_names) return Array.isArray(list.preset_names) ? list.preset_names : Object.keys(list.preset_names);
  return manager.getAllPresets?.() || [];
}

export function assistantPresetDirectory(context) {
  const presets = [];
  for (const api of APIS) {
    const manager = managerFor(context, api);
    if (!manager) continue;
    for (const name of namesFor(manager)) {
      if (typeof name !== 'string' || !name || name.length > 500) continue;
      presets.push({ id: idFor(api, name), name, kind: LABELS[api] });
    }
  }
  const api = context.mainApi === 'openai' ? 'openai' : 'sysprompt';
  const name = managerFor(context, api)?.getSelectedPresetName?.() || '';
  return { presets, current: name ? { id: idFor(api, name), name, kind: LABELS[api] } : null };
}

function macroValues(context) {
  const card = context.characters?.[context.characterId];
  const data = card?.data || card || {};
  return {
    user: context.name1 || '', char: context.name2 || data.name || '',
    description: data.description || '', personality: data.personality || '',
    scenario: data.scenario || '', mesexamples: data.mes_example || '',
    persona: context.powerUserSettings?.persona_description || '',
    charprompt: data.system_prompt || '', charjailbreak: data.post_history_instructions || '',
    lastmessage: context.chat?.at(-1)?.mes || '', newline: '\n', trim: '',
  };
}

export function expandAssistantPresetMacros(content, context) {
  const values = macroValues(context), unresolved = new Set();
  const expanded = content.replace(/\{\{([^{}]*)\}\}/g, (match, inner) => {
    const key = inner.trim().toLowerCase();
    if (Object.hasOwn(values, key)) return String(values[key]);
    unresolved.add(inner.trim().slice(0, 100));
    return match;
  });
  // generateRaw expands macros again. Make remaining delimiters inert, including those inside card data.
  const safe = expanded.replaceAll('{{', '｛｛').replaceAll('}}', '｝｝');
  return { content: safe, unresolved: [...unresolved] };
}

export function resolveAssistantPreset(context, value) {
  const options = normalizeAssistantPreset(value);
  if (options.presetMode === 'none') return null;
  const api = context.mainApi === 'openai' ? 'openai' : 'sysprompt';
  const currentManager = managerFor(context, api);
  const currentName = currentManager?.getSelectedPresetName?.();
  const pair = options.presetMode === 'current' ? [api, currentName] : parseAssistantPresetId(options.presetId);
  if (!pair?.[1]) throw new Error('请先选择可读取的酒馆提示词预设');
  const [kind, name] = pair, manager = managerFor(context, kind);
  if (!manager) throw new Error('当前酒馆未提供提示词预设读取接口');
  const preset = options.presetMode === 'current'
    ? kind === 'openai' ? context.chatCompletionSettings || manager.getPresetList?.()?.settings
      : manager.getPresetList?.()?.settings || manager.getPresetSettings?.(name)
    : manager.getCompletionPresetByName?.(name);
  if (!preset || typeof preset !== 'object') throw new Error('酒馆预设已删除或无法读取，请重新选择');
  const warnings = [], entries = [], rows = [], unlistedRows = [], identifiers = new Set();
  let skipped = 0, total = 0;
  const add = (item, enabled, listed = true) => {
    if (!item || typeof item.identifier !== 'string' || !item.identifier || item.identifier.length > 500) {
      throw new Error('预设条目标识无效，请在酒馆中检查预设');
    }
    if (identifiers.has(item.identifier)) throw new Error('预设存在重复条目标识，请在酒馆中检查预设');
    identifiers.add(item.identifier);
    const row = { id: item.identifier, name: String(item.name || item.identifier).slice(0, 500),
      role: item.role || 'system', enabled: Boolean(enabled), kind: 'text' };
    (listed ? rows : unlistedRows).push(row);
    if (item.marker) { row.kind = 'marker'; skipped++; return; }
    if (typeof item.content !== 'string' || !item.content.trim()) { row.kind = 'empty'; skipped++; return; }
    if (!['system', 'user', 'assistant'].includes(row.role)) { row.kind = 'unsupported'; skipped++; return; }
    const expansion = expandAssistantPresetMacros(item.content, context);
    total += expansion.content.length;
    if (entries.length >= MAX_ENTRIES || expansion.content.length > 64000 || total > 120000) {
      throw new Error('预设文字过长，请精简酒馆预设后重试（最多 128 条、12 万字符）');
    }
    entries.push({ id: item.identifier, name: String(item.name || item.identifier).slice(0, 500),
      role: item.role || 'system', content: expansion.content, enabled: Boolean(enabled),
      unresolved: expansion.unresolved });
  };
  if (kind === 'sysprompt') {
    add({ identifier: 'system', name: '系统提示词', role: 'system', content: preset.content }, preset.enabled !== false);
    if (preset.post_history?.trim()) add({ identifier: 'post-history', name: '后置提示词', role: 'system', content: preset.post_history }, preset.enabled !== false);
  } else {
    if (!Array.isArray(preset.prompts)) throw new Error('该预设没有可读取的提示词条目');
    const orders = Array.isArray(preset.prompt_order) ? preset.prompt_order : [];
    const order = orders.find((item) => String(item.character_id) === '100001')
      || orders.find((item) => String(item.character_id) === '100000')
      || orders.find((item) => String(item.character_id) === String(context.characterId))
      || (orders.length === 1 ? orders[0] : null);
    if (!Array.isArray(order?.order)) throw new Error('无法确定预设条目顺序，请在酒馆中保存预设后重试');
    const byId = new Map();
    for (const item of preset.prompts) {
      if (byId.has(item?.identifier)) throw new Error('预设存在重复条目标识，请在酒馆中检查预设');
      byId.set(item?.identifier, item);
    }
    const seen = new Set();
    for (const row of order.order) {
      if (seen.has(row.identifier)) throw new Error('预设顺序存在重复条目，请在酒馆中检查预设');
      seen.add(row.identifier);
      const item = byId.get(row.identifier);
      if (!item) continue;
      // Reuse the preset's enabled text even when its native trigger is normal chat.
      add(item, row.enabled === true);
    }
    for (const item of preset.prompts) if (!seen.has(item.identifier)) add(item, false, false);
    if (entries.some((entry) => {
      const original = byId.get(entry.id);
      return original.injection_position || original.injection_depth;
    })) warnings.push('深度注入条目按预设列表顺序放入助手前置消息，不模拟聊天楼层。');
  }
  if (!entries.length) throw new Error('该预设没有可用文字条目，请重新选择');
  if (skipped) warnings.push(`${skipped} 个占位、空白或不可发送条目保留原位，聊天与世界书由助手上下文单独提供。`);
  return { id: idFor(kind, name), name, kind: LABELS[kind], entries, rows, unlistedRows, warnings };
}

export function selectedAssistantPresetEntries(preset, settings) {
  if (!preset) return [];
  const options = normalizeAssistantPreset(settings);
  const selection = options.presetSelection;
  if (options.presetMode === 'current' || selection?.id !== preset.id) {
    return preset.entries.filter((entry) => entry.enabled);
  }
  const ids = new Set(selection.entries);
  if (selection.entries.some((id) => !preset.entries.some((entry) => entry.id === id))) {
    throw new Error('勾选的预设条目已被删除，请重新读取并选择条目');
  }
  return preset.entries.filter((entry) => ids.has(entry.id));
}

export function validateAssistantMessages(messages) {
  return Array.isArray(messages) && messages.length >= 2 && messages.length <= MAX_ENTRIES + 16
    && messages.every((item) => item && ['system', 'user', 'assistant'].includes(item.role)
      && typeof item.content === 'string' && item.content.length <= 150000)
    && messages.reduce((total, item) => total + item.content.length, 0) <= 250000;
}

export function composeAssistantPresetMessages(base, preset, settings) {
  const entries = selectedAssistantPresetEntries(preset, settings);
  const messages = [...entries.map(({ role, content }) => ({ role, content })), ...base];
  if (!validateAssistantMessages(messages)) throw new Error('提示词助手请求过长，请减少预设或上下文内容');
  return messages;
}
