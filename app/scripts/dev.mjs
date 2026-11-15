// 一键启动：同时拉起 API 与 Vite，任一退出即整体退出
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const procs = [];

function run(name, cmd, args, color) {
  const p = spawn(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const tag = `\x1b[${color}m[${name}]\x1b[0m`;
  const pipe = (stream, isErr) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) console.log(`${tag} ${l}`);
    });
  };
  pipe(p.stdout); pipe(p.stderr);
  p.on('exit', (code) => {
    if (code !== 0 && code !== null) console.log(`${tag} 退出 code=${code}`);
    shutdown(code ?? 0);
  });
  procs.push(p);
  return p;
}

let closing = false;
function shutdown(code) {
  if (closing) return;
  closing = true;
  for (const p of procs) { try { p.kill('SIGTERM'); } catch {} }
  setTimeout(() => process.exit(code), 200);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('api', process.execPath, ['server/index.mjs'], '36');
run('web', process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], '35');
