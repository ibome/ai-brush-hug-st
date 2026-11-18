export const FIELD_SCHEMES = Object.freeze([
  ['auto', '自动兼容（推荐）'], ['classic', '灵画师标准格式'],
  ['short', 'Scene / Char 短格式'], ['chinese', '中文格式'], ['custom', '自定义格式'],
]);
export const FIELD_TEMPLATES = Object.freeze({
  classic: { scene: 'Scene Composition:', positive: 'Character {n} Prompt:', negative: 'Character {n} UC:', globalNegative: 'Negative prompt:' },
  short: { scene: 'Scene:', positive: 'Char{n}:', negative: 'Char{n} UC:', globalNegative: 'Negative:' },
  chinese: { scene: '场景描述：', positive: '角色{n}正向提示词：', negative: '角色{n}负面：', globalNegative: '全局负面：' },
});
const keys = ['scene', 'positive', 'negative', 'globalNegative'];
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function normalizeFieldSettings(value = {}) {
  return { scheme: FIELD_SCHEMES.some(([id]) => id === value?.scheme) ? value.scheme : 'auto',
    custom: Object.fromEntries(keys.map((key) => [key, typeof value?.custom?.[key] === 'string'
      ? value.custom[key].slice(0, 160) : FIELD_TEMPLATES.classic[key]])) };
}

export function validateFieldSettings(value) {
  const settings = normalizeFieldSettings(value);
  if (settings.scheme !== 'custom') return settings;
  const seen = new Set();
  for (const key of keys) {
    const template = settings.custom[key].trim();
    if (!template || /[\r\n;]/.test(template) || template.length > 160 || !/[：:]$/.test(template)) throw new Error('字段头需为 1 至 160 字符，以冒号结尾，不能包含换行或分号');
    const numbered = ['positive', 'negative'].includes(key);
    if ((template.match(/\{n\}/g) || []).length !== (numbered ? 1 : 0)) throw new Error('人物正向和负面字段头需各包含一个 {n}，公共字段不能包含 {n}');
    if ((template.match(/\{coord\}/g) || []).length > (numbered ? 1 : 0)
      || /\{(?!n\}|coord\})[^}]*\}/.test(template)) throw new Error('字段头仅支持 {n} 和人物字段中的 {coord} 占位符');
    const identity = template.toLowerCase().replace(/\s/g, '').replace(/：/g, ':');
    if (seen.has(identity)) throw new Error('不同用途的字段头不能相同');
    seen.add(identity);
  }
  return settings;
}

function compileTemplate(template) {
  const captures = [];
  const pattern = template.trim().split(/(\{n\}|\{coord\}|\s+|[：:])/g).map((part) => {
    if (part === '{n}') { captures.push('number'); return '[ \\t]*(\\d{1,3})[ \\t]*'; }
    if (part === '{coord}') { captures.push('position'); return '([a-e][1-5]|auto|(?:top|bottom)(?:-left|-right)?|left|right|center)'; }
    if (/^\s+$/.test(part)) return '[ \\t]*';
    return /^[：:]$/.test(part) ? '[：:]' : escaped(part);
  }).join('');
  return { regex: new RegExp(`(?:^|[;\\r\\n])[ \\t]*${pattern}[ \\t]*`, 'giu'), captures };
}

export function multiCharacterFields(input, value) {
  const settings = validateFieldSettings(value);
  const schemes = settings.scheme === 'auto' ? ['classic', 'short', 'chinese'] : [settings.scheme];
  const definitions = schemes.flatMap((scheme) => Object.entries(scheme === 'custom' ? settings.custom : FIELD_TEMPLATES[scheme])
    .map(([key, template]) => ({ key: key === 'globalNegative' ? 'negative' : key, template })));
  // Metadata stays compatible across field schemes.
  for (const [field, english, chinese] of [
    ['name', 'Name', '名字'], ['profileId', 'ID', 'ID'], ['action', 'Action', '动作'],
    ['expression', 'Expression', '表情'], ['outfit', 'Outfit', '服装'], ['position', 'Position', '位置'],
  ]) {
    definitions.push({ key: field, template: `Character {n} ${english}:` },
      { key: field, template: `Char{n} ${english}:` }, { key: field, template: `角色{n}${chinese}：` });
  }
  if (['auto', 'chinese'].includes(settings.scheme)) {
    for (const scene of ['场景：', '场景构图：']) definitions.push({ key: 'scene', template: scene });
    for (const [key, title] of [['positive', '正向'], ['negative', '负面提示词'], ['name', '名称']]) {
      definitions.push({ key, template: `角色{n}${title}：` });
    }
    definitions.push({ key: 'negative', template: '全局负面提示词：' });
  }
  const matches = definitions.flatMap(({ key, template }) => {
    const { regex, captures } = compileTemplate(template);
    return [...input.matchAll(regex)].map((match) => ({ index: match.index, end: match.index + match[0].length, key,
      ...Object.fromEntries(captures.map((name, index) => [name, name === 'number' ? Number(match[index + 1]) : match[index + 1]])) }));
  }).sort((a, b) => a.index - b.index || b.end - a.end);
  return matches.filter((match, index) => !index || matches[index - 1].index !== match.index);
}
