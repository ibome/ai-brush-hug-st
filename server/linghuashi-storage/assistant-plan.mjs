const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);

export function storedAssistantPlan(value, cleanScene) {
  if (!object(value) || JSON.stringify(value).length > 500000) throw new Error('配图草稿无效或过长');
  const single = (row) => ({
    shouldDraw: row.shouldDraw === true, scene: text(row.scene, 2000), reason: text(row.reason, 500),
    positive: text(row.positive, 32000), negative: text(row.negative, 32000),
    aspect: ['portrait', 'landscape', 'square'].includes(row.aspect) ? row.aspect : 'square',
    ...(row.anchor ? { anchor: text(row.anchor, 1000) } : {}),
    ...(Array.isArray(row.characters) ? { characters: row.characters.slice(0, 6).filter((entry) =>
      object(entry) && /^[A-Za-z0-9_-]{1,80}$/.test(entry.profileId)).map((entry) => ({
        profileId: entry.profileId, action: text(entry.action, 1000), expression: text(entry.expression, 500),
        appearance: text(entry.appearance, 4000), outfit: text(entry.outfit, 4000), negative: text(entry.negative, 1000),
      })) } : {}),
  });
  const plan = single(value);
  if (value.illustrations !== undefined) {
    if (!Array.isArray(value.illustrations) || value.illustrations.length > 4
      || !value.illustrations.every(object)) throw new Error('配图画面列表无效');
    plan.illustrations = value.illustrations.map((row) => single({ ...row, shouldDraw: value.shouldDraw }));
  }
  if (value.characterScene && cleanScene) plan.characterScene = cleanScene(value.characterScene);
  return plan;
}
