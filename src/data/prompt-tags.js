import { EXTRA_TAG_GROUPS } from './prompt-tags-extra.js';

// The vocabulary is local; English tokens and builtin IDs remain stable across updates.
const groups = {
  '人数与主体': [
    ['1girl', '一位女性', '单人女孩 女生'], ['1boy', '一位男性', '单人男孩 男生'],
    ['2girls', '两位女性'], ['2boys', '两位男性'], ['multiple girls', '多位女性'],
    ['multiple boys', '多位男性'], ['solo', '单人'], ['duo', '双人'], ['group', '群像'],
    ['no humans', '无人场景', '风景 空镜'], ['portrait', '肖像'], ['couple', '情侣'],
    ['animal', '动物'], ['cat', '猫'], ['dog', '狗'], ['bird', '鸟'], ['butterfly', '蝴蝶'],
    ['dragon', '龙'], ['whale', '鲸鱼'], ['robot', '机器人'],
  ],
  '发型': [
    ['long hair', '长发'], ['short hair', '短发'], ['medium hair', '中长发'],
    ['very long hair', '超长发'], ['straight hair', '直发'], ['wavy hair', '波浪发', '卷发'],
    ['curly hair', '卷曲发'], ['messy hair', '凌乱发'], ['ponytail', '马尾'],
    ['high ponytail', '高马尾'], ['low ponytail', '低马尾'], ['twintails', '双马尾'],
    ['braid', '辫子'], ['twin braids', '双辫'], ['side braid', '侧辫'],
    ['hair bun', '丸子头', '发髻'], ['double bun', '双丸子头'], ['bob cut', '波波头', '鲍伯头 妹妹头'],
    ['bangs', '刘海'], ['blunt bangs', '齐刘海'], ['parted bangs', '分开刘海'],
    ['hair over one eye', '遮住一只眼的头发'], ['ahoge', '呆毛'], ['hair intakes', 'M形发根', '进气口 翘起的发根'],
  ],
  '发色': [
    ['black hair', '黑发'], ['white hair', '白发'], ['silver hair', '银发'],
    ['grey hair', '灰发'], ['blonde hair', '金发'], ['brown hair', '棕发'],
    ['red hair', '红发'], ['orange hair', '橘发'], ['pink hair', '粉发'],
    ['blue hair', '蓝发'], ['green hair', '绿发'], ['purple hair', '紫发'],
    ['aqua hair', '青发', '水蓝发'], ['multicolored hair', '多色头发'],
    ['gradient hair', '渐变发'], ['two-tone hair', '双色头发'], ['streaked hair', '挑染头发'],
  ],
  '眼睛与特征': [
    ['blue eyes', '蓝眼'], ['green eyes', '绿眼'], ['red eyes', '红眼'],
    ['purple eyes', '紫眼'], ['brown eyes', '棕眼'], ['yellow eyes', '黄眼'],
    ['grey eyes', '灰眼'], ['aqua eyes', '青眼'], ['heterochromia', '异色瞳'],
    ['closed eyes', '闭眼'], ['half-closed eyes', '半闭眼'], ['sparkling eyes', '闪亮眼睛'],
    ['pointy ears', '尖耳', '精灵耳'], ['animal ears', '兽耳'], ['cat ears', '猫耳'],
    ['fox ears', '狐耳'], ['bunny ears', '兔耳'], ['horns', '角'], ['dragon horns', '龙角'],
    ['wings', '翅膀'], ['dragon wings', '龙翼'], ['tail', '尾巴'], ['dragon tail', '龙尾'],
    ['fang', '小虎牙'], ['freckles', '雀斑'], ['mole under eye', '泪痣'],
  ],
  '表情': [
    ['smile', '微笑'], ['grin', '露齿笑'], ['laughing', '大笑'], ['smirk', '坏笑'],
    ['blush', '脸红', '害羞'], ['embarrassed', '难为情'], ['shy', '羞怯'],
    ['pout', '噘嘴'], ['angry', '生气'], ['annoyed', '不满'], ['sad', '伤心'],
    ['crying', '哭泣'], ['tears', '泪水'], ['surprised', '惊讶'], ['confused', '困惑'],
    ['expressionless', '无表情', '冷淡 面瘫'], ['sleepy', '困倦'], ['serious', '认真'],
    ['determined', '坚定'], ['nervous', '紧张'], ['excited', '兴奋'],
    ['one eye closed', '眨一只眼', 'wink'], ['open mouth', '张嘴'], ['light smile', '浅笑'],
  ],
  '动作与姿势': [
    ['standing', '站立'], ['sitting', '坐着'], ['walking', '行走'], ['running', '奔跑'],
    ['jumping', '跳跃'], ['kneeling', '跪姿', '跪坐'], ['lying', '躺着'], ['squatting', '蹲着'],
    ['leaning forward', '身体前倾'], ['leaning back', '身体后仰'], ['crossed arms', '双手抱胸'],
    ['arms up', '举起双臂'], ['hand on hip', '单手叉腰'], ['hands on hips', '双手叉腰'],
    ['hand on own chin', '手托下巴', '托腮'], ['waving', '挥手'], ['pointing', '指向'],
    ['peace sign', '比耶', 'v手势'], ['thumbs up', '竖大拇指'], ['heart hands', '双手比心'],
    ['holding book', '捧书'], ['reading', '阅读'], ['writing', '书写'], ['drawing', '画画'],
    ['eating', '吃东西'], ['drinking', '喝饮料'], ['dancing', '跳舞'], ['playing flute', '吹长笛'],
    ['hugging', '拥抱'], ['holding hands', '牵手'], ['looking back', '回头'],
    ['looking at viewer', '看向观众', '直视镜头'], ['looking away', '看向别处'],
    ['head tilt', '歪头'], ['crossed legs', '翘腿'], ['hands clasped', '双手交握'],
  ],
  '服装': [
    ['dress', '连衣裙'], ['white dress', '白色连衣裙'], ['black dress', '黑色连衣裙'],
    ['long dress', '长裙'], ['frilled dress', '荷叶边裙'], ['off-shoulder dress', '露肩裙'],
    ['skirt', '裙子'], ['pleated skirt', '百褶裙'], ['long skirt', '长半身裙'],
    ['shirt', '衬衫'], ['white shirt', '白衬衫'], ['blouse', '女式衬衫'], ['t-shirt', 'T恤'],
    ['sweater', '毛衣'], ['cardigan', '针织开衫'], ['hoodie', '连帽衫'],
    ['jacket', '夹克'], ['coat', '外套'], ['long coat', '长大衣'], ['cape', '披风'],
    ['suit', '西装'], ['vest', '马甲'], ['pants', '长裤'], ['shorts', '短裤'],
    ['jeans', '牛仔裤'], ['school uniform', '校服'], ['sailor collar', '水手领'],
    ['maid', '女仆', '女仆装'], ['apron', '围裙'], ['kimono', '和服'], ['yukata', '浴衣'],
    ['hanfu', '汉服', '古装'], ['chinese clothes', '中式服装'], ['china dress', '旗袍'],
    ['armor', '盔甲'], ['military uniform', '军装'], ['sportswear', '运动装'],
    ['pajamas', '睡衣'], ['lab coat', '白大褂'], ['raincoat', '雨衣'],
  ],
  '配饰与鞋袜': [
    ['hair ribbon', '发带'], ['hair bow', '发饰蝴蝶结'], ['hair ornament', '发饰'],
    ['hairclip', '发夹'], ['hair flower', '花朵发饰'], ['headband', '发箍'],
    ['maid headdress', '女仆头饰'], ['hat', '帽子'], ['beret', '贝雷帽'],
    ['crown', '王冠'], ['tiara', '小皇冠'], ['glasses', '眼镜'], ['round eyewear', '圆框眼镜'],
    ['headphones', '耳机'], ['earrings', '耳环'], ['necklace', '项链'], ['choker', '颈圈'],
    ['ribbon', '缎带'], ['bow', '蝴蝶结'], ['necktie', '领带'], ['bowtie', '领结'],
    ['scarf', '围巾'], ['gloves', '手套'], ['bracelet', '手环'], ['ring', '戒指'],
    ['backpack', '双肩包'], ['handbag', '手提包'], ['umbrella', '雨伞'],
    ['socks', '袜子'], ['knee socks', '及膝袜'], ['thighhighs', '过膝袜'],
    ['pantyhose', '连裤袜'], ['boots', '靴子'], ['sneakers', '运动鞋'],
    ['high heels', '高跟鞋'], ['sandals', '凉鞋'], ['loafers', '乐福鞋'],
  ],
  '构图与视角': [
    ['close-up', '特写'], ['upper body', '上半身'], ['cowboy shot', '大腿以上构图', '七分身'],
    ['full body', '全身'], ['wide shot', '远景'], ['face focus', '面部聚焦'],
    ['from above', '俯视'], ['from below', '仰视'], ['from side', '侧面视角'],
    ['from behind', '背后视角'], ['profile', '侧脸'], ['front view', '正面视角'],
    ['three-quarter view', '四分之三视角'], ['dutch angle', '倾斜镜头'],
    ['centered composition', '居中构图'], ['symmetrical composition', '对称构图'],
    ['rule of thirds', '三分法构图'], ['depth of field', '景深'], ['foreshortening', '透视缩短'],
    ['dynamic angle', '动态视角'], ['negative space', '大面积留白'], ['cropped', '裁切构图'],
  ],
  '室内场景': [
    ['indoors', '室内'], ['bedroom', '卧室'], ['living room', '客厅'], ['kitchen', '厨房'],
    ['classroom', '教室'], ['library', '图书馆'], ['bookstore', '书店'],
    ['cafe', '咖啡馆'], ['restaurant', '餐厅'], ['office', '办公室'],
    ['laboratory', '实验室'], ['train interior', '列车内'], ['hallway', '走廊'],
    ['staircase', '楼梯'], ['window', '窗户'], ['bookshelf', '书架'],
    ['desk', '书桌'], ['chair', '椅子'], ['sofa', '沙发'], ['fireplace', '壁炉'],
  ],
  '室外场景': [
    ['outdoors', '室外'], ['forest', '森林'], ['bamboo forest', '竹林'], ['garden', '花园'],
    ['flower field', '花田'], ['meadow', '草地'], ['mountain', '山峦'],
    ['lake', '湖泊'], ['river', '河流'], ['waterfall', '瀑布'], ['beach', '海滩'],
    ['ocean', '海洋'], ['underwater', '水下'], ['desert', '沙漠'], ['snow', '积雪'],
    ['street', '街道'], ['cityscape', '城市景观'], ['rooftop', '屋顶'],
    ['bridge', '桥'], ['park', '公园'], ['shrine', '神社'], ['castle', '城堡'],
    ['palace', '宫殿'], ['ruins', '遗迹'], ['space', '太空'], ['starry sky', '星空'],
    ['cherry blossoms', '樱花'], ['autumn leaves', '秋叶'],
  ],
  '天气与时间': [
    ['day', '白天'], ['night', '夜晚'], ['dawn', '黎明'], ['sunrise', '日出'],
    ['sunset', '日落'], ['dusk', '黄昏'], ['blue sky', '蓝天'], ['cloudy sky', '多云天空'],
    ['rain', '下雨'], ['snowing', '飘雪'], ['fog', '雾气'], ['mist', '薄雾'],
    ['wind', '风'], ['rainbow', '彩虹'], ['full moon', '满月'], ['crescent moon', '新月'],
    ['spring', '春天'], ['summer', '夏天'], ['autumn', '秋天'], ['winter', '冬天'],
  ],
  '光照与色彩': [
    ['soft lighting', '柔和光照'], ['natural light', '自然光'], ['sunlight', '阳光'],
    ['moonlight', '月光'], ['backlighting', '逆光'], ['rim lighting', '轮廓光'],
    ['volumetric lighting', '体积光'], ['dappled sunlight', '斑驳阳光'],
    ['cinematic lighting', '电影光照'], ['studio lighting', '棚拍光照'],
    ['neon lights', '霓虹灯'], ['candlelight', '烛光'], ['glowing', '发光'],
    ['warm colors', '暖色调'], ['cool colors', '冷色调'], ['pastel colors', '粉彩色调'],
    ['muted colors', '低饱和色彩'], ['vibrant colors', '鲜艳色彩'],
    ['monochrome', '单色'], ['greyscale', '灰度'], ['high contrast', '高对比度'],
    ['low contrast', '低对比度'], ['blue theme', '蓝色主题'], ['green theme', '绿色主题'],
  ],
  '画风与媒介': [
    ['anime', '动漫风'], ['manga', '漫画风'], ['chibi', 'Q版', 'q版 小人 二头身'],
    ['watercolor', '水彩'], ['oil painting', '油画'], ['ink painting', '水墨画'],
    ['pencil sketch', '铅笔素描'], ['lineart', '线稿'], ['pixel art', '像素画'],
    ['digital painting', '数字绘画'], ['illustration', '插画'], ['concept art', '概念艺术'],
    ['realistic', '写实'], ['photorealistic', '照片写实'], ['semi-realistic', '半写实'],
    ['cel shading', '赛璐璐上色'], ['flat color', '平涂'], ['soft shading', '柔和阴影'],
    ['minimalist', '极简风'], ['retro artstyle', '复古画风'], ['storybook illustration', '绘本插画'],
    ['fantasy', '奇幻'], ['science fiction', '科幻'], ['cyberpunk', '赛博朋克'],
    ['steampunk', '蒸汽朋克'], ['traditional media', '传统绘画媒介'],
  ],
  '背景与氛围': [
    ['simple background', '简洁背景'], ['white background', '白色背景'],
    ['black background', '黑色背景'], ['transparent background', '透明背景'],
    ['gradient background', '渐变背景'], ['blurred background', '模糊背景'],
    ['bokeh', '焦外散景'], ['sparkles', '星光闪烁'], ['bubbles', '气泡'],
    ['floating petals', '飘落花瓣'], ['falling leaves', '落叶'], ['light particles', '光粒子'],
    ['dreamy', '梦幻氛围'], ['peaceful', '宁静氛围'], ['cozy', '温馨氛围'],
    ['mysterious', '神秘氛围'], ['dramatic', '戏剧氛围'], ['romantic', '浪漫氛围'],
    ['melancholic', '忧郁氛围'], ['ethereal', '空灵氛围'],
  ],
  '质量词': [
    ['masterpiece', '杰作'], ['best quality', '最佳质量'], ['high quality', '高质量'],
    ['very aesthetic', '高度美学'], ['absurdres', '超高分辨率'], ['highres', '高分辨率'],
    ['detailed', '精细细节'], ['highly detailed', '高度精细'], ['clean lineart', '干净线稿'],
    ['sharp focus', '清晰对焦'], ['detailed background', '精细背景'],
    ['detailed eyes', '精细眼睛'], ['beautiful lighting', '优美光照'],
  ],
  '负面词': [
    ['low quality', '低质量'], ['worst quality', '最差质量'], ['lowres', '低分辨率'],
    ['blurry', '模糊'], ['jpeg artifacts', 'JPEG压缩痕迹'], ['pixelated', '像素化'],
    ['bad anatomy', '人体结构错误'], ['bad hands', '手部错误'], ['extra fingers', '多余手指'],
    ['missing fingers', '缺少手指'], ['fused fingers', '手指粘连'], ['extra arms', '多余手臂'],
    ['extra legs', '多余腿'], ['extra limbs', '多余肢体'], ['missing limbs', '缺少肢体'],
    ['malformed limbs', '肢体畸形'], ['deformed', '变形'], ['disfigured', '外观扭曲'],
    ['poorly drawn face', '面部绘制不佳'], ['poorly drawn hands', '手部绘制不佳'],
    ['duplicate', '重复主体'], ['watermark', '水印'], ['signature', '签名'],
    ['text', '文字'], ['logo', '标志'], ['overexposed', '过曝'], ['underexposed', '欠曝'],
    ['out of frame', '主体出框'], ['unfinished', '未完成'],
  ],
};

