import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { testActivationCode } from './fixtures/activation.mjs';

const BASE = process.env.BASE;
const DB_DIR = process.env.BANXUE_TEST_DB;
if (!BASE || !DB_DIR) throw new Error('旅行验收必须通过 npm test 在隔离数据库运行');
let cookie = '';
async function api(path, method = 'GET', body) {
  const response = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  const raw = await response.text();
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { json = { raw }; }
  return { response, json };
}
function check(condition, label) {
  assert.ok(condition, label);
  console.log(`✓ ${label}`);
}

const register = await api('/api/auth/register', 'POST', {
  activationCode: testActivationCode(DB_DIR), login: `travel-${Date.now()}`,
  password: 'Travel-Suite-2026!', name: '旅行验收家长', familyName: '旅行验收家庭', childName: '旅行孩子',
});
assert.equal(register.response.status, 200, JSON.stringify(register.json));
const adopted = await api('/api/v2/adopt', 'POST', { breed: 'cat_orange', name: '小旅伴' });
assert.equal(adopted.response.status, 200, JSON.stringify(adopted.json));
let state = adopted.json;
check(state.travel.unlocked === false, '幼年宠物未开放旅行');
let locked = await api('/api/v2/travel/start', 'POST', { cityId: 'nanchang', durationHours: 1 });
check(locked.response.status === 409, '少年阶段前无法开始旅行');

const db = new DatabaseSync(join(DB_DIR, 'banxue.db'));
db.exec('PRAGMA busy_timeout = 5000;');
const pet = db.prepare('SELECT pet_id,child_id FROM pet_life WHERE pet_id=?').get(state.pet.id);
assert.ok(pet?.pet_id && pet?.child_id);
db.prepare('UPDATE pet_life SET confirmed_level=3,stage=2 WHERE pet_id=?').run(pet.pet_id);
state = (await api('/api/v2/student')).json;
check(state.travel.unlocked === true, '少年初阶自动开放旅行');
assert.deepEqual(state.travel.rarePity, { baseChance: .1, guaranteeEvery: 5, completedWithoutRare: 0, tripsUntilGuaranteed: 5 });
check(true, '稀有基础概率10%，完整旅行五次保底且初始计数独立');
check(state.travel.cities.length === 24, '旅行地图含 24 个目的地');
check(state.travel.catalog.length === 168 && state.travel.catalog.filter(item => item.type === 'postcard').length === 72, '每城有三款明信片和四类当地藏品');
for (const id of ['nanchang', 'dali', 'lijiang', 'xishuangbanna', 'urumqi', 'turpan', 'kashgar', 'yili']) {
  check(state.travel.cities.some(city => city.id === id), `地图包含 ${id}`);
}

const today = state.today;
const weekdayNumber = new Date(`${today}T00:00:00`).getDay() || 7;
const rule = await api('/api/v2/rules', 'POST', {
  title: '旅行时完成阅读', subject: '阅读', icon: '📖', weekdays: [weekdayNumber], minutes: 10,
  basePoints: 6, startTime: '00:00', endTime: '23:59', reviewRequired: false,
});
assert.equal(rule.response.status, 200, JSON.stringify(rule.json));

const started = await api('/api/v2/travel/start', 'POST', { cityId: 'nanchang', durationHours: 1 });
assert.equal(started.response.status, 200, JSON.stringify(started.json));
const earlyTrip = started.json.activeTrip;
check((await api('/api/v2/travel/' + earlyTrip.id + '/claim', 'POST', {})).response.status === 409, '旅行中不能提前查收');
check(earlyTrip.cityId === 'nanchang', '可以指定江西南昌出发');
check(earlyTrip.durationHours === 1 && Math.abs(Date.parse(earlyTrip.returnsAt) - Date.parse(earlyTrip.startedAt) - 3600000) < 3000, '1 小时行程使用服务端倒计时');
check(earlyTrip.itinerary.length === 2, '1 小时路线也会自动停靠两个城市');

for (const [path, body] of [
  ['/api/pet/interact', { action: 'pet' }],
  ['/api/v2/pet/rest', {}],
  ['/api/v2/pet/shower', {}],
  ['/api/v2/room', { revision: 0, placements: [] }],
  ['/api/shop/buy', { key: 'kibble', qty: 1 }],
]) {
  const blocked = await api(path, 'POST', body);
  check(blocked.response.status === 409, `旅行中拦截宠物操作 ${path}`);
}

