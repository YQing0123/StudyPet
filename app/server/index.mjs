import { saveRoom } from './pet-room.mjs';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as ACCOUNTS from './accounts.mjs';
import * as ADMIN from './admin.mjs';
import * as SUBSCRIPTIONS from './subscriptions.mjs';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { q, now, uid, tx, db, DATA_DIR } from './db.mjs';
import * as SRS from './srs.mjs';
import * as PET from './pet.mjs';
import * as DAILY from './daily.mjs';
import { confirmLevel, acknowledgeLevel } from './pet-progression.mjs';
import * as V2 from './v2.mjs';
import * as POINTS from './points.mjs';
import * as TRAVEL from './travel.mjs';
import * as CHALLENGES from './challenges.mjs';
import { notificationPhoto } from './notification-cards.mjs';
import { startNotificationScheduler } from './notification-scheduler.mjs';
import * as CONTENT from './content.mjs';
import * as AUDIO from './audio.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 7717);
const HOST = process.env.HOST || '127.0.0.1';
const STATIC_MODE = process.argv.includes('--static');
const PUBLIC_ORIGIN = (process.env.BANXUE_PUBLIC_ORIGIN || '').replace(/\/$/, '');
if (PUBLIC_ORIGIN) {
 const u = new URL(PUBLIC_ORIGIN);
 if (u.origin !== PUBLIC_ORIGIN || u.protocol !== 'https:') throw Error('BANXUE_PUBLIC_ORIGIN 必须是无路径的 HTTPS Origin');
}
if (process.env.NODE_ENV === 'production' && !PUBLIC_ORIGIN && process.env.BANXUE_ALLOW_HTTP !== '1') {
 throw Error('公网生产部署必须配置 BANXUE_PUBLIC_ORIGIN；仅隔离内网 HTTP 试用可设置 BANXUE_ALLOW_HTTP=1');
}

/* ---------------- 工具 ---------------- */
const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
};
const err = (res, code, message) => json(res, code, { error: message });
function apiError(res,e) {
  const sqlite=String(e.code||'').startsWith('ERR_SQLITE');
  const constraint=sqlite && (Number(e.errcode)&255)===19;
  const internal=e.status===500 || (sqlite && !constraint);
  if(internal)console.error('API internal error:',e.code||e.name);
  if(e.status===429)res.setHeader('retry-after','600');
  if(!res.headersSent)err(res,constraint?400:internal?500:e.status||400,constraint?'请求内容或资源状态不正确':internal?'服务暂时不可用':e.message||'请求失败');else res.destroy();
}

