/**
 * 伴学小岛 v2：周计划 / 家长审核 / 自定义奖励 / 日历汇总 / 通知
 * 与 v1（daily.mjs）共享宠物状态、积分账本、材料背包。
 */
import { q, db, uid, tx } from './db.mjs';
import * as DAILY from './daily.mjs';
import * as NOTIFY from './notifications.mjs';
import * as CARDS from './notification-cards.mjs';
import * as PET_BACKUPS from './pet-backups.mjs';

db.exec(`
CREATE TABLE IF NOT EXISTS plan_rule (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  title TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '自习',
  icon TEXT NOT NULL DEFAULT '📘',
  minutes INTEGER NOT NULL DEFAULT 15,
  weekdays TEXT NOT NULL DEFAULT '[1,2,3,4,5,6,7]',
  start_time TEXT,
  end_time TEXT,
  base_points INTEGER NOT NULL DEFAULT 10,
  early_bonus INTEGER NOT NULL DEFAULT 0,
  late_penalty INTEGER NOT NULL DEFAULT 0,
  review_required INTEGER NOT NULL DEFAULT 1,
  photo_required INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rule_child ON plan_rule(child_id, active);

CREATE TABLE IF NOT EXISTS v2_task (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  rule_id TEXT,
  date TEXT NOT NULL,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  icon TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  window_start TEXT,
  window_end TEXT,
  base_points INTEGER NOT NULL,
  early_bonus INTEGER NOT NULL DEFAULT 0,
  late_penalty INTEGER NOT NULL DEFAULT 0,
  review_required INTEGER NOT NULL DEFAULT 1,
  photo_required INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  timing TEXT,
  awarded_points INTEGER,
  note TEXT,
  photo TEXT,
  reject_reason TEXT,
  submitted_at TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(child_id, rule_id, date)
);
CREATE INDEX IF NOT EXISTS idx_v2_task_day ON v2_task(child_id, date, status);
CREATE INDEX IF NOT EXISTS idx_v2_task_status ON v2_task(child_id, status);

CREATE TABLE IF NOT EXISTS reward_item (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  title TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '🎁',
  cost INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'experience',
  stock INTEGER NOT NULL DEFAULT -1,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS redemption (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  reward_id TEXT NOT NULL,
  title TEXT NOT NULL,
  icon TEXT NOT NULL,
  cost INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  handled_at TEXT
);

CREATE TABLE IF NOT EXISTS daily_note (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  date TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  sender_relation TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(child_id, date, sender_id)
);
CREATE INDEX IF NOT EXISTS idx_note_day ON daily_note(child_id, date);

CREATE TABLE IF NOT EXISTS family_setting (
  child_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (child_id, key)
);
`);

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const todayKey = () => DAILY.toDateKey();
const MON = ['日', '一', '二', '三', '四', '五', '六'];

