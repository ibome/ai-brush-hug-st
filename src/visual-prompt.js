import { applyCharacterScene, nativeCharacterPrompts } from './character-profiles.js';
import { parsePrompt, serializePrompt, findPromptItem, updatePromptItem, rebuildPromptGroup, groupPromptItems } from './prompt-composer.js';

export function selectedPromptItems(items, ids) {
  const chosen = new Set(ids);
  return items.flatMap((item) => chosen.has(item.id) ? [item]
    : item.kind === 'group' ? selectedPromptItems(item.children, chosen) : []);
}

export function copyPromptSelection(items, ids) {
  const chosen = new Set(selectedPromptItems(items, ids).map((item) => item.id));
  const visit = (rows) => rows.flatMap((item) => chosen.has(item.id) ? [item]
    : item.kind === 'group' ? visit(item.children).map((child) => rebuildPromptGroup(item, [child])) : []);
  return structuredClone(visit(items));
}

export const copyPromptItems = (items, ids) => serializePrompt(copyPromptSelection(items, ids));

export function preserveGroupLabels(previous, next) {
  const groups = new Map();
  const collect = (items) => { for (const item of items) if (item.kind === 'group') {
    const matches = groups.get(item.raw) || [];
    matches.push({ name: item.name, color: item.color }); groups.set(item.raw, matches); collect(item.children);
  } };
  collect(previous);
  const visit = (items) => items.map((item) => item.kind === 'group'
    ? { ...item, ...groups.get(item.raw)?.shift(), children: visit(item.children) } : item);
  return visit(next);
}

export function removePromptItems(items, ids) {
  let result = structuredClone(items);
  for (const item of selectedPromptItems(items, ids)) result = updatePromptItem(result, item.id, () => []);
  return result;
}

export function groupPromptSelection(items, ids, format, options) {
  const selected = selectedPromptItems(items, ids);
  const found = selected.map((item) => findPromptItem(items, item.id));
  if (found.length < 2 || found.some((row) => row.siblings !== found[0].siblings)) throw new Error('请选择同一层级的两个或更多标签');
  const parents = ancestors(items, selected[0].id);
  const depth = (item) => item.kind === 'group' ? 1 + Math.max(0, ...item.children.map(depth)) : 0;
  if (parents.length + 1 + Math.max(...selected.map(depth)) > 8) throw new Error('标签组最多嵌套 8 层');
  const siblings = groupPromptItems(found[0].siblings, selected.map((item) => item.id), format, options);
  if (found[0].siblings === items) return siblings;
  const parent = ancestors(items, selected[0].id).at(-1);
  return updatePromptItem(items, parent.id, (item) => [rebuildPromptGroup(item, siblings)]);
}

function ancestors(items, id, parents = []) {
  for (const item of items) {
    if (item.id === id) return parents;
    if (item.kind === 'group') {
      const found = ancestors(item.children, id, [...parents, item]);
      if (found) return found;
    }
  }
  return null;
}

