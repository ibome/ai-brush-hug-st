export const ASSISTANT_OPERATIONS = [
  ['generate', '生成提示词'], ['translate', '翻译'], ['polish', '润色'],
  ['illustrate', '聊天配图'], ['profile', '创建角色档'], ['edit', '单图编辑'], ['comic', '漫画分镜'],
];
export const DEFAULT_TASK_MESSAGES = Object.freeze([
  Object.freeze({ role: 'system', content: '{{rules}}' }),
  Object.freeze({ role: 'user', content: '{{input}}' }),
]);
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' ? value.slice(0, max).trim() : '';
export const TASK_TEMPLATE_FILE_LIMIT = 400000;

export function validateTaskMessages(rows) {
  const errors = [];
  if (!Array.isArray(rows) || !rows.length || rows.length > 16) return ['每个任务需要 1 至 16 条消息'];
  if (rows.some((row) => !object(row) || !['system', 'user', 'assistant'].includes(row.role)
    || typeof row.content !== 'string' || row.content.length > 8000)) return ['消息类型无效或单条内容超过 8000 字符'];
  for (const [token, role] of [['rules', 'system'], ['input', 'user']]) {
    const matches = rows.flatMap((row) => [...row.content.matchAll(/\{\{(rules|input)\}\}/g)]
      .filter((match) => match[1] === token).map(() => row));
    if (matches.length !== 1 || matches[0].role !== role) errors.push(`任务消息需保留一处 ${role} 类型的 {{${token}}}`);
  }
  return errors;
}

export function importTaskTemplates(value) {
  if (!object(value) || value.format !== 'linghuashi-task-messages' || value.version !== 1
    || Object.keys(value).some((key) => !['format', 'version', 'tasks'].includes(key)) || !object(value.tasks)) {
    throw new Error('不是受支持的任务消息模板文件');
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > TASK_TEMPLATE_FILE_LIMIT) throw new Error('模板文件超过 400 KB');
  const keys = Object.keys(value.tasks), known = ASSISTANT_OPERATIONS.map(([key]) => key);
  if (!keys.length || keys.some((key) => !known.includes(key))) throw new Error('模板包含未知或空的任务类型');
  let total = 0;
  const result = {};
  for (const key of keys) {
    const rows = value.tasks[key], errors = validateTaskMessages(rows);
    if (errors.length) throw new Error(`${ASSISTANT_OPERATIONS.find(([id]) => id === key)[1]}：${errors[0]}`);
    if (rows.some((row) => Object.keys(row).some((field) => !['role', 'content'].includes(field)))) {
      throw new Error('任务消息包含不支持的字段');
    }
    total += rows.reduce((sum, row) => sum + row.content.length, 0);
    if (total > 96000) throw new Error('任务消息总内容超过 96000 字符');
    result[key] = rows.map(({ role, content }) => ({ role, content }));
  }
  return result;
}

export function exportTaskTemplates(tasks) {
  const value = { format: 'linghuashi-task-messages', version: 1,
    tasks: Object.fromEntries(ASSISTANT_OPERATIONS.map(([key]) => [key, tasks?.[key] || DEFAULT_TASK_MESSAGES])) };
  return { ...value, tasks: importTaskTemplates(value) };
}

export function normalizeTaskMessages(value) {
  if (!object(value)) return {};
  const result = {};
  let total = 0;
  for (const [operation] of ASSISTANT_OPERATIONS) {
    const rows = value[operation];
    if (!Array.isArray(rows) || !rows.length || rows.length > 16) continue;
    const clean = rows.filter((row) => object(row) && ['system', 'user', 'assistant'].includes(row.role)
      && typeof row.content === 'string' && row.content.length <= 8000)
      .map(({ role, content }) => ({ role, content }));
    total += clean.reduce((sum, row) => sum + row.content.length, 0);
    if (clean.length === rows.length && total <= 96000) result[operation] = clean;
  }
  return result;
}

export function composeTaskMessages(base, operation, settings) {
  const rows = settings?.taskMessages?.[operation];
  if (!rows) return base;
  const errors = validateTaskMessages(rows);
  if (errors.length) throw new Error(errors[0]);
  const rules = base.filter((row) => row.role === 'system').map((row) => row.content).join('\n');
  const input = base.filter((row) => row.role === 'user').map((row) => row.content).join('\n');
  return rows.map((row) => ({
    role: row.role,
    content: row.content.replace(/\{\{(rules|input)\}\}/g, (_match, token) => token === 'rules' ? rules : input),
  }));
}

