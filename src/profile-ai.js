import { randomUUID } from './crypto-compat.js';
import { renderTaskRules } from './assistant-rules.js';
import { normalizeProfile, normalizeProfileLibrary, saveProfile } from './character-profiles.js';

export const PROFILE_AI_FIELDS = Object.freeze({
  name: ['档案名称', 120], hair: ['头发', 800], eyes: ['眼睛', 800],
  body: ['体型', 800], features: ['辨识特征', 1600], tags: ['固定外貌标签', 4000],
  negative: ['角色负面标签', 2000],
});
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const string = (value, limit, label) => {
  if (typeof value !== 'string' || value.length > limit) throw new Error(`${label}格式无效或过长`);
  return value.trim();
};
export const profileFingerprint = (profile) => JSON.stringify(normalizeProfile(profile));

export function manualProfileSource(name, description) {
  const title = string(name, 120, '角色名称'), content = string(description, 16000, '角色设定');
  if (!title || !content) throw new Error('请填写角色名称和角色设定');
  return { id: 'manual-0', name: title, avatar: '', description: content };
}

export function buildProfileMessages(sources, settings = {}) {
  if (!Array.isArray(sources) || !sources.length || sources.length > 6) throw new Error('每次请选择 1 至 6 个角色');
  const ids = new Set();
  const material = sources.map((source) => {
    if (!object(source) || !/^(card|manual)-\d+$/.test(source.id) || ids.has(source.id)) throw new Error('角色来源无效');
    ids.add(source.id);
    return { sourceId: source.id, name: string(source.name, 120, '角色名称'),
      description: string(source.description, 16000, '角色设定'),
      personality: string(source.personality || '', 4000, '角色性格'),
      scenario: string(source.scenario || '', 4000, '角色背景') };
  });
  if (JSON.stringify(material).length > 65000) throw new Error('角色资料过长，请减少一次选择的角色数量');
  return [{ role: 'system', content: renderTaskRules('profile', settings) },
    { role: 'user', content: JSON.stringify({ CHARACTERS: material }) }];
}

export function parseProfileResult(raw, sources, uuid = () => randomUUID()) {
  buildProfileMessages(sources);
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 100000) throw new Error('文字模型没有返回有效角色草稿');
  let result;
  try { result = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw new Error('角色草稿不是完整 JSON，请检查文字模型或增加最大输出 Token 后重试'); }
  if (!object(result) || !Array.isArray(result.profiles) || result.profiles.length !== sources.length) {
    throw new Error('返回的角色数量不完整，请减少一次选择的角色或增加最大输出 Token');
  }
  const byId = new Map();
  for (const row of result.profiles) {
    if (!object(row) || !sources.some((source) => source.id === row.sourceId) || byId.has(row.sourceId)) {
      throw new Error('模型返回了重复或未知的角色来源');
    }
    const fields = {};
    for (const key of Object.keys(PROFILE_AI_FIELDS).filter((key) => key !== 'name')) {
      fields[key] = string(row[key], PROFILE_AI_FIELDS[key][1], PROFILE_AI_FIELDS[key][0]);
    }
    if (!Array.isArray(row.outfits) || row.outfits.length > 10 || !Array.isArray(row.notes) || row.notes.length > 12) {
      throw new Error('角色服装或核对信息格式无效');
    }
    const names = new Set();
    const outfits = row.outfits.map((outfit) => {
      if (!object(outfit)) throw new Error('服装格式无效');
      const name = string(outfit.name, 80, '服装名称'), prompt = string(outfit.prompt, 4000, '服装提示词');
      if (!name || !prompt || names.has(name.toLocaleLowerCase())) throw new Error('服装名称重复或服装内容为空');
      names.add(name.toLocaleLowerCase());
      return { id: uuid(), name, prompt };
    });
    byId.set(row.sourceId, { fields, outfits, notes: row.notes.map((note) => string(note, 300, '核对信息')) });
  }
  return sources.map((source) => {
    const row = byId.get(source.id);
    const draft = normalizeProfile({ id: uuid(), name: source.name, avatar: source.avatar, ...row.fields, outfits: row.outfits });
    if (!draft) throw new Error('角色草稿无效');
    return { source: structuredClone(source), draft, notes: row.notes, included: true, mode: 'new', targetId: '', selected: Object.keys(PROFILE_AI_FIELDS).concat('outfits') };
  });
}

