/** Test-only setup: cannot seed a code into a real family data directory. */
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
export function testActivationCode(dir = process.env.BANXUE_TEST_DB) {
 if (!dir || !resolve(dir).startsWith(resolve(tmpdir()) + sep + 'banxue-')) throw Error('邀请码验收必须指定 banxue- 临时数据库目录');
 const raw = randomBytes(16).toString('hex').toUpperCase(), code = 'BX-' + raw;
 const db = new DatabaseSync(join(dir, 'banxue.db'));
 try {
  db.prepare('INSERT INTO activation_invite(id,code_hash,code_hint,purpose,duration_days,plan_name,redeem_by,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(
   crypto.randomUUID(), createHash('sha256').update('BX' + raw).digest('hex'), raw.slice(-4), 'create', 365, '隔离测试套餐', Date.now() + 86400000, 'test-only', new Date().toISOString());
 } finally { db.close(); }
 return code;
}
