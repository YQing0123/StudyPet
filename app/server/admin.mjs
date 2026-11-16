/** Independent operator identities: family accounts cannot acquire platform privileges. */
import { randomBytes } from 'node:crypto';
import { db, q, tx, uid, now } from './db.mjs';
import { digest, fail, loginName, hashPassword, verifyPassword, DUMMY_PASSWORD } from './credentials.mjs';
db.exec(`
CREATE TABLE IF NOT EXISTS platform_admin(id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_session(token_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES platform_admin(id), expires_at INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_audit(id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT, created_at TEXT NOT NULL);
`);
const TTL = 8 * 3600000;
export function readAdmin(req) {
 const token = /(?:^|;\s*)island_admin=([^;]+)/.exec(req.headers.cookie || '')?.[1];
 if (!token || token.length > 100) return null;
 return q.get('SELECT s.token_hash,a.id,a.login FROM admin_session s JOIN platform_admin a ON a.id=s.admin_id WHERE s.token_hash=? AND s.expires_at>?', digest(token), Date.now()) || null;
}
export function requireAdmin(req) { const a = readAdmin(req); if (!a) fail('请先登录管理员端', 401); return a; }
export function adminSnapshot(a) { return a ? { authenticated: true, login: a.login } : { authenticated: false }; }
export async function login(body, res, secure) {
 const name = loginName(body.login), a = q.get('SELECT * FROM platform_admin WHERE login=?', name);
 const verified = await verifyPassword(body.password, a?.password_hash || DUMMY_PASSWORD);
 if (!a || !verified) fail('管理员账号或密码不正确', 401);
 const token = randomBytes(32).toString('base64url');
 tx(() => {
  if(q.get('SELECT password_hash FROM platform_admin WHERE id=?',a.id)?.password_hash!==a.password_hash)fail('管理员凭据已更新，请重新登录',401);
  q.run('DELETE FROM admin_session WHERE expires_at<=?', Date.now());
  q.run('INSERT INTO admin_session VALUES(?,?,?,?)', digest(token), a.id, Date.now() + TTL, now());
  audit(a.id, 'admin.login');
 });
 res.setHeader('set-cookie', `island_admin=${token}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${TTL / 1000}${secure ? '; Secure' : ''}`);
 return adminSnapshot(a);
}
export function logout(req, res) {
 const a = readAdmin(req);
 if (a) { q.run('DELETE FROM admin_session WHERE token_hash=?', a.token_hash); audit(a.id, 'admin.logout'); }
 res.setHeader('set-cookie', 'island_admin=; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=0');
 return { authenticated: false };
}
export function audit(id, action, target = null) { q.run('INSERT INTO admin_audit VALUES(?,?,?,?,?)', uid(), id, action, target, now()); }
// Only the local operator CLI calls this. There is no HTTP admin registration endpoint.
export async function provisionAdmin(login, password) {
 const name = loginName(login), hash = await hashPassword(password, 12);
 return tx(() => {
  const old = q.get('SELECT id FROM platform_admin WHERE login=?', name), id = old?.id || uid();
  q.run('INSERT INTO platform_admin VALUES(?,?,?,?) ON CONFLICT(login) DO UPDATE SET password_hash=excluded.password_hash', id, name, hash, now());
  q.run('DELETE FROM admin_session WHERE admin_id=?', id);
  audit(id, old ? 'admin.password.reset.local' : 'admin.create.local');
  return { login: name, reset: !!old };
 });
}