function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return DAILY.toDateKey(new Date(y, m - 1, d + n));
}
function weekdayOf(key) {
  const [y, m, d] = key.split('-').map(Number);
  const w = new Date(y, m - 1, d).getDay();
  return w === 0 ? 7 : w; // 1=周一 ... 7=周日
}
function timeHM(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function settingsMap(childId) {
  const rows = q.all('SELECT key, value FROM family_setting WHERE child_id=?', childId);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
function getSetting(childId, key, fallback = '') {
  return settingsMap(childId)[key] ?? fallback;
}
function setSetting(childId, key, value) {
  q.run(
    `INSERT INTO family_setting(child_id, key, value) VALUES(?,?,?)
     ON CONFLICT(child_id, key) DO UPDATE SET value=excluded.value`,
    childId, key, String(value ?? ''),
  );
}

/* ---------------- 规则 ---------------- */
function parseWeekdays(raw) {
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v) && v.length) return v.map(Number).filter((x) => x >= 1 && x <= 7);
  } catch {}
  return [1, 2, 3, 4, 5, 6, 7];
}
function serializeRule(r) {
  const weekdays = parseWeekdays(r.weekdays);
  return {
    id: r.id,
    title: r.title,
    subject: r.subject,
    icon: r.icon,
    minutes: r.minutes,
    weekdays,
    weekdaysLabel: weekdays.length === 7 ? '每天' : weekdays.map((d) => `周${MON[d % 7]}`).join('、'),
    startTime: r.start_time,
    endTime: r.end_time,
    timeLabel: r.start_time && r.end_time ? `${r.start_time}–${r.end_time}` : '全天',
    basePoints: r.base_points,
    earlyBonus: r.early_bonus,
    latePenalty: r.late_penalty,
    reviewRequired: !!r.review_required,
    photoRequired: !!r.photo_required,
    active: !!r.active,
    sort: r.sort,
  };
}
export function listRules(childId) {
  return q.all('SELECT * FROM plan_rule WHERE child_id=? ORDER BY active DESC, sort, created_at', childId)
    .map(serializeRule);
}
export function saveRule(childId, body = {}) {
  return tx(() => {
  const title = String(body.title || '').trim();
  if (!title) throw new Error('计划名称不能为空');
  const id = body.id || uid();
  const weekdays = Array.isArray(body.weekdays)
    ? [...new Set(body.weekdays.map(Number).filter((x) => Number.isInteger(x) && x >= 1 && x <= 7))].sort()
    : [1, 2, 3, 4, 5, 6, 7];
  if (!weekdays.length) throw new Error('至少选择一天');
  const validTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if ((body.startTime && !validTime.test(body.startTime)) || (body.endTime && !validTime.test(body.endTime))) throw new Error('请填写有效的时间');
  const start = body.startTime || null;
  const end = body.endTime || null;
  if (start && end && start >= end) throw new Error('结束时间要晚于开始时间');
  const base = clamp(Math.round(Number(body.basePoints) || 10), 1, 300);
  const early = clamp(Math.round(Number(body.earlyBonus) || 0), 0, 200);
  const late = clamp(Math.round(Number(body.latePenalty) || 0), 0, 200);
  const minutes = clamp(Math.round(Number(body.minutes) || 15), 5, 240);
  const subject = String(body.subject || '自习').slice(0, 10);
  const icon = String(body.icon || '📘').slice(0, 4);
  const review = body.reviewRequired !== false ? 1 : 0;
  const photo = body.photoRequired ? 1 : 0;
  const active = body.active === false ? 0 : 1;
  const ts = new Date().toISOString();
  const exists = q.get('SELECT id FROM plan_rule WHERE id=? AND child_id=?', id, childId);
  if (exists) {
    q.run(
      `UPDATE plan_rule SET title=?, subject=?, icon=?, minutes=?, weekdays=?, start_time=?, end_time=?,
        base_points=?, early_bonus=?, late_penalty=?, review_required=?, photo_required=?, active=?, updated_at=?
       WHERE id=? AND child_id=?`,
      title, subject, icon, minutes, JSON.stringify(weekdays), start, end,
      base, early, late, review, photo, active, ts, id, childId);
  } else {
    const sort = (q.get('SELECT COALESCE(MAX(sort),-1) AS n FROM plan_rule WHERE child_id=?', childId)?.n ?? -1) + 1;
    q.run(
      `INSERT INTO plan_rule(id, child_id, title, subject, icon, minutes, weekdays, start_time, end_time,
        base_points, early_bonus, late_penalty, review_required, photo_required, active, sort, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, childId, title, subject, icon, minutes, JSON.stringify(weekdays), start, end,
      base, early, late, review, photo, active, sort, ts, ts);
  }
  syncUnsubmittedTasks(childId, id);
  ensureTasks(childId, todayKey());
  return listRules(childId);
  });
}
export function deleteRule(childId, id) {
  tx(() => {
    q.run("DELETE FROM v2_task WHERE child_id=? AND rule_id=? AND date>=? AND status IN ('open','rejected')", childId, id, todayKey());
    q.run('DELETE FROM plan_rule WHERE id=? AND child_id=?', id, childId);
  });
  return listRules(childId);
}

// 已提交与已通过是历史快照；只同步今天起尚未提交的任务。
function syncUnsubmittedTasks(childId, ruleId) {
  const rule = q.get('SELECT * FROM plan_rule WHERE id=? AND child_id=?', ruleId, childId);
  const tasks = q.all("SELECT * FROM v2_task WHERE child_id=? AND rule_id=? AND date>=? AND status IN ('open','rejected')", childId, ruleId, todayKey());
  for (const task of tasks) {
    if (!rule.active || !parseWeekdays(rule.weekdays).includes(weekdayOf(task.date))) {
      q.run('DELETE FROM v2_task WHERE id=?', task.id);
    } else {
      q.run(`UPDATE v2_task SET title=?, subject=?, icon=?, minutes=?, window_start=?, window_end=?,
        base_points=?, early_bonus=?, late_penalty=?, review_required=?, photo_required=?, timing=NULL, awarded_points=NULL WHERE id=?`,
        rule.title, rule.subject, rule.icon, rule.minutes, rule.start_time, rule.end_time,
        rule.base_points, rule.early_bonus, rule.late_penalty, rule.review_required, rule.photo_required, task.id);
    }
  }
}

/* ---------------- 任务生成 ---------------- */
export function ensureTasks(childId, date, knownRules) {
  const wd = weekdayOf(date);
  const rules = knownRules || q.all('SELECT * FROM plan_rule WHERE child_id=? AND active=1', childId);
  const ts = new Date().toISOString();
  const existing = new Set(q.all('SELECT rule_id FROM v2_task WHERE child_id=? AND date=?',childId,date).map(t=>t.rule_id));
  for (const r of rules) {
    if(existing.has(r.id))continue;
    if (!parseWeekdays(r.weekdays).includes(wd)) continue;
    // 计划从创建那天开始生效，不能倒推补出历史任务
    const startDate = DAILY.toDateKey(r.created_at);
    if (startDate && date < startDate) continue;
    q.run(
      `INSERT OR IGNORE INTO v2_task(
        id, child_id, rule_id, date, title, subject, icon, minutes, window_start, window_end,
        base_points, early_bonus, late_penalty, review_required, photo_required, status, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?)`,
      uid(), childId, r.id, date, r.title, r.subject, r.icon, r.minutes, r.start_time, r.end_time,
      r.base_points, r.early_bonus, r.late_penalty, r.review_required, r.photo_required, ts);
  }
}

function serializeTask(t) {
  return {
    id: t.id,
    ruleId: t.rule_id,
    date: t.date,
    title: t.title,
    subject: t.subject,
    icon: t.icon,
    minutes: t.minutes,
    windowStart: t.window_start,
    windowEnd: t.window_end,
    timeLabel: t.window_start && t.window_end ? `${t.window_start}–${t.window_end}` : '全天',
    basePoints: t.base_points,
    earlyBonus: t.early_bonus,
    latePenalty: t.late_penalty,
    reviewRequired: !!t.review_required,
    photoRequired: !!t.photo_required,
    status: t.status,
    timing: t.timing,
    timingLabel: t.timing === 'early' ? '提前完成' : t.timing === 'late' ? '超时完成' : t.timing === 'ontime' ? '按时完成' : '',
    awardedPoints: t.awarded_points,
    note: t.note,
    photo: t.photo,
    rejectReason: t.reject_reason,
    submittedAt: t.submitted_at,
    approvedAt: t.approved_at,
    rulesText: buildRulesText(t),
  };
}
function buildRulesText(t) {
  const parts = [`按时完成 +${t.base_points}`];
  if (t.early_bonus) parts.push(`提前完成 +${t.early_bonus}`);
  if (t.late_penalty) parts.push(`超出时段 −${t.late_penalty}`);
  if (t.review_required) parts.push('需家长审核');
  if (t.photo_required) parts.push('需拍照');
  return parts;
}
function tasksOf(childId, date) {
  return q.all('SELECT * FROM v2_task WHERE child_id=? AND date=? ORDER BY status, created_at', childId, date)
    .map(serializeTask);
}
function taskById(childId, id) {
  return q.get('SELECT * FROM v2_task WHERE id=? AND child_id=?', id, childId);
}

/* ---------------- 积分发放 ---------------- */
function awardTask(childId, task, overridePoints) {
  return tx(() => {
  if (!task) return null;
  const points = clamp(Math.round(Number(overridePoints ?? task.awarded_points ?? task.base_points) || 0), 0, 999);
  const key = `v2task:${task.id}:approved`;
  const has = q.get('SELECT id FROM point_ledger WHERE dedupe_key=?', key);
  if (!has) {
    q.run(
      `INSERT INTO point_ledger(id, child_id, date, delta, reason, dedupe_key, created_at)
       VALUES(?,?,?,?,?,?,?)`,
      uid(), childId, task.date, points, `任务通过：${task.title}`, key, new Date().toISOString());
  }
  q.run(
    `UPDATE v2_task SET status='approved', approved_at=?, awarded_points=?, reject_reason=NULL WHERE id=?`,
    new Date().toISOString(), points, task.id);
  if (!has) DAILY.awardTaskGrowth(childId, task);
  // 重试不会重复发分或重复增加心情。
  const pet = DAILY.getPetRow(childId);
  if (pet && !has) q.run('UPDATE pet_life SET mood=? WHERE pet_id=?', clamp(pet.mood + 2, 0, 100), pet.pet_id);
  return points;
  });
}

/* ---------------- 学生动作 ---------------- */
export function submitTask(childId, id, body = {}) {
  let notice;
  const result = tx(() => {
  const task = taskById(childId, id);
  if (!task) throw new Error('找不到这个任务');
  if (task.status === 'approved') throw new Error('这个任务已经通过啦');
  if (task.status === 'submitted') throw new Error('已经提交，等家长看一下');
  if (task.date > todayKey()) throw new Error('还没到这一天');
  const photo = body.photo ? String(body.photo) : null;
  if (task.photo_required && !photo) throw new Error('这个任务需要拍照上传');
  if (photo && (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(photo) || photo.length > 6 * 1024 * 1024)) {
    throw new Error('请上传 4MB 以内的 JPG、PNG 或 WebP 照片');
  }
  const now = new Date();
  let timing = 'ontime';
  if (task.date < todayKey()) timing = 'late';
  else if (task.window_start && task.window_end) {
    const hm = timeHM(now);
    if (hm < task.window_start) timing = 'early';
    else if (hm > task.window_end) timing = 'late';
  } else if (task.window_start && timeHM(now) < task.window_start) timing = 'early';
  else if (task.window_end && timeHM(now) > task.window_end) timing = 'late';
  let pts = task.base_points;
  if (timing === 'early') pts += task.early_bonus;
  if (timing === 'late') pts -= task.late_penalty;
  pts = clamp(pts, 0, 999);
  const note = body.note ? String(body.note).slice(0, 500) : null;
  q.run(
    `UPDATE v2_task SET status='submitted', timing=?, awarded_points=?, note=?, photo=?, submitted_at=?, reject_reason=NULL
     WHERE id=?`,
    timing, pts, note, photo, new Date().toISOString(), id);
  if (!task.review_required) {
    const points=awardTask(childId, taskById(childId, id));
    notice={text:`【伴学小岛】${task.title} 已完成，无需审核，+${points} 星贝已到账。`,event:'completed'};
  }
  else {
    const resubmitted=task.status==='rejected';
    const text = `【伴学小岛】${task.title} ${resubmitted?'已重新提交':'已提交'}，等待家长审核。预计 ${pts} 星贝。`;
    notice = {text,event:resubmitted?'resubmission':'submission',submission:taskById(childId,id)};
  }
  return serializeTask(taskById(childId, id));
  });
  if (notice) NOTIFY.sendNotification(childId,notice.text,{event:notice.event,submission:notice.submission}).catch(() => {});
  return result;
}

export function reviewDetail(childId,id) {
 const task=taskById(childId,id);if(!task)throw Error('找不到当前孩子的这项任务，请确认登录的家庭和孩子');
 return serializeTask(task);
}

export function reviewTask(childId, id, body = {}) {
 let notice;
 const result=tx(() => {
  const task = taskById(childId, id);
  if (!task) throw new Error('找不到这个任务');
  if (task.status !== 'submitted') throw new Error('这个任务当前不在待审核状态');
  if (body.expectedSubmittedAt !== undefined && body.expectedSubmittedAt !== task.submitted_at) throw Error('孩子已重新提交，请刷新并查看最新内容后再审核');
  if (body.approve === false) {
    q.run(
      `UPDATE v2_task SET status='rejected', reject_reason=?, approved_at=NULL WHERE id=?`,
      String(body.reason || '再检查一下，重新提交吧').slice(0, 200), id);
    notice={text:`【伴学小岛】${task.title} 被退回：${String(body.reason||'再检查一下，重新提交吧').slice(0,200)}`,event:'rejected'};
    return serializeTask(taskById(childId, id));
  }
  const override = body.points != null ? Number(body.points) : null;
  const points=awardTask(childId, task, override);
  notice={text:`【伴学小岛】${task.title} 审核通过，+${points} 星贝已到账。`,event:'approved'};
  return serializeTask(taskById(childId, id));
 });
 if(notice)NOTIFY.sendNotification(childId,notice.text,{event:notice.event}).catch(()=>{});
 return result;
}

export function restPet(childId) {
  const pet = DAILY.getPetRow(childId);
  if (!pet) throw new Error('先领养一个小伙伴吧');
  const left = DAILY.cooldownLeft(pet, 'rest', 30 * 60 * 1000);
  if (left > 0) {
    throw new Error(`刚睡过啦，${Math.ceil(left / 60)} 分钟后再睡`);
  }
  tx(() => {
  DAILY.markCare(pet, 'rest');
  q.run(
    `UPDATE pet_life SET energy=?, mood=?, last_care_at=?, last_care_kind=?, last_tick=? WHERE pet_id=?`,
    Math.min(100, pet.energy + 14), Math.min(100, pet.mood + 2),
    new Date().toISOString(), 'rest', new Date().toISOString(), pet.pet_id);
  });
  return getStudentState(childId, todayKey());
}

export function approveAll(childId) {
  const list = q.all(`SELECT * FROM v2_task WHERE child_id=? AND status='submitted'`, childId);
  tx(() => { for (const t of list) {
    awardTask(childId, t);
  } });
  if(list.length)NOTIFY.sendNotification(childId,`【伴学小岛】${list.length} 项待审核任务已批量通过，共 +${list.reduce((sum,t)=>sum+(t.awarded_points??t.base_points),0)} 星贝已到账。`,{event:'batch_approved'}).catch(()=>{});
  return getParentState(childId);
}

export function giftPoints(childId, body = {}) {
  const amount = clamp(Math.round(Number(body.amount) || 0), 1, 500);
  const reason = String(body.reason || '家长奖励').slice(0, 80);
  q.run(
    `INSERT INTO point_ledger(id, child_id, date, delta, reason, dedupe_key, created_at)
     VALUES(?,?,?,?,?,?,?)`,
    uid(), childId, todayKey(), amount, `家长奖励：${reason}`, `gift:${uid()}`, new Date().toISOString());
  return getStudentState(childId, todayKey());
}

/* ---------------- 自定义奖励 ---------------- */
export function listRewards(childId) {
  return q.all('SELECT * FROM reward_item WHERE child_id=? ORDER BY active DESC, cost', childId)
    .map((r) => ({
      id: r.id, title: r.title, icon: r.icon, cost: r.cost, kind: r.kind,
      stock: r.stock, note: r.note, active: !!r.active,
    }));
}
export function saveReward(childId, body = {}) {
  const id = body.id || uid();
  const title = String(body.title || '').trim();
  if (!title) throw new Error('奖励名称不能为空');
  const cost = clamp(Math.round(Number(body.cost) || 0), 1, 9999);
  const icon = String(body.icon || '🎁').slice(0, 4);
  const kind = ['experience', 'item', 'privilege'].includes(body.kind) ? body.kind : 'experience';
  const stock = body.stock == null ? -1 : clamp(Math.round(Number(body.stock)), -1, 999);
  const note = String(body.note || '').slice(0, 200);
  const active = body.active === false ? 0 : 1;
  const exists = q.get('SELECT id FROM reward_item WHERE id=? AND child_id=?', id, childId);
  if (exists) {
    q.run('UPDATE reward_item SET title=?, icon=?, cost=?, kind=?, stock=?, note=?, active=? WHERE id=? AND child_id=?',
      title, icon, cost, kind, stock, note, active, id, childId);
  } else {
    q.run('INSERT INTO reward_item(id, child_id, title, icon, cost, kind, stock, note, active, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      id, childId, title, icon, cost, kind, stock, note, active, new Date().toISOString());
  }
  return listRewards(childId);
}
export function deleteReward(childId, id) {
  q.run('DELETE FROM reward_item WHERE id=? AND child_id=?', id, childId);
  return listRewards(childId);
}
export function redeemReward(childId, id) {
  const r = q.get('SELECT * FROM reward_item WHERE id=? AND child_id=? AND active=1', id, childId);
  if (!r) throw new Error('这个奖励已经下架了');
  if (r.stock === 0) throw new Error('这个奖励暂时兑完了');
  const balance = q.get('SELECT COALESCE(SUM(delta),0) AS n FROM point_ledger WHERE child_id=?', childId)?.n ?? 0;
  if (balance < r.cost) throw new Error(`还差 ${r.cost - balance} 星贝`);
  tx(() => {
    q.run(
      `INSERT INTO point_ledger(id, child_id, date, delta, reason, dedupe_key, created_at)
       VALUES(?,?,?,?,?,?,?)`,
      uid(), childId, todayKey(), -r.cost, `兑换奖励：${r.title}`, `redeem:${uid()}`, new Date().toISOString());
    q.run('INSERT INTO redemption(id, child_id, reward_id, title, icon, cost, status, created_at) VALUES(?,?,?,?,?,?,?,?)',
      uid(), childId, id, r.title, r.icon, r.cost, 'pending', new Date().toISOString());
    if (r.stock > 0) q.run('UPDATE reward_item SET stock=stock-1 WHERE id=?', id);
  });
  return getStudentState(childId, todayKey());
}
export function listRedemptions(childId) {
  return q.all('SELECT * FROM redemption WHERE child_id=? ORDER BY created_at DESC LIMIT 30', childId);
}
export function handleRedemption(childId, id, status) {
  if (!['fulfilled', 'rejected'].includes(status)) throw new Error('无效的兑现状态');
  return tx(() => {
  const r = q.get('SELECT * FROM redemption WHERE id=? AND child_id=?', id, childId);
  if (!r) throw new Error('找不到兑换记录');
  if (r.status !== 'pending') return listRedemptions(childId);
  if (status === 'rejected') {
    q.run('UPDATE redemption SET status=?, handled_at=? WHERE id=?', status, new Date().toISOString(), id);
    q.run(
      `INSERT INTO point_ledger(id, child_id, date, delta, reason, dedupe_key, created_at)
       VALUES(?,?,?,?,?,?,?)`,
      uid(), childId, todayKey(), r.cost, `奖励退回：${r.title}`, `refund:${id}`, new Date().toISOString());
    q.run('UPDATE reward_item SET stock=stock+1 WHERE id=? AND child_id=? AND stock>=0', r.reward_id, childId);
  } else {
    q.run('UPDATE redemption SET status=?, handled_at=? WHERE id=?', status, new Date().toISOString(), id);
  }
  return listRedemptions(childId);
  });
}

/* ---------------- 通知 ---------------- */
export const listNotifyLogs = NOTIFY.notificationLogs;
export const listPetBackups = PET_BACKUPS.listPetBackups;
export const backupPet = PET_BACKUPS.backupPet;
export const migratePet = PET_BACKUPS.migratePet;
export const restartPet = PET_BACKUPS.restartPet;
export const restorePet = PET_BACKUPS.restorePet;

/* ---------------- 状态 ---------------- */
function progressOf(tasks) {
  const total = tasks.length;
  const approved = tasks.filter((t) => t.status === 'approved').length;
  const submitted = tasks.filter((t) => t.status === 'submitted').length;
  const rejected = tasks.filter((t) => t.status === 'rejected').length;
  const open = tasks.filter((t) => t.status === 'open').length;
  const early = tasks.filter((t) => t.timing === 'early').length;
  return { total, approved, submitted, rejected, open, early, percent: total ? Math.round((approved / total) * 100) : 0 };
}

export function taskSummary(childId, date) {
 ensureTasks(childId,date);
 const tasks=tasksOf(childId,date),p=progressOf(tasks);
 const earned=tasks.reduce((sum,t)=>sum+(t.status==='approved'?(t.awardedPoints??0):0),0);
 const lines=[`【伴学小岛】${date} 每日任务汇总`,`今日计划 ${p.total} 项 · 完成率 ${p.percent}%`,`已通过 ${p.approved} · 待审核 ${p.submitted} · 未完成 ${p.open} · 已退回 ${p.rejected}`,`今日已赚 ${earned} ★`];
 if(!tasks.length)lines.push('今天没有安排任务。');
 const status={open:'未完成',submitted:'待审核',approved:'已通过',rejected:'已退回'};
 let shown=0;
 for(const t of tasks){
  const line=`${status[t.status]}｜${t.subject} · ${t.title.replace(/[\r\n]+/g,' ')}${t.status==='approved'?` · +${t.awardedPoints??0} ★`:''}`;
  if(lines.join('\n').length+line.length>3300)break;
  lines.push(line);shown++;
 }
 if(shown<tasks.length)lines.push(`其余 ${tasks.length-shown} 项请到小岛查看。`);
 return lines.join('\n');
}

export function listDailyNotes(childId, date = todayKey()) {
  return q.all('SELECT * FROM daily_note WHERE child_id=? AND date=? ORDER BY updated_at DESC,id', childId, date).map(n => ({
    id: n.id, date: n.date, text: n.text, senderId: n.sender_id, senderName: n.sender_name,
    senderRelation: n.sender_relation, createdAt: n.created_at, updatedAt: n.updated_at,
  }));
}

export function sendDailyNote(childId, context, body = {}) {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw new Error('先写一句想对孩子说的话吧');
  if (Array.from(text).length > 80) throw new Error('小纸条最多 80 个字，请再精简一点');
  const date = todayKey();
  const now = new Date().toISOString();
  q.run(`INSERT INTO daily_note(id,child_id,date,sender_id,sender_name,sender_relation,text,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(child_id,date,sender_id) DO UPDATE SET
    sender_name=excluded.sender_name,sender_relation=excluded.sender_relation,text=excluded.text,updated_at=excluded.updated_at`,
    uid(), childId, date, context.account_id, context.display_name, context.relation || '家长', text, now, now);
  return listDailyNotes(childId, date);
}

export function deleteDailyNote(childId, id) {
  const note = q.get('SELECT id FROM daily_note WHERE id=? AND child_id=? AND date=?', id, childId, todayKey());
  if (!note) throw new Error('这张纸条已撤回或已过期');
  q.run('DELETE FROM daily_note WHERE id=? AND child_id=?', id, childId);
  return listDailyNotes(childId);
}

export function getStudentState(childId, date = todayKey()) {
  ensureTasks(childId, date);
  const base = DAILY.getToday(childId, date);
  const tasks = tasksOf(childId, date);
  const rules = listRules(childId).filter((r) => r.active);
  const rewards = listRewards(childId).filter((r) => r.active);
  const redemptions = listRedemptions(childId).filter((r) => r.status === 'pending');
  const pendingApprovals = q.get('SELECT COUNT(*) AS n FROM v2_task WHERE child_id=? AND status=?', childId, 'submitted')?.n ?? 0;
  return {
    date,
    today: todayKey(),
    pet: base.pet,
    wallet: base.wallet,
    tasks,
    progress: progressOf(tasks),
    rules,
    shop: base.shop,
    inventory: base.inventory,
    rewards,
    pendingApprovals,
    dailyNotes: listDailyNotes(childId, date),
    redemptions,
    recent: base.recent,
    cooldowns: base.cooldowns,
    notifyEnabled: NOTIFY.notificationsEnabled(childId),
    parentPinDefault: !getSetting(childId, 'parent_pin'),
  };
}

export function getParentState(childId, date = todayKey(), month) {
  const m = /^\d{4}-\d{2}$/.test(month || '') ? month : date.slice(0, 7);
  const [y, mo] = m.split('-').map(Number);
  const days = new Date(y, mo, 0).getDate();
  const calendar = [];
  let weekSum = { total: 0, approved: 0, early: 0, pending: 0 };
  const activeRules = q.all('SELECT * FROM plan_rule WHERE child_id=? AND active=1', childId);
  // Generate missing dates with one rule read, then aggregate lightweight rows.
  const monthRows = new Map();
  for(let d=1;d<=days;d++) {
    const key=`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    if(key<=todayKey())ensureTasks(childId,key,activeRules);
  }
  for(const row of q.all('SELECT date,status,timing FROM v2_task WHERE child_id=? AND date>=? AND date<=?',childId,m+'-01',m+'-31')) {
    if(!monthRows.has(row.date))monthRows.set(row.date,[]);monthRows.get(row.date).push(row);
  }
  for (let d = 1; d <= days; d++) {
    const key = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (key <= todayKey()) {
      const tasks = monthRows.get(key) || [];
      const p = progressOf(tasks);
      calendar.push({ date: key, day: d, weekday: weekdayOf(key), ...p });
    } else {
      // 未来日期不生成任务，只按规则展示"计划几项"
      const wd = weekdayOf(key);
      const planned = activeRules.filter((r) => parseWeekdays(r.weekdays).includes(wd) && key >= String(r.created_at).slice(0, 10)).length;
      calendar.push({ date: key, day: d, weekday: wd, total: planned, approved: 0, submitted: 0, rejected: 0, open: planned, early: 0, percent: 0 });
    }
  }
  const monday = addDays(date, -(weekdayOf(date) - 1));
  const weekRows=q.all('SELECT date,status,timing FROM v2_task WHERE child_id=? AND date>=? AND date<=?',childId,monday,addDays(monday,6));
  for (let i = 0; i < 7; i++) {
    const key = addDays(monday, i);
    if (key > todayKey()) continue;
    const tasks = weekRows.filter(t=>t.date===key);
    const p = progressOf(tasks);
    weekSum.total += p.total; weekSum.approved += p.approved; weekSum.early += p.early; weekSum.pending += p.submitted;
  }
  const monthTasks = calendar.filter((d) => d.date <= todayKey()).reduce((s, d) => ({
    total: s.total + d.total, approved: s.approved + d.approved,
    early: s.early + d.early, pending: s.pending + d.submitted,
  }), { total: 0, approved: 0, early: 0, pending: 0 });

  const approvals = q.all(`SELECT * FROM v2_task WHERE child_id=? AND status='submitted' ORDER BY submitted_at`, childId)
    .map(serializeTask);
  const todayTasks = tasksOf(childId, date);
  const base = DAILY.getToday(childId, date);
  return {
    date,
    today: todayKey(),
    month: m,
    pet: base.pet,
    wallet: base.wallet,
    childId,
    dailyNotes: listDailyNotes(childId),
    approvals,
    todayTasks,
    progress: progressOf(todayTasks),
    rules: listRules(childId),
    calendar,
    week: { start: monday, end: addDays(monday, 6), ...weekSum },
    monthSummary: monthTasks,
    rewards: listRewards(childId),
    redemptions: listRedemptions(childId),
    materialPrices: q.all('SELECT item_key, cost FROM material_price WHERE child_id=?', childId),
    settings: {
      notifyEnabled: NOTIFY.notificationsEnabled(childId),
      notifyChannels: NOTIFY.notificationChannels(childId),
      notifyEvents: NOTIFY.notificationEvents(childId),
      notifySummaryTime: NOTIFY.summaryTime(childId),
      notifyPublicUrl: CARDS.publicUrl(childId),
      pinSet: !!getSetting(childId, 'parent_pin'),
    },
    shop: base.shop,
  };
}

export function setParentSettings(childId, body = {}) {
  if(body.notifyEvents!==undefined||body.notifySummaryTime!==undefined)NOTIFY.saveNotificationPreferences(childId,{events:body.notifyEvents,time:body.notifySummaryTime});
  if (body.notifyPublicUrl !== undefined) CARDS.savePublicUrl(childId,body.notifyPublicUrl);
  if (body.pin != null) {
    const pin = String(body.pin).trim();
    if (!/^\d{4}$/.test(pin)) throw new Error('家长密码需要 4 位数字');
    setSetting(childId, 'parent_pin', pin);
  }
  if (body.notifyChannels != null) NOTIFY.saveNotificationChannels(childId, body.notifyChannels);
  if (body.materialPrices && typeof body.materialPrices === 'object') {
    for (const [key, value] of Object.entries(body.materialPrices)) {
      if (!DAILY.SHOP_MAP[key]) continue;
      const cost = clamp(Math.round(Number(value) || 0), 1, 999);
      q.run(`INSERT INTO material_price(child_id, item_key, cost) VALUES(?,?,?)
             ON CONFLICT(child_id, item_key) DO UPDATE SET cost=excluded.cost`,
        childId, key, cost);
    }
  }
  return getParentState(childId);
}

export function adoptWithStarter(childId, body = {}) {
  DAILY.adopt(childId, body);
  const count = q.get('SELECT COUNT(*) AS n FROM plan_rule WHERE child_id=?', childId)?.n ?? 0;
  if (!count) {
    saveRule(childId, { title: '晨读 15 分钟', subject: '语文', icon: '📖', weekdays: [1,2,3,4,5,6,7], startTime: '07:00', endTime: '08:00', basePoints: 12, earlyBonus: 5, latePenalty: 3, reviewRequired: true, minutes: 15 });
    saveRule(childId, { title: '数学口算 20 题', subject: '数学', icon: '📐', weekdays: [1,2,3,4,5], startTime: '17:00', endTime: '18:30', basePoints: 15, earlyBonus: 5, latePenalty: 5, reviewRequired: true, minutes: 20 });
    saveRule(childId, { title: '英语跟读 10 分钟', subject: '英语', icon: '🔤', weekdays: [1,2,3,4,5,6,7], startTime: '19:00', endTime: '20:00', basePoints: 10, earlyBonus: 3, latePenalty: 2, reviewRequired: false, minutes: 10 });
  }
  return getStudentState(childId, todayKey());
}

// Legacy endpoints now use the same safe pet-only restart semantics.
export function resetAll(childId, expectedPetId) {
  PET_BACKUPS.restartPet(childId, expectedPetId);
  return getStudentState(childId, todayKey());
}

export function verifyPin(childId, pin) {
  const stored = getSetting(childId, 'parent_pin', '1234');
  return String(pin) === String(stored);
}

export function notifyTest(childId, provider) {
  return NOTIFY.sendNotification(childId, '【伴学小岛】通知已接通，任务消息将按后台的推送场景开关和每日汇总时间发送。', { provider, event: 'test' });
}