state = (await api('/api/v2/student')).json;
const learningTask = state.tasks.find(task => task.title === '旅行时完成阅读');
assert.ok(learningTask, '学习任务应在旅行期间生成');
const submitted = await api(`/api/v2/tasks/${learningTask.id}/submit`, 'POST', { note: '旅行途中照常完成' });
check(submitted.response.status === 200 && submitted.json.status === 'approved', '旅行期间仍能提交并完成学习任务');

const returned = await api(`/api/v2/travel/${earlyTrip.id}/return`, 'POST', {});
assert.equal(returned.response.status, 200, JSON.stringify(returned.json));
const earlyOutcome = returned.json.lastTrip.outcome;
check(returned.json.activeTrip === null && earlyOutcome.early === true, '立即回家结束行程并记录提前返程');
check(earlyOutcome.collectionDrops.length === 1 && returned.json.collection.length === 0 && returned.json.pendingTrip?.id === earlyTrip.id, '提前回家保底明信片先进入待查收行囊，不直接进入收藏');
const restored = (await api('/api/v2/student')).json;
check(JSON.stringify(restored.travel.pendingTrip.outcome) === JSON.stringify(earlyOutcome), '刷新后待领取奖励完整保存，不重新抽取');
const blockedStart = await api('/api/v2/travel/start', 'POST', { cityId: 'beijing', durationHours: 1 });
check(blockedStart.response.status === 409, '上趟行囊未查收时不能再次出发');
const claimedEarly = await api('/api/v2/travel/' + earlyTrip.id + '/claim', 'POST', {});
check(claimedEarly.response.status === 200 && !claimedEarly.json.pendingTrip && claimedEarly.json.lastTrip.claimedAt && claimedEarly.json.collection.some(item => item.cityId === 'nanchang' && item.type === 'postcard'), '点击查收后明信片才收入收藏并记录领取时间');
const repeatEarly = await api('/api/v2/travel/' + earlyTrip.id + '/claim', 'POST', {});
check(repeatEarly.response.status === 200 && repeatEarly.json.collection[0].qty === claimedEarly.json.collection[0].qty, '已查收行囊重复请求安全返回且不重复发奖');
check(earlyOutcome.foodDrops.length === 0 && earlyOutcome.materialDrops.length === 0 && earlyOutcome.coins === 0, '未满15分钟立即返程不能反复刷取补给和星贝');
check(earlyOutcome.dropRates.collectible === 0, '提前返程不掉当地收藏品');
check(earlyOutcome.dropRates.rare === 0 && earlyOutcome.rareReward.received === false && returned.json.rarePity.completedWithoutRare === 0 && repeatEarly.json.rarePity.completedWithoutRare === 0, '立即回家和重复查收均不累计稀有保底');
const ledgerCount = db.prepare("SELECT COUNT(*) n FROM point_ledger WHERE child_id=? AND dedupe_key=?").get(pet.child_id, `travel:${earlyTrip.id}:coins`).n;
const duplicateReturn = await api(`/api/v2/travel/${earlyTrip.id}/return`, 'POST', {});
check(duplicateReturn.response.status >= 400 && db.prepare("SELECT COUNT(*) n FROM point_ledger WHERE child_id=? AND dedupe_key=?").get(pet.child_id, `travel:${earlyTrip.id}:coins`).n === ledgerCount, '重复返程请求不会重复结算奖励');

const partial = await api('/api/v2/travel/start', 'POST', { cityId: 'nanchang', durationHours: 1 });
const partialId = partial.json.activeTrip.id;
db.prepare('UPDATE pet_travel_trip SET started_at=?,returns_at=? WHERE id=?').run(new Date(Date.now() - 30 * 60000).toISOString(), new Date(Date.now() + 30 * 60000).toISOString(), partialId);
const partialReturned = await api(`/api/v2/travel/${partialId}/return`, 'POST', {});
const partialOutcome = partialReturned.json.lastTrip.outcome;
check(partialOutcome.early && partialOutcome.coins > 0 && partialOutcome.coins < 8 && partialOutcome.foodDrops.length > 0 && partialOutcome.materialDrops.length > 0, '完成半小时后提前回家按进度发放缩减补给');
const partialClaimed = await api('/api/v2/travel/' + partialId + '/claim', 'POST', {});
check(partialClaimed.json.collection.filter(item => item.cityId === 'nanchang' && item.type === 'postcard').length === 2, '同城重游优先寄回尚未收藏的明信片');

