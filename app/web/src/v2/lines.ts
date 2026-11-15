const PRAISE = [
  '这一小步，我记住啦。',
  '你认真的样子，真好看。',
  '完成一件，我们就离目标近一点。',
  '我在这儿陪着你，慢慢来。',
  '今天也谢谢你没有放弃。',
  '又翻过去一页，真棒。',
  '要不要摸摸我？今天的你值得。',
  '我发现你越来越会安排时间了。',
];

const SUBMIT = [
  '交上去啦，等爸爸妈妈看一眼。',
  '我帮你把小本本合上，等审核。',
  '先歇一会儿，马上就有结果。',
  '这一步算完成了，剩下交给大人。',
];

const APPROVED = [
  '通过啦！星贝到账，叮——',
  '家长点头了，你做到了。',
  '看，认真是会被看见的。',
  '这一颗星，是你自己挣来的。',
  '通过！要不要去材料铺看看？',
];

const REJECTED = [
  '这次没过，没关系，再试一次就好。',
  '家长说再检查一下，我陪你重来。',
  '退回不是失败，是把事情做得更好。',
  '我们先看看原因，再交一次。',
];

const FEED = [
  '啊呜——这一口好香。',
  '吃饱了才有力气陪你写作业。',
  '谢谢你记得我，真好吃。',
  '慢点吃，都是我的。',
  '吃饱啦，尾巴都翘起来了。',
];

const PLAY = [
  '再来一次！我还没玩够。',
  '你扔得真准，我接住啦。',
  '陪你玩的时候，时间过得好快。',
  '呼——跑得我耳朵都飞起来了。',
];

const PET = [
  '呼噜呼噜……就是这里。',
  '你的手好暖。',
  '再摸一下，就一下。',
  '我记住你的味道了。',
];

const HUG = [
  '抱紧一点，今天也辛苦啦。',
  '被你抱着，什么都不怕。',
  '我的心跳，你听见了吗？',
];

const IDLE = [
  '今天想先做哪一件？',
  '我在这儿，不着急。',
  '写完记得来摸摸我。',
  '要不要先挑一个最简单的开始？',
  '窗外的云走得比你慢。',
  '我刚刚打了个小哈欠。',
];

const NEED_HUNGRY = [
  '我有点饿了，可以给我一点吃的吗？',
  '肚子在叫啦……现在方便喂我一点吗？',
  '我不是催你，我只是闻到饼干的香味了。',
];
const NEED_TIRED = [
  '我有点累了，可以让我眯一会儿吗？',
  '眼睛快睁不开了……我先睡十分钟，好吗？',
  '今天玩得很开心，不过我确实需要休息一下。',
];
const NEED_DIRTY = [
  '我身上有点灰，可以帮我梳一梳吗？',
  '想洗个香香的泡泡浴，你方便的时候就好。',
];
const NEED_PLAY = [
  '你忙完了吗？可以陪我玩五分钟吗？',
  '我有一点想玩，但现在可以等你。',
  '如果你现在没空，我就自己滚一会儿。',
];
const NEED_LONELY = [
  '我有点想你了，不过来也没关系。',
  '今天还没怎么见到你，我在这里等你。',
];
const SOCIAL = [
  '我有点难过，可以抱抱我吗？',
  '这件事我还没做好，你可以教教我吗？',
  '我现在不想被摸，等我吃完饭好吗？',
  '谢谢你今天陪我，我很开心。',
  '你可以先忙你的，我在这里就好。',
];
const SLEEP = ['那就眯一小会儿…', '呼……呼……', '晚安，醒了再陪你。'];
const WAKE = ['睡饱啦，继续陪你。', '唔……我醒了。', '伸个懒腰，开始吧。'];

const MORNING = ['早上好，今天也一起。', '太阳晒到尾巴啦，起床吧。'];
const EVENING = ['晚上好，收个尾就休息。', '今天做得够多了，别太累。'];

function pick(arr: string[], seed?: number) {
  const i = seed == null ? Math.floor(Math.random() * arr.length) : Math.abs(seed) % arr.length;
  return arr[i];
}

export const lines = {
  praise: (seed?: number) => pick(PRAISE, seed),
  submit: (seed?: number) => pick(SUBMIT, seed),
  approved: (seed?: number) => pick(APPROVED, seed),
  rejected: (seed?: number) => pick(REJECTED, seed),
  feed: (seed?: number) => pick(FEED, seed),
  play: (seed?: number) => pick(PLAY, seed),
  pet: (seed?: number) => pick(PET, seed),
  hug: (seed?: number) => pick(HUG, seed),
  idle: (seed?: number) => pick(IDLE, seed),
  sleep: (seed?: number) => pick(SLEEP, seed),
  needHungry: (seed?: number) => pick(NEED_HUNGRY, seed),
  needTired: (seed?: number) => pick(NEED_TIRED, seed),
  needDirty: (seed?: number) => pick(NEED_DIRTY, seed),
  needPlay: (seed?: number) => pick(NEED_PLAY, seed),
  needLonely: (seed?: number) => pick(NEED_LONELY, seed),
  social: (seed?: number) => pick(SOCIAL, seed),
  wake: (seed?: number) => pick(WAKE, seed),
  morning: (seed?: number) => pick(MORNING, seed),
  evening: (seed?: number) => pick(EVENING, seed),
};

export const STAT_HELP = [
  { key: 'hunger', icon: '🍚', name: '饱食', color: 'warm', desc: '会随时间慢慢下降。喂小饼干、小鱼干、羊奶可以补；低于 25 时它会没精神。' },
  { key: 'energy', icon: '⚡', name: '精力', color: 'mint', desc: '陪玩会消耗，睡觉和小憩会恢复。低于 20 时它会想打盹。' },
  { key: 'mood', icon: '💛', name: '心情', color: 'gold', desc: '完成任务、被摸头、陪玩、抱抱都会变好；长期不理它会下降。' },
  { key: 'clean', icon: '🫧', name: '清洁', color: 'sky', desc: '会随时间下降。用小梳子或泡泡浴可以恢复，干净时它更愿意亲近你。' },
];
