/** Shared password hashing. Bound expensive work before it enters the worker pool. */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export const digest = value => createHash('sha256').update(value).digest('hex');
export function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
export function loginName(value) {
 const s = String(value ?? '').trim().toLowerCase();
 if (!/^[a-z0-9][a-z0-9_.@-]{2,79}$/.test(s)) fail('账号需为 3–80 位字母、数字或 . _ @ -');
 return s;
}
let hashing = 0;
async function derive(value, salt, modern = true) {
 if (hashing >= 4) fail('登录服务繁忙，请稍后再试', 503);
 hashing++;
 // OWASP's memory-constrained scrypt option: N=2^14, r=8, p=5 (16 MiB per job).
 try { return await scrypt(value, salt, 64, { N: 16384, r: 8, p: modern ? 5 : 1, maxmem: 32 * 1024 * 1024 }); } finally { hashing--; }
}
export async function hashPassword(value, minimum = 8) {
 if (typeof value !== 'string' || value.length < minimum || value.length > 128) fail(`密码需为 ${minimum}–128 个字符`);
 const salt = randomBytes(16).toString('hex');
 return `scrypt:v2:${salt}:${(await derive(value, salt)).toString('hex')}`;
}
export async function verifyPassword(value, encoded) {
 const parts = String(encoded || '').split(':'), modern = parts.length === 4 && parts[1] === 'v2';
 if (parts[0] !== 'scrypt' || (!modern && parts.length !== 3)) return false;
 const [salt, hash] = modern ? parts.slice(2) : parts.slice(1);
 if (!/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash) || typeof value !== 'string' || value.length > 128) return false;
 const actual = await derive(value, salt, modern), expected = Buffer.from(hash, 'hex');
 return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const needsPasswordUpgrade = encoded => String(encoded).split(':').length === 3;
export const DUMMY_PASSWORD = 'scrypt:v2:00000000000000000000000000000000:' + '0'.repeat(128);
