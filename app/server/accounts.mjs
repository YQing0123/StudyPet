/** Family-scoped identities and durable, revocable sessions. No default credentials. */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { q, db, tx, uid, now } from './db.mjs';
import * as V from './v2.mjs';
const scrypt = promisify(scryptCallback);
const TTL = 14 * 24 * 60 * 60 * 1000;
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => { const e = new Error(message); e.status = status; throw e; };
const text = (value, label, max = 40) => { const s = String(value ?? '').trim(); if (!s || s.length > max) fail(`${label}需填写 1–${max} 个字符`); return s; };
const loginName = value => { const s = String(value ?? '').trim().toLowerCase(); if (!/^[a-z0-9][a-z0-9_.@-]{2,79}$/.test(s)) fail('账号需为 3–80 位字母、数字或 . _ @ -'); return s; };
const validPassword = value => { if (typeof value !== 'string' || value.length < 8 || value.length > 128) fail('密码需为 8–128 个字符'); return value; };
async function hashPassword(value) { const salt = randomBytes(16).toString('hex'); const hash = await scrypt(validPassword(value), salt, 64); return `scrypt:${salt}:${hash.toString('hex')}`; }
async function verifyPassword(value, encoded) {
 const [,salt,hash] = String(encoded || '').split(':');
 if (!salt || !hash || typeof value !== 'string' || value.length > 128) return false;
 const actual = await scrypt(value, salt, 64), expected = Buffer.from(hash, 'hex');
 return actual.length === expected.length && timingSafeEqual(actual, expected);
}

