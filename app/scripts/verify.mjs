// 端到端验收：从教材导入一路跑到宠物养成，任何一步失败即退出非零
const B = 'http://127.0.0.1:7717';
const pass = [], fail = [], skip = [];
const check = (name, cond, detail = '') => (cond ? pass : fail).push({ name, detail });

async function api(path, body, raw, ctype) {
  const init = { method: body !== undefined || raw ? 'POST' : 'GET' };
  if (raw) { init.body = raw; init.headers = { 'content-type': ctype }; }
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers = { 'content-type': 'application/json' }; }
  const r = await fetch(B + path, init);
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(data).slice(0, 160)}`);
  return data;
}

const t0 = Date.now();

// 1 健康
const health = await api('/api/health');
check('健康检查', health.ok === true);

// 2 PDF 导入
const { readFileSync } = await import('node:fs');
const pdf = readFileSync('../素材/示例教材-The Bag.pdf');
const parsed = await api(`/api/import/pdf?name=v.pdf`, undefined, pdf, 'application/pdf');
check('PDF 解析出页', parsed.pages.length >= 4, `${parsed.pages.length} 页`);
const cleanText = parsed.pages[0].sentences.join(' ');
check('页码噪声已过滤', !/\d{3,}/.test(cleanText), cleanText.slice(0, 40));

const committed = await api('/api/import/commit', {
  seriesCode: 'RAZ', seriesName: 'RAZ', level: 'B', title: 'The Bag V2',
  pages: parsed.pages, autoGenerate: true,
});
check('教材入库并切句', committed.sentences > 0, `${committed.sentences} 句`);
check('指纹生成', /^fp_/.test(committed.fingerprint), committed.fingerprint);
check('基础题生成', committed.generated.created > 0, `${committed.generated.created} 题`);

// 3 音频分析 + 绑定
const mp3 = readFileSync('../素材/audio/带停顿朗读.mp3');
const bookId = committed.book.id;
const info = await api(`/api/audio/analyze?name=a.mp3&bookId=${bookId}&pageFrom=1&pageTo=2`, undefined, mp3, 'audio/mpeg');
check('音频时长识别', info.duration > 1, `${info.duration}s`);
check('按停顿切分', info.method === 'silence', `${info.segments.length} 段 / ${info.method}`);
const bound = await api('/api/audio/bind', {
  bookId, pageFrom: 1, pageTo: 2, sourcePath: info.sourcePath, segments: info.segments, autoGenerate: true,
});
check('音频绑定到句子', bound.bound > 0, `${bound.bound} 句`);
check('听力题生成', bound.generated.created > 0, `${bound.generated.created} 道`);
const cov = await api(`/api/audio/status?bookId=${bookId}`);
check('音频覆盖率可查', cov.ratio > 0, `${cov.withAudio}/${cov.total}`);

// 4 计划
const today = new Date();
const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
const dk = (d) => d.toISOString().slice(0, 10);
const days = Array.from({ length: 7 }, (_, i) => {
  const d = new Date(monday); d.setDate(monday.getDate() + i);
  return { date: dk(d), bookId, pageFrom: 1, pageTo: 6, targetMinutes: 15 };
});
await api('/api/plan', { weekStart: dk(monday), days });
check('周计划保存', true, '7 天');

// 5 会话：三种题型覆盖
const all = await api('/api/parent/questions?bookId=' + bookId);
const answerOf = Object.fromEntries(all.map((q) => [q.id, q.answer.index]));
const types = new Set(all.map((q) => q.type));
check('题型多样', types.size >= 3, [...types].join(','));

const s = await api('/api/session', { mode: 'training' });
check('抽题成功', s.questions.length > 0, `${s.questions.length} 题`);
// 只有抽到听力题时才能验证排序；没抽到不算失败
const hasListen = s.questions.some((q) => q.type === 'listening_choice');
check('听力题排在最前', !hasListen || s.questions[0].type === 'listening_choice',
  hasListen ? s.questions[0].type : '本次未抽到听力题');
check('题面不含答案', !JSON.stringify(s.questions).includes('"answer"'), '无 answer 字段');

let correct = 0;
for (const q of s.questions) {
  const r = await api(`/api/session/${s.sessionId}/answer`, {
    questionId: q.id, response: { index: answerOf[q.id] ?? 0 }, elapsedMs: 3000,
  });
  if (r.correct) correct++;
}
check('判分正确', correct === s.questions.length, `${correct}/${s.questions.length}`);

const fin = await api(`/api/session/${s.sessionId}/finish`, {});
// 奖励按「每天每档一次」去重，所以当天重复跑验收时 gifts 为空是正确行为
check('结算发奖或已领过',
  fin.reward.gifts.length > 0 || fin.reward.alreadyRewarded === true,
  fin.reward.gifts.length ? JSON.stringify(fin.reward.gifts) : '今天这一档已领过');
const fin2 = await api(`/api/session/${s.sessionId}/finish`, {});
check('重复结算不重复发奖', fin2.reward.alreadyRewarded === true);

// 6 复习排期
const tp = await api('/api/today');
const totalFuture = tp.forecast.reduce((n, f) => n + f.count, 0);
check('复习卡已排期', totalFuture > 0, `${totalFuture} 张`);

// 7 宠物
const petBefore = await api('/api/pet');
const act = await api('/api/pet/action', { action: 'pet' });
check('宠物互动生效', act.ok === true, act.text);
const petAfter = await api('/api/pet');
check('亲密度增长', petAfter.bond >= petBefore.bond, `${petBefore.bond} → ${petAfter.bond}`);
check('事件记录', petAfter.events.length > 0, `${petAfter.events.length} 条`);
check('场景数组完整', petAfter.scenes.length === 5);

// 8 MCP
const mcpList = await api('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
check('MCP 工具可列', mcpList.result.tools.length >= 6, `${mcpList.result.tools.length} 个`);
const mcpBad = await api('/mcp', {
  jsonrpc: '2.0', id: 2, method: 'tools/call',
  params: { name: 'question_create_batch', arguments: { candidates: [{ bookId, page: 99, sentenceIndex: 0, type: 'word_choice', prompt: 'x', answer: { index: 0 }, payload: { options: [{ text: 'a' }, { text: 'b' }] } }] } },
});
const mcpBadRes = JSON.parse(mcpBad.result.content[0].text);
check('MCP 拒绝错误页码', mcpBadRes.rejected === 1, mcpBadRes.rejectedItems?.[0]?.message ?? '');

// 9 静态托管（开发模式未开启 --static，此项跳过而不是判失败）
const home = await fetch(B + '/');
if (home.status === 404) {
  skip.push({ name: '生产页面托管', detail: '当前为开发模式，需 node server/index.mjs --static' });
} else {
  check('生产页面可访问', home.ok, String(home.status));
}

const ms = Date.now() - t0;
console.log(`\n通过 ${pass.length} 项，失败 ${fail.length} 项，跳过 ${skip.length} 项，耗时 ${ms}ms\n`);
for (const p of pass) console.log('  ✅', p.name, p.detail ? `— ${p.detail}` : '');
for (const f of fail) console.log('  ❌', f.name, '—', f.detail);
for (const k of skip) console.log('  ⏭', k.name, '—', k.detail);
process.exit(fail.length ? 1 : 0);
