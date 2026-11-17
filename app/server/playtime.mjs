/** Foreground activity leases are shared across tabs; only the server clock spends a child's daily budget. */
import { db, q, tx } from './db.mjs';
import { fail, hashPassword, verifyPassword } from './credentials.mjs';
const MINUTE = 60000, DAY = 86400000, OFFSET = 8 * 3600000;
const LEASE = 30000;
export const UNLOCK_MINUTES = 15;
export const dayStart = at => Math.floor((at + OFFSET) / DAY) * DAY - OFFSET;
const dateKey = at => new Date(at + OFFSET).toISOString().slice(0, 10);
db.exec(`
CREATE TABLE IF NOT EXISTS playtime_setting (
 child_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, daily_minutes INTEGER NOT NULL DEFAULT 60,
 idle_minutes INTEGER NOT NULL DEFAULT 5, pin_hash TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS playtime_clock (child_id TEXT PRIMARY KEY, settled_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS playtime_client (
 child_id TEXT NOT NULL, client_id TEXT NOT NULL, session_hash TEXT NOT NULL,
 last_seen INTEGER NOT NULL, last_activity INTEGER NOT NULL, active INTEGER NOT NULL,
 PRIMARY KEY(child_id,client_id)
);
CREATE TABLE IF NOT EXISTS playtime_usage (
 child_id TEXT NOT NULL, date TEXT NOT NULL, used_ms INTEGER NOT NULL DEFAULT 0,
 bonus_ms INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(child_id,date)
);
CREATE TABLE IF NOT EXISTS playtime_lock (
 id INTEGER PRIMARY KEY, child_id TEXT NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_playtime_lock_child ON playtime_lock(child_id,starts_at,ends_at);
CREATE TABLE IF NOT EXISTS playtime_unlock (
 child_id TEXT NOT NULL, request_id TEXT NOT NULL, date TEXT NOT NULL, PRIMARY KEY(child_id,request_id)
);
CREATE TABLE IF NOT EXISTS playtime_pin_attempt (
 child_id TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, blocked_until INTEGER NOT NULL DEFAULT 0
);`);

