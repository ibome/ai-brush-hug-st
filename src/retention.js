import { protectedVersionGroups, versionGroupId } from '../server/linghuashi-storage/image-versions.mjs';

export function cleanupPlan(rows, settings, lastCleanup, now = Date.now()) {
  if (settings.cacheLocation !== 'browser' || settings.cleanupMode === 'manual') return { ids: [], due: false };
  const elapsed = now - lastCleanup;
  const period = settings.cleanupInterval * (settings.cleanupUnit === 'hours' ? 3600000 : 86400000);
  const due = settings.cleanupMode === 'time' ? elapsed >= period : rows.length >= settings.cleanupMaxImages;
  if (!due) return { ids: [], due: false };
  const cutoff = now - settings.cleanupOlderThanDays * 86400000;
  const protectedGroups = protectedVersionGroups(rows);
  return {
    due: true,
    ids: rows.filter((row) => !protectedGroups.has(versionGroupId(row)) && (settings.cleanupMode === 'time' || row.createdAt < cutoff))
      .map((row) => row.id),
  };
}
