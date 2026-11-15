// 基于 CDP 的截图工具：等到指定条件再截图，避免虚拟时间被动画循环耗尽
// 用法: node scripts/shot.mjs <url> <outfile> <waitSelector> [width] [height]
const [url, out, waitSel = 'body', w = '1280', h = '900', js = ''] = process.argv.slice(2);
const PORT = 9333;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(list.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id;
  pending.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method, params }));
});

await new Promise((r) => (ws.onopen = r));
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  }
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: Number(w), height: Number(h), deviceScaleFactor: 2, mobile: false,
});
await send('Page.navigate', { url });

// 轮询等待选择器出现，最多 20 秒
const deadline = Date.now() + 20000;
let ok = false;
while (Date.now() < deadline) {
  const r = await send('Runtime.evaluate', {
    expression: `!!document.querySelector(${JSON.stringify(waitSel)})`,
    returnByValue: true,
  });
  if (r.result?.value) { ok = true; break; }
  await new Promise((r) => setTimeout(r, 250));
}
if (js) {
  await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true });
  await new Promise((r) => setTimeout(r, 1200));
}
// 额外等待动画稳定
await new Promise((r) => setTimeout(r, 900));

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
const { writeFileSync } = await import('node:fs');
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log(ok ? `OK ${out}` : `TIMEOUT(${waitSel}) ${out}`);
ws.close();
process.exit(0);