db.exec(`
CREATE TABLE IF NOT EXISTS family(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS user_account(id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS family_member(family_id TEXT NOT NULL REFERENCES family(id), account_id TEXT NOT NULL REFERENCES user_account(id), role TEXT NOT NULL CHECK(role IN ('parent','student')), relation TEXT NOT NULL, child_id TEXT REFERENCES child(id), PRIMARY KEY(family_id,account_id));
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_account_child ON family_member(child_id) WHERE child_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_member_account ON family_member(account_id,family_id);
CREATE TABLE IF NOT EXISTS login_session(token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES user_account(id), family_id TEXT NOT NULL REFERENCES family(id), child_id TEXT REFERENCES child(id), parent_unlocked INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_session_account ON login_session(account_id);
CREATE TABLE IF NOT EXISTS family_invite(id TEXT PRIMARY KEY, family_id TEXT NOT NULL REFERENCES family(id), code_hash TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, expires_at INTEGER NOT NULL, used_by TEXT, revoked_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS account_audit(id TEXT PRIMARY KEY, family_id TEXT NOT NULL, account_id TEXT NOT NULL, child_id TEXT, action TEXT NOT NULL, created_at TEXT NOT NULL);
`);
if (!q.all('PRAGMA table_info(child)').some(c => c.name === 'family_id')) db.exec('ALTER TABLE child ADD COLUMN family_id TEXT REFERENCES family(id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_child_family ON child(family_id,created_at)');
export const audit = (c, action) => q.run('INSERT INTO account_audit(id,family_id,account_id,child_id,action,created_at) VALUES(?,?,?,?,?,?)',uid(),c.family_id,c.account_id,c.child_id || null,action,now());
const legacyAvailable = () => !q.get('SELECT id FROM user_account LIMIT 1') && !!q.get('SELECT id FROM child WHERE family_id IS NULL LIMIT 1');
function addChildRow(familyId, body) {
 const id = uid(), name = text(body.name, '孩子名字', 20), grade = Number(body.grade ?? 2);
 if (!Number.isInteger(grade) || grade < 0 || grade > 12) fail('年级需为 0–12');
 q.run('INSERT INTO child(id,name,avatar,grade,created_at,family_id) VALUES(?,?,?,?,?,?)',id,name,'🌱',grade,now(),familyId);
 return id;
}
function createSession(accountId, familyId, childId, unlocked, res, secure = false) {
 const token = randomBytes(32).toString('base64url');
 q.run('DELETE FROM login_session WHERE expires_at<?',Date.now());
 q.run('INSERT INTO login_session VALUES(?,?,?,?,?,?,?)',digest(token),accountId,familyId,childId,unlocked ? 1 : 0,Date.now()+TTL,now());
 res.setHeader('set-cookie', `island_session=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${TTL/1000}${secure ? '; Secure' : ''}`);
 return readSession({headers:{cookie:`island_session=${token}`}});
}
export function readSession(req) {
 const token = /(?:^|;\s*)island_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
 if (!token || token.length > 100) return null;
 return q.get(`SELECT s.*,a.login,a.display_name,m.role,m.relation FROM login_session s JOIN user_account a ON a.id=s.account_id JOIN family_member m ON m.account_id=s.account_id AND m.family_id=s.family_id WHERE s.token_hash=? AND s.expires_at>?`,digest(token),Date.now()) || null;
}
export function context(req) {
 const s = readSession(req); if (!s) fail('请先登录账号',401);
 const familyId = req.headers['x-family-id'] || s.family_id;
 const membership = q.get('SELECT * FROM family_member WHERE account_id=? AND family_id=?',s.account_id,familyId);
 if (!membership) fail('无权访问这个家庭',403);
 const childId = req.headers['x-child-id'] || (familyId === s.family_id ? s.child_id : null);
 if (membership.role === 'student' && childId !== membership.child_id) fail('学生只能访问自己的记录',403);
 const child = childId ? q.get('SELECT * FROM child WHERE id=? AND family_id=?',childId,familyId) : null;
 if (childId && !child) fail('无权访问这个孩子',403);
 return {...s,...membership,token_hash:s.token_hash,account_id:s.account_id,family_id:familyId,child_id:child?.id || null,child};
}
export function requireParent(c) { if (c.role !== 'parent' || !c.parent_unlocked) fail('请使用家长账号解锁后操作',403); }
export function snapshot(c) {
 if (!c) return { authenticated:false, legacyAvailable:legacyAvailable() };
 const families = q.all('SELECT f.id,f.name,m.role,m.relation FROM family f JOIN family_member m ON m.family_id=f.id WHERE m.account_id=? ORDER BY f.created_at',c.account_id);
 const family = families.find(f=>f.id===c.family_id);
 const children = q.all('SELECT id,name,grade,avatar FROM child WHERE family_id=? ORDER BY created_at,id',c.family_id)
  .filter(x => c.role === 'parent' || x.id === c.child_id);
 const members = c.role === 'parent' && c.parent_unlocked ? q.all(`SELECT a.id,a.login,a.display_name AS name,m.relation,m.role,m.child_id AS childId FROM family_member m JOIN user_account a ON a.id=m.account_id WHERE m.family_id=? ORDER BY a.created_at`,c.family_id) : [];
 const invitations = c.role === 'parent' && c.parent_unlocked ? q.all('SELECT id,expires_at AS expiresAt,created_at AS createdAt FROM family_invite WHERE family_id=? AND used_by IS NULL AND revoked_at IS NULL AND expires_at>?',c.family_id,Date.now()) : [];
 return {authenticated:true,user:{id:c.account_id,login:c.login,name:c.display_name},family,families,children,members,invitations,activeChildId:c.child_id,parentUnlocked:!!c.parent_unlocked && c.role==='parent',role:c.role};
}
// Small persistent attempt windows: restarting the service does not reset limits.
db.exec('CREATE TABLE IF NOT EXISTS auth_attempt(key TEXT PRIMARY KEY, count INTEGER NOT NULL, until_ms INTEGER NOT NULL)');
export function throttle(key, max = 12) {
 const t = Date.now();q.run('DELETE FROM auth_attempt WHERE until_ms<?',t);
 const r=q.get('SELECT * FROM auth_attempt WHERE key=?',key);
 if (r?.count >= max) fail('尝试次数较多，请 10 分钟后再试',429);
 q.run('INSERT INTO auth_attempt VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',key,t+600000);
}
export function clearAttempts(key) { q.run('DELETE FROM auth_attempt WHERE key=?',key); }

