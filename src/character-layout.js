export const POSITION_OPTIONS = [
  ['auto', '自动'], ['left', '左侧'], ['center', '中央'], ['right', '右侧'],
  ['top-left', '左上'], ['top', '上方'], ['top-right', '右上'],
  ['bottom-left', '左下'], ['bottom', '下方'], ['bottom-right', '右下'],
];
const positions = {
  auto: [0.5, 0.5], left: [0.2, 0.5], center: [0.5, 0.5], right: [0.8, 0.5],
  'top-left': [0.2, 0.2], top: [0.5, 0.2], 'top-right': [0.8, 0.2],
  'bottom-left': [0.2, 0.8], bottom: [0.5, 0.8], 'bottom-right': [0.8, 0.8],
};
export const POSITION_GRID = Array.from({ length: 25 }, (_, index) =>
  `${'ABCDE'[index % 5]}${Math.floor(index / 5) + 1}`);

export function characterPosition(value) {
  if (typeof value !== 'string') return 'auto';
  const trimmed = value.trim();
  if (/^[a-e][1-5]$/i.test(trimmed)) return trimmed.toUpperCase();
  return Object.hasOwn(positions, trimmed.toLowerCase()) ? trimmed.toLowerCase() : 'auto';
}

export function characterCenter(value) {
  const position = characterPosition(value);
  const [x, y] = positions[position] || [
    ('ABCDE'.indexOf(position[0]) * 2 + 1) / 10, (Number(position[1]) * 2 - 1) / 10,
  ];
  return { x, y };
}

export function characterPositionText(value) {
  const position = characterPosition(value);
  if (position === 'auto') return '';
  if (positions[position]) return `position ${position}`;
  const { x, y } = characterCenter(position);
  return `position ${position} (x=${x}, y=${y}, origin at top left)`;
}

export function characterPositionLabel(value) {
  const position = characterPosition(value);
  return POSITION_OPTIONS.find(([key]) => key === position)?.[1] || `网格 ${position}`;
}

export function characterLayoutWarnings(scene, native = false) {
  const roles = scene?.characterPrompts || [], entries = scene?.entries || [], warnings = [];
  const positioned = roles.filter((role) => role.position !== 'auto');
  if (native && positioned.length && positioned.length < roles.length) {
    warnings.push('本次启用了手动定位，未指定位置的人物将按中央提交。');
  }
  const centers = new Map();
  for (const role of native && positioned.length ? roles : positioned) {
    const center = characterCenter(role.position), key = `${center.x},${center.y}`;
    const group = centers.get(key) || [];
    group.push(role.name || role.id);
    centers.set(key, group);
  }
  for (const names of centers.values()) {
    if (names.length > 1) warnings.push(`${names.map((name) => `「${name}」`).join('、')}使用相同画面位置，人物可能重叠。`);
  }
  for (const entry of entries) {
    const relation = entry.interaction || scene.directions?.find((row) => row.profileId === entry.profileId)?.interaction;
    if (!relation || !relation.targetId && !relation.action) continue;
    const name = entry.profile.name;
    if (!relation.targetId) warnings.push(`「${name}」的互动尚未选择对象，本次不会提交。`);
    else if (relation.targetId === entry.profileId) warnings.push(`「${name}」不能与自己建立人物互动，本次不会提交。`);
    else if (!entries.some((row) => row.profileId === relation.targetId)) warnings.push(`「${name}」的互动对象未出场，本次不会提交。`);
    else if (!relation.action) warnings.push(`「${name}」的互动尚未填写动作，本次不会提交。`);
  }
  return warnings;
}

export function characterLimit(provider, model) {
  return ['novelai', 'openai'].includes(provider) && /(?:^|[^a-z])nai-diffusion-5(?:-|$)/i.test(model || '') ? 22 : 6;
}

export function independentCharacters(provider, model, mode) {
  return /nai-diffusion-(?:4|5)(?:-|$)/i.test(model || '')
    && (provider === 'novelai' || provider === 'openai' && ['novelai-v4', 'character-prompts'].includes(mode));
}

export function characterCaptionPayload(positive, negative, characters) {
  const useCoords = characters.some((entry) => entry.position && entry.position !== 'auto');
  const captions = (key) => characters.map((entry) => ({
    char_caption: entry[key] || '', centers: [characterCenter(entry.position)],
  }));
  return {
    v4_prompt: { caption: { base_caption: positive, char_captions: captions('positive') }, use_coords: useCoords, use_order: true },
    v4_negative_prompt: { caption: { base_caption: negative, char_captions: captions('negative') }, legacy_uc: false },
    characterPrompts: characters.map((entry) => ({
      prompt: entry.positive, uc: entry.negative, center: characterCenter(entry.position), enabled: true,
    })),
    use_coords: useCoords,
  };
}

export function arrangeCharacters(entries, layout) {
  const count = entries.length;
  const rows = Math.ceil(count / 5);
  return entries.map((entry, index) => ({
    ...entry,
    position: layout === 'auto' ? 'auto' : layout === 'reverse' ? entries[count - index - 1].position
      : (() => {
        const row = Math.floor(index / 5), columns = Math.min(5, count - row * 5);
        return `${'ABCDE'[columns < 2 ? 2 : Math.round(index % 5 * 4 / (columns - 1))]}${rows < 2 ? 3 : 1 + Math.round(row * 4 / (rows - 1))}`;
      })(),
  }));
}
