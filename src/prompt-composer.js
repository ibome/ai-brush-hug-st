import { randomUUID } from './crypto-compat.js';
export const promptIdentity = (value) => String(value || '').trim().replace(/\\([()[\]{}])/g, '$1')
  .replace(/_/g, ' ').replace(/\s+/g, ' ').toLowerCase();

// Keep bracketed groups, escaped punctuation and NovelAI numeric emphasis intact.
export function splitPrompt(value) {
  const parts = [], warnings = [], stack = [];
  const source = String(value || '');
  let part = '', escaped = false, numericDepth = 0;
  const flush = () => { if (part.trim()) parts.push(part.trim()); part = ''; };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (escaped) { part += char; escaped = false; continue; }
    if (char === '\\') { part += char; escaped = true; continue; }
    if (char === ':' && source[index + 1] === ':') {
      const opening = /(?:^|[\s,{[(])([+-]?\d+(?:\.\d+)?)$/.exec(part);
      if (opening && Number(opening[1]) === 0) numericDepth = 0;
      else if (opening) numericDepth++;
      else if (numericDepth) numericDepth--;
      part += '::'; index++; continue;
    }
    if ('{[('.includes(char)) stack.push(char);
    if ('}])'.includes(char)) {
      if (stack.at(-1) === ({ '}': '{', ']': '[', ')': '(' })[char]) stack.pop();
      else warnings.push('存在未配对的括号，已保留原文');
    }
    if (',，\n\r'.includes(char) && !stack.length && !numericDepth) flush();
    else part += char;
  }
  flush();
  if (stack.length || numericDepth || escaped) warnings.push('存在未闭合的分组，已保留原文');
  return { parts, warnings: [...new Set(warnings)] };
}

function outerWrapper(raw) {
  const pairs = { '{': '}', '[': ']', '(': ')' };
  if (!pairs[raw[0]] || raw.at(-1) !== pairs[raw[0]]) return false;
  const stack = [];
  let escaped = false;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (pairs[char]) stack.push(char);
    else if ('}])'.includes(char)) {
      if (pairs[stack.pop()] !== char) return false;
      if (!stack.length && index !== raw.length - 1) return false;
    }
  }
  return !stack.length;
}

function unwrap(raw, depth, tags) {
  const numeric = /^([+-]?\d+(?:\.\d+)?)::([\s\S]+?)\s*::$/.exec(raw);
  const group = (body, format, extra) => {
    if (depth >= 8 || /(?:^|[^\\])[|]/.test(body) || splitPrompt(body).warnings.length) return null;
    const children = parseItems(body, tags, depth + 1);
    if (children.length < 2 && !children.some((row) => row.syntax !== 'plain')) return null;
    return { kind: 'group', en: body, syntax: format, children, ...extra };
  };
  if (numeric && Number(numeric[1]) !== 0) {
    const parsed = group(numeric[2].trim(), 'novelai', { weight: Number(numeric[1]), numeric: true });
    if (parsed) return parsed;
  }
  if (numeric && Number(numeric[1]) !== 0 && splitPrompt(numeric[2]).parts.length === 1 && !/[{}[\]]|::|(?:^|[^\\])[|]/.test(numeric[2])) {
    return { en: numeric[2].trim(), syntax: 'novelai', weight: Number(numeric[1]), numeric: true };
  }
  const sd = /^\(([\s\S]+):([+-]?\d+(?:\.\d+)?)\)$/.exec(raw);
  if (sd && outerWrapper(raw)) {
    const parsed = group(sd[1].trim(), 'sd', { weight: Number(sd[2]) });
    if (parsed) return parsed;
  }
  if (sd && outerWrapper(raw) && splitPrompt(sd[1]).parts.length === 1 && !/[{}[\]():]/.test(sd[1])) {
    return { en: sd[1].trim(), syntax: 'sd', weight: Number(sd[2]) };
  }
  for (const [open, close, direction] of [['{', '}', 1], ['[', ']', -1]]) {
    let en = raw, level = 0;
    while (en.startsWith(open) && en.endsWith(close) && outerWrapper(en)) { en = en.slice(1, -1).trim(); level += direction; }
    if (level) {
      const parsed = group(en, 'novelai', { level, weight: 1.05 ** level });
      if (parsed) return parsed;
    }
    if (level && !/[{}[\]]|::|(?:^|[^\\])[:|]/.test(en) && splitPrompt(en).parts.length === 1) {
      return { en, syntax: 'novelai', level, weight: 1.05 ** level };
    }
  }
  const plain = splitPrompt(raw);
  return { en: raw, syntax: /(?:^|[^\\])[{}[\]]|::|^\(.*\)$/.test(raw) || plain.warnings.length ? 'opaque' : 'plain', weight: 1 };
}

function parseItems(value, tags, depth = 0) {
  const lookup = new Map(tags.map((tag) => [promptIdentity(tag.en), tag]));
  return splitPrompt(value).parts.map((raw) => {
    const parsed = unwrap(raw, depth, tags), tag = lookup.get(promptIdentity(parsed.en));
    return { id: randomUUID(), raw, kind: parsed.syntax === 'opaque' ? 'opaque' : 'tag', ...parsed,
      tagId: parsed.kind === 'group' ? '' : tag?.id || '', name: parsed.kind === 'group' ? '标签组' : tag?.name || parsed.en };
  });
}

export function parsePrompt(value, tags = []) {
  const { warnings } = splitPrompt(value), items = parseItems(value, tags);
  const seen = new Set();
  if (items.some((item) => {
    const key = item.kind === 'group' || item.syntax === 'opaque' ? item.raw : promptIdentity(item.en);
    if (seen.has(key)) return true;
    seen.add(key); return false;
  })) warnings.push('存在重复标签，可使用去重操作');
  return { items, warnings };
}

export const serializePrompt = (items) => items.map((item) => item.raw).join(', ');
const itemKey = (item) => item.kind === 'group' || item.syntax === 'opaque' ? item.raw.toLowerCase() : promptIdentity(item.en);

export function appendPromptParts(before, addition) {
  const existing = parsePrompt(before).items;
  const seen = new Set([...existing.map(itemKey), ...promptLeaves(existing).map(itemKey)]);
  const fresh = parsePrompt(addition).items.filter((item) => {
    if (seen.has(itemKey(item))) return false;
    seen.add(itemKey(item)); return true;
  });
  if (!fresh.length) return String(before || '');
  const value = String(before || '');
  return `${value}${value.trim() ? /[,，\n]\s*$/.test(value) ? ' ' : ', ' : ''}${serializePrompt(fresh)}`;
}

export function deduplicatePrompt(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = itemKey(item);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function emphasisFormat(context) {
  if (context.provider === 'sdwebui') return 'sd';
  return context.provider === 'novelai' || context.provider === 'openai' && /nai-diffusion/i.test(context.params?.model)
    ? 'novelai' : 'plain';
}

export function adjustPromptWeight(item, direction, format) {
  if (!['novelai', 'sd'].includes(format)) throw new Error('当前格式不支持标签权重');
  if (item.syntax === 'opaque' || !['plain', format].includes(item.syntax)) throw new Error('该分组请在原文中编辑');
  const en = item.kind === 'group' ? serializePrompt(item.children) : item.en;
  if (format === 'novelai' && !item.numeric) {
    const level = Math.max(-20, Math.min(20, (item.level || 0) + Math.sign(direction)));
    if (item.kind === 'group' && level === 0) {
      return { ...item, syntax: item.numericAllowed === false ? 'plain' : 'novelai', level: 0, weight: 1,
        numeric: item.numericAllowed !== false, raw: item.numericAllowed === false ? en : `1::${en}::` };
    }
    return { ...item, syntax: level ? 'novelai' : 'plain', level, weight: 1.05 ** level,
      raw: level > 0 ? `${'{'.repeat(level)}${en}${'}'.repeat(level)}`
        : level < 0 ? `${'['.repeat(-level)}${en}${']'.repeat(-level)}` : en };
  }
  let weight = Math.max(format === 'sd' ? 0 : -10, Math.min(10, Math.round((item.weight + Math.sign(direction) * .1) * 100) / 100));
  if (format === 'novelai' && weight === 0) weight = Math.sign(direction) * .1;
  return { ...item, syntax: format, weight, raw: format === 'sd' ? `(${en}:${weight})` : `${weight}::${en}::` };
}

export function promptLeaves(items) {
  return items.flatMap((item) => item.kind === 'group' ? promptLeaves(item.children) : [item]);
}

export function findPromptItem(items, id) {
  for (let index = 0; index < items.length; index++) {
    if (items[index].id === id) return { item: items[index], siblings: items, index };
    if (items[index].kind === 'group') {
      const found = findPromptItem(items[index].children, id);
      if (found) return found;
    }
  }
  return null;
}

export function rebuildPromptGroup(group, children) {
  const body = serializePrompt(children);
  let raw;
  if (group.syntax === 'sd') raw = `(${body}:${group.weight})`;
  else if (group.numeric) raw = `${group.weight}::${body}::`;
  else if (group.level > 0) raw = `${'{'.repeat(group.level)}${body}${'}'.repeat(group.level)}`;
  else if (group.level < 0) raw = `${'['.repeat(-group.level)}${body}${']'.repeat(-group.level)}`;
  else raw = body;
  return { ...group, children, en: body, raw };
}

export function updatePromptItem(items, id, transform) {
  return items.flatMap((item) => {
    if (item.id === id) return transform(item);
    if (item.kind !== 'group' || !findPromptItem(item.children, id)) return [item];
    const children = updatePromptItem(item.children, id, transform);
    return children.length ? [rebuildPromptGroup(item, children)] : [];
  });
}

export function movePromptItem(items, id, direction) {
  const next = structuredClone(items), found = findPromptItem(next, id);
  if (!found) throw new Error('标签已改变，请重新选择');
  const to = Math.max(0, Math.min(found.siblings.length - 1, found.index + Math.sign(direction)));
  found.siblings.splice(to, 0, found.siblings.splice(found.index, 1)[0]);
  return updatePromptItem(next, id, (item) => [item]);
}

export function numericPromptGroups(context) {
  return /nai-diffusion-(?:[4-9]|[1-9]\d)/i.test(context.params?.model || '');
}

export function groupPromptItems(items, ids, format, { numeric = true } = {}) {
  if (!['novelai', 'sd'].includes(format)) throw new Error('当前文本格式不支持带权标签组');
  const selected = items.filter((item) => ids.includes(item.id));
  if (selected.length < 2) throw new Error('请至少勾选两个同栏标签');
  const depth = (item) => item.kind === 'group' ? 1 + Math.max(...item.children.map(depth)) : 0;
  if (selected.some((item) => depth(item) >= 8)) throw new Error('标签组最多嵌套 8 层');
  const body = serializePrompt(selected), first = items.findIndex((item) => ids.includes(item.id));
  const group = { id: randomUUID(), kind: 'group', syntax: format, tagId: '', name: '标签组',
    children: structuredClone(selected), en: body, weight: format === 'novelai' && !numeric ? 1.05 : 1,
    ...(format === 'novelai' ? numeric ? { numeric: true } : { level: 1, numericAllowed: false } : {}),
    raw: format === 'novelai' ? numeric ? `1::${body}::` : `{${body}}` : `(${body}:1)` };
  return items.flatMap((item, index) => index === first ? [group] : ids.includes(item.id) ? [] : [item]);
}

export function ungroupPromptItem(group, tags = []) {
  if (group.kind !== 'group') throw new Error('当前条目不是标签组');
  return group.children.map((child) => {
    const raw = rebuildPromptGroup(group, [child]).raw;
    return { ...parsePrompt(raw, tags).items[0], id: child.id, name: child.name };
  });
}

export function moveBetweenPrompts(from, to, id, tags = []) {
  const found = findPromptItem(from, id);
  if (!found) throw new Error('标签已改变，请重新选择');
  const scope = (items) => {
    for (const item of items) {
      if (item.id === id) return item.raw;
      if (item.kind === 'group' && findPromptItem(item.children, id)) {
        return rebuildPromptGroup(item, [{ raw: scope(item.children) }]).raw;
      }
    }
  };
  const carried = scope(from);
  const destinationKeys = new Set(promptLeaves(to).map(itemKey));
  if (promptLeaves(parsePrompt(carried, tags).items).some((item) => destinationKeys.has(itemKey(item)))) {
    throw new Error('另一栏已包含该标签或标签组');
  }
  const nextTo = appendPromptParts(serializePrompt(to), carried);
  if (nextTo === serializePrompt(to)) throw new Error('另一栏已包含该标签或标签组');
  return { from: updatePromptItem(from, id, () => []), to: [...to, ...parsePrompt(carried, tags).items] };
}
