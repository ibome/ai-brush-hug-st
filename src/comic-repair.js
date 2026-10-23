import { parseComicStoryboard } from './comic.js';

export function previewComicRepair(raw, project) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 100000) throw new Error('请先保留一份完整的分镜回复');
  const trimmed = raw.trim(), fence = trimmed.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  const source = fence ? fence[1] : trimmed;
  if (!source.startsWith('{') || !source.endsWith('}')) throw new Error('仅能修复完整分镜 JSON 中的字符串引号；回复缺失时请重新创建分镜');
  let validJSON = false;
  try { JSON.parse(source); validJSON = true; } catch { /* Repair only invalid JSON. */ }
  if (validJSON) throw new Error('回复已是有效 JSON，请直接重新解析并检查分镜字段');
  const changes = [];
  const repaired = source.split('\n').map((line, index) => {
    const match = line.match(/^(\s*"(title|scene|shot|positive|negative|caption|speaker|text|type)"\s*:\s*")([^\r\n]*)("\s*,?\s*\r?)$/);
    if (!match) return line;
    const content = match[3];
    // A line containing more than one property has ambiguous string boundaries.
    if (/"\s*,\s*"(?:[^"\\]|\\.)*"\s*:/.test(content)) return line;
    let value = '', slashes = 0, quotes = 0;
    for (const character of content) {
      if (character === '"' && slashes % 2 === 0) { value += '\\'; quotes++; }
      value += character;
      slashes = character === '\\' ? slashes + 1 : 0;
    }
    if (quotes) changes.push({ line: index + 1, field: match[2], quotes });
    return match[1] + value + match[4];
  }).join('\n');
  if (!changes.length) throw new Error('没有可确定修复的字符串引号；请手动检查失败回复');
  let candidate;
  try {
    JSON.parse(repaired);
    candidate = parseComicStoryboard(repaired, project);
  } catch {
    throw new Error('引号修复后仍未通过完整 JSON 或分镜字段检查，请手动检查失败回复');
  }
  return { source: repaired, changes, quotes: changes.reduce((sum, row) => sum + row.quotes, 0), panels: candidate.panels.length };
}