export function normalizeCharacterStates(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).slice(0, 6).flatMap((row) => {
    if (!object(row)) return [];
    const profileId = /^[A-Za-z0-9_-]{1,80}$/.test(row.profileId || '') ? row.profileId : '';
    const name = text(row.name, 120), key = profileId || name;
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [{ profileId, name, ...Object.fromEntries([
      ['appearance', 4000], ['outfit', 4000], ['action', 1000], ['expression', 500], ['evidence', 500],
    ].map(([field, max]) => [field, text(row[field], max)])) }];
  });
}

const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim();
export function evidencedCharacterStates(values, target, scene, characters = []) {
  const source = compact(target);
  return normalizeCharacterStates(values).filter((row) => {
    if (!row.evidence || !source.includes(compact(row.evidence))) return false;
    return row.profileId ? scene?.entries?.some((entry) => entry.profileId === row.profileId)
      : characters.some((character) => character.name === row.name);
  });
}

export function mergeCharacterStates(previous, next) {
  const rows = new Map(normalizeCharacterStates(previous).map((row) => [row.profileId || row.name, row]));
  for (const row of normalizeCharacterStates(next)) {
    const key = row.profileId || row.name;
    const old = rows.get(key) || {};
    rows.set(key, { ...old, ...Object.fromEntries(Object.entries(row).filter(([, value]) => value !== '')) });
  }
  return [...rows.values()].slice(-6);
}

export function illustrationPlans(plan) {
  return plan?.illustrations?.length ? plan.illustrations : plan ? [plan] : [];
}

export function selectedIllustration(plan, index = 0) {
  const shot = illustrationPlans(plan)[index];
  if (!shot) throw new Error('配图画面已变化，请重新分析');
  const { illustrations, ...single } = structuredClone(shot);
  return { ...single, ...(plan.characterScene ? { characterScene: structuredClone(plan.characterScene) } : {}) };
}

export function freezeIllustrationCharacters(plan, scene, previous = []) {
  const states = normalizeCharacterStates(previous);
  for (const shot of illustrationPlans(plan)) {
    if (!scene?.entries?.length) { delete shot.characterScene; delete shot.characters; continue; }
    shot.characters = scene.entries.map((entry) => {
      const state = states.find((row) => row.profileId === entry.profileId);
      const direction = shot.characters?.find((row) => row.profileId === entry.profileId);
      const profile = entry.profile;
      return {
        profileId: entry.profileId,
        action: entry.action || direction?.action || state?.action || '',
        expression: entry.expression || direction?.expression || state?.expression || '',
        appearance: profile.lockAppearance ? '' : direction?.appearance || state?.appearance || '',
        outfit: profile.lockOutfit ? '' : direction?.outfit || state?.outfit || '',
        negative: direction?.negative || '',
      };
    });
  }
  if (scene?.entries?.length) {
    plan.characterScene = structuredClone(scene);
    plan.characters = structuredClone(illustrationPlans(plan)[0].characters);
  } else { delete plan.characterScene; delete plan.characters; }
  return plan;
}

export function syncPrimaryIllustration(plan) {
  if (plan?.illustrations?.length) {
    for (const field of ['scene', 'positive', 'negative', 'anchor', 'aspect', 'characters']) {
      if (plan.illustrations[0][field] !== undefined) plan[field] = structuredClone(plan.illustrations[0][field]);
      else delete plan[field];
    }
  }
  return plan;
}

export function validateIllustrationAnchors(plan, target) {
  const source = compact(target), seen = new Set();
  for (const shot of illustrationPlans(plan)) {
    const anchor = compact(shot.anchor);
    if (!anchor) continue;
    const start = source.indexOf(anchor);
    if (anchor.length < 2 || start < 0 || source.indexOf(anchor, start + 1) >= 0 || seen.has(anchor)) {
      delete shot.anchor;
    } else seen.add(anchor);
  }
  return syncPrimaryIllustration(plan);
}
