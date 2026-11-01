export function changedVersionRows(previous, next) {
  const stored = new Map(previous.map((row) => [row.id, row]));
  return next.filter((row) => !stored.has(row.id) || stored.get(row.id).versionCurrent !== row.versionCurrent);
}