async function readBody(req, limit = 200 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) { const e = new Error('请求体过大'); e.status = 413; throw e; }
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
async function readJson(req) {
  const limit = /^\/api\/v2\/tasks\/[^/?]+\/submit(?:\?|$)/.test(req.url) ? 8 * 1024 * 1024 : 256 * 1024;
  if (Number(req.headers['content-length']) > limit) { const e = new Error('请求体过大'); e.status = 413; throw e; }
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  let value;
  try { value = JSON.parse(buf.toString('utf8')); } catch { throw Error('JSON 请求格式不正确'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('请求内容需为 JSON 对象');
  const c = requestContext.getStore();
  if (c) SUBSCRIPTIONS.requireActive(c.family_id);
  return value;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.webm': 'video/webm',
  '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.pdf': 'application/pdf',
};

async function serveFile(req, res, filePath) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return err(res,404,'未找到文件');
    const etag = `W/"${info.size}-${Math.trunc(info.mtimeMs)}"`;
    const headers = {'content-type':MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control':['.html','.json'].includes(extname(filePath))?'no-cache':'public, max-age=300',
      'etag':etag,'accept-ranges':'bytes','x-content-type-options':'nosniff'};
    if(req.headers['if-none-match']===etag) {res.writeHead(304,headers);return res.end();}
    let start=0,end=info.size-1,status=200;
    const range=req.headers.range;
    if(range && (!req.headers['if-range'] || req.headers['if-range']===etag)) {
      const m=/^bytes=(\d*)-(\d*)$/.exec(range);
      if(!m || (!m[1]&&!m[2])) {res.writeHead(416,{'content-range':`bytes */${info.size}`});return res.end();}
      if(!m[1])start=Math.max(0,info.size-Number(m[2]));
      else {start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}
      if(start>end || start>=info.size) {res.writeHead(416,{'content-range':`bytes */${info.size}`});return res.end();}
      status=206;headers['content-range']=`bytes ${start}-${end}/${info.size}`;
    }
    headers['content-length']=Math.max(0,end-start+1);res.writeHead(status,headers);
    if(req.method==='HEAD' || !info.size)return res.end();
    const stream=createReadStream(filePath,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  } catch { if(!res.headersSent)err(res,404,'未找到文件');else res.destroy(); }
}

/* ---------------- 业务 ---------------- */
const requestContext = new AsyncLocalStorage();
function defaultChild() {
  const c = requestContext.getStore();
  if (!c?.child) { const e = new Error('请先选择家庭中的孩子'); e.status=409; throw e; }
  return c.child;
}

function todayPlan(childId, date = SRS.toDateKey()) {
  const plan = q.get(`SELECT * FROM plan WHERE child_id=? ORDER BY week_start DESC LIMIT 1`, childId);
  if (!plan) return null;
  const day = q.get('SELECT * FROM plan_day WHERE plan_id=? AND date=?', plan.id, date);
  if (!day) return { plan, day: null };
  const book = day.book_id ? q.get('SELECT * FROM book WHERE id=?', day.book_id) : null;
  return { plan, day, book };
}

function bootstrap() {
  const child = defaultChild();
  const pet = PET.petSnapshot(child.id);
  const due = SRS.dueCards(child.id, SRS.DAILY_REVIEW_CAP);
  const tp = todayPlan(child.id);
  const today = SRS.toDateKey();
  const doneRow = q.get(
    `SELECT COUNT(*) AS n, SUM(correct) AS ok FROM attempt a
       JOIN session s ON s.id=a.session_id
      WHERE s.child_id=? AND s.date=?`, child.id, today);

  return {
    child, pet,
    today: {
      date: today,
      plan: tp?.day ?? null,
      book: tp?.book ?? null,
      dueCount: due.length,
      attempts: doneRow?.n ?? 0,
      correct: doneRow?.ok ?? 0,
    },
    scenes: pet.scenes,
  };
}

function startSession({ childId, mode, bookId, pageFrom, pageTo, focus }) {
  const date = SRS.toDateKey();

  // 没有指定教材时，按「今日计划 → 最近导入的教材」回退，
  // 保证首页的「开始学习」在没有参数时也能用。
  if (mode !== 'review' && !bookId) {
    const tp = todayPlan(childId, date);
    bookId = tp?.day?.book_id ?? q.get('SELECT id FROM book ORDER BY created_at DESC LIMIT 1')?.id ?? null;
    if (bookId && !pageFrom) {
      pageFrom = tp?.day?.page_from ?? 1;
      pageTo = tp?.day?.page_to ?? 9999;
    }
  }
  if (mode !== 'review' && !bookId) throw new Error('还没有导入教材');

  const id = uid();
  q.run(`INSERT INTO session(id, child_id, date, mode, book_id, page_from, page_to, status, started_at)
         VALUES(?,?,?,?,?,?,?,?,?)`,
    id, childId, date, mode, bookId ?? null, pageFrom ?? null, pageTo ?? null, 'active', now());

  let questions;
  if (mode === 'review') {
    questions = SRS.dueCards(childId, SRS.DAILY_REVIEW_CAP).map(c => CONTENT.publicQuestion(c.question_id)).filter(Boolean);
  } else {
    const focusTypes = focus === 'listening' ? ['listening_choice']
      : focus === 'reading' ? ['word_choice', 'cloze_choice', 'picture_choice']
      : null;
    questions = CONTENT.buildQuestionSet({
      childId, bookId, pageFrom: pageFrom ?? 1, pageTo: pageTo ?? 9999,
      count: mode === 'verification' ? 5 : 6, mode, types: focusTypes,
    });
  }
  return { sessionId: id, mode, questions };
}

function gradeQuestion(questionId, response) {
  const row = q.get('SELECT * FROM question WHERE id=?', questionId);
  if (!row) return { correct: false, reason: 'NOT_FOUND' };
  const answer = JSON.parse(row.answer);
  if (['word_choice', 'cloze_choice', 'picture_choice', 'listening_choice'].includes(row.type)) {
    const ok = Number(response?.index) === Number(answer.index);
    return { correct: ok, expected: answer.index, expectedText: answer.text };
  }
  if (row.type === 'text') {
    const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return { correct: norm(response?.text) === norm(answer.text), expectedText: answer.text };
  }
  return { correct: false, reason: 'UNSUPPORTED_TYPE' };
}

function answerSession(sessionId, body) {
  const s = q.get('SELECT * FROM session WHERE id=?', sessionId);
  if (!s) throw new Error('会话不存在');
  const { questionId, response, helped = false, unrecognized = false, elapsedMs = 0 } = body;
  const g = gradeQuestion(questionId, response);
  const correct = unrecognized ? false : g.correct;

  q.run(`INSERT INTO attempt(id, session_id, question_id, response, correct, helped, unrecognized, elapsed_ms, created_at)
         VALUES(?,?,?,?,?,?,?,?,?)`,
    uid(), sessionId, questionId, JSON.stringify(response ?? null),
    correct ? 1 : 0, helped ? 1 : 0, unrecognized ? 1 : 0, elapsedMs, now());

  const qrow = q.get('SELECT difficulty, objective_id FROM question WHERE id=?', questionId);
  const card = SRS.upsertCard(s.child_id, questionId, qrow?.objective_id ?? null, {
    correct, helped, unrecognized, difficulty: qrow?.difficulty ?? 3,
  });

  return {
    correct, helped, unrecognized,
    expected: g.expected, expectedText: g.expectedText,
    nextDue: card.due_at, level: card.level,
    mastery: SRS.masteryOf(card.level),
  };
}

function finishSession(sessionId) {
  // 状态更新与发奖必须原子：奖励失败不能让会话停留在「已完成」，
  // 否则里程碑判定、重复结算、账本都会错。
  return tx(() => {
  const s = q.get('SELECT * FROM session WHERE id=?', sessionId);
  if (!s) throw new Error('会话不存在');
  if (s.status === 'finished') {
    const prev = q.get(`SELECT COUNT(*) AS total, SUM(correct) AS correct FROM attempt WHERE session_id=?`, sessionId);
    return {
      stats: { total: prev?.total ?? 0, correct: prev?.correct ?? 0, helped: 0, unrecognized: 0,
               accuracy: prev?.total ? Math.round((prev.correct / prev.total) * 100) : 0 },
      reward: { gifts: [], exp: 0, alreadyRewarded: true },
      pet: PET.petSnapshot(s.child_id),
    };
  }
  const stats = q.get(`SELECT COUNT(*) AS total, SUM(correct) AS correct,
                              SUM(helped) AS helped, SUM(unrecognized) AS unrecognized
                         FROM attempt WHERE session_id=?`, sessionId);
  const total = stats?.total ?? 0;
  const correct = stats?.correct ?? 0;
  const helped = stats?.helped ?? 0;

  q.run('UPDATE session SET status=?, finished_at=? WHERE id=?', 'finished', now(), sessionId);

  const reward = PET.rewardStudy(s.child_id, {
    slot: s.mode === 'verification' ? 'verify' : 'train',
    mode: s.mode, correct,
  });

  // 里程碑
  const finishedCount = q.get('SELECT COUNT(*) AS n FROM session WHERE child_id=? AND status=?', s.child_id, 'finished')?.n ?? 0;
  if (finishedCount === 1) PET.addMilestone(s.child_id, 'first_session', '第一次完成学习', '今天开始了第一段旅程');
  if (finishedCount === 5) PET.addMilestone(s.child_id, 'five_sessions', '连续学习 5 次', '坚持真的会变成习惯');

  return {
    stats: { total, correct, helped, unrecognized: stats?.unrecognized ?? 0,
             accuracy: total ? Math.round((correct / total) * 100) : 0 },
    reward,
    pet: PET.petSnapshot(s.child_id),
  };
  });
}

/* ---------------- MCP ---------------- */
const MCP_TOOLS = [
  { name: 'library_list_books', description: '列出教材', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'library_book_detail', description: '某本教材的页与句子（含页码、句序）', inputSchema: { type: 'object', properties: { bookId: { type: 'string' } }, required: ['bookId'], additionalProperties: false } },
  { name: 'question_search', description: '按教材/状态检索题目', inputSchema: { type: 'object', properties: { bookId: { type: 'string' }, limit: { type: 'number' } }, additionalProperties: false } },
  { name: 'question_create_batch', description: '批量创建候选题（自然键：bookId + page + sentenceIndex）', inputSchema: { type: 'object', properties: { candidates: { type: 'array', items: { type: 'object' } } }, required: ['candidates'], additionalProperties: false } },
  { name: 'question_delete', description: '删除题目', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'], additionalProperties: false } },
  { name: 'review_forecast', description: '未来复习量预测', inputSchema: { type: 'object', properties: { days: { type: 'number' } }, additionalProperties: false } },
];

const MCP_IMPL = {
  async library_list_books() { return CONTENT.listBooks(); },
  async library_book_detail({ bookId }) {
    const d = CONTENT.bookDetail(bookId);
    if (!d) throw new Error('教材不存在');
    return d.pages.map(p => ({
      page: p.index_no,
      sentences: p.sentences.map(s => ({ index: s.index_no, text: s.text, audio: s.audio_path })),
    }));
  },
  async question_search({ bookId, limit = 50 }) {
    const rows = bookId
      ? q.all('SELECT id, type, prompt, instruction, difficulty, status, source FROM question WHERE book_id=? ORDER BY created_at DESC LIMIT ?', bookId, limit)
      : q.all('SELECT id, type, prompt, instruction, difficulty, status, source FROM question ORDER BY created_at DESC LIMIT ?', limit);
    return rows;
  },
  async question_create_batch({ candidates }) {
    if (!Array.isArray(candidates)) throw new Error('candidates 必须是数组');
    if (candidates.length > 200) throw new Error('单次最多 200 条');
    const accepted = [], rejected = [];

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      try {
        const book = q.get('SELECT id FROM book WHERE id=?', c.bookId);
        if (!book) throw new Error(`L2: 教材不存在 ${c.bookId}`);
        let sentenceId = null;
        if (c.page != null && c.sentenceIndex != null) {
          const s = q.get(`SELECT se.id FROM sentence se JOIN page p ON p.id=se.page_id
                            WHERE p.book_id=? AND p.index_no=? AND se.index_no=?`,
            c.bookId, c.page, c.sentenceIndex);
          if (!s) throw new Error(`L2: 第 ${c.page} 页没有第 ${c.sentenceIndex} 句`);
          sentenceId = s.id;
        }
        if (!c.type) throw new Error('L1: 缺少 type');
        if (!c.prompt) throw new Error('L1: 缺少 prompt');
        if (!c.answer) throw new Error('L1: 缺少 answer');
        if (c.payload?.options?.length < 2) throw new Error('L3: 选项至少 2 个');
        if (c.payload?.options) {
          const seen = new Set();
          for (const o of c.payload.options) {
            const k = o.text ?? o.asset;
            if (seen.has(k)) throw new Error(`L3: 选项重复 ${k}`);
            seen.add(k);
          }
        }
        const dedupe = c.dedupeKey ?? `mcp:${c.bookId}:${c.page ?? 0}:${c.sentenceIndex ?? 0}:${c.type}:${String(c.prompt).slice(0, 40)}`;
        if (q.get('SELECT id FROM question WHERE dedupe_key=?', dedupe)) {
          rejected.push({ index: i, code: 'L4_DUPLICATE', message: '已存在相同题目' });
          continue;
        }
        const id = uid();
        q.run(`INSERT INTO question(id, book_id, type, sentence_id, prompt, instruction, payload, answer, difficulty, status, source, dedupe_key, created_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          id, c.bookId, c.type, sentenceId, c.prompt, c.instruction ?? '',
          JSON.stringify(c.payload ?? {}), JSON.stringify(c.answer),
          c.difficulty ?? 2, 'published', c.source ?? 'mcp', dedupe, now());
        accepted.push({ index: i, id });
      } catch (e) {
        rejected.push({ index: i, code: String(e.message).split(':')[0] || 'ERROR', message: e.message });
      }
    }
    return { accepted: accepted.length, rejected: rejected.length, rejectedItems: rejected, ids: accepted.map(a => a.id) };
  },
  async question_delete({ ids }) {
    let n = 0;
    for (const id of ids ?? []) { q.run('DELETE FROM question WHERE id=?', id); n++; }
    return { deleted: n };
  },
  async review_forecast({ days = 7 }) {
    return SRS.forecast(defaultChild().id, Math.min(days, 30));
  },
};

async function handleMcp(req, res) {
  const body = await readJson(req);
  const { id = null, method, params } = body ?? {};
  const reply = (result) => json(res, 200, { jsonrpc: '2.0', id, result });
  const fail = (code, message) => json(res, 200, { jsonrpc: '2.0', id, error: { code, message } });

  if (method === 'initialize') {
    return reply({
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'banxue-bank', version: '0.1.0' },
    });
  }
  if (method === 'notifications/initialized' || method === 'initialized') return json(res, 202, {});
  if (method === 'tools/list') return reply({ tools: MCP_TOOLS });
  if (method === 'tools/call') {
    const name = params?.name;
    const fn = MCP_IMPL[name];
    if (!fn) return fail(-32601, `未知工具: ${name}`);
    try {
      const result = await fn(params?.arguments ?? {});
      return reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    } catch (e) {
      return reply({ content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }], isError: true });
    }
  }
  return fail(-32601, `未知方法: ${method}`);
}

/* ---------------- 路由 ---------------- */
const ROUTES = [
  ['GET', /^\/api\/v2\/challenges$/, async (req,res)=>json(res,200,CHALLENGES.lobby(defaultChild().id))],
  ['GET', /^\/api\/v2\/challenges\/settings$/, async (req,res)=>json(res,200,CHALLENGES.settings(defaultChild().id))],
  ['POST', /^\/api\/v2\/challenges\/settings$/, async (req,res)=>json(res,200,CHALLENGES.savePolicy(defaultChild().id,await readJson(req)))],
  ['GET', /^\/api\/v2\/challenges\/wrong$/, async (req,res)=>json(res,200,CHALLENGES.wrongBook(defaultChild().id,new URL(req.url,'http://x').searchParams))],
  ['POST', /^\/api\/v2\/challenges\/rounds$/, async (req,res)=>json(res,200,CHALLENGES.start(defaultChild().id,await readJson(req)))],
  ['GET', /^\/api\/v2\/challenges\/rounds\/([^/]+)$/, async (req,res,m)=>json(res,200,CHALLENGES.getRound(defaultChild().id,m[1]))],
  ['POST', /^\/api\/v2\/challenges\/rounds\/([^/]+)\/next$/, async (req,res,m)=>json(res,200,CHALLENGES.next(defaultChild().id,m[1],await readJson(req)))],
  ['POST', /^\/api\/v2\/challenges\/rounds\/([^/]+)\/answer$/, async (req,res,m)=>json(res,200,CHALLENGES.answer(defaultChild().id,m[1],await readJson(req)))],
  ['POST', /^\/api\/v2\/challenges\/rounds\/([^/]+)\/abandon$/, async (req,res,m)=>json(res,200,CHALLENGES.abandon(defaultChild().id,m[1]))],
  ['POST', /^\/api\/v2\/challenges\/rounds\/([^/]+)\/cashout$/, async (req,res,m)=>json(res,200,CHALLENGES.cashout(defaultChild().id,m[1]))],
  ['POST', /^\/api\/v2\/notes$/, async (req,res)=>json(res,200,V2.sendDailyNote(defaultChild().id,requestContext.getStore(),await readJson(req)))],
  ['DELETE', /^\/api\/v2\/notes\/([^/]+)$/, async (req,res,m)=>json(res,200,V2.deleteDailyNote(defaultChild().id,m[1]))],
  ['GET', /^\/api\/v2\/auth\/session$/, async (req,res)=>json(res,200,{ok:!!requestContext.getStore()?.parent_unlocked})],
  ['POST', /^\/api\/v2\/auth\/logout$/, async (req,res)=>json(res,200,ACCOUNTS.lock(requestContext.getStore()))],
  ['GET', /^\/api\/health$/, async (req, res) => json(res, 200, { ok: true, time: now() })],
  ['GET', /^\/api\/bootstrap$/, async (req, res) => json(res, 200, bootstrap())],
  ['GET', /^\/api\/pet$/, async (req, res) => json(res, 200, PET.petSnapshot(defaultChild().id))],
  ['POST', /^\/api\/pet\/action$/, async (req, res) => {
    const { action } = await readJson(req);
    json(res, 200, PET.applyAction(defaultChild().id, action));
  }],
  // ---------- MVP：今天 / 计划 / 积分 / 材料 / 养成 ----------
  ['GET', /^\/api\/today$/, async (req, res) => {
    const child = defaultChild();
    const date = new URL(req.url, 'http://x').searchParams.get('date') || DAILY.toDateKey();
    json(res, 200, DAILY.getToday(child.id, date));
  }],
  // ---------- v2：学生端 / 家长端 / 周计划 / 审核 ----------
  ['GET', /^\/api\/v2\/student$/, async (req, res) => {
    try {
      const child = defaultChild();
      const date = new URL(req.url, 'http://x').searchParams.get('date') || DAILY.toDateKey();
      json(res, 200, V2.getStudentState(child.id, date));
    } catch (e) { apiError(res, e); }
  }],
  ['GET', /^\/api\/v2\/parent$/, async (req, res) => {
    try {
      const child = defaultChild();
      const url = new URL(req.url, 'http://x');
      json(res, 200, V2.getParentState(child.id, url.searchParams.get('date') || DAILY.toDateKey(), url.searchParams.get('month')));
    } catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/v2\/rules$/, async (req, res) => {
    try { json(res, 200, V2.saveRule(defaultChild().id, await readJson(req))); }
    catch (e) { apiError(res, e); }
  }],
  ['DELETE', /^\/api\/v2\/rules\/([^/]+)$/, async (req, res, m) => {
    try { json(res, 200, V2.deleteRule(defaultChild().id, m[1])); }
    catch (e) { apiError(res, e); }
  }],
  ['GET', /^\/api\/v2\/tasks\/([^/]+)$/, async (req,res,m) => { json(res,200,V2.reviewDetail(defaultChild().id,m[1])); }],
  ['POST', /^\/api\/v2\/tasks\/([^/]+)\/submit$/, async (req, res, m) => {
    try { json(res, 200, V2.submitTask(defaultChild().id, m[1], await readJson(req))); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/v2\/tasks\/([^/]+)\/review$/, async (req, res, m) => {
    try { json(res, 200, V2.reviewTask(defaultChild().id, m[1], await readJson(req))); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/v2\/adopt$/, async (req, res) => {
    try { json(res, 200, V2.adoptWithStarter(defaultChild().id, await readJson(req))); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/v2\/pet\/breed$/, async (req, res) => {
    try {
      const child = defaultChild();
      const body = await readJson(req);
      V2.migratePet(child.id, body.breed, body.expectedPetId);
      json(res, 200, V2.getStudentState(child.id));
    } catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/v2\/reset$/, async (req, res) => {
    try { json(res, 200, V2.resetAll(defaultChild().id, (await readJson(req)).expectedPetId)); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/v2\/pet\/level-up$/, async (req, res) => {
    try { const child = defaultChild(); const event = confirmLevel(child.id, await readJson(req)); json(res, 200, { ...V2.getStudentState(child.id), levelupEvent: event }); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/v2\/pet\/level-up\/([^/]+)\/seen$/, async (req, res, m) => {
    acknowledgeLevel(defaultChild().id, m[1]); json(res, 200, { ok: true });
  }],
  ['POST', /^\/api\/v2\/room$/, async (req, res) => {
    try { json(res, 200, saveRoom(defaultChild().id, await readJson(req))); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/v2\/pet\/scenario$/, async (req, res) => {
    try { json(res, 200, DAILY.runPetScenario(defaultChild().id, (await readJson(req)).scenario)); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/v2\/pet\/shower$/, async (req, res) => {
    try { json(res, 200, DAILY.shower(defaultChild().id)); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/v2\/pet\/rest$/, async (req, res) => {
    try { json(res, 200, V2.restPet(defaultChild().id)); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/v2\/pet\/sleep-touch$/, async (req, res) => {
    try { json(res, 200, V2.touchSleepingPet(defaultChild().id)); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/v2\/travel\/start$/, async (req, res) => {
    try { json(res, 200, V2.startTravel(defaultChild().id, await readJson(req))); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/v2\/travel\/([^/]+)\/return$/, async (req, res, m) => {
    try { json(res, 200, V2.returnTravel(defaultChild().id, m[1])); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/v2\/travel\/([^/]+)\/claim$/, async (req, res, m) => {
    try { json(res, 200, V2.claimTravel(defaultChild().id, m[1])); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/v2\/review\/all$/, async (req, res) => {
    try { json(res, 200, V2.approveAll(defaultChild().id)); }
    catch (e) { apiError(res, e); }
  }],
  ['GET', /^\/api\/v2\/ledger$/, async (req, res) => {
    try {
      const params = new URL(req.url, 'http://localhost').searchParams;
      json(res, 200, POINTS.pointHistory(defaultChild().id, { filter: params.get('filter') || 'all', before: params.get('before') || '', limit: params.has('limit') ? Number(params.get('limit')) : 30 }));
    } catch (e) { apiError(res, e); }
  }],
  ['GET', /^\/api\/v2\/penalties$/, async (req, res) => {
    json(res, 200, POINTS.listPenalties(defaultChild().id));
  }],
  ['POST', /^\/api\/v2\/penalties$/, async (req, res) => {
    try { json(res, 200, POINTS.savePenalty(defaultChild().id, await readJson(req))); }
    catch (e) { apiError(res, e); }
  }],
  ['DELETE', /^\/api\/v2\/penalties\/([^/]+)$/, async (req, res, m) => {
    try { json(res, 200, POINTS.deletePenalty(defaultChild().id, m[1])); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/v2\/penalties\/([^/]+)\/apply$/, async (req, res, m) => {
    try { json(res, 200, POINTS.applyPenalty(defaultChild().id, m[1], await readJson(req))); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/v2\/points\/gift$/, async (req, res) => {
    try { json(res, 200, V2.giftPoints(defaultChild().id, await readJson(req))); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/v2\/rewards$/, async (req, res) => {
    try { json(res, 200, V2.saveReward(defaultChild().id, await readJson(req))); }
    catch (e) { apiError(res, e); }
  }],
  ['DELETE', /^\/api\/v2\/rewards\/([^/]+)$/, async (req, res, m) => {
    try { json(res, 200, V2.deleteReward(defaultChild().id, m[1])); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/v2\/rewards\/([^/]+)\/redeem$/, async (req, res, m) => {
    try { json(res, 200, V2.redeemReward(defaultChild().id, m[1])); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/v2\/redemptions\/([^/]+)\/handle$/, async (req, res, m) => {
    try {
      const b = await readJson(req);
      json(res, 200, V2.handleRedemption(defaultChild().id, m[1], b.status || 'fulfilled'));
    } catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/v2\/settings$/, async (req, res) => {
    try { json(res, 200, V2.setParentSettings(defaultChild().id, await readJson(req))); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/v2\/notify\/test$/, async (req, res) => {
    try { json(res, 200, await V2.notifyTest(defaultChild().id, (await readJson(req)).provider)); }
    catch (e) { apiError(res, e); }
  }],
  ['GET', /^\/api\/v2\/notify\/logs$/, async (req, res) => {
    const params = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, V2.listNotifyLogs(defaultChild().id, { status: params.get('status') || '', before: params.get('before') || '' }));
  }],
  ['GET', /^\/api\/v2\/pet\/backups$/, async (req, res) => {
    json(res, 200, V2.listPetBackups(defaultChild().id, new URL(req.url, 'http://localhost').searchParams.get('before') || ''));
  }],
  ['POST', /^\/api\/v2\/pet\/backups$/, async (req, res) => {
    json(res, 200, V2.backupPet(defaultChild().id, (await readJson(req)).expectedPetId));
  }],
  ['POST', /^\/api\/v2\/pet\/backups\/([^/]+)\/restore$/, async (req, res, match) => {
    json(res, 200, V2.restorePet(defaultChild().id, match[1], (await readJson(req)).expectedPetId));
  }],
  ['POST', /^\/api\/v2\/pet\/restart$/, async (req, res) => {
    json(res, 200, V2.restartPet(defaultChild().id, (await readJson(req)).expectedPetId));
  }],
  ['GET', /^\/api\/breeds$/, async (req, res) => json(res, 200, DAILY.breedList())],
  ['POST', /^\/api\/pet\/adopt$/, async (req, res) => {
    try { json(res, 200, DAILY.adopt(defaultChild().id, await readJson(req))); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/pet\/rename$/, async (req, res) => {
    try { const b = await readJson(req); json(res, 200, DAILY.rename(defaultChild().id, b.name)); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/pet\/reset$/, async (req, res) => {
    try { json(res, 200, V2.resetAll(defaultChild().id, (await readJson(req)).expectedPetId)); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/tasks$/, async (req, res) => {
    try { json(res, 200, DAILY.addTask(defaultChild().id, await readJson(req))); }
    catch (e) { apiError(res, e); }
  }],
  ['PATCH', /^\/api\/tasks\/([^/]+)$/, async (req, res, m) => {
    try {
      const b = await readJson(req);
      json(res, 200, DAILY.toggleTask(defaultChild().id, m[1], b.done !== false));
    } catch (e) { apiError(res, e); }
  }],
  ['DELETE', /^\/api\/tasks\/([^/]+)$/, async (req, res, m) => {
    try { json(res, 200, DAILY.deleteTask(defaultChild().id, m[1])); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/shop\/buy$/, async (req, res) => {
    try { json(res, 200, DAILY.buy(defaultChild().id, await readJson(req))); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/pet\/use$/, async (req, res) => {
    try { json(res, 200, DAILY.useMaterial(defaultChild().id, await readJson(req))); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/pet\/interact$/, async (req, res) => {
    try { json(res, 200, DAILY.interact(defaultChild().id, await readJson(req))); }
    catch (e) { apiError(res, e); }
  }],
  ['POST', /^\/api\/session$/, async (req, res) => {
    const body = await readJson(req);
    json(res, 200, startSession({ childId: defaultChild().id, ...body }));
  }],
  ['POST', /^\/api\/session\/([^/]+)\/answer$/, async (req, res, m) => {
    json(res, 200, answerSession(m[1], await readJson(req)));
  }],
  ['POST', /^\/api\/session\/([^/]+)\/finish$/, async (req, res, m) => {
    json(res, 200, finishSession(m[1]));
  }],

  ['GET', /^\/api\/books$/, async (req, res) => json(res, 200, CONTENT.listBooks())],
  ['GET', /^\/api\/books\/([^/]+)$/, async (req, res, m) => {
    const d = CONTENT.bookDetail(m[1]);
    if (!d) return err(res, 404, '教材不存在');
    json(res, 200, d);
  }],
  ['POST', /^\/api\/books\/([^/]+)\/generate$/, async (req, res, m) => {
    const body = await readJson(req).catch(() => ({}));
    json(res, 200, CONTENT.generateBasicQuestions(m[1], body.pageFrom, body.pageTo));
  }],
  ['POST', /^\/api\/import\/pdf$/, async (req, res) => {
    const name = new URL(req.url, 'http://x').searchParams.get('name') ?? 'book.pdf';
    const buf = await readBody(req);
    CONTENT.savePdf(name, buf);
    const pages = await CONTENT.extractPdfPages(buf);
    json(res, 200, { name, pages: pages.map(p => ({ ...p, sentences: CONTENT.splitSentences(p.text) })) });
  }],
  ['POST', /^\/api\/import\/audio$/, async (req, res) => {
    const name = new URL(req.url, 'http://x').searchParams.get('name') ?? 'audio.mp3';
    const path = CONTENT.saveAudio(name, await readBody(req));
    json(res, 200, { path });
  }],
  ['POST', /^\/api\/import\/commit$/, async (req, res) => {
    const body = await readJson(req);
    const saved = CONTENT.saveBook(body);
    let gen = null;
    if (body.autoGenerate) gen = CONTENT.generateBasicQuestions(saved.book.id);
    json(res, 200, { ...saved, generated: gen });
  }],

  // ---------- 音频教材 ----------
  ['POST', /^\/api\/audio\/analyze$/, async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const name = url.searchParams.get('name') ?? 'audio.mp3';
    const bookId = url.searchParams.get('bookId');
    const pageFrom = Number(url.searchParams.get('pageFrom') ?? 1);
    const pageTo = Number(url.searchParams.get('pageTo') ?? 9999);

    let expected = 0;
    if (bookId) {
      expected = q.get(
        `SELECT COUNT(*) n FROM sentence se JOIN page p ON p.id = se.page_id
          WHERE se.book_id = ? AND p.index_no BETWEEN ? AND ?`,
        bookId, pageFrom, pageTo)?.n ?? 0;
    }

    const buf = await readBody(req);
    const saved = await AUDIO.saveUpload(name, buf);
    const info = await AUDIO.analyze(saved.abs, expected);
    json(res, 200, { ...info, sourcePath: saved.abs, url: saved.url, expected });
  }],

  ['POST', /^\/api\/audio\/bind$/, async (req, res) => {
    const body = await readJson(req);
    if (!body.sourcePath || !Array.isArray(body.segments) || !body.segments.length) {
      return err(res, 400, '缺少 sourcePath 或 segments');
    }
    const r = await AUDIO.bindToSentences(body);
    let gen = null;
    if (body.autoGenerate) gen = CONTENT.generateListeningQuestions(body.bookId, body.pageFrom, body.pageTo);
    json(res, 200, { ...r, generated: gen });
  }],

  ['GET', /^\/api\/audio\/status$/, async (req, res) => {
    const bookId = new URL(req.url, 'http://x').searchParams.get('bookId');
    if (!bookId) return err(res, 400, '缺少 bookId');
    json(res, 200, { ...AUDIO.audioCoverage(bookId), ffmpeg: await AUDIO.ffmpegAvailable() });
  }],

  ['GET', /^\/api\/plan$/, async (req, res) => {
    const child = defaultChild();
    const plans = q.all('SELECT * FROM plan WHERE child_id=? ORDER BY week_start DESC LIMIT 5', child.id);
    const days = plans.length
      ? q.all(`SELECT * FROM plan_day WHERE plan_id=? ORDER BY date`, plans[0].id)
      : [];
    json(res, 200, { plans, days, current: plans[0] ?? null });
  }],
  ['POST', /^\/api\/plan$/, async (req, res) => {
    const child = defaultChild();
    const body = await readJson(req);
    const weekStart = body.weekStart ?? SRS.toDateKey();
    let plan = q.get('SELECT * FROM plan WHERE child_id=? AND week_start=?', child.id, weekStart);
    if (!plan) {
      const id = uid();
      q.run('INSERT INTO plan(id, child_id, week_start, status, created_at) VALUES(?,?,?,?,?)',
        id, child.id, weekStart, 'active', now());
      plan = q.get('SELECT * FROM plan WHERE id=?', id);
    }
    if (Array.isArray(body.days)) {
      for (const d of body.days) {
        q.run(`INSERT INTO plan_day(id, plan_id, date, book_id, page_from, page_to, target_minutes, status)
               VALUES(?,?,?,?,?,?,?,'open')
               ON CONFLICT(plan_id, date) DO UPDATE SET
                 book_id=excluded.book_id, page_from=excluded.page_from,
                 page_to=excluded.page_to, target_minutes=excluded.target_minutes`,
          uid(), plan.id, d.date, d.bookId ?? null, d.pageFrom ?? null, d.pageTo ?? null, d.targetMinutes ?? 15);
      }
    }
    json(res, 200, { plan });
  }],

  ['GET', /^\/api\/parent\/overview$/, async (req, res) => {
    const child = defaultChild();
    json(res, 200, {
      child,
      mastery: SRS.masterySummary(child.id),
      forecast: SRS.forecast(child.id, 7),
      books: CONTENT.listBooks(),
      questionCount: q.get('SELECT COUNT(*) AS n FROM question')?.n ?? 0,
      sessionCount: q.get('SELECT COUNT(*) AS n FROM session WHERE status=?', 'finished')?.n ?? 0,
      pet: PET.petSnapshot(child.id),
    });
  }],
  ['GET', /^\/api\/parent\/questions$/, async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const bookId = url.searchParams.get('bookId');
    const rows = bookId
      ? q.all('SELECT * FROM question WHERE book_id=? ORDER BY created_at DESC LIMIT 200', bookId)
      : q.all('SELECT * FROM question ORDER BY created_at DESC LIMIT 200');
    json(res, 200, rows.map(r => ({ ...r, payload: JSON.parse(r.payload), answer: JSON.parse(r.answer) })));
  }],
];

function allowedOrigin(req,path) {
  const safe=['GET','HEAD'].includes(req.method);
  // External review links and capability-scoped notification images remain readable.
  if(safe && (!path.startsWith('/api/') || path.startsWith('/api/notify-images/')))return true;
  const origin=req.headers.origin;
  if(!safe && req.headers['sec-fetch-site']==='cross-site')return false;
  if (!origin) {
   if (PUBLIC_ORIGIN && !['GET','HEAD','OPTIONS'].includes(req.method)) {
    try { return new URL(req.headers.referer).origin === PUBLIC_ORIGIN; } catch { return false; }
   }
   return true;
  }
  if (PUBLIC_ORIGIN) {
   if (origin === PUBLIC_ORIGIN) return true;
   // Some NAS tunnels rewrite Origin to their upstream address. A browser's
   // same-origin fetch metadata plus the exact public Referer still proves the
   // page's origin; neither header can be supplied by cross-site page script.
   if (origin !== 'null' && req.headers['sec-fetch-site'] === 'same-origin') {
    try { return new URL(req.headers.referer).origin === PUBLIC_ORIGIN; } catch { return false; }
   }
   return false;
  }
  try {
    const from=new URL(origin), host=new URL(`http://${req.headers.host}`);
    return (from.protocol==='http:' && from.host===host.host) || (from.protocol==='http:' && ['127.0.0.1','localhost'].includes(host.hostname) && ['127.0.0.1','localhost'].includes(from.hostname) && ['5199','7717','7788','17718','17719'].includes(from.port));
  } catch { return false; }
}
async function accountRoute(req,res,path) {
  const c=ACCOUNTS.context(req);
  ACCOUNTS.throttle(`account-api:${c.account_id}`,600);
  const body=req.method==='GET'?{}:await readJson(req);
  const secure=!!req.socket.encrypted || process.env.BANXUE_PUBLIC_ORIGIN?.startsWith('https://');
  if(path==='/api/auth/logout' && req.method==='POST')return ACCOUNTS.logout(req,res);
  if(path==='/api/auth/context' && req.method==='POST')return ACCOUNTS.selectContext(c,body);
  if(path==='/api/auth/lock' && req.method==='POST')return ACCOUNTS.lock(c);
  if(path==='/api/auth/unlock' && req.method==='POST') { const key=`unlock:${c.account_id}`;ACCOUNTS.throttle(key);const r=await ACCOUNTS.unlock(c,body);ACCOUNTS.clearAttempts(key);return r; }
  if(path==='/api/auth/password' && req.method==='POST') {ACCOUNTS.throttle(`password:${c.account_id}`);return ACCOUNTS.changePassword(c,body);}
  if(path==='/api/family' && req.method==='GET')return ACCOUNTS.snapshot(c);
  if(path==='/api/family/renew' && req.method==='POST') {ACCOUNTS.throttle(`renew:${c.account_id}`,15);return ACCOUNTS.renew(c,body);}
  if(path==='/api/family/children' && req.method==='POST')return ACCOUNTS.addChild(c,body);
  let m=/^\/api\/family\/children\/([^/]+)(\/account)?$/.exec(path);
  if(m && req.method==='POST')return m[2]?await ACCOUNTS.studentAccount(c,m[1],body):ACCOUNTS.renameChild(c,m[1],body);
  if(path==='/api/family/invites' && req.method==='POST') {ACCOUNTS.throttle(`invite:${c.account_id}`,20);return ACCOUNTS.createInvite(c);}
  m=/^\/api\/family\/invites\/([^/]+)$/.exec(path);
  if(m && req.method==='DELETE')return ACCOUNTS.revokeInvite(c,m[1]);
  m=/^\/api\/family\/parents\/([^/]+)$/.exec(path);
  if(m && req.method==='DELETE')return ACCOUNTS.removeParent(c,m[1]);
  if(path==='/api/family/join' && req.method==='POST') {ACCOUNTS.throttle(`join:${c.account_id}`,15);return ACCOUNTS.join(body,res,secure,c);}
  const e=new Error('未找到账号接口');e.status=404;throw e;
}
async function adminRoute(req,res,path,url) {
 const secure=!!req.socket.encrypted || !!PUBLIC_ORIGIN;
 if(path==='/api/admin/session' && req.method==='GET')return ADMIN.adminSnapshot(ADMIN.readAdmin(req));
 if(path==='/api/admin/login' && req.method==='POST') {
  ACCOUNTS.throttle(`admin-ip:${req.socket.remoteAddress}`,40);
  const body=await readJson(req),key=`admin-login:${String(body.login||'').trim().toLowerCase().slice(0,80)}`;
  ACCOUNTS.throttle(key,8);const result=await ADMIN.login(body,res,secure);ACCOUNTS.clearAttempts(key);return result;
 }
 const a=ADMIN.requireAdmin(req);
 ACCOUNTS.throttle(`admin-requests:${a.id}`,600);
 if(path==='/api/admin/challenges/questions' && req.method==='GET')return CHALLENGES.adminQuestions(url.searchParams);
 const challengeQuestion=/^\/api\/admin\/challenges\/questions\/([^/]+)$/.exec(path);
 if(challengeQuestion && req.method==='POST') {const result=CHALLENGES.setQuestion(challengeQuestion[1],await readJson(req));ADMIN.audit(a.id,'challenge.question.set',challengeQuestion[1]);return result;}
 if(path==='/api/admin/logout' && req.method==='POST')return ADMIN.logout(req,res);
 if(path==='/api/admin/invites' && req.method==='GET')return SUBSCRIPTIONS.listActivationInvites(url.searchParams.get('before')||'');
 if(path==='/api/admin/invites' && req.method==='POST') {
  const result=SUBSCRIPTIONS.createActivationInvite(a.id,await readJson(req));ADMIN.audit(a.id,'invite.create',result.id);return result;
 }
 let m=/^\/api\/admin\/invites\/([^/]+)$/.exec(path);
 if(m && req.method==='DELETE') {const r=SUBSCRIPTIONS.revokeActivationInvite(m[1]);ADMIN.audit(a.id,'invite.revoke',m[1]);return r;}
 if(path==='/api/admin/families' && req.method==='GET')return SUBSCRIPTIONS.listFamilies(url.searchParams.get('before')||'',url.searchParams.get('q')||'');
 m=/^\/api\/admin\/families\/([^/]+)\/subscription$/.exec(path);
 if(m && req.method==='POST') {const r=SUBSCRIPTIONS.setFamilySubscription(a.id,m[1],await readJson(req));ADMIN.audit(a.id,'subscription.set',m[1]);return r;}
 if(m && req.method==='GET') {SUBSCRIPTIONS.entitlement(m[1]);return q.all('SELECT action,detail,created_at AS createdAt FROM subscription_event WHERE family_id=? ORDER BY rowid DESC LIMIT 50',m[1]);}
 const e=new Error('未找到管理员接口');e.status=404;throw e;
}
const server = createServer(async (req,res)=>{
 try {
  res.setHeader('x-content-type-options','nosniff');
  res.setHeader('x-frame-options','DENY');
  // Preserve the public page origin on same-origin requests through NAS tunnels.
  res.setHeader('referrer-policy','same-origin');
  res.setHeader('permissions-policy','geolocation=(), microphone=(), camera=(self)');
  if(PUBLIC_ORIGIN)res.setHeader('strict-transport-security','max-age=31536000');
  if(STATIC_MODE)res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if((req.url||'').length>4096)return err(res,414,'请求地址过长');
  const url=new URL(req.url,`http://${req.headers.host}`),path=decodeURIComponent(url.pathname);
  if(!allowedOrigin(req,path))return err(res,403,PUBLIC_ORIGIN ? `请求来源不受信任，请通过 ${PUBLIC_ORIGIN} 打开小岛后重试` : '请求来源不受信任');
  if(req.method==='OPTIONS') {res.writeHead(204,{'access-control-allow-methods':'GET, POST, PATCH, DELETE, OPTIONS','access-control-allow-headers':'content-type, x-family-id, x-child-id'});return res.end();}
  const unsafe=!['GET','HEAD'].includes(req.method);
  if(unsafe && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || ''))return err(res,415,'请使用 JSON 请求');
  if(path.startsWith('/api/'))res.setHeader('cache-control','no-store');
  if(path.startsWith('/api/admin/'))return json(res,200,await adminRoute(req,res,path,url));
  if(path.startsWith('/api/notify-images/')) {
   if(!['GET','HEAD'].includes(req.method))return err(res,405,'仅支持读取图片');
   const photo=notificationPhoto(path.slice('/api/notify-images/'.length));
   res.setHeader('referrer-policy','no-referrer');res.setHeader('x-content-type-options','nosniff');
   if(!photo)return err(res,404,'图片链接已失效，请登录家长端查看');
   res.writeHead(200,{'content-type':photo.type,'content-length':photo.bytes.length,'cache-control':'private, no-store'});
   return res.end(req.method==='HEAD'?undefined:photo.bytes);
  }
  if(path==='/api/auth/session' && req.method==='GET')return json(res,200,ACCOUNTS.snapshot(ACCOUNTS.readSession(req)));
  if(['/api/auth/login','/api/auth/register','/api/auth/join'].includes(path) && req.method==='POST') {
   ACCOUNTS.throttle(`auth-ip:${req.socket.remoteAddress}`,120);
   const body=await readJson(req),key=`${path}:${req.socket.remoteAddress}:${String(body.login||'').trim().toLowerCase().slice(0,80)}`;
   const identityKey=`auth-identity:${path}:${String(body.login||'').trim().toLowerCase().slice(0,80)}`;
   ACCOUNTS.throttle(key);ACCOUNTS.throttle(identityKey,20);
   const secure=!!req.socket.encrypted || process.env.BANXUE_PUBLIC_ORIGIN?.startsWith('https://');
   const result=path.endsWith('/login')?await ACCOUNTS.login(body,res,secure):path.endsWith('/register')?await ACCOUNTS.register(body,res,secure):await ACCOUNTS.join(body,res,secure);
   ACCOUNTS.clearAttempts(key);ACCOUNTS.clearAttempts(identityKey);return json(res,200,result);
  }
  if(path.startsWith('/api/auth/') || path.startsWith('/api/family'))return json(res,200,await accountRoute(req,res,path));
  // Retire unscoped prototype APIs. They are not used by the current product.
  if(path==='/mcp' || path.startsWith('/media/'))return err(res,410,'该旧接口已停用');
  if(path.startsWith('/api/')) {
   if(path==='/api/health')return json(res,200,{ok:true,time:now()});
   if(!/^\/api\/(?:v2(?:\/|$)|today$|breeds$|tasks(?:\/|$)|shop\/buy$|pet\/(?:adopt|rename|reset|use|interact)$)/.test(path))return err(res,410,'该旧接口已停用');
   const c=ACCOUNTS.context(req);
   ACCOUNTS.throttle(`api:${c.account_id}`,1800);
   const parentOnly=(req.method==='GET'&&/^\/api\/v2\/tasks\/[^/]+$/.test(path)) || path==='/api/v2/parent' || /^\/api\/v2\/(?:rules|settings|points|review|redemptions|notify|notes|pet\/backups|pet\/restart)(?:\/|$)/.test(path) || (path.startsWith('/api/v2/rewards')&&!path.endsWith('/redeem')) || /^\/api\/v2\/tasks\/[^/]+\/review$/.test(path) || ['/api/v2/reset','/api/pet/reset'].includes(path) || path.startsWith('/api/tasks');
   if(parentOnly || path==='/api/v2/challenges/settings' || /^\/api\/v2\/penalties(?:\/|$)/.test(path))ACCOUNTS.requireParent(c);
   if(unsafe && path!=='/api/v2/auth/logout')SUBSCRIPTIONS.requireActive(c.family_id);
   if(path==='/api/v2/notify/test' && unsafe)ACCOUNTS.throttle(`notify-test:${c.account_id}`,10);
   if(unsafe)res.once('finish',()=>{if(res.statusCode<400){try{ACCOUNTS.audit(c,`${req.method} ${path}`);}catch(e){console.error('Account audit failed:',e.message);}}});
   return await requestContext.run(c,async()=>{
    const petActionPath=/^(?:\/api\/shop\/buy|\/api\/pet\/(?:adopt|rename|reset|use|interact)|\/api\/v2\/(?:adopt|reset|room|pet\/(?:breed|rest|shower|scenario|sleep-touch|level-up(?:\/[^/]+\/seen)?|backups(?:\/[^/]+\/restore)?|restart)))$/;
    if(unsafe && c.child && petActionPath.test(path) && TRAVEL.isTravelling(c.child.id)) return err(res,409,'小伙伴还在旅行，回家后才能照顾它。');
    for(const [method,re,fn] of ROUTES){if(req.method!==method)continue;const m=re.exec(path);if(m)return await fn(req,res,m);}
    return err(res,404,'未找到接口');
   });
  }
  if(STATIC_MODE && ['GET','HEAD'].includes(req.method)) {
   if(path.split('/').some(p=>p.startsWith('.')) || path.endsWith('.map'))return err(res,404,'未找到文件');
   const dist=join(ROOT,'web','dist');let file=join(dist,path==='/'?'index.html':path);
   if(!file.startsWith(dist+'/'))return err(res,404,'未找到页面');
   try{await stat(file);}catch{if(extname(path))return err(res,404,'未找到文件');file=join(dist,'index.html');}
   return serveFile(req,res,file);
  }
  err(res,404,'未找到页面');
 }catch(e){apiError(res,e);}
});
server.requestTimeout=30000;
server.headersTimeout=10000;
server.keepAliveTimeout=5000;
server.maxHeadersCount=64;
server.maxRequestsPerSocket=100;

server.listen(PORT, HOST, () => {
  startNotificationScheduler();
  console.log(`API 就绪  http://${HOST}:${PORT}`);

});

// Current pet stats decay on each scoped read; no global first-child timer.