const second = await api('/api/v2/travel/start', 'POST', { cityId: 'turpan', durationHours: 2 });
assert.equal(second.response.status, 200, JSON.stringify(second.json));
const fullTrip = second.json.activeTrip;
check(fullTrip.cityId === 'turpan' && fullTrip.itinerary.length === 3, '吐鲁番两小时路线包含三个停靠城市');
const balanceBefore = (await api('/api/v2/student')).json.wallet.balance;
// Rare stream seed 2 gives 0.6041047470644116: a reproducible miss at every
// duration; seed 1 gives 0.0872284343931824 and exercises the normal 10% draw.
db.prepare('UPDATE pet_travel_trip SET started_at=?,returns_at=?,reward_seed=2 WHERE id=?').run(new Date(Date.now() - 2 * 3600000 - 1000).toISOString(), new Date(Date.now() - 1000).toISOString(), fullTrip.id);
state = (await api('/api/v2/student')).json;
check(state.travel.activeTrip === null && state.travel.lastTrip?.outcome?.early === false, '到期后读取状态会自动完成旅行');
check(state.wallet.balance === balanceBefore && state.travel.pendingTrip?.id === fullTrip.id, '正常到期先展示行囊，查收前钱包不变');
check(state.travel.lastTrip.outcome.destinations.length === 3, '正常旅行逐站寄回明信片');
assert.deepEqual(state.travel.lastTrip.outcome.dropRates, { collectible: .2, food: .45, souvenir: .35, badge: .2, rare: .1 });
check(!state.travel.lastTrip.outcome.rareReward.received && state.travel.rarePity.completedWithoutRare === 1 && state.travel.rarePity.tripsUntilGuaranteed === 4, '2小时完整行程计为一次未获稀有，普通藏品每站20%且类别45/35/20');
state = { ...state, travel: (await api('/api/v2/travel/' + fullTrip.id + '/claim', 'POST', {})).json };
check((await api('/api/v2/student')).json.wallet.balance === balanceBefore + 16, '查收后星贝才进入钱包');
check(state.travel.collection.filter(item => item.type === 'postcard').length >= 5 && state.travel.collection.filter(item => item.type === 'postcard').every(item => item.note && item.note.length > 10), '明信片收藏保存当地特色寄语');
const fullLedgerCount = db.prepare("SELECT COUNT(*) n FROM point_ledger WHERE child_id=? AND dedupe_key=?").get(pet.child_id, `travel:${fullTrip.id}:coins`).n;
await api('/api/v2/student');
check(fullLedgerCount === 1 && db.prepare("SELECT COUNT(*) n FROM point_ledger WHERE child_id=? AND dedupe_key=?").get(pet.child_id, `travel:${fullTrip.id}:coins`).n === 1, '旅行到期的重复读取只结算一次');
check(state.travel.rarePity.completedWithoutRare === 1, '领取完整旅行奖励不会再次增加保底次数');