function mergeOutfits(existing, incoming, mode) {
  const result = structuredClone(existing);
  for (const outfit of incoming) {
    const matches = result.filter((row) => row.name.toLocaleLowerCase() === outfit.name.toLocaleLowerCase());
    if (matches.length > 1) throw new Error('已有服装存在重名，请先调整服装名称再合并');
    if (!matches.length) result.push(structuredClone(outfit));
    else if (mode === 'update' || !matches[0].prompt.trim()) matches[0].prompt = outfit.prompt;
  }
  if (result.length > 20) throw new Error('合并后超过 20 套服装，请减少草稿服装');
  return result;
}

export function profileProposal(row, profiles) {
  if (!['new', 'fill', 'update'].includes(row.mode)) throw new Error('请选择有效的保存方式');
  if (!row.draft?.name?.trim()) throw new Error('档案名称不能为空');
  for (const [key, [label, limit]] of Object.entries(PROFILE_AI_FIELDS)) string(row.draft[key], limit, label);
  if (!Array.isArray(row.draft.outfits) || row.draft.outfits.length > 20
    || row.draft.outfits.some((outfit) => !outfit.name?.trim() || !outfit.prompt?.trim())) throw new Error('请补全服装名称和提示词，或删除空服装');
  const outfitNames = new Set();
  for (const outfit of row.draft.outfits) {
    const name = string(outfit.name, 80, '服装名称').toLocaleLowerCase();
    string(outfit.prompt, 4000, '服装提示词');
    if (outfitNames.has(name)) throw new Error('草稿中存在重名服装，请修改名称');
    outfitNames.add(name);
  }
  const draft = normalizeProfile(row.draft);
  if (!draft) throw new Error('角色草稿无效');
  if (row.mode === 'new') {
    if (profiles.some((profile) => profile.id === draft.id)) throw new Error('新建档案标识已存在，请重新生成草稿');
    return { profile: draft, changes: Object.entries(PROFILE_AI_FIELDS).filter(([key]) => draft[key])
      .map(([key, [label]]) => ({ key, label, before: '', after: draft[key] }))
      .concat(draft.outfits.length ? [{ key: 'outfits', label: '服装方案', before: '', after: outfitText(draft.outfits) }] : []) };
  }
  const target = profiles.find((profile) => profile.id === row.targetId);
  if (!target) throw new Error('请选择要补全或更新的已有档案');
  if (row.source.avatar && target.avatar !== row.source.avatar) throw new Error('目标档案关联的角色卡与来源不一致');
  const next = structuredClone(target), changes = [], selected = new Set(row.selected);
  for (const [key, [label]] of Object.entries(PROFILE_AI_FIELDS)) {
    if (!draft[key] || row.mode === 'fill' && target[key]) continue;
    if (draft[key] !== target[key]) {
      changes.push({ key, label, before: target[key], after: draft[key] });
      if (selected.has(key)) next[key] = draft[key];
    }
  }
  const outfits = mergeOutfits(target.outfits, draft.outfits, row.mode);
  if (outfitText(outfits) !== outfitText(target.outfits)) {
    changes.push({ key: 'outfits', label: '服装方案', before: outfitText(target.outfits), after: outfitText(outfits) });
    if (selected.has('outfits')) {
      next.outfits = outfits;
      // An explicit "no outfit" remains intentional on an existing profile.
      next.defaultOutfitId = target.defaultOutfitId;
    }
  }
  return { profile: normalizeProfile(next), changes };
}
const outfitText = (outfits) => outfits.map((row) => `${row.name}: ${row.prompt}`).join('\n');

export function applyProfileDrafts(library, rows, baseline) {
  const selected = rows.filter((row) => row.included);
  if (!selected.length) throw new Error('请至少勾选一个草稿');
  const db = normalizeProfileLibrary(library), targets = new Set();
  // Validate every target before constructing a new library; no partial batch writes.
  const proposals = selected.map((row) => {
    if (row.mode !== 'new') {
      if (targets.has(row.targetId)) throw new Error('多个草稿不能同时写入同一个档案');
      targets.add(row.targetId);
      const before = baseline.find((profile) => profile.id === row.targetId);
      const current = db.profiles.find((profile) => profile.id === row.targetId);
      if (!before || !current || profileFingerprint(before) !== profileFingerprint(current)) {
        throw new Error('已有档案已变化，请重新生成草稿后再合并');
      }
    }
    return profileProposal(row, db.profiles);
  });
  let next = db;
  for (const proposal of proposals) next = saveProfile(next, proposal.profile);
  return { library: next, profiles: proposals.map((proposal) => proposal.profile) };
}
