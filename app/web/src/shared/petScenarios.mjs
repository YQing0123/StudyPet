/** Pure scenario definitions shared by the server and renderer. No browser/DB dependencies. */
export const PET_SCENARIOS = {
  pet: { action: 'pet', label: '摸摸', delta: { mood: 6, energy: -.6, clean: -.2 }, growth: 1, duration: 6000 },
  play: { action: 'play', label: '陪玩', delta: { mood: 11, energy: -5, clean: -2 }, growth: 1, duration: 9000 },
  hug: { action: 'hug', label: '抱抱', delta: { mood: 8, energy: -.8, clean: -.3 }, growth: 1, duration: 8000 },
  rest: { action: 'sleep', label: '小憩', delta: { energy: 14, mood: 2 } },
  shower: { publicInteraction: true, action: 'clean', label: '免费简单淋浴', delta: { clean: 20 }, caps: { clean: 95 }, conditions: [
    { stat: 'clean', min: 50, message: '清洁度低于50，需要用🛀泡泡浴认真洗澡哦' },
    { stat: 'clean', below: 95, message: '已经很清爽啦，免费淋浴最高补到95，不用再洗哦' }],
    oncePerDay: true, limitMessage: '今天的免费淋浴用过啦，明天再来；也可以使用泡泡浴', effect: 'shower', duration: 7000, line: '小主人，水温刚刚好！简单冲一冲，也要记得认真洗澡哦。', finish: '闪亮亮，清爽多啦！简单淋浴不会补满清洁哦。' },
  bath: { action: 'clean', label: '泡泡香香浴', delta: { mood: 8 }, set: { clean: 100 }, effect: 'bath', duration: 9000,
    line: '咕噜咕噜，泡泡把脏脏都带走啦！', finish: 'Buling buling，洗得干干净净啦！' },
  brush: { action: 'clean', label: '梳毛', effect: 'brush', duration: 5000,
    line: '梳梳毛，马上就蓬蓬松松啦！', finish: 'Buling buling，清爽多啦！' },
  food: { action: 'feed', duration: 7000 }, toy: { action: 'play', duration: 9000 }, deco: { action: 'outfit' },
};
export const SLEEP_LINES = [
  '唔……我还在睡觉呢，小主人也快去休息吧，等我醒来再一起玩。',
  '翻个身……梦里的小枕头好软呀，睡醒了再找你。',
  '呼噜……让我缩一缩，再睡一会儿，小主人也要好好休息哦。',
  '嗯……换个舒服的姿势。等我睡饱，我们再一起玩吧。',
];
export function scenarioForItem(item) { return PET_SCENARIOS[item.key] || PET_SCENARIOS[item.kind] || PET_SCENARIOS.brush; }
export const EFFECT_ASSETS = { shower: 'pets/effects/shower.gif', bath: 'pets/effects/bath.gif', bug: 'pets/effects/bug.gif', fly: 'pets/effects/fly.gif' };
export const DIRT_BANDS = [
  { below: 30, level: 3, flies: 2, bugs: 1 }, { below: 50, level: 2, flies: 2, bugs: 0 },
  { below: 65, level: 1, flies: 1, bugs: 0 },
];
export function dirtState(clean) { return DIRT_BANDS.find(band => Math.round(clean * 10) / 10 < band.below) || { level: 0, flies: 0, bugs: 0 }; }
export function dirtLevel(clean) { return dirtState(clean).level; }
export const NEED_SCENARIOS = [
  { stat: 'hunger', below: 30, lines: ['小主人，我有点饿啦，可以给我一点吃的吗？'] },
  { stat: 'energy', below: 18, lines: ['眼皮有点重了，让我休息一下，睡醒再玩吧。'] },
  { stat: 'clean', below: 50, lines: ['小主人，我需要洗澡啦！这次要用🛀泡泡浴，才能认真洗干净哦。'] },
  { stat: 'clean', below: 80, lines: ['小主人，我身上有点脏啦，可以帮我洗个澡吗？'] },
  { stat: 'mood', below: 30, lines: ['小主人，有空陪陪我好吗？摸摸头也很开心。'] },
];
export function needScenario(stats) { return NEED_SCENARIOS.find(x => stats[x.stat] < x.below) || null; }
