const fields = ['positive', 'negative', 'artist'];
const reference = /<([^<>:\r\n]{1,40}):([^<>:\r\n]{1,80})>/g;
export const GROUP_COLORS = ['default', 'blue', 'green', 'rose', 'gold'];

export function normalizeCardLayout(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(fields.flatMap((field) => {
    if (!Array.isArray(value[field])) return [];
    return [[field, value[field].slice(0, 100).filter((row) => row && Array.isArray(row.path)
      && row.path.length > 0 && row.path.length <= 8 && row.path.every((index) => Number.isInteger(index) && index >= 0 && index < 2000))
      .map((row) => ({ path: [...row.path], name: String(row.name || '').slice(0, 40),
        color: GROUP_COLORS.includes(row.color) ? row.color : 'default' }))]];
  }));
}

export function cardLayout(items, path = []) {
  return items.flatMap((item, index) => item.kind === 'group'
    ? [{ path: [...path, index], name: item.name, color: item.color || 'default' },
      ...cardLayout(item.children, [...path, index])] : []);
}

export function restoreCardLayout(items, rows = []) {
  const next = structuredClone(items);
  for (const row of rows) {
    let scope = next, item;
    for (const index of row.path) { item = scope?.[index]; scope = item?.children; }
    if (item?.kind === 'group') { item.name = row.name || '标签组'; item.color = row.color; }
  }
  return next;
}

export function cardReference(card) {
  if (/[<>:\r\n]/.test(card.category) || /[<>:\r\n]/.test(card.name)) throw new Error('引用名称或分类含保留字符，请先修改');
  if (/^(lora|lyco|hypernet|embedding)$/i.test(card.category.trim())) throw new Error('此分类名为模型语法保留名称，请换一个分类');
  return `<${card.category}:${card.name}>`;
}

export function resolveMaterialText(value, cards, field = 'positive', { limit = field === 'artist' ? 4000 : 12000 } = {}) {
  if (!fields.includes(field)) throw new Error('素材卡字段无效');
  let expansions = 0;
  const expand = (source, stack = []) => {
    if (stack.length > 8) throw new Error('素材卡引用最多嵌套 8 层');
    if (String(source).length > limit) throw new Error(`素材展开后超过 ${limit} 字符`);
    const result = String(source || '').replace(reference, (token, category, name) => {
      if (/^(lora|lyco|hypernet|embedding)$/i.test(category.trim())) return token;
      if (++expansions > 200) throw new Error('素材卡引用次数超过 200 次');
      const matches = cards.filter((row) => row.category === category.trim() && row.name === name.trim());
      if (matches.length !== 1) throw new Error(matches.length ? `素材引用重名：${token}` : `找不到素材卡：${token}`);
      const card = matches[0];
      if (stack.includes(card.id)) throw new Error(`素材卡循环引用：${[...stack, card.id].map((id) => cards.find((row) => row.id === id)?.name || id).join(' → ')}`);
      return expand(card[field] || '', [...stack, card.id]);
    });
    if (result.length > limit) throw new Error(`素材展开后超过 ${limit} 字符`);
    return result;
  };
  return expand(value);
}

export function resolveMaterialCard(card, cards) {
  return { ...card, ...Object.fromEntries(fields.map((field) => [field,
    resolveMaterialText(card[field], cards, field)])) };
}
