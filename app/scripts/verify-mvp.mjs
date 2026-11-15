/** MVP 业务闭环验收：直接打 API，不依赖浏览器。先运行 node scripts/dev.mjs 或 server/index.mjs。 */
const BASE = process.env.BASE;
if (!BASE) throw new Error('请运行 npm test，自动使用隔离数据库；直接验收必须显式指定 BASE。');

let cookie = '';
let pass = 0;
const fails = [];
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fails.push(name); console.log(`✗ ${name} ${extra}`); }
}
async function api(path, method = 'GET', body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json?.error || text}`);
  return json;
}

console.log(`MVP 验收：${BASE}\n`);

await api('/api/auth/register', 'POST', { login: 'mvp-suite-'+Date.now(), password: 'Suite-Only-2026!', name:'验收家长', familyName:'MVP隔离家庭',childName:'验收孩子' });
let d = await api('/api/today');
ok(d.isNew === true && d.pet === null, '新家庭初始处于未领养状态');

d = await api('/api/pet/adopt', 'POST', { breed: 'cat_orange', name: '小橘' });
ok(d.pet?.name === '小橘' && d.pet?.stage === 1, '领养橘猫并进入幼年');
ok(d.tasks.length === 3, '领养时放入 3 个示例任务');
ok(d.wallet.balance === 0, '初始星贝为 0');
ok(d.inventory.length === 0, '初始背包为空');

let task = d.tasks[0];
d = await api(`/api/tasks/${task.id}`, 'PATCH', { done: true });
ok(d.wallet.balance === task.points, '完成一个任务获得对应星贝');
ok(d.progress.done === 1, '进度 1/3');
ok(d.pet.stats.mood > 86, '完成任务让宠物心情变好');

for (const t of d.tasks.filter((x) => x.status === 'open')) {
  d = await api(`/api/tasks/${t.id}`, 'PATCH', { done: true });
}
const afterAll = d.wallet.balance;
ok(d.progress.percent === 100, '全部完成进度 100%');
ok(afterAll === 52, '三个任务 37 + 全清 15 = 52 星贝', String(afterAll));
ok(d.bonus?.awarded === true, '第一次全清发放 +15 奖励');

d = await api('/api/tasks', 'POST', { title: '附加任务', subject: '阅读', minutes: 10, points: 8 });
ok(d.wallet.balance === afterAll, '追加任务不会追回已发的全清奖励');
const extra = d.tasks.find((x) => x.title === '附加任务');
d = await api(`/api/tasks/${extra.id}`, 'PATCH', { done: true });
ok(d.wallet.balance === afterAll + 8, '追加任务完成后正常入账');
ok(d.bonus?.awarded === false, '追加任务完成后不重复发全清奖励');
d = await api(`/api/tasks/${extra.id}`, 'PATCH', { done: false });
ok(d.wallet.balance === afterAll, '撤销追加任务退回 8 星贝');

const beforeBuy = d.wallet.balance;
d = await api('/api/shop/buy', 'POST', { key: 'kibble', qty: 1 });
ok(d.wallet.balance === beforeBuy - 22, '兑换小饼干扣 22 星贝');
ok(d.inventory.some((x) => x.key === 'kibble' && x.qty === 1), '小饼干进入背包');

const hungerBefore = d.pet.stats.hunger;
const growthBefore = d.pet.growth;
d = await api('/api/pet/use', 'POST', { key: 'kibble' });
ok(d.pet.stats.hunger > hungerBefore, '喂食后饱食上升', `${hungerBefore} -> ${d.pet.stats.hunger}`);
ok(d.pet.growth === growthBefore + 1, '喂食成长 +1');
ok(!d.inventory.some((x) => x.key === 'kibble'), '用完后材料从背包移除');

d = await api('/api/pet/interact', 'POST', { action: 'pet' });
ok(d.pet.growth >= growthBefore + 2, '摸头也增加成长');
let cooldownBlocked = false;
try { await api('/api/pet/interact', 'POST', { action: 'pet' }); } catch (e) { cooldownBlocked = /回味|秒后/.test(e.message); }
ok(cooldownBlocked, '连续摸头有冷却');

d = await api('/api/pet/rename', 'POST', { name: '小桔' });
ok(d.pet.name === '小桔', '改名成功');

d = await api('/api/today');
ok(d.tasks.length === 4, '刷新后任务仍在');
ok(d.pet.stats.hunger >= 0 && d.pet.stats.hunger <= 100, '数值始终限制在 0~100');

console.log(`\n通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) { console.log('失败：' + fails.join('；')); process.exit(1); }
