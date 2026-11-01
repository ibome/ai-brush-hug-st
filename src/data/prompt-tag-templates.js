const negative = 'low quality, worst quality, blurry, bad anatomy, bad hands, extra fingers, watermark, signature';
const entries = [
  ['chibi-avatar', 'Q版头像', '人物', 'solo, chibi, portrait, face focus, looking at viewer, smile, simple background', 'clean lineart, flat color'],
  ['ancient-study', '古风书房', '古风', 'solo, hanfu, hair ornament, sitting, reading, study, desk, book, window, bamboo, soft lighting', 'ink painting, illustration'],
  ['ancient-gentleman', '古装公子', '古风', '1boy, solo, male focus, long hair, hair crown, hanfu, long sleeves, courtyard, standing, light smile', 'illustration, soft shading'],
  ['rainy-street', '雨夜街道', '场景', 'street, night, rain, wet pavement, reflections, neon lights, umbrella, depth of field', 'cinematic lighting'],
  ['cozy-cafe', '午后咖啡馆', '场景', 'solo, sitting, cafe, window, coffee, cup, dappled sunlight, warm colors, cozy', 'watercolor, illustration'],
  ['two-characters', '双人对话', '互动', 'duo, facing another, talking, sitting, table, medium shot, indoors, soft lighting', 'anime, clean lineart'],
  ['back-to-back', '背靠背搭档', '互动', 'duo, back-to-back, standing, full body, simple background', 'illustration, dynamic angle'],
  ['moon-garden', '月下庭院', '古风', 'no humans, courtyard, pavilion, pond, full moon, night, moonlight, flowers, peaceful', 'ink painting, watercolor'],
  ['ocean-mascot', '海洋吉祥物', '人物', 'solo, chibi, long hair, blue hair, blue eyes, whale tail, ribbon, white dress, smile, bubbles, simple background', 'flat color, clean lineart'],
  ['forest-trip', '林间散步', '场景', 'solo, walking, forest, path, dappled sunlight, wind, floating petals, peaceful', 'storybook illustration'],
  ['male-portrait', '男性半身像', '人物', '1boy, solo, male focus, upper body, looking at viewer, shirt, light smile, simple background', 'illustration, soft shading'],
  ['food-table', '餐桌小景', '静物', 'no humans, still life, table, plate, bread, fruit, tea, window, morning, natural light', 'watercolor, illustration'],
  ['character-sheet', '角色设定图', '构图', 'solo, character sheet, multiple views, full body, standing, white background', 'concept art, clean lineart'],
  ['hand-cleanup', '手部与结构负面词', '负面词', '', ''],
];
export const BUILTIN_TAG_TEMPLATES = Object.freeze(entries.map(([id, name, category, positive, artist]) =>
  Object.freeze({ id: `builtin-template-${id}`, name, category, positive, artist,
    negative: id === 'hand-cleanup' ? 'bad anatomy, bad hands, poorly drawn hands, extra fingers, missing fingers, fused fingers, extra arms, malformed limbs' : negative })));
