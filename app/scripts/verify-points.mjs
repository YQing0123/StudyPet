/** Real HTTP checks against the isolated test service. Never use a live family DB. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { testActivationCode } from './fixtures/activation.mjs';
const base = process.env.BASE, dir = process.env.BANXUE_TEST_DB;
if (!base || !dir) throw Error('积分验收必须使用隔离服务和数据库');
let count = 0;
const ok = (value, message) => { assert.ok(value, message); count++; console.log('✓ ' + message); };
class Client {
  cookie = ''; scope = {};
  async call(path, body, status = 200, method = body === undefined ? 'GET' : 'POST', extra = {}) {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie: this.cookie, ...this.scope, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await r.json(); assert.equal(r.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
    if (r.headers.has('set-cookie')) this.cookie = r.headers.get('set-cookie').split(';')[0];
    return data;
  }
  use(s) { this.scope = { 'x-family-id': s.family.id, 'x-child-id': s.activeChildId }; return s; }
}
const dad = new Client(), student = new Client(), other = new Client(), anon = new Client();
const suffix = Date.now(), password = 'Points-Only-2026!';
const form = login => ({ activationCode: testActivationCode(dir), login: login + suffix, password, name: '验收家长', familyName: '积分隔离家庭', childName: '验收孩子' });
const db = new DatabaseSync(join(dir, 'banxue.db')); db.exec('PRAGMA busy_timeout=5000');
try {
  await anon.call('/api/v2/ledger', undefined, 401);
  const session = dad.use(await dad.call('/api/auth/register', form('points-dad'))), childId = session.activeChildId;
  other.use(await other.call('/api/auth/register', form('points-other')));
  await dad.call(`/api/family/children/${childId}/account`, { login: 'points-student' + suffix, password });
  student.use(await student.call('/api/auth/login', { login: 'points-student' + suffix, password }));
  const empty = await student.call('/api/v2/ledger');
  ok(empty.items.length === 0 && empty.summary.balance === 0, '学生可读取空账本，无需领养宠物');
  const config = { title: '超过约定的游戏时间', points: 10, note: '每超时一次扣10星贝', active: true };
  let items = await dad.call('/api/v2/penalties', config), item = items[0];
  ok(items.length === 1 && item.points === 10, '家长新增惩罚并保存快捷清单');
  for (const path of ['/api/v2/penalties', `/api/v2/penalties/${item.id}/apply`]) await student.call(path, { ...config, requestId: crypto.randomUUID() }, 403);
  await student.call('/api/v2/penalties', undefined, 403);
  await student.call(`/api/v2/penalties/${item.id}`, undefined, 403, 'DELETE');
  ok(true, '学生只能看明细，不能查看配置、增删或执行惩罚');
  for (const points of [0, -1, 1.5, 10000, '10', null]) await dad.call('/api/v2/penalties', { ...config, points }, 400);
  await dad.call('/api/v2/penalties', { ...config, title: ' ' }, 400);
  await dad.call('/api/v2/penalties', { ...config, note: 'a'.repeat(161) }, 400);
  await dad.call(`/api/v2/penalties/${item.id}/apply`, {}, 400);
  ok(true, '拒绝空名称、无效扣分、过长说明和缺失的请求标识');
  await other.call('/api/v2/penalties', { ...item, title: '跨家庭覆盖' }, 400);
  await other.call(`/api/v2/penalties/${item.id}/apply`, { requestId: crypto.randomUUID() }, 400);
  await other.call(`/api/v2/penalties/${item.id}`, undefined, 200, 'DELETE');
  await other.call('/api/v2/ledger', undefined, 403, 'GET', dad.scope);
  ok((await dad.call('/api/v2/penalties')).length === 1, '其他家庭不能覆盖、执行或删除当前孩子的项目，也不能读取账本');
  const sibling = (await dad.call('/api/family/children', { name: '二宝', grade: 2 })).children.find(c => c.id !== childId).id;
  dad.scope['x-child-id'] = sibling;
  await dad.call(`/api/v2/penalties/${item.id}/apply`, { requestId: crypto.randomUUID() }, 400);
  ok((await dad.call('/api/v2/penalties')).length === 0 && (await dad.call('/api/v2/ledger')).items.length === 0, '兄弟姐妹的清单与积分独立');
  dad.scope['x-child-id'] = childId;
  await dad.call('/api/auth/lock', {});
  await dad.call(`/api/v2/penalties/${item.id}/apply`, { requestId: crypto.randomUUID() }, 403);
  await dad.call('/api/v2/ledger'); await dad.call('/api/auth/unlock', { password });
  ok(true, '锁定家长仍可看积分，但不能扣分');
  await dad.call('/api/v2/points/gift', { amount: 5, reason: '主动整理书桌' });
  const requestId = crypto.randomUUID();
  const race = await Promise.all([dad.call(`/api/v2/penalties/${item.id}/apply`, { requestId, points: 999 }), dad.call(`/api/v2/penalties/${item.id}/apply`, { requestId })]);
  assert.equal(race[0].entry.id, race[1].entry.id);
  let history = await student.call('/api/v2/ledger');
  ok(history.summary.balance === -5 && history.summary.earned === 5 && history.summary.spent === 10 && history.items.length === 2, '并发重复请求只扣一次，金额取服务端配置；余额不足完整扣分且收支对账');
  ok(history.items.some(r => r.kind === 'penalty' && r.delta === -10 && r.reason.includes(config.title) && r.reason.includes(config.note)), '学生即时读到惩罚名称、说明、负积分和时间');
  await dad.call('/api/v2/penalties', { ...item, points: 3, title: '新的项目名', note: '新的说明', active: false });
  await dad.call(`/api/v2/penalties/${item.id}/apply`, { requestId: crypto.randomUUID() }, 400);
  await dad.call('/api/v2/penalties', { ...item, points: 3, title: '新的项目名', note: '新的说明', active: true });
  await dad.call(`/api/v2/penalties/${item.id}/apply`, { requestId: crypto.randomUUID() });
  await dad.call(`/api/v2/penalties/${item.id}`, undefined, 200, 'DELETE');
  await dad.call(`/api/v2/penalties/${item.id}/apply`, { requestId: crypto.randomUUID() }, 400);
  const repeat = await dad.call(`/api/v2/penalties/${item.id}/apply`, { requestId });
  history = await student.call('/api/v2/ledger');
  ok(repeat.repeated && history.summary.balance === -8 && history.items.some(r => r.reason.includes(config.title)) && history.items.some(r => r.reason.includes('新的项目名') && r.delta === -3), '编辑、停用、重启用、删除正确生效；历史快照保留，已成功请求重试不再扣分');
  // Existing ledger entries from all sources are visible, including same-time pages.
  const stamp = '2026-11-17T12:00:00.000Z';
  for (let i = 0; i < 65; i++) db.prepare('INSERT INTO point_ledger VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(), childId, '2026-11-17', i % 2 ? -2 : 4, i % 2 ? '兑换材料：食物' : '完成学习任务', `points-test:${childId}:${i}`, stamp);
  const first = await student.call('/api/v2/ledger?limit=20');
  const ids = new Set(); let page = first;
  do {
    for (const row of page.items) { assert.ok(!ids.has(row.id)); ids.add(row.id); }
    page = page.next ? await student.call('/api/v2/ledger?limit=20&before=' + encodeURIComponent(page.next)) : null;
  } while (page);
  ok(ids.size === 68, '多页历史包含全部旧记录，同一毫秒入账无重复或遗漏');
  const income = await student.call('/api/v2/ledger?filter=income&limit=100'), expense = await student.call('/api/v2/ledger?filter=expense&limit=100');
  ok(income.items.every(r => r.delta > 0) && expense.items.every(r => r.delta < 0) && income.items.length + expense.items.length === ids.size && income.summary.balance === expense.summary.balance, '得分/扣分筛选覆盖所有来源，汇总与账本余额一致');
  db.prepare('INSERT INTO point_ledger VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(), childId, '2026-11-17', 0, '任务通过：迟交后零分', `points-zero:${childId}`, new Date().toISOString());
  ok((await student.call('/api/v2/ledger?limit=100')).items.some(r => r.delta === 0 && r.kind === 'neutral'), '历史零分任务显示积分未变，不误标为扣分');
  await student.call('/api/v2/ledger?before=bad', undefined, 400); await student.call('/api/v2/ledger?filter=bad', undefined, 400); await student.call('/api/v2/ledger?limit=NaN', undefined, 400);
  ok(true, '无效分页和筛选参数被拒绝');
  item = (await dad.call('/api/v2/penalties', config))[0];
  const balance = (await student.call('/api/v2/ledger')).summary.balance;
  db.prepare('UPDATE family SET expires_at=? WHERE id=?').run(Date.now() - 1000, session.family.id);
  await dad.call(`/api/v2/penalties/${item.id}/apply`, { requestId: crypto.randomUUID() }, 402);
  await dad.call('/api/v2/penalties', config, 402); await dad.call(`/api/v2/penalties/${item.id}`, undefined, 402, 'DELETE');
  ok((await student.call('/api/v2/ledger')).summary.balance === balance, '家庭到期仍可看明细，新增、删除和扣分全部阻断');
  console.log(`${count} point history/penalty checks passed`);
} finally { db.close(); }
