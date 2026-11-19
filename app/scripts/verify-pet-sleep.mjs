/** Scheduled sleep, gentle warnings and care guards, always on disposable family data. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SLEEP_SCHEDULE, sleepWindow, validateSleepSchedule, sleptMilliseconds } from '../web/src/shared/petSleep.mjs';
const dir = mkdtempSync(join(tmpdir(), 'banxue-sleep-'));
process.env.BANXUE_DATA_DIR = dir;
const { q, db } = await import('../server/db.mjs');
const D = await import('../server/daily.mjs');
const V = await import('../server/v2.mjs');
const S = await import('../server/pet-sleep.mjs');
const B = await import('../server/pet-backups.mjs');
const RealDate = Date;
let time = RealDate.parse('2026-11-16T21:29:59+08:00');
class ClockDate extends RealDate { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return time; } }
globalThis.Date = ClockDate;
const at = value => { time = RealDate.parse(value); };
const advance = ms => { time += ms; };
let checks = 0;
const check = (label, fn) => { fn(); checks++; console.log('✓ ' + label); };
const schedule = { ...DEFAULT_SLEEP_SCHEDULE, nightEnabled: true, napEnabled: true };
const create = id => { q.run('INSERT INTO child(id,name,created_at) VALUES(?,?,?)', id, '睡眠验收', new Date().toISOString()); D.adopt(id, { breed: 'alpaca_toon', name: '梦梦' }); };
try {
  const id = 'sleep-test'; create(id); create('sleep-other');
  check('既有家庭作息默认关闭，不突然限制互动', () => assert.equal(S.sleepState(id).active, null));
  for (const invalid of [null, [], {}, { ...schedule, nightStart: '25:00' }, { ...schedule, nightEnabled: 'true' }, { ...schedule, nightStart: '07:00' }, { ...schedule, napEnd: '12:00' }, { ...schedule, napStart: '06:00' }]) {
    check('拒绝非法时间、错误开关、零时长和重叠区间', () => assert.throws(() => validateSleepSchedule(invalid)));
  }
  V.setParentSettings(id, { petSleep: schedule });
  check('孩子独立保存作息且家长读取一致', () => { assert.deepEqual(V.getParentState(id).settings.petSleep, schedule); assert.equal(S.sleepState('sleep-other').schedule.nightEnabled, false); });
  check('入睡前一秒仍清醒', () => assert.equal(S.sleepState(id).active, null));
  at('2026-11-16T21:30:00+08:00');
  check('到夜间开始时间立刻入睡', () => assert.equal(V.getStudentState(id).sleep.active.kind, 'night'));
  const windowId = S.sleepState(id).active.id;
  at('2026-11-17T00:00:00+08:00');
  check('跨午夜仍属于同一段睡眠', () => assert.equal(S.sleepState(id).active.id, windowId));
  at('2026-11-17T06:59:59+08:00');
  check('清晨起床前仍在睡觉', () => assert.equal(S.sleepState(id).active.kind, 'night'));
  at('2026-11-17T07:00:00+08:00');
  check('起床边界恢复清醒', () => assert.equal(S.sleepState(id).active, null));
  at('2026-11-17T13:00:00+08:00');
  check('午休边界入睡且与夜间分别计数', () => assert.equal(S.sleepState(id).active.kind, 'nap'));
  at('2026-11-17T14:00:00+08:00');
  check('午休结束边界醒来', () => assert.equal(S.sleepState(id).active, null));
  check('固定北京时间，不依赖系统所在时区', () => assert.equal(sleepWindow(schedule, RealDate.parse('2026-11-16T13:30:00Z')).kind, 'night'));
  check('睡眠时长精确结算跨夜和午休', () => {
    assert.equal(sleptMilliseconds(schedule, RealDate.parse('2026-11-16T20:00:00+08:00'), RealDate.parse('2026-11-17T08:00:00+08:00')), 9.5 * 3600000);
    assert.equal(sleptMilliseconds(schedule, RealDate.parse('2026-11-17T12:30:00+08:00'), RealDate.parse('2026-11-17T14:30:00+08:00')), 3600000);
  });

  at('2026-11-17T21:30:00+08:00');
  q.run('UPDATE pet_life SET mood=70,energy=30,hunger=80,clean=80,last_tick=? WHERE child_id=?', new Date().toISOString(), id);
  const touch = () => V.touchSleepingPet(id).sleepInteraction;
  let result = touch();
  check('第一次打扰只有梦话和翻身，不扣心情', () => { assert.equal(result.count, 1); assert.equal(result.warning, false); assert.equal(result.penalty, 0); assert.match(result.message, /休息|睡觉/); });
  for (let i = 0; i < 20; i++) touch();
  check('连续快速点击不累计惩罚次数', () => assert.equal(touch().count, 1));
  advance(2100); result = touch();
  check('第二次仍温柔回应并切换动作', () => { assert.equal(result.warning, false); assert.equal(result.motion, 1); assert.equal(result.penalty, 0); });
  advance(2100); result = touch();
  check('第三次先明确警告，绝不同时扣分', () => { assert.equal(result.warning, true); assert.match(result.message, /继续打扰.*减 2/); assert.equal(result.penalty, 0); });
  const saved = B.backupPet(id, D.getPetRow(id).pet_id);
  check('读取或刷新状态不视为打扰', () => { for (let i = 0; i < 8; i++) V.getStudentState(id); assert.equal(q.get('SELECT count FROM pet_sleep_disturbance WHERE child_id=?', id).count, 3); });
  advance(2100); result = touch();
  check('警告后仍保留阅读缓冲，不立即扣分', () => assert.equal(result.penalty, 0));
  advance(2100); result = touch();
  check('第五次若未过十秒仍不扣分', () => assert.equal(result.penalty, 0));
  advance(6000); result = touch();
  check('明确警告后继续打扰才扣 2 心情', () => { assert.equal(result.penalty, 2); assert.equal(result.totalPenalty, 2); });
  advance(2100); result = touch();
  check('每分钟最多扣一次', () => assert.equal(result.penalty, 0));
  B.restorePet(id, saved.id, D.getPetRow(id).pet_id);
  check('恢复备份不会清除作息与打扰记录', () => { assert.equal(S.sleepState(id).active.kind, 'night'); assert.equal(q.get('SELECT total_penalty FROM pet_sleep_disturbance WHERE child_id=?', id).total_penalty, 2); });
  advance(61000); result = touch();
  advance(61000); result = touch();
  advance(61000); result = touch();
  check('每段睡眠扣减上限 6 点且话术说明停止扣减', () => { assert.equal(result.totalPenalty, 6); assert.equal(result.penalty, 0); assert.match(result.message, /不再扣/); });
  advance(5 * 60000); result = touch();
  check('安静五分钟后重新温柔提醒，上限保留', () => { assert.equal(result.count, 1); assert.equal(result.warning, false); assert.equal(result.totalPenalty, 6); });
  at('2026-11-18T13:00:00+08:00'); result = touch();
  check('新一段睡眠重新开始计数和上限', () => { assert.equal(result.count, 1); assert.equal(result.totalPenalty, 0); });

  V.giftPoints(id, { amount: 500 });
  for (const key of ['brush', 'bath', 'milk', 'ball', 'bow']) D.buy(id, { key });
  const before = V.getStudentState(id);
  for (const key of ['brush', 'bath', 'milk', 'ball', 'bow']) {
    advance(2100);
    const used = D.useMaterial(id, { key });
    check(`睡眠时使用 ${key} 提醒休息且不消耗、不增加成长`, () => { assert.ok(used.sleepInteraction); assert.equal(used.inventory.find(i => i.key === key).qty, before.inventory.find(i => i.key === key).qty); assert.equal(used.pet.growth, before.pet.growth); });
  }
  check('睡眠时装扮不被偷偷穿上', () => assert.deepEqual(V.getStudentState(id).pet.outfit, {}));
  for (const action of ['pet', 'play', 'hug']) {
    advance(2100); const r = D.interact(id, { action });
    check(`睡眠期间 ${action} 不刷成长和互动奖励`, () => { assert.ok(r.sleepInteraction); assert.equal(r.pet.growth, before.pet.growth); });
  }
  const energy = V.getStudentState(id).pet.stats.energy;
  advance(2100); const resting = V.restPet(id);
  check('作息睡眠不能反复领取手动小憩奖励', () => { assert.ok(resting.sleepInteraction); assert.ok(resting.pet.stats.energy - energy < .1); });
  at('2026-11-18T14:00:00+08:00');
  check('睡醒后材料正常使用', () => { const used = D.useMaterial(id, { key: 'brush' }); assert.equal(used.sleepInteraction, undefined); assert.ok(!used.inventory.some(i => i.key === 'brush')); });
  check('离线期间没有自动打扰扣减', () => assert.equal(q.get('SELECT count FROM pet_sleep_disturbance WHERE child_id=?', id).count, resting.sleepInteraction.count));

  at('2026-11-18T20:00:00+08:00');
  q.run('UPDATE pet_life SET energy=20,hunger=80,mood=80,clean=80,last_tick=? WHERE child_id=?', new Date().toISOString(), id);
  at('2026-11-18T22:30:00+08:00');
  check('精力区分清醒衰减与实际睡眠恢复', () => assert.ok(Math.abs(D.getPetRow(id).energy - (20 - 1.5 * D.DECAY_PER_HOUR.energy + 8)) < .001));
  S.saveSleepSchedule('sleep-other', { ...schedule, nightEnabled: false, napEnabled: false });
  q.run('UPDATE pet_life SET energy=20,last_tick=? WHERE child_id=?', new Date(time - 3600000).toISOString(), 'sleep-other');
  V.setParentSettings('sleep-other', { petSleep: schedule });
  check('新开启作息不追溯发放过去的睡眠恢复', () => assert.ok(Math.abs(D.getPetRow('sleep-other').energy - (20 - D.DECAY_PER_HOUR.energy)) < .001));
  create('sleep-low-mood'); S.saveSleepSchedule('sleep-low-mood', schedule);
  q.run('UPDATE pet_life SET mood=.65 WHERE child_id=?', 'sleep-low-mood');
  V.touchSleepingPet('sleep-low-mood'); advance(2100); V.touchSleepingPet('sleep-low-mood');
  advance(2100); V.touchSleepingPet('sleep-low-mood'); advance(2100); V.touchSleepingPet('sleep-low-mood');
  advance(10000); const low = V.touchSleepingPet('sleep-low-mood');
  check('低心情扣减不为负，提示不出现长小数', () => { assert.equal(low.pet.stats.mood, 0); assert.equal(low.sleepInteraction.penalty, .6); assert.match(low.sleepInteraction.message, /心情 -0\.6/); });
  console.log(`${checks} sleep checks passed`);
} finally { globalThis.Date = RealDate; db.close(); rmSync(dir, { recursive: true, force: true }); }
