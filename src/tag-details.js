import { promptIdentity } from './prompt-composer.js';

const guidance = {
  '人数与主体': '描述画面中的主体与人数。双人或多人画面可再配合各角色的外貌与位置提示词。',
  '发型': '描述头发的长度、形状或束发方式。发型与发色可以分别组合。',
  '发色': '描述头发颜色。挑染、发尾染色与整体发色可以分别指定。',
  '眼睛与特征': '描述眼睛、肤色和外貌细节。局部特征在近景或肖像构图中更容易看清。',
  '男性外貌与体型': '描述男性的外貌或体型，可与人数、发型、服装和姿势词组合。',
  '表情': '描述面部情绪。可搭配视线方向或头部姿势。',
  '动作与姿势': '描述人物的动作。可补充手部位置、站坐姿势和构图。',
  '身体姿势': '描述身体姿态。可配合腿部动作、手势和视角。',
  '手势与手部动作': '描述手或手臂的动作。近景、半身或全身构图可呈现不同细节。',
  '视线与头部动作': '描述视线方向或头部姿势，不等同于摄影机视角。',
  '腿部动作': '描述腿部姿态，可配合身体姿势及全身构图。',
  '人物互动': '描述人物之间的互动。多人画面可在角色提示词中分别补充动作。',
  '服装': '描述服装，可继续补充颜色、材质、袖型和饰品。',
  '上装': '描述上半身服饰，可与下装和服装细节组合。',
  '裙装': '描述裙子或连衣裙，可补充长度、颜色和裙摆细节。',
  '裤装': '描述裤装，可配合上装、鞋袜和体型。',
  '鞋袜': '描述鞋子与袜子。需要看清时可选择全身或腿部构图。',
  '配饰与鞋袜': '描述搭配物品，可与相应部位的服装词组合。',
  '服装细节与材质': '描述服装的结构或质感，通常需要同时指定服装主体。',
  '古风服饰与元素': '描述古风服饰或文化元素。自然语言词的理解会随模型而变化。',
  '活动与职业': '描述活动或身份。服装、道具和环境词可以进一步补充场景。',
  '构图与视角': '描述取景范围、主体位置或摄影机方向，可搭配人物姿势。',
  '室内场景': '描述室内环境，可补充家具、道具和光线。',
  '室外场景': '描述室外环境，可补充天气、时间和建筑。',
  '天气与时间': '描述天气、季节或时间，可配合光线和场景。',
  '光照与色彩': '描述光线和配色。光照方向与视角、时间词可以共同使用。',
  '画风与媒介': '描述画面风格或绘画媒介，通常作用于整张图。',
  '背景与氛围': '描述背景或情绪氛围，可与具体场景组合。',
  '质量词': '描述希望的画面质量或细节，具体效果与模型的训练方式有关。',
  '负面词': '描述希望减少的内容。只有支持独立负面提示词的模型或节点会读取该字段。',
  '建筑与家具': '描述建筑或家具，可配合室内外场景和位置。',
  '食物与饮品': '描述食物或饮品，可配合盛装器皿、用餐动作和场景。',
  '道具与器物': '描述道具或器物。可补充持物动作和物品位置。',
  '动物与植物': '描述动物或植物，可搭配数量、动作和环境。',
  '画面效果': '描述视觉效果，可与构图、光线或绘画媒介组合。',
};

