/** Family entitlement is checked on the server; codes are single use and stored hashed. */
import { randomBytes } from 'node:crypto';
import { db, q, tx, uid, now } from './db.mjs';
import { digest, fail } from './credentials.mjs';
export const DAY = 86400000;
db.exec(`
CREATE TABLE IF NOT EXISTS family(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS activation_invite(
 id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, code_hint TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('create','renew')), duration_days INTEGER NOT NULL,
 plan_name TEXT NOT NULL, redeem_by INTEGER NOT NULL, created_by TEXT NOT NULL,
 used_family_id TEXT REFERENCES family(id), used_by TEXT, used_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscription_event(
 id TEXT PRIMARY KEY, family_id TEXT NOT NULL REFERENCES family(id), actor_id TEXT NOT NULL,
 action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscription_family ON subscription_event(family_id,created_at);
`);
const columns = q.all('PRAGMA table_info(family)');
if (!columns.some(c => c.name === 'expires_at')) db.exec('ALTER TABLE family ADD COLUMN expires_at INTEGER');
if (!columns.some(c => c.name === 'plan_name')) db.exec("ALTER TABLE family ADD COLUMN plan_name TEXT NOT NULL DEFAULT '原有家庭'");
export function entitlement(familyId, at = Date.now()) {
 const f = q.get('SELECT expires_at,plan_name FROM family WHERE id=?', familyId);
 if (!f) fail('家庭不存在', 404);
 const daysRemaining = f.expires_at === null ? null : Math.max(0, Math.ceil((f.expires_at - at) / DAY));
 const status = f.expires_at === null ? 'lifetime' : f.expires_at <= at ? 'expired' : daysRemaining <= 7 ? 'expiring' : 'active';
 return { expiresAt: f.expires_at, planName: f.plan_name, daysRemaining, status, readOnly: status === 'expired', serverTime: at };
}
export function requireActive(familyId) {
 if (entitlement(familyId).readOnly) fail('家庭使用期限已到，当前可查看历史记录。请在家庭管理中兑换续期码或联系管理员续期。', 402);
}
export function childIsActive(childId, at = Date.now()) {
 // Unclaimed legacy children are handled by the explicit migration flow.
 const hasColumn = q.all('PRAGMA table_info(child)').some(c => c.name === 'family_id');
 if (!hasColumn) return true;
 const child = q.get('SELECT family_id FROM child WHERE id=?', childId);
 return !child?.family_id || !entitlement(child.family_id, at).readOnly;
}
function positiveDays(value, max, label) {
 const n = Number(value);
 if (!Number.isInteger(n) || n < 1 || n > max) fail(`${label}需为 1–${max} 天`);
 return n;
}
function planName(value) {
 if (typeof value !== 'string' || !value.trim() || value.trim().length > 40) fail('套餐名称需为 1–40 个字符');
 return value.trim();
}
function codeDigest(code) {
 if (typeof code !== 'string' || code.length > 100) fail('开通码或续期码格式不正确');
 const normalized = code.replace(/[\s-]/g, '').toUpperCase();
 if (!/^BX[A-F0-9]{32}$/.test(normalized)) fail('开通码或续期码格式不正确');
 return digest(normalized);
}
export function event(familyId, actor, action, detail) {
 q.run('INSERT INTO subscription_event VALUES(?,?,?,?,?,?)', uid(), familyId, actor, action, JSON.stringify(detail), now());
}
export function createActivationInvite(adminId, body) {
 if (!['create', 'renew'].includes(body.purpose)) fail('请选择开通码或续期码');
 const duration = positiveDays(body.durationDays, 3650, '家庭有效期');
 const redeemDays = positiveDays(body.redeemDays, 365, '兑换有效期');
 const name = planName(body.planName), id = uid();
 const raw = randomBytes(16).toString('hex').toUpperCase();
 const code = `BX-${raw.match(/.{8}/g).join('-')}`, redeemBy = Date.now() + redeemDays * DAY;
 q.run('INSERT INTO activation_invite(id,code_hash,code_hint,purpose,duration_days,plan_name,redeem_by,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
  id, codeDigest(code), raw.slice(-4), body.purpose, duration, name, redeemBy, adminId, now());
 return { id, code, redeemBy, durationDays: duration, planName: name, purpose: body.purpose };
}
export function inspectCode(code, purpose) {
 const invite = q.get('SELECT * FROM activation_invite WHERE code_hash=? AND purpose=? AND used_at IS NULL AND revoked_at IS NULL AND redeem_by>?', codeDigest(code), purpose, Date.now());
 if (!invite) fail('该邀请码无效、已使用、已撤销或已过兑换期限');
 return invite;
}
export function activateFamily(familyId, accountId, code) {
 // Caller wraps account/family creation and this redemption in the same transaction.
 const invite = inspectCode(code, 'create'), expires = Date.now() + invite.duration_days * DAY;
 consume(invite.id, familyId, accountId);
 q.run('UPDATE family SET expires_at=?,plan_name=? WHERE id=?', expires, invite.plan_name, familyId);
 event(familyId, accountId, 'family.activate', { inviteId: invite.id, expiresAt: expires, durationDays: invite.duration_days });
}
function consume(id, familyId, accountId) {
 const result = q.run('UPDATE activation_invite SET used_family_id=?,used_by=?,used_at=? WHERE id=? AND used_at IS NULL AND revoked_at IS NULL AND redeem_by>?', familyId, accountId, now(), id, Date.now());
 if (result.changes !== 1) fail('该邀请码已使用或已失效');
}
export function renewFamily(c, code) {
 return tx(() => {
  const current = entitlement(c.family_id);
  if (current.expiresAt === null) fail('本家庭不限期，无需兑换续期码');
  const invite = inspectCode(code, 'renew');
  const expires = Math.max(Date.now(), current.expiresAt) + invite.duration_days * DAY;
  consume(invite.id, c.family_id, c.account_id);
  q.run('UPDATE family SET expires_at=?,plan_name=? WHERE id=?', expires, invite.plan_name, c.family_id);
  event(c.family_id, c.account_id, 'family.renew', { inviteId: invite.id, oldExpiresAt: current.expiresAt, expiresAt: expires, durationDays: invite.duration_days });
  return entitlement(c.family_id);
 });
}
export function listActivationInvites(before = '') {
 const cursor = before ? q.get('SELECT rowid FROM activation_invite WHERE id=?', before) : null;
 if (before && !cursor) fail('无效的分页位置');
 const rows = q.all(`SELECT id,code_hint AS codeHint,purpose,duration_days AS durationDays,plan_name AS planName,redeem_by AS redeemBy,used_family_id AS usedFamilyId,used_at AS usedAt,revoked_at AS revokedAt,created_at AS createdAt FROM activation_invite ${cursor ? 'WHERE rowid<?' : ''} ORDER BY rowid DESC LIMIT 51`, ...(cursor ? [cursor.rowid] : []));
 return { items: rows.slice(0, 50), next: rows.length > 50 ? rows[49].id : null };
}
export function revokeActivationInvite(id) {
 const result = q.run('UPDATE activation_invite SET revoked_at=? WHERE id=? AND used_at IS NULL AND revoked_at IS NULL', now(), id);
 if (!result.changes) fail('邀请码不存在、已使用或已撤销');
 return { ok: true };
}
export function listFamilies(before = '', query = '') {
 if (query.length > 80) fail('查询内容过长');
 const cursor = before ? q.get('SELECT rowid FROM family WHERE id=?', before) : null;
 if (before && !cursor) fail('无效的分页位置');
 const rows = q.all(`SELECT id,name,created_at AS createdAt FROM family WHERE (name LIKE ? OR id=?) ${cursor ? 'AND rowid<?' : ''} ORDER BY rowid DESC LIMIT 51`, `%${query}%`, query, ...(cursor ? [cursor.rowid] : []));
 return { items: rows.slice(0, 50).map(f => ({ ...f, subscription: entitlement(f.id) })), next: rows.length > 50 ? rows[49].id : null };
}
export function setFamilySubscription(adminId, familyId, body) {
 const name = planName(body.planName), note = String(body.note || '').trim();
 if (!note || note.length > 200) fail('请填写 1–200 字的变更原因');
 const expires = body.expiresAt;
 if (expires !== null && (!Number.isSafeInteger(expires) || expires < 0 || expires > Date.now() + 3650 * DAY)) fail('有效期需为十年内的有效日期，或选择不限期');
 return tx(() => {
  const old = entitlement(familyId);
  q.run('UPDATE family SET expires_at=?,plan_name=? WHERE id=?', expires, name, familyId);
  event(familyId, adminId, 'admin.subscription.set', { oldExpiresAt: old.expiresAt, expiresAt: expires, planName: name, note });
  return entitlement(familyId);
 });
}