export async function register(body,res,secure) {
 const login=loginName(body.login), name=text(body.name,'你的称呼',20), passwordHash=await hashPassword(body.password);
 const familyName=text(body.familyName || `${name}的家`,'家庭名称',40);
 const claim = !!body.claimLegacy;
 // First migration is explicit and proves possession of the old local parent PIN.
 if (claim) {
  if (!legacyAvailable()) fail('原记录已关联家庭，请使用已有账号登录');
  const first=q.get('SELECT id FROM child WHERE family_id IS NULL ORDER BY created_at LIMIT 1');
  if (!V.verifyPin(first.id,body.legacyPin)) fail('原家长密码不正确，无法关联已有记录');
 }
 let accountId,familyId,childId;
 tx(()=>{
  if (q.get('SELECT id FROM user_account WHERE login=?',login)) fail('这个账号已被使用');
  if (claim && !legacyAvailable()) fail('原记录已关联家庭，请使用已有账号登录');
  if (!claim && legacyAvailable()) fail('请先关联本机已有记录，再创建其他家庭');
  accountId=uid();familyId=uid();
  q.run('INSERT INTO user_account VALUES(?,?,?,?,?)',accountId,login,name,passwordHash,now());
  q.run('INSERT INTO family VALUES(?,?,?)',familyId,familyName,now());
  q.run('INSERT INTO family_member VALUES(?,?,?,?,NULL)',familyId,accountId,'parent',text(body.relation || '家长','家庭身份',10));
  if (claim) { q.run('UPDATE child SET family_id=? WHERE family_id IS NULL',familyId);childId=q.get('SELECT id FROM child WHERE family_id=? ORDER BY created_at LIMIT 1',familyId).id; }
  else childId=addChildRow(familyId,{name:body.childName,grade:body.grade});
 });
 return snapshot(createSession(accountId,familyId,childId,true,res,secure));
}
export async function login(body,res,secure) {
 const login=loginName(body.login), a=q.get('SELECT * FROM user_account WHERE login=?',login);
 // Run the same expensive hash for unknown identities too.
 const dummy='scrypt:00000000000000000000000000000000:'+ '0'.repeat(128);
 const ok=await verifyPassword(body.password,a?.password_hash || dummy);
 if (!a || !ok) fail('账号或密码不正确',401);
 const m=q.get('SELECT * FROM family_member WHERE account_id=? ORDER BY family_id LIMIT 1',a.id);
 if (!m) fail('账号尚未关联家庭',403);
 const childId=m.role==='student'?m.child_id:q.get('SELECT id FROM child WHERE family_id=? ORDER BY created_at,id LIMIT 1',m.family_id)?.id || null;
 return snapshot(createSession(a.id,m.family_id,childId,m.role==='parent',res,secure));
}
export function logout(req,res) {
 const s=readSession(req);if(s)q.run('DELETE FROM login_session WHERE token_hash=?',s.token_hash);
 res.setHeader('set-cookie','island_session=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0');
 return {authenticated:false,legacyAvailable:legacyAvailable()};
}
export function lock(c) {q.run('UPDATE login_session SET parent_unlocked=0 WHERE token_hash=?',c.token_hash);return snapshot({...c,parent_unlocked:0});}
export async function unlock(c,body) {
 if(c.role!=='parent')fail('学生账号没有家长权限',403);
 const a=q.get('SELECT password_hash FROM user_account WHERE id=?',c.account_id);
 if(!await verifyPassword(body.password,a.password_hash))fail('家长账号密码不正确',401);
 q.run('UPDATE login_session SET parent_unlocked=1 WHERE token_hash=?',c.token_hash);return snapshot({...c,parent_unlocked:1});
}
export function selectContext(c,body) {
 requireParent(c);
 const familyId=String(body.familyId || c.family_id),m=q.get("SELECT * FROM family_member WHERE account_id=? AND family_id=? AND role='parent'",c.account_id,familyId);
 if(!m)fail('无权管理这个家庭',403);
 const childId=body.childId || q.get('SELECT id FROM child WHERE family_id=? ORDER BY created_at,id LIMIT 1',familyId)?.id || null;
 if(childId && !q.get('SELECT id FROM child WHERE id=? AND family_id=?',childId,familyId))fail('无权访问这个孩子',403);
 q.run('UPDATE login_session SET family_id=?,child_id=? WHERE token_hash=?',familyId,childId,c.token_hash);
 return snapshot({...c,...m,family_id:familyId,child_id:childId});
}
export function addChild(c,body) { requireParent(c);const id=tx(()=>addChildRow(c.family_id,body));audit({...c,child_id:id},'child.create');return snapshot(c); }
export function renameChild(c,id,body) {requireParent(c);if(!q.get('SELECT id FROM child WHERE id=? AND family_id=?',id,c.family_id))fail('无权修改这个孩子',403);const grade=Number(body.grade ?? 2);if(!Number.isInteger(grade)||grade<0||grade>12)fail('年级需为 0–12');q.run('UPDATE child SET name=?,grade=? WHERE id=?',text(body.name,'孩子名字',20),grade,id);audit({...c,child_id:id},'child.update');return snapshot(c);}
export function createInvite(c) {
 requireParent(c); const code=randomBytes(18).toString('base64url');const id=uid(),expires=Date.now()+48*3600000;
 q.run('INSERT INTO family_invite VALUES(?,?,?,?,?,NULL,NULL,?)',id,c.family_id,digest(code),c.account_id,expires,now());audit(c,'invite.create');
 return {id,code,expiresAt:expires};
}
export function revokeInvite(c,id){requireParent(c);q.run('UPDATE family_invite SET revoked_at=? WHERE id=? AND family_id=? AND used_by IS NULL',now(),id,c.family_id);return snapshot(c);}
export async function join(body,res,secure,c) {
 let accountId=c?.account_id,passwordHash,login,name;
 if(c)requireParent(c);
 else {login=loginName(body.login);name=text(body.name,'你的称呼',20);passwordHash=await hashPassword(body.password);}
 let familyId,childId;
 tx(()=>{
  const invite=q.get('SELECT * FROM family_invite WHERE code_hash=? AND used_by IS NULL AND revoked_at IS NULL AND expires_at>?',digest(String(body.code || '').trim()),Date.now());
  if(!invite)fail('邀请码无效、已使用或已过期');
  familyId=invite.family_id;
  if(accountId && q.get('SELECT 1 FROM family_member WHERE account_id=? AND family_id=?',accountId,familyId))fail('你已经在这个家庭中');
  if(!accountId){if(q.get('SELECT id FROM user_account WHERE login=?',login))fail('账号已存在，请先登录再加入家庭');accountId=uid();q.run('INSERT INTO user_account VALUES(?,?,?,?,?)',accountId,login,name,passwordHash,now());}
  q.run('INSERT INTO family_member VALUES(?,?,?,?,NULL)',familyId,accountId,'parent',text(body.relation || '家长','家庭身份',10));
  q.run('UPDATE family_invite SET used_by=? WHERE id=?',accountId,invite.id);
  childId=q.get('SELECT id FROM child WHERE family_id=? ORDER BY created_at,id LIMIT 1',familyId)?.id || null;
 });
 if(c)q.run('DELETE FROM login_session WHERE token_hash=?',c.token_hash);
 return snapshot(createSession(accountId,familyId,childId,true,res,secure));
}
export async function studentAccount(c,id,body) {
 requireParent(c); if(!q.get('SELECT id FROM child WHERE id=? AND family_id=?',id,c.family_id))fail('无权管理这个孩子',403);
 const hash=await hashPassword(body.password), existing=q.get('SELECT * FROM family_member WHERE child_id=?',id);
 if(existing){tx(()=>{q.run('UPDATE user_account SET password_hash=? WHERE id=?',hash,existing.account_id);q.run('DELETE FROM login_session WHERE account_id=?',existing.account_id);});}
 else {const login=loginName(body.login);if(q.get('SELECT id FROM user_account WHERE login=?',login))fail('这个账号已被使用');tx(()=>{const aid=uid();q.run('INSERT INTO user_account VALUES(?,?,?,?,?)',aid,login,q.get('SELECT name FROM child WHERE id=?',id).name,hash,now());q.run('INSERT INTO family_member VALUES(?,?,?,?,?)',c.family_id,aid,'student','孩子',id);});}
 audit({...c,child_id:id},existing?'student.password.reset':'student.account.create');return snapshot(c);
}
export async function changePassword(c,body) {
 const a=q.get('SELECT password_hash FROM user_account WHERE id=?',c.account_id);
 if(!await verifyPassword(body.currentPassword,a.password_hash))fail('原密码不正确',401);
 const hash=await hashPassword(body.password);
 tx(()=>{q.run('UPDATE user_account SET password_hash=? WHERE id=?',hash,c.account_id);q.run('DELETE FROM login_session WHERE account_id=? AND token_hash<>?',c.account_id,c.token_hash);});
 return {ok:true};
}
export function removeParent(c,id) {
 requireParent(c);
 if(id===c.account_id)fail('请由另一位家长移除你的家庭权限');
 tx(()=>{const m=q.get("SELECT * FROM family_member WHERE account_id=? AND family_id=? AND role='parent'",id,c.family_id);if(!m)fail('没有这位家长');q.run('DELETE FROM family_member WHERE account_id=? AND family_id=?',id,c.family_id);q.run('DELETE FROM login_session WHERE account_id=? AND family_id=?',id,c.family_id);});audit(c,'parent.remove');return snapshot(c);
}