const move = (from, to, english) => {
  const selected = new Set(english);
  groups[to] = [...(groups[to] || []), ...groups[from].filter(([en]) => selected.has(en))];
  groups[from] = groups[from].filter(([en]) => !selected.has(en));
};
move('动作与姿势', '身体姿势', ['standing', 'sitting', 'kneeling', 'lying', 'squatting', 'leaning forward', 'leaning back']);
move('动作与姿势', '手势与手部动作', ['crossed arms', 'arms up', 'hand on hip', 'hands on hips', 'hand on own chin', 'waving', 'pointing', 'peace sign', 'thumbs up', 'heart hands', 'hands clasped']);
move('动作与姿势', '视线与头部动作', ['looking back', 'looking at viewer', 'looking away', 'head tilt']);
move('动作与姿势', '腿部动作', ['crossed legs']);
move('动作与姿势', '人物互动', ['hugging', 'holding hands']);
move('服装', '上装', ['shirt', 'white shirt', 'blouse', 't-shirt', 'sweater', 'cardigan', 'hoodie', 'jacket', 'coat', 'long coat', 'vest']);
move('服装', '裙装', ['dress', 'white dress', 'black dress', 'long dress', 'frilled dress', 'off-shoulder dress', 'skirt', 'pleated skirt', 'long skirt']);
move('服装', '裤装', ['pants', 'shorts', 'jeans']);
move('配饰与鞋袜', '鞋袜', ['socks', 'knee socks', 'thighhighs', 'pantyhose', 'boots', 'sneakers', 'high heels', 'sandals', 'loafers']);
for (const [category, rows] of Object.entries(EXTRA_TAG_GROUPS)) groups[category] = [...(groups[category] || []), ...rows];
export const TAG_CATEGORIES = Object.freeze(Object.keys(groups).filter((category) => groups[category].length));
export const BUILTIN_TAGS = Object.freeze(Object.entries(groups).flatMap(([category, rows]) =>
  rows.map(([en, name, aliases = '']) => Object.freeze({
    id: `builtin-${en.replace(/[^a-z0-9]+/g, '-')}`, en, name, category,
    aliases: Object.freeze(aliases ? aliases.split(' ') : []),
  }))));