export function movePromptTo(items, id, { parentId = '', beforeId = '' } = {}, tags = []) {
  const source = findPromptItem(items, id);
  if (!source) throw new Error('标签已改变，请重新选择');
  if (id === beforeId) return structuredClone(items);
  const parent = parentId ? findPromptItem(items, parentId)?.item : null;
  if (parentId && parent?.kind !== 'group') throw new Error('目标标签组已改变');
  if (parentId === id || source.item.kind === 'group' && parentId && findPromptItem(source.item.children, parentId)) {
    throw new Error('不能把标签组移到自身或子组中');
  }
  const fromParents = ancestors(items, id), toParents = parent ? [...ancestors(items, parentId), parent] : [];
  const depth = (item) => item.kind === 'group' ? 1 + Math.max(0, ...item.children.map(depth)) : 0;
  let common = 0;
  while (fromParents[common] && fromParents[common].id === toParents[common]?.id) common++;
  let carried = structuredClone(source.item);
  for (const wrapper of fromParents.slice(common).reverse()) {
    if (wrapper.weight === 1) continue;
    const parsed = parsePrompt(rebuildPromptGroup(wrapper, [carried]).raw, tags).items[0];
    carried = { ...parsed, id, name: source.item.name, ...(source.item.color ? { color: source.item.color } : {}) };
  }
  if (toParents.length + depth(carried) > 8) throw new Error('标签组最多嵌套 8 层');
  const remove = (rows) => rows.flatMap((item) => {
    if (item.id === id) return [];
    if (item.kind !== 'group') return [item];
    const children = remove(item.children);
    return children.length || item.id === parentId ? [rebuildPromptGroup(item, children)] : [];
  });
  let next = remove(structuredClone(items));
  const insert = (rows) => {
    const index = beforeId ? rows.findIndex((item) => item.id === beforeId) : rows.length;
    if (index < 0) throw new Error('插入位置已改变');
    return [...rows.slice(0, index), carried, ...rows.slice(index)];
  };
  if (parentId) next = updatePromptItem(next, parentId, (group) => [rebuildPromptGroup(group, insert(group.children))]);
  else next = insert(next);
  if (!findPromptItem(next, id)) throw new Error('目标标签组已改变');
  return next;
}

export function setPromptWeight(item, value, format, { numeric = true } = {}) {
  const weight = Number(value);
  if (!Number.isFinite(weight) || weight < (format === 'sd' ? 0 : -10) || weight > 10
    || format === 'novelai' && weight === 0) throw new Error('权重需在支持范围内，NovelAI 不可设为 0');
  if (!['novelai', 'sd'].includes(format) || item.syntax === 'opaque' || !['plain', format].includes(item.syntax)) {
    throw new Error('当前条目或模型不支持数值权重');
  }
  if (format === 'novelai' && !numeric) throw new Error('此 NovelAI 模型请使用增强和减弱按钮');
  const rounded = Math.round(weight * 100) / 100;
  if (format === 'novelai' && rounded === 0) throw new Error('NovelAI 权重不可设为 0');
  const body = item.kind === 'group' ? serializePrompt(item.children) : item.en;
  return { ...item, syntax: format, weight: rounded, level: 0, numeric: format === 'novelai',
    raw: format === 'novelai' ? `${rounded}::${body}::` : `(${body}:${rounded})` };
}

export function visualPromptPreview(snapshot, edits = {}) {
  let next = structuredClone(snapshot);
  const params = next.params || next.config.params;
  for (const key of ['positive', 'negative', 'artist']) if (Object.hasOwn(edits, key)) params[key] = edits[key];
  if (next.characterScene?.applied) {
    next.characterScene.basePositive = params.positive || '';
    next.characterScene.baseNegative = params.negative || '';
  }
  next = applyCharacterScene(next, next.characterScene);
  const value = next.params || next.config.params, blocks = [];
  const add = (title, text) => { if (text) blocks.push({ title, text: String(text) }); };
  const novel = next.provider === 'novelai', compatibleNovel = /nai-diffusion/i.test(value.model || '');
  add('主提示词', [value.artist?.trim(), value.positive?.trim()].filter(Boolean).join(novel ? ', ' : '\n'));
  if (novel || compatibleNovel || next.provider === 'sdwebui' || next.provider === 'comfyui' && next.config.mapping?.negative) add('负面提示词', value.negative);
  if (next.provider === 'openai' && !compatibleNovel && value.advanced?.mode && value.advanced.mode !== 'text' && value.negative?.trim()) {
    if (blocks.length) blocks[0].text += `\nAvoid: ${value.negative.trim()}`;
  }
  if (nativeCharacterPrompts(next.provider, value.model)) {
    for (const role of next.characterScene?.characterPrompts || []) {
      add(`${role.name} · 角色正向`, role.positive);
      add(`${role.name} · 角色负面`, role.negative);
    }
  }
  if (next.provider === 'comfyui' && next.config.mapping?.characterPrompts) add('角色节点', value.characterPrompts);
  return blocks;
}