let completedMisses = 1;
for (const durationHours of [3, 5]) {
  const result = await api('/api/v2/travel/start', 'POST', { cityId: null, durationHours });
  check(result.response.status === 200 && result.json.activeTrip.itinerary.length === durationHours + 1, `${durationHours}小时随机行程有${durationHours + 1}个不重复目的地`);
  const trip = result.json.activeTrip;
  assert.equal(new Set(trip.itinerary.map(stop => stop.id)).size, trip.itinerary.length);
  db.prepare('UPDATE pet_travel_trip SET started_at=?,returns_at=?,reward_seed=2 WHERE id=?').run(new Date(Date.now() - durationHours * 3600000 - 1000).toISOString(), new Date(Date.now() - 1000).toISOString(), trip.id);
  const results = await Promise.all(Array.from({ length: 4 }, () => api('/api/v2/student')));
  const settled = results[0].json.travel.lastTrip;
  completedMisses++;
  check(!settled.outcome.rareReward.received && results.every(row => row.json.travel.rarePity.completedWithoutRare === completedMisses), `${durationHours}小时完整行程统一累计一次，四次并发读取不重复计数`);
  check(settled.outcome.coins === durationHours * 8 && results.every(row => row.json.travel.pendingTrip?.id === trip.id && row.json.wallet.balance === results[0].json.wallet.balance), durationHours + '小时行程并发读取保留同一份待领取行囊');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM point_ledger WHERE dedupe_key=?').get('travel:' + trip.id + ':coins').n, 0);
  const beforeQty = db.prepare('SELECT COALESCE(SUM(qty),0) n FROM material_inv WHERE child_id=?').get(pet.child_id).n;
  const beforeCollection = db.prepare('SELECT COALESCE(SUM(qty),0) n FROM pet_travel_collection WHERE child_id=?').get(pet.child_id).n;
  const claims = await Promise.all(Array.from({ length: 4 }, () => api('/api/v2/travel/' + trip.id + '/claim', 'POST', {})));
  check(claims.every(row => row.response.status === 200 && !row.json.pendingTrip), '并发查收均安全完成');
  assert.ok(claims.every(row => row.json.rarePity.completedWithoutRare === completedMisses));
  const expectedQty = [...settled.outcome.foodDrops, ...settled.outcome.materialDrops].reduce((sum, drop) => sum + drop.qty, 0);
  assert.equal(db.prepare('SELECT COALESCE(SUM(qty),0) n FROM material_inv WHERE child_id=?').get(pet.child_id).n, beforeQty + expectedQty);
  assert.equal(db.prepare('SELECT COALESCE(SUM(qty),0) n FROM pet_travel_collection WHERE child_id=?').get(pet.child_id).n, beforeCollection + settled.outcome.collectionDrops.reduce((sum, drop) => sum + drop.qty, 0));
  check((await api('/api/v2/student')).json.wallet.balance === results[0].json.wallet.balance + settled.outcome.coins, '查收后物品、收藏和星贝准确入账一次');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM point_ledger WHERE dedupe_key=?').get(`travel:${trip.id}:coins`).n, 1);
}

const expireTrip = (trip, seed = 2) => db.prepare('UPDATE pet_travel_trip SET started_at=?,returns_at=?,reward_seed=? WHERE id=?').run(new Date(Date.now() - trip.durationHours * 3600000 - 1000).toISOString(), new Date(Date.now() - 1000).toISOString(), seed, trip.id);
async function finishTrip(hours, seed = 2, cityId = 'nanchang') {
  const started = await api('/api/v2/travel/start', 'POST', { cityId, durationHours: hours });
  assert.equal(started.response.status, 200, JSON.stringify(started.json));
  expireTrip(started.json.activeTrip, seed);
  const student = await api('/api/v2/student');
  assert.equal(student.response.status, 200, JSON.stringify(student.json));
  return student.json.travel;
}
async function claimPending(travel) {
  const response = await api('/api/v2/travel/' + travel.pendingTrip.id + '/claim', 'POST', {});
  assert.equal(response.response.status, 200, JSON.stringify(response.json));
  return response.json;
}

let pityTravel = await finishTrip(1);
check(!pityTravel.pendingTrip.outcome.rareReward.received && pityTravel.rarePity.completedWithoutRare === 4 && pityTravel.rarePity.tripsUntilGuaranteed === 1, '跨2/3/5/1小时完整旅行累计四次未得稀有，第五次进入保底');
pityTravel = await claimPending(pityTravel);
for (const elapsedMinutes of [0, 30]) {
  const start = await api('/api/v2/travel/start', 'POST', { cityId: 'nanchang', durationHours: 1 });
  assert.equal(start.response.status, 200, JSON.stringify(start.json));
  const trip = start.json.activeTrip;
  db.prepare('UPDATE pet_travel_trip SET started_at=?,returns_at=?,reward_seed=1 WHERE id=?').run(new Date(Date.now() - elapsedMinutes * 60000).toISOString(), new Date(Date.now() + (60 - elapsedMinutes) * 60000).toISOString(), trip.id);
  const returned = await api(`/api/v2/travel/${trip.id}/return`, 'POST', {});
  assert.equal(returned.response.status, 200, JSON.stringify(returned.json));
  const outcome = returned.json.pendingTrip.outcome;
  check(outcome.early && !outcome.rareReward.received && !outcome.rareReward.guaranteed && returned.json.rarePity.completedWithoutRare === 4 && returned.json.rarePity.tripsUntilGuaranteed === 1, `${elapsedMinutes}分钟提前回家不参与稀有抽奖，不增加也不清空已有四次保底`);
  if (elapsedMinutes) assert.ok(outcome.coins > 0 && outcome.coins < 8 && outcome.materialDrops.length > 0);
  const claimed = await claimPending(returned.json);
  assert.equal(claimed.rarePity.completedWithoutRare, 4);
}