const definitions = {
  'long hair': '长发。可与发色、刘海、马尾等词组合；它本身不指定卷曲程度或束发方式。',
  'short hair': '短发。若需要明确形状，可进一步加入波波头、寸头或其他发型。',
  'medium hair': '中等长度的头发。需要更明确的长度时，可再补充及肩等描述。',
  'very long hair': '超长发，可配合发尾位置、散发或束发方式。',
  'wavy hair': '波浪状的头发，侧重较舒展的弯曲形态。',
  'curly hair': '卷曲的头发，侧重卷曲纹理，可同时指定长度。',
  'hime cut': '姬发式：常见特征是整齐刘海与两侧较短的鬓发，后方头发通常较长。',
  'hair intakes': '发根向两侧拱起的发束形状，不等同于整片刘海或头顶呆毛。',
  'ahoge': '呆毛：从主体发型中单独翘起的一小束头发。',
  'sidelocks': '脸颊两侧、耳前垂下的鬓发。',
  'ponytail': '马尾：将头发束在头后。高低与左右位置可另外指定。',
  'twintails': '双马尾：将头发分为左右两束。不要与双辫混淆。',
  'twin braids': '双辫：左右各一条编织辫子，不同于未经编织的双马尾。',
  'colored tips': '发尾染色。可与整体发色和目标发尾颜色一起描述。',
  'gradient hair': '渐变发色，描述不同颜色之间逐渐过渡。',
  'pointy ears': '尖耳。描述耳朵外形，不自动指定人物种族。',
  'heterochromia': '异色瞳，通常指两只眼睛颜色不同；可进一步明确左右眼颜色。',
  'star-shaped pupils': '星形瞳孔，侧重瞳孔的形状，与眼中星形高光不同。',
  'smile': '微笑。可进一步加入温柔、害羞等表情描述。',
  'blush': '脸红或红晕，常用于表现害羞，也可搭配其他表情。',
  'closed eyes': '闭眼。可与微笑、睡眠等表情和动作搭配。',
  'looking at viewer': '看向观看者。它描述视线，不自动改变人物的身体朝向。',
  'looking away': '视线看向别处。可结合侧身或扭头，进一步明确姿势。',
  'head tilt': '歪头。它描述头部姿势，不等同于画面倾斜。',
  'crossed arms': '双臂交叉，常见于抱胸姿势。',
  'peace sign': '手指比出 V 手势，常见于“比耶”动作。',
  'thumbs up': '竖起大拇指的手势。',
  'heart hands': '用双手组成爱心形状。',
  'portrait': '肖像构图，通常强调人物的脸部或上半身。',
  'upper body': '上半身取景，不要求显示整个人物。',
  'full body': '全身取景，希望头到脚都进入画面。',
  'cowboy shot': '大约从头部到大腿的取景范围。',
  'from above': '摄影机从较高位置向下观看，与人物低头不是同一个动作。',
  'from below': '摄影机从较低位置向上观看，与人物抬头不是同一个动作。',
  'depth of field': '景深效果，用清晰与模糊区域区分主体和背景。',
  'backlighting': '逆光：主要光源位于主体背后。',
  'rim lighting': '轮廓光：用边缘亮光勾勒主体。',
  'watercolor': '水彩风格，常表现为柔和晕染、透明色层和纸张质感。',
  'cel shading': '赛璐璐式着色，常使用清晰的明暗分区。',
  'lineart': '线稿风格，强调轮廓和线条。',
  'chibi': 'Q 版比例，通常头部较大、身体较短；可以另加表情和服装。',
  'white background': '白色背景，不等同于透明背景。需要透明图片时，还需接口支持相关输出参数。',
  'transparent background': '希望背景透明的描述。实际透明通道仍取决于模型、接口与输出格式。',
  'blurry': '模糊。放在负面提示词中表示希望减少不清晰的画面。',
  'lowres': '低分辨率的视觉特征。负面提示词不能替代实际输出尺寸设置。',
  'extra fingers': '多余手指。放在负面词中表示希望减少该问题，不能保证完全修复。',
  'bad anatomy': '异常的人体结构。可用作负面描述，细节修复也可能需要局部重绘。',
  'text': '画面中的文字。放在负面词中可表达不希望出现文字的意图。',
  'watermark': '水印。与签名、普通文字是不同的描述。',
};

const previews = [
  [['long hair', 'wavy hair', 'orange hair', 'cardigan', 'book', 'reading', 'smile', 'chibi'],
    new URL('./assets/themes/claude/claude-reading.webp', import.meta.url).href],
  [['mint hair', 'green hair', 'white dress', 'off-shoulder dress', 'frilled dress', 'blush', 'closed eyes', 'ribbon'],
    new URL('./assets/themes/gemini/gemini-shy.webp', import.meta.url).href],
  [['blue hair', 'dark blue hair', 'blue eyes', 'maid', 'maid headdress', 'whale tail', 'thinking', 'hand on own chin'],
    new URL('./assets/themes/whale/whale-girl-thinking.webp', import.meta.url).href],
  [['white hair', 'silver hair', 'pointy ears', 'dragon horns', 'dragon wings', 'wings', 'purple eyes'],
    new URL('./assets/themes/gpt/gpt-wings.webp', import.meta.url).href],
  [['black hair', 'maid outfit', 'gold trim', 'crossed arms', 'frown', 'half-closed eyes'],
    new URL('./assets/themes/glm/glm-disdain.webp', import.meta.url).href],
  [['hoodie', 'peace sign', 'black skirt', 'robot', 'sneakers'],
    new URL('./assets/themes/grok/grok-peace.webp', import.meta.url).href],
  [['male focus', '1boy', 'hanfu', 'long sleeves', 'ancient chinese clothing'],
    new URL('./assets/themes/ancient/ancient-calm.webp', import.meta.url).href],
];
const previewMap = new Map(previews.flatMap(([tags, url]) => tags.map((tag) => [tag, url])));

export function safeTagSource(value) {
  if (typeof value !== 'string' || !value || value.length > 1000) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    url.search = '';
    return url.href;
  } catch { return ''; }
}

export function safeTagPreview(value) {
  return typeof value === 'string' && value.length <= 60000
    && /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : '';
}

export function tagDetails(tag) {
  const en = promptIdentity(tag.en);
  return { description: tag.description || definitions[en] || guidance[tag.category] || '自定义提示词。可编辑释义、来源及示例图，记录自己的使用经验。',
    descriptionType: tag.description || definitions[en] ? '标签释义' : '分类提示',
    preview: safeTagPreview(tag.preview) || previewMap.get(en) || '',
    previewLabel: tag.preview ? '自定义示例' : '主题插画示例',
    source: safeTagSource(tag.source),
    wiki: tag.id.startsWith('builtin-') ? `https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(en.replace(/ /g, '_'))}` : '',
  };
}
