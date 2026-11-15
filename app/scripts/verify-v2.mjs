/** v2 验收：周计划、提交、审核、积分、奖励、价格、日历。先启动 server。 */
const BASE = process.env.BASE;
if (!BASE) throw new Error('请运行 npm test，自动使用隔离数据库；直接验收必须显式指定 BASE。');
let cookie = '';
let pass = 0; const fails = [];
const ok = (c, n, e = '') => { if (c) { pass++; console.log(`✓ ${n}`); } else { fails.push(n); console.log(`✗ ${n} ${e}`); } };
async function api(path, method = 'GET', body) {
  const res = await fetch(BASE + path, {
    method, headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json?.error || text}`);
  return json;
}
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const weekday = () => { const w = new Date().getDay(); return w === 0 ? 7 : w; };

console.log(`v2 验收：${BASE}\n`);
await api('/api/auth/register', 'POST', { login: 'v2-suite-'+Date.now(), password: 'Suite-Only-2026!', name:'验收家长', familyName:'V2隔离家庭',childName:'验收孩子' });
let s = await api('/api/v2/student');
ok(s.pet === null, '新家庭初始无宠物');

await api('/api/pet/adopt', 'POST', { breed: 'cat_orange', name: '小橘' });
s = await api('/api/v2/student');
ok(s.pet?.name === '小橘', '领养后学生端有宠物');

await api('/api/v2/rules', 'POST', {
  title: '数学口算', subject: '数学', icon: '📐', weekdays: [weekday()], minutes: 20,
  basePoints: 10, earlyBonus: 3, latePenalty: 2, reviewRequired: true, photoRequired: false,
});
await api('/api/v2/rules', 'POST', {
  title: '只在别的星期', subject: '阅读', icon: '📖', weekdays: [weekday() === 7 ? 1 : weekday() + 1], minutes: 10,
  basePoints: 5, reviewRequired: false,
});
await api('/api/v2/rules', 'POST', {
  title: '英语跟读', subject: '英语', icon: '🔤', weekdays: [1, 2, 3, 4, 5, 6, 7], minutes: 10,
  basePoints: 8, earlyBonus: 0, latePenalty: 0, reviewRequired: false, photoRequired: false,
});
s = await api('/api/v2/student');
ok(s.tasks.length === 2, '只生成今天该做的任务', String(s.tasks.length));

const math = s.tasks.find((t) => t.title === '数学口算');
const eng = s.tasks.find((t) => t.title === '英语跟读');
const before = s.wallet.balance;
await api(`/api/v2/tasks/${math.id}/submit`, 'POST', { note: '做完了' });
s = await api('/api/v2/student');
ok(s.tasks.find((t) => t.id === math.id)?.status === 'submitted', '需审核任务提交后是待审核');
ok(s.wallet.balance === before, '待审核不到账');
let dup = false;
try { await api(`/api/v2/tasks/${math.id}/submit`, 'POST', {}); } catch { dup = true; }
ok(dup, '同一任务不能重复提交');

await api(`/api/v2/tasks/${math.id}/review`, 'POST', { approve: true });
s = await api('/api/v2/student');
ok(s.tasks.find((t) => t.id === math.id)?.status === 'approved', '家长通过后已通过');
ok(s.wallet.balance === before + 10, '通过后 +10 星贝', String(s.wallet.balance));

let again = false;
try { await api(`/api/v2/tasks/${math.id}/submit`, 'POST', {}); } catch { again = true; }
ok(again, '已通过任务不能再次提交领分');

await api(`/api/v2/tasks/${eng.id}/submit`, 'POST', {});
s = await api('/api/v2/student');
ok(s.tasks.find((t) => t.id === eng.id)?.status === 'approved', '免审核任务提交即通过');
ok(s.wallet.balance === before + 18, '免审核任务 +8', String(s.wallet.balance));

const gift = await api('/api/v2/points/gift', 'POST', { amount: 5, reason: '主动整理书桌' });
ok(gift.wallet.balance === before + 23, '家长赠分 +5');

const rewards = await api('/api/v2/rewards', 'POST', { title: 'Switch 20 分钟', icon: '🎮', cost: 12, kind: 'experience', stock: 1 });
ok(rewards.length === 1, '上架心愿');
const reward = rewards[0];
s = await api(`/api/v2/rewards/${reward.id}/redeem`, 'POST');
ok(s.wallet.balance === before + 11, '兑换心愿扣 12');
ok(s.redemptions.length === 1, '生成待兑现记录');

const parent = await api('/api/v2/parent');
ok(parent.redemptions.some((r) => r.status === 'pending'), '家长端看到待兑现');
await api(`/api/v2/redemptions/${parent.redemptions[0].id}/handle`, 'POST', { status: 'fulfilled' });
ok((await api('/api/v2/parent')).redemptions[0].status === 'fulfilled', '家长标记已兑现');

await api('/api/v2/settings', 'POST', { materialPrices: { kibble: 5 } });
s = await api('/api/v2/student');
const kibble = s.shop.find((x) => x.key === 'kibble');
ok(kibble?.cost === 5, '材料价格覆盖生效');
await api('/api/shop/buy', 'POST', { key: 'kibble', qty: 1 });
s = await api('/api/v2/student');
ok(s.inventory.some((x) => x.key === 'kibble'), '按覆盖价买到材料');

const cal = await api('/api/v2/parent');
const day = cal.calendar.find((d) => d.date === today());
ok(day?.approved === 2 && day?.total === 2, '日历当天 2/2', JSON.stringify(day));
ok(cal.week.approved >= 2 && cal.week.total >= 2, '周汇总有数据');
ok(cal.monthSummary.approved >= 2, '月汇总有数据');

const identity = await api('/api/auth/session');
ok(identity.parentUnlocked === true, '独立家长账号已解锁');
const rest = await api('/api/v2/pet/rest', 'POST');
ok(rest.pet.stats.energy > 0, '小憩恢复到精力');

console.log(`\n通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) { console.log('失败：' + fails.join('；')); process.exit(1); }