const guaranteedStart = await api('/api/v2/travel/start', 'POST', { cityId: 'turpan', durationHours: 2 });
assert.equal(guaranteedStart.response.status, 200, JSON.stringify(guaranteedStart.json));
const guaranteedTrip = guaranteedStart.json.activeTrip;
const ownedRareKey = guaranteedTrip.itinerary[0].id + '.rare';
const ownedAt = new Date().toISOString();
db.prepare('INSERT OR IGNORE INTO pet_travel_collection(child_id,item_key,qty,first_trip_id,first_at,last_at) VALUES(?,?,?,?,?,?)').run(pet.child_id, ownedRareKey, 1, 'owned-rare-fixture', ownedAt, ownedAt);
expireTrip(guaranteedTrip); // seed 2 misses naturally: only the fifth-trip guarantee can award it.
const guaranteedReads = await Promise.all(Array.from({ length: 4 }, () => api('/api/v2/student')));
pityTravel = guaranteedReads[0].json.travel;
const guaranteedOutcome = pityTravel.pendingTrip.outcome;
const rareDrops = guaranteedOutcome.collectionDrops.filter(drop => pityTravel.catalog.find(item => item.key === drop.key)?.type === 'rare');
check(guaranteedOutcome.rareReward.guaranteed && guaranteedOutcome.rareReward.received && rareDrops.length === 1 && rareDrops[0].qty === 1, '第五次完整旅行强制带回恰好一件稀有，即使本次种子未命中10%');
check(rareDrops[0].key !== ownedRareKey && guaranteedTrip.itinerary.some(city => rareDrops[0].key === city.id + '.rare'), '保底稀有来自实际到访城市，优先路线中尚未获得的稀有');
const persistedOutcome = db.prepare('SELECT outcome_json FROM pet_travel_trip WHERE id=?').get(guaranteedTrip.id).outcome_json;
check(guaranteedReads.every(row => row.json.travel.rarePity.completedWithoutRare === 0 && row.json.travel.rarePity.tripsUntilGuaranteed === 5 && JSON.stringify(row.json.travel.pendingTrip.outcome) === persistedOutcome), '第五次保底结果与重置状态一起持久保存，并发读取不重抽');
const parentTravel = (await api('/api/v2/parent')).json.travel;
check(JSON.stringify(parentTravel.rarePity) === JSON.stringify(pityTravel.rarePity) && JSON.stringify(parentTravel.pendingTrip.outcome) === persistedOutcome && parentTravel.catalog.length === pityTravel.catalog.length, '家长端返回同一份旅行收藏、已持久结果与保底统计');
const guaranteeClaims = await Promise.all(Array.from({ length: 3 }, () => api('/api/v2/travel/' + guaranteedTrip.id + '/claim', 'POST', {})));
check(guaranteeClaims.every(row => row.response.status === 200 && row.json.rarePity.completedWithoutRare === 0) && db.prepare('SELECT outcome_json FROM pet_travel_trip WHERE id=?').get(guaranteedTrip.id).outcome_json === persistedOutcome, '重复查收不重抽稀有、不改变保底计数与持久结果');
pityTravel = await finishTrip(1, 2);
assert.equal(pityTravel.rarePity.completedWithoutRare, 1);
await claimPending(pityTravel);
pityTravel = await finishTrip(5, 1);
check(pityTravel.pendingTrip.outcome.rareReward.received && !pityTravel.pendingTrip.outcome.rareReward.guaranteed && pityTravel.rarePity.completedWithoutRare === 0, '10%普通稀有抽奖独立于时长，未到第五次也能获得并重置保底');
await claimPending(pityTravel);