function policy(childId) {
  return q.get('SELECT * FROM playtime_setting WHERE child_id=?', childId) || { enabled: 0, daily_minutes: 60, idle_minutes: 5, pin_hash: '' };
}
export function playtimeSettings(childId) {
  const p = policy(childId);
  return { enabled: !!p.enabled, dailyMinutes: p.daily_minutes, idleMinutes: p.idle_minutes, pinSet: !!p.pin_hash, unlockMinutes: UNLOCK_MINUTES };
}
function usage(childId, at) {
  q.run('INSERT OR IGNORE INTO playtime_usage(child_id,date) VALUES(?,?)', childId, dateKey(at));
  return q.get('SELECT * FROM playtime_usage WHERE child_id=? AND date=?', childId, dateKey(at));
}
const limited = p => !!p.enabled && !!p.pin_hash;
const allowance = (p, u) => p.daily_minutes * MINUTE + u.bonus_ms;
function ensureLock(childId, at) {
  if (!q.get('SELECT id FROM playtime_lock WHERE child_id=? AND starts_at<=? AND ends_at>?', childId, at, at))
    q.run('INSERT INTO playtime_lock(child_id,starts_at,ends_at) VALUES(?,?,?)', childId, at, dayStart(at) + DAY);
}
function endLock(childId, at) {
  q.run('UPDATE playtime_lock SET ends_at=? WHERE child_id=? AND starts_at<=? AND ends_at>?', at, childId, at, at);
}
function settle(childId, at) {
  const p = policy(childId), clock = q.get('SELECT settled_at FROM playtime_clock WHERE child_id=?', childId);
  at = Math.max(at, clock?.settled_at || at);
  let from = clock ? clock.settled_at : at;
  // Each lease starts at a previously settled heartbeat, so their union is one interval.
  const clients = q.all('SELECT * FROM playtime_client WHERE child_id=? AND active=1', childId);
  const activeEnd = Math.min(at, Math.max(from, ...clients.map(c => Math.min(c.last_seen + LEASE, c.last_activity + p.idle_minutes * MINUTE))));
  while (from < activeEnd) {
    const end = Math.min(activeEnd, dayStart(from) + DAY), u = usage(childId, from);
    const duration = end - from, remaining = Math.max(0, allowance(p, u) - u.used_ms);
    const spent = limited(p) ? Math.min(duration, remaining) : duration;
    q.run('UPDATE playtime_usage SET used_ms=used_ms+? WHERE child_id=? AND date=?', spent, childId, u.date);
    if (limited(p) && duration >= remaining && from + remaining < dayStart(from) + DAY) ensureLock(childId, from + remaining);
    from = end;
  }
  q.run('INSERT INTO playtime_clock VALUES(?,?) ON CONFLICT(child_id) DO UPDATE SET settled_at=excluded.settled_at', childId, at);
  const u = usage(childId, at), locked = limited(p) && u.used_ms >= allowance(p, u);
  if (locked) {
    ensureLock(childId, at);
    q.run('UPDATE playtime_client SET active=0 WHERE child_id=?', childId);
  } else endLock(childId, at);
  return { p, u, locked };
}
export function playtimeState(childId, at = Date.now()) {
  return tx(() => {
    const { p, u, locked } = settle(childId, at);
    return { ...playtimeSettings(childId), date: u.date, serverNow: at, resetsAt: dayStart(at) + DAY,
      usedSeconds: Math.floor(u.used_ms / 1000), bonusSeconds: u.bonus_ms / 1000,
      remainingSeconds: limited(p) ? Math.max(0, Math.ceil((allowance(p, u) - u.used_ms) / 1000)) : null, locked };
  });
}
export function heartbeat(childId, sessionHash, body = {}, at = Date.now()) {
  if (typeof body.clientId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(body.clientId) || typeof body.active !== 'boolean' || typeof body.interacted !== 'boolean') fail('游玩计时参数无效');
  return tx(() => {
    const { p, locked } = settle(childId, at);
    const old = q.get('SELECT * FROM playtime_client WHERE child_id=? AND client_id=?', childId, body.clientId);
    if (old && old.session_hash !== sessionHash) fail('计时页面已失效，请刷新', 409);
    const lastActivity = body.interacted ? at : old?.last_activity || at;
    const idle = at - lastActivity >= p.idle_minutes * MINUTE;
    q.run(`INSERT INTO playtime_client VALUES(?,?,?,?,?,?) ON CONFLICT(child_id,client_id) DO UPDATE SET
      last_seen=excluded.last_seen,last_activity=excluded.last_activity,active=excluded.active`,
      childId, body.clientId, sessionHash, at, lastActivity, Number(body.active && !locked && !idle));
    // Expired leases no longer contribute, even if the browser disappeared without a final message.
    q.run('DELETE FROM playtime_client WHERE child_id=? AND last_seen<?', childId, at - DAY);
    return { ...playtimeState(childId, at), idle };
  });
}
export async function savePlaytimeSettings(childId, body = {}, at) {
  if (typeof body.enabled !== 'boolean' || !Number.isInteger(body.dailyMinutes) || body.dailyMinutes < 1 || body.dailyMinutes > 480 || !Number.isInteger(body.idleMinutes) || body.idleMinutes < 1 || body.idleMinutes > 60) fail('每日游玩需为 1–480 分钟，无操作时间需为 1–60 分钟');
  if (body.pin !== undefined && (typeof body.pin !== 'string' || !/^\d{6}$/.test(body.pin))) fail('解锁密码需为 6 位数字');
  if (body.enabled && !body.pin && !policy(childId).pin_hash) fail('请先设置 6 位解锁密码再开启每日限时');
  const encoded = body.pin ? await hashPassword(body.pin, 6) : null;
  at = Math.max(at ?? Date.now(), q.get('SELECT settled_at FROM playtime_clock WHERE child_id=?', childId)?.settled_at || 0);
  return tx(() => {
    settle(childId, at);
    q.run(`INSERT INTO playtime_setting VALUES(?,?,?,?,?) ON CONFLICT(child_id) DO UPDATE SET
      enabled=excluded.enabled,daily_minutes=excluded.daily_minutes,idle_minutes=excluded.idle_minutes,pin_hash=excluded.pin_hash`,
      childId, Number(body.enabled), body.dailyMinutes, body.idleMinutes, encoded || policy(childId).pin_hash);
    if (encoded) q.run('DELETE FROM playtime_pin_attempt WHERE child_id=?', childId);
    return playtimeState(childId, at);
  });
}
export async function unlockPlaytime(childId, body = {}) {
  if (typeof body.pin !== 'string' || !/^\d{6}$/.test(body.pin) || typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(body.requestId)) fail('请输入 6 位数字解锁密码');
  const at = Date.now(), p = policy(childId);
  if ((q.get('SELECT blocked_until FROM playtime_pin_attempt WHERE child_id=?', childId)?.blocked_until || 0) > at) fail('密码尝试过多，请 10 分钟后再试，或在家长端重设密码', 429);
  if (!p.pin_hash || !await verifyPassword(body.pin, p.pin_hash)) {
    const previous = q.get('SELECT * FROM playtime_pin_attempt WHERE child_id=?', childId);
    const failures = (previous?.blocked_until && previous.blocked_until <= at ? 0 : previous?.failures || 0) + 1;
    q.run(`INSERT INTO playtime_pin_attempt VALUES(?,?,?) ON CONFLICT(child_id) DO UPDATE SET failures=excluded.failures,blocked_until=excluded.blocked_until`, childId, failures, failures >= 5 ? at + 10 * MINUTE : 0);
    fail(failures >= 5 ? '密码尝试过多，请 10 分钟后再试' : '解锁密码不正确', failures >= 5 ? 429 : 400);
  }
  return tx(() => {
    const current = playtimeState(childId);
    if (current.locked && !q.get('SELECT 1 FROM playtime_unlock WHERE child_id=? AND request_id=?', childId, body.requestId)) {
      q.run('INSERT INTO playtime_unlock VALUES(?,?,?)', childId, body.requestId, current.date);
      q.run('UPDATE playtime_usage SET bonus_ms=bonus_ms+? WHERE child_id=? AND date=?', UNLOCK_MINUTES * MINUTE, childId, current.date);
    }
    q.run('DELETE FROM playtime_pin_attempt WHERE child_id=?', childId);
    return playtimeState(childId);
  });
}
export function requirePlaytime(childId) {
  if (playtimeState(childId).locked) fail('今日游玩时间已用完，请家长输入 6 位密码解锁', 423);
}
export function lockedIntervals(childId, from, to) {
  playtimeState(childId, to);
  return q.all('SELECT starts_at,ends_at FROM playtime_lock WHERE child_id=? AND starts_at<? AND ends_at>? ORDER BY starts_at', childId, to, from)
    .map(r => [Math.max(from, r.starts_at), Math.min(to, r.ends_at)]).filter(([a,b]) => b > a);
}
