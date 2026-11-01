export const validImageId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value)
  && !['__proto__', 'constructor', 'prototype', 'toString'].includes(value);

export function normalizeVersion(value, id) {
  return {
    groupId: validImageId(value?.groupId) ? value.groupId : id,
    parentId: validImageId(value?.parentId) && value.parentId !== id ? value.parentId : '',
    number: Number.isSafeInteger(value?.number) && value.number > 0 && value.number < 1000000 ? value.number : 1,
    note: typeof value?.note === 'string' ? value.note.trim().slice(0, 1000) : '',
  };
}

export const versionGroupId = (row) => normalizeVersion(row.version, row.id).groupId;
export const versionOrder = (a, b) => normalizeVersion(a.version, a.id).number - normalizeVersion(b.version, b.id).number
  || a.createdAt - b.createdAt || a.id.localeCompare(b.id);

export function groupVersions(rows, id) {
  const row = rows.find((item) => item.id === id);
  const group = row ? versionGroupId(row) : id;
  return rows.filter((item) => versionGroupId(item) === group).sort(versionOrder);
}

export function currentDrawing(rows, id) {
  const versions = groupVersions(rows, id);
  return versions.filter((row) => row.versionCurrent === true).at(-1) || versions.at(-1) || null;
}

export function drawingGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const id = versionGroupId(row);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  }
  return [...groups.values()].map((group) => {
    const current = currentDrawing(group, group[0].id);
    return { ...current, versionCount: group.length, groupFavorite: group.some((row) => row.favorite) };
  });
}

export function insertVersion(rows, row) {
  const clean = { ...row, version: normalizeVersion(row.version, row.id) };
  const parent = rows.find((item) => item.id === clean.version.parentId);
  if (parent && versionGroupId(parent) !== clean.version.groupId) throw new Error('来源图片与版本图组不一致');
  const group = rows.filter((item) => versionGroupId(item) === clean.version.groupId);
  if (clean.version.parentId && group.some((item) => normalizeVersion(item.version, item.id).number === clean.version.number)) {
    clean.version.number = Math.max(...group.map((item) => normalizeVersion(item.version, item.id).number)) + 1;
  }
  if (parent) clean.chatBinding = parent.chatBinding || null;
  clean.versionCurrent = row.versionCurrent !== false;
  return [...rows.map((item) => clean.versionCurrent && versionGroupId(item) === clean.version.groupId
    ? { ...item, versionCurrent: false } : item), clean];
}

export function selectVersion(rows, id) {
  const target = rows.find((row) => row.id === id);
  if (!target) throw new Error('图片已经删除，请刷新版本列表');
  const groupId = versionGroupId(target);
  return rows.map((row) => versionGroupId(row) === groupId ? { ...row, versionCurrent: row.id === id } : row);
}

export function removeVersions(rows, ids) {
  const deleted = new Set(ids);
  const next = rows.filter((row) => !deleted.has(row.id)).map((row) => ({ ...row }));
  for (const row of rows.filter((item) => deleted.has(item.id))) {
    const versions = groupVersions(next, versionGroupId(row));
    if (versions.length && !versions.some((item) => item.versionCurrent === true)) {
      versions.at(-1).versionCurrent = true;
    }
  }
  return next;
}

export function editRelation(row, note = '') {
  return { groupId: versionGroupId(row), parentId: row.id, number: normalizeVersion(row.version, row.id).number + 1,
    note: typeof note === 'string' ? note.slice(0, 1000) : '' };
}

export function protectedVersionGroups(rows) {
  return new Set(rows.filter((row) => row.favorite || row.chatBinding).map(versionGroupId));
}