const originalCookie = cookie;
const otherFamily = await api('/api/auth/register', 'POST', { activationCode: testActivationCode(DB_DIR), login: 'travel-other-' + Date.now(), password: 'Travel-Other-2026!', name: '另一位家长', familyName: '另一家庭', childName: '另一孩子' });
assert.equal(otherFamily.response.status, 200, JSON.stringify(otherFamily.json));
check((await api('/api/v2/travel/' + fullTrip.id + '/claim', 'POST', {})).response.status === 404, '不能领取其他家庭孩子的行囊');
let otherState = (await api('/api/v2/student')).json;
check(otherState.travel.rarePity.completedWithoutRare === 0 && otherState.travel.rarePity.tripsUntilGuaranteed === 5, '另一家庭的稀有保底从零开始，和当前家庭独立');
const otherAdopted = await api('/api/v2/adopt', 'POST', { breed: 'cat_orange', name: '旧旅行验收' });
assert.equal(otherAdopted.response.status, 200, JSON.stringify(otherAdopted.json));
const otherPet = db.prepare('SELECT pet_id,child_id FROM pet_life WHERE pet_id=?').get(otherAdopted.json.pet.id);
const legacyOutcome = { early: false, progress: 100, destinations: ['beijing'], collectionDrops: [{ key: 'beijing.postcard', qty: 1 }], foodDrops: [], materialDrops: [], coins: 0, dropRates: { collectible: .083, food: .44, souvenir: .31, badge: .2, rare: .05 } };
const insertLegacy = (id, duration, outcome, pending = false, offset = 0) => {
  const ended = new Date(Date.now() - (24 - offset) * 3600000).toISOString();
  db.prepare(`INSERT INTO pet_travel_trip(id,child_id,pet_id,start_city_id,itinerary_json,duration_hours,reward_seed,started_at,returns_at,status,returned_at,outcome_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, otherPet.child_id, otherPet.pet_id, 'beijing', '["beijing"]', duration, 1, new Date(Date.parse(ended) - duration * 3600000).toISOString(), ended, pending ? 'awaiting_claim' : 'returned', ended, JSON.stringify(outcome));
};
for (const [index, duration] of [1, 2, 3, 5].entries()) insertLegacy(`legacy-travel-${otherPet.child_id}-${index}`, duration, legacyOutcome, index === 3, index);
const legacyPendingId = `legacy-travel-${otherPet.child_id}-3`;
const legacyJson = db.prepare('SELECT outcome_json FROM pet_travel_trip WHERE id=?').get(legacyPendingId).outcome_json;
otherState = (await api('/api/v2/student')).json;
check(otherState.travel.rarePity.completedWithoutRare === 4 && otherState.travel.rarePity.tripsUntilGuaranteed === 1 && JSON.stringify(otherState.travel.pendingTrip.outcome) === legacyJson && otherState.travel.pendingTrip.outcome.rareReward === undefined, '旧已发奖与已生成待领取结果计入历史，缺省新字段安全且原奖励不重抽');
const oldClaimed = await claimPending(otherState.travel);
assert.equal(oldClaimed.rarePity.completedWithoutRare, 4);
const legacyQty = db.prepare('SELECT SUM(qty) n FROM pet_travel_collection WHERE child_id=?').get(otherPet.child_id).n;
await api('/api/v2/travel/' + `legacy-travel-${otherPet.child_id}-0` + '/claim', 'POST', {});
check(db.prepare('SELECT SUM(qty) n FROM pet_travel_collection WHERE child_id=?').get(otherPet.child_id).n === legacyQty && db.prepare('SELECT outcome_json FROM pet_travel_trip WHERE id=?').get(legacyPendingId).outcome_json === legacyJson, '旧版已发奖旅行重试查收不再次发奖，旧待领取结果查收后保持原样');
const otherCookie = cookie;
cookie = originalCookie;
check((await api('/api/v2/student')).json.travel.rarePity.completedWithoutRare === 0, '其他家庭累计四次历史不会影响原家庭的保底');
cookie = otherCookie;
insertLegacy(`legacy-rare-${otherPet.child_id}`, 1, { ...legacyOutcome, collectionDrops: [{ key: 'beijing.rare', qty: 1 }] }, false, 5);
check((await api('/api/v2/student')).json.travel.rarePity.completedWithoutRare === 0, '旧版已获得稀有的持久结果也会正确重置历史连续未得计数');
cookie = originalCookie;
db.close();
console.log('\n旅行验收全部通过。');
