/** Run against the mounted data directory, never pass passwords as command arguments. */
import { createInterface } from 'node:readline/promises';
const login = process.argv[2];
if (!login || process.argv.length !== 3) {
 console.error('用法：node scripts/admin-account.mjs <管理员账号>（密码通过交互输入或标准输入提供）');
 process.exit(1);
}
async function readSecret(prompt) {
 if (!process.stdin.isTTY) return null;
 process.stdout.write(prompt);
 process.stdin.setRawMode(true); process.stdin.resume();
 return new Promise((resolve, reject) => {
  let value = '';
  const data = chunk => {
   for (const char of chunk.toString()) {
    if (char === '\u0003') { finish(); reject(Error('已取消')); return; }
    if (char === '\r' || char === '\n') { finish(); resolve(value); return; }
    if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
    else if (char >= ' ') value += char;
   }
  };
  const finish = () => { process.stdin.off('data', data); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
  process.stdin.on('data', data);
 });
}
try {
 let password;
 if (process.stdin.isTTY) {
  password = await readSecret('管理员密码（至少 12 位，不回显）：');
  if (password !== await readSecret('再次输入密码：')) throw Error('两次密码不一致');
 } else {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) { password = line; input.close(); break; }
 }
 const { provisionAdmin } = await import('../server/admin.mjs');
 const result = await provisionAdmin(login, password);
 console.log(result.reset ? '管理员密码已重设，旧管理会话已撤销。' : '管理员账号已创建。请访问站点 /admin 登录。');
} catch (e) { console.error(e.message); process.exitCode = 1; }
