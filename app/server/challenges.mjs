import { db, q, uid, now, tx } from './db.mjs';
import { library, catalog, byId, topics, shuffle, initialPoems, eligible, snapshot } from './challenge-content.mjs';
import { entitlement } from './subscriptions.mjs';

db.exec(`
CREATE TABLE IF NOT EXISTS challenge_policy(child_id TEXT PRIMARY KEY REFERENCES child(id) ON DELETE CASCADE, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS challenge_disabled(question_id TEXT PRIMARY KEY, disabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS challenge_round(
 id TEXT PRIMARY KEY, child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
 date TEXT NOT NULL, request_id TEXT NOT NULL, subject TEXT NOT NULL, difficulty INTEGER NOT NULL, mode TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active', questions TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0,
 activated_at INTEGER, deadline INTEGER, created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL,
 ended_ms INTEGER, correct INTEGER NOT NULL DEFAULT 0, reward INTEGER NOT NULL DEFAULT 0, reward_cap INTEGER NOT NULL,
 UNIQUE(child_id,request_id));
CREATE UNIQUE INDEX IF NOT EXISTS challenge_one_active ON challenge_round(child_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS challenge_round_day ON challenge_round(child_id,date);
CREATE TABLE IF NOT EXISTS challenge_answer(
 round_id TEXT NOT NULL REFERENCES challenge_round(id) ON DELETE CASCADE, index_no INTEGER NOT NULL,
 response TEXT, correct INTEGER NOT NULL, timed_out INTEGER NOT NULL, elapsed_ms INTEGER NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(round_id,index_no));
CREATE TABLE IF NOT EXISTS challenge_wrong(
 child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE, question_id TEXT NOT NULL,
 snapshot TEXT NOT NULL, subject TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
 wrong_count INTEGER NOT NULL DEFAULT 0, correct_count INTEGER NOT NULL DEFAULT 0, relapse_count INTEGER NOT NULL DEFAULT 0,
 first_wrong_at TEXT NOT NULL, last_wrong_at TEXT NOT NULL, mastered_at TEXT,
 PRIMARY KEY(child_id,question_id));
CREATE INDEX IF NOT EXISTS challenge_wrong_sort ON challenge_wrong(child_id,wrong_count DESC,last_wrong_at DESC);
`);
// Preserve existing rounds; version 3 snapshots configurable question counts and capped doubling.
if (!q.all('PRAGMA table_info(challenge_round)').some(c => c.name === 'rules_version')) db.exec('ALTER TABLE challenge_round ADD COLUMN rules_version INTEGER NOT NULL DEFAULT 1');
const fail = (message, status = 400) => { const e = Error(message); e.status = status; throw e; };
const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const dateKey = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0,10);
const dayEnd = () => Date.parse(dateKey() + 'T23:59:59.999+08:00');
export const rewards = { 1: [10,13,16], 2: [20,26,32], 3: [40,52,64] };
const legacyRewards = { 1: [3,4,5], 2: [6,8,10], 3: [9,12,15] };
const doubleScore = (correct, version = 3) => correct > 0 ? 2 ** (version >= 3 ? Math.min(correct - 1, 9) : correct - 1) : 0;
const standardReward = (correct, total, difficulty) => correct === total ? rewards[difficulty][2] : correct * 10 >= total * 9 ? rewards[difficulty][1] : correct * 5 >= total * 4 ? rewards[difficulty][0] : 0;
export function policy(childId) {
  const child = q.get('SELECT grade FROM child WHERE id=?', childId);
  if (!child) fail('没有找到孩子',404);
  const grade = int(child.grade,1,6) ? child.grade : 2;
  const saved = q.get('SELECT payload FROM challenge_policy WHERE child_id=?',childId);
  const p = saved ? JSON.parse(saved.payload) : { grade, term: 'upper', textbook: '人教版', mathScope: grade === 1 ? '1upper' : '2upper', topics: grade === 1 ? ['add'] : topics.map(t => t.id), poemIds: initialPoems(grade,'upper'), nextGrade: false, doubleEnabled: true };
  return {...p,
    dailyRounds: int(p.dailyRounds,0,20) ? p.dailyRounds : 3,
    questionsPerRound: int(p.questionsPerRound,5,20) ? p.questionsPerRound : 10,
    roundMinutes: int(p.roundMinutes,1,60) ? p.roundMinutes : 10,
    dailyPoints: null
  };
}
export function savePolicy(childId, body) {
  const keys = ['grade','term','mathScope','topics','poemIds','nextGrade','doubleEnabled','dailyRounds','questionsPerRound','roundMinutes'];
  const next = { ...policy(childId) };
  for (const key of keys) if (body[key] !== undefined) next[key] = body[key];
  if (!int(next.grade,1,6) || !['upper','lower'].includes(next.term) || !['1upper','1lower','2upper'].includes(next.mathScope)) fail('请选择一年级至六年级及有效的练习范围');
  if (!int(next.dailyRounds,0,20)) fail('每天免费挑战次数需为 0–20 的整数');
  if (!int(next.questionsPerRound,5,20)) fail('每轮题量需为 5–20 的整数');
  if (!int(next.roundMinutes,1,60)) fail('每轮时长需为 1–60 分钟的整数');
  if (![next.nextGrade,next.doubleEnabled].every(x => typeof x === 'boolean')) fail('开关设置无效');
  if (!Array.isArray(next.topics) || !next.topics.length || next.topics.some(t => !topics.some(x => x.id === t))) fail('至少选择一个有效的数学知识点');
  if (next.mathScope.startsWith('1') && next.topics.some(t => t !== 'add')) fail('一年级计算范围只支持加减法');
  if (!Array.isArray(next.poemIds) || !next.poemIds.length || next.poemIds.length > 155 || next.poemIds.some(id => !library.poems.some(p => p.id === id))) fail('至少选择一首有效的已学古诗词');
  next.poemIds = [...new Set(next.poemIds)]; next.topics = [...new Set(next.topics)];
  return tx(() => {
    // Running rounds retain their question/reward snapshots; new policy applies next round.
    q.run('INSERT INTO challenge_policy VALUES(?,?) ON CONFLICT(child_id) DO UPDATE SET payload=excluded.payload',childId,JSON.stringify(next));
    q.run('UPDATE child SET grade=? WHERE id=?',next.grade,childId);
    return settings(childId);
  });
}
export function settings(childId) {
  return { policy: policy(childId), topics, poems: library.poems.map(({id,title,grade,group,source})=>({id,title,grade,group,source})), sourceName: library.sourceName };
}
function row(childId, id) {
  const round = q.get('SELECT * FROM challenge_round WHERE id=? AND child_id=?',id,childId);
  if (!round) fail('没有找到这次挑战',404);
  return round;
}
function balance(childId) { return Number(q.get('SELECT COALESCE(SUM(delta),0) n FROM point_ledger WHERE child_id=?',childId).n); }
function usage(childId, p) {
  const rounds = q.all('SELECT * FROM challenge_round WHERE child_id=? AND date=?',childId,dateKey());
  const millis = rounds.reduce((sum,r) => sum + Math.max(0,Math.min(r.ended_ms || Date.now(),r.expires_ms) - r.created_ms),0);
  const earned = rounds.reduce((sum,r) => sum + r.reward,0);
  return { rounds: rounds.length, remainingRounds: Math.max(0,p.dailyRounds-rounds.length), seconds: Math.ceil(millis/1000), earned };
}
function finish(r, status) {
  if (r.status !== 'active') return;
  const completed = status === 'completed';
  let reward;
  const total = JSON.parse(r.questions).length;
  if (r.rules_version >= 3) reward = r.mode === 'double'
    ? ((completed && r.correct === total) || (status === 'cashed_out' && r.correct >= 3) ? doubleScore(r.correct) : 0)
    : (completed ? standardReward(r.correct,total,r.difficulty) : 0);
  else if (r.rules_version >= 2) reward = r.mode === 'double'
    ? ((completed && r.correct === 10) || (status === 'cashed_out' && r.correct >= 3) ? doubleScore(r.correct) : 0)
    : (completed && r.correct >= 8 ? rewards[r.difficulty][r.correct-8] : 0);
  else reward = completed ? r.mode === 'double' ? (r.correct === 10 ? r.difficulty*10 : 0) : (r.correct >= 8 ? legacyRewards[r.difficulty][r.correct-8] : 0) : 0;
  reward = Math.min(reward,r.reward_cap);
  q.run('UPDATE challenge_round SET status=?,reward=?,ended_ms=? WHERE id=? AND status=\'active\'',status,reward,Math.min(Date.now(),r.expires_ms),r.id);
  if (reward > 0) q.run('INSERT OR IGNORE INTO point_ledger(id,child_id,date,delta,reason,dedupe_key,created_at) VALUES(?,?,?,?,?,?,?)',uid(),r.child_id,r.date,reward,`${r.subject === 'poetry' ? '古诗词' : '计算'}挑战 · ${['','普通','挑战','困难'][r.difficulty]}${r.mode === 'double' ? '翻倍' : ''}`,`challenge:${r.id}`,now());
}
function recordAnswer(r, response, timedOut, settle = true) {
  const questions = JSON.parse(r.questions), question = questions[r.cursor];
  const correct = !timedOut && response === question.answer;
  q.run('INSERT INTO challenge_answer VALUES(?,?,?,?,?,?,?)',r.id,r.cursor,response,correct?1:0,timedOut?1:0,Math.max(0,Math.min(Date.now()-r.activated_at,question.seconds*1000)),now());
  const old = q.get('SELECT * FROM challenge_wrong WHERE child_id=? AND question_id=?',r.child_id,question.id);
  if (!correct) {
    q.run(`INSERT INTO challenge_wrong(child_id,question_id,snapshot,subject,state,wrong_count,relapse_count,first_wrong_at,last_wrong_at)
     VALUES(?,?,?,?, 'pending',1,0,?,?) ON CONFLICT(child_id,question_id) DO UPDATE SET state='pending',wrong_count=wrong_count+1,
     relapse_count=relapse_count+CASE WHEN state='mastered' THEN 1 ELSE 0 END,last_wrong_at=excluded.last_wrong_at,snapshot=excluded.snapshot`,r.child_id,question.id,JSON.stringify(question),r.subject,now(),now());
  } else if (old) q.run("UPDATE challenge_wrong SET state='mastered',correct_count=correct_count+1,mastered_at=? WHERE child_id=? AND question_id=?",now(),r.child_id,question.id);
  q.run('UPDATE challenge_round SET correct=correct+? WHERE id=?',correct?1:0,r.id);
  if (!settle) return;
  const updated = row(r.child_id,r.id);
  if (r.mode === 'double' && !correct) finish(updated,'failed');
  else if (r.cursor === questions.length - 1) finish(updated,'completed');
}
function expire(r) {
  if (r.status !== 'active' || Date.now() < r.expires_ms) return;
  const family=q.get('SELECT family_id FROM child WHERE id=?',r.child_id)?.family_id;
  // Read-only family access must not settle an expired round or change its wrong book.
  if(family && entitlement(family).readOnly)return;
  if (r.activated_at && !q.get('SELECT 1 FROM challenge_answer WHERE round_id=? AND index_no=?',r.id,r.cursor)) recordAnswer(r,null,true,false);
  finish(row(r.child_id,r.id),'expired');
}
function publicRound(r) {
  const questions = JSON.parse(r.questions), question = questions[r.cursor];
  const answered = q.get('SELECT * FROM challenge_answer WHERE round_id=? AND index_no=?',r.id,r.cursor);
  const { answer, explanation, distractors, notes, translation, ...safe } = question;
  return { id:r.id, subject:r.subject, difficulty:r.difficulty, mode:r.mode, status:r.status, index:r.cursor, total:questions.length, correct:r.correct, reward:r.reward, rewardCap:r.reward_cap,
    rulesVersion:r.rules_version, pending:r.mode === 'double' && r.status === 'active' ? r.rules_version >= 2 ? doubleScore(r.correct,r.rules_version) : r.correct*r.difficulty : 0,
    nextReward:r.mode === 'double' && r.rules_version >= 2 && r.status === 'active' && r.correct < questions.length ? doubleScore(r.correct+1,r.rules_version) : null,
    canCashOut:r.rules_version >= 2 && r.mode === 'double' && r.status === 'active' && r.correct >= 3 && !!answered?.correct,
    serverNow:Date.now(), expiresAt:r.expires_ms,
    deadline:r.deadline, question:r.activated_at ? safe : null, feedback:answered ? { correct:!!answered.correct, timedOut:!!answered.timed_out, response:answered.response, answer, explanation, wrong:wrongSummary(r.child_id,question.id) } : null,
    balance:balance(r.child_id) };
}
function wrongSummary(childId,questionId) {
  const w=q.get('SELECT state,wrong_count,relapse_count FROM challenge_wrong WHERE child_id=? AND question_id=?',childId,questionId);
  return w ? { state:w.state,wrongCount:w.wrong_count,relapseCount:w.relapse_count } : null;
}
export function lobby(childId) {
  return tx(() => {
    let active=q.get("SELECT * FROM challenge_round WHERE child_id=? AND status='active'",childId);
    if (active) { expire(active); active=row(childId,active.id); }
    const p=policy(childId), disabled=new Set(q.all('SELECT question_id FROM challenge_disabled WHERE disabled=1').map(d=>d.question_id));
    const available=Object.fromEntries(['poetry','math'].map(subject=>[subject,[1,2,3].map(d=>catalog.filter(x=>x.subject===subject&&!disabled.has(x.id)&&eligible(x,p,d)).length)]));
    const wrong=q.get("SELECT COUNT(*) total,SUM(CASE WHEN state='pending' THEN 1 ELSE 0 END) pending,SUM(CASE WHEN relapse_count>0 THEN 1 ELSE 0 END) relapse FROM challenge_wrong WHERE child_id=?",childId);
    return { policy:p, usage:usage(childId,p), rewards, available, active:active?.status==='active'?publicRound(active):null, wrong:{ total:wrong.total,pending:wrong.pending||0,relapse:wrong.relapse||0 }, recent:q.all('SELECT id,subject,difficulty,mode,status,correct,reward,questions FROM challenge_round WHERE child_id=? ORDER BY created_ms DESC LIMIT 6',childId).map(({questions,...r})=>({...r,total:JSON.parse(questions).length})), serverNow:Date.now() };
  });
}
export function start(childId,body) {
  if (!['poetry','math'].includes(body.subject)||!int(body.difficulty,1,3)||!['standard','double'].includes(body.mode)||typeof body.requestId!=='string'||!/^[-\w]{8,80}$/.test(body.requestId)) fail('挑战参数不完整');
  return tx(() => {
    const prior=q.get('SELECT * FROM challenge_round WHERE child_id=? AND request_id=?',childId,body.requestId);
    if (prior) { expire(prior); return publicRound(row(childId,prior.id)); }
    const active=q.get("SELECT * FROM challenge_round WHERE child_id=? AND status='active'",childId);
    if(active) { expire(active); if(row(childId,active.id).status==='active') fail('还有一次挑战未结束，请先继续或结束它',409); }
    const p=policy(childId), u=usage(childId,p), max=body.mode==='double'?512:rewards[body.difficulty][2];
    if(!u.remainingRounds) fail('今天的挑战次数已用完，明天再来吧',409);
    if(body.mode==='double'&&!p.doubleEnabled) fail('翻倍模式暂不可用，需要家长开启',409);
    const disabled=new Set(q.all('SELECT question_id FROM challenge_disabled WHERE disabled=1').map(x=>x.question_id));
    const pool=catalog.filter(x=>x.subject===body.subject&&!disabled.has(x.id)&&eligible(x,p,body.difficulty));
    const count=p.questionsPerRound;
    if(pool.length<count) fail(`当前范围题目不足 ${count} 道，请家长调整已学内容`,409);
    const errors=q.all('SELECT * FROM challenge_wrong WHERE child_id=? AND subject=? ORDER BY wrong_count DESC,last_wrong_at DESC',childId,body.subject).filter(w=>byId.has(w.question_id)&&pool.some(x=>x.id===w.question_id));
    const reviews=[...shuffle(errors.filter(w=>w.state==='pending').slice(0,30)).slice(0,2),...shuffle(errors.filter(w=>w.state==='mastered')).slice(0,1)];
    const used=new Set(reviews.map(x=>x.question_id));
    // Reinsert the exact saved calculation/poem question; preserve options but refresh timer.
    const preferred=shuffle(pool.filter(x=>!used.has(x.id)&&(body.subject==='math'?x.level===body.difficulty:body.difficulty>1&&(x.group==='extension'||x.level===2)))).slice(0,Math.min(Math.ceil(count*.7),count-reviews.length));
    preferred.forEach(x=>used.add(x.id));
    const fresh=[...preferred,...shuffle(pool.filter(x=>!used.has(x.id))).slice(0,count-reviews.length-preferred.length)];
    const selected=shuffle([...reviews.map(w=>({...JSON.parse(w.snapshot),seconds:snapshot(byId.get(w.question_id),body.difficulty).seconds,review:true})),...fresh.map(x=>snapshot(x,body.difficulty))]);
    const id=uid(), timestamp=Date.now();
    q.run('INSERT INTO challenge_round(id,child_id,date,request_id,subject,difficulty,mode,questions,created_ms,expires_ms,reward_cap,rules_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,3)',id,childId,dateKey(),body.requestId,body.subject,body.difficulty,body.mode,JSON.stringify(selected),timestamp,Math.min(timestamp+p.roundMinutes*60000,dayEnd()),max);
    return publicRound(row(childId,id));
  });
}
export function getRound(childId,id) { return tx(()=>{const r=row(childId,id);expire(r);return publicRound(row(childId,id));}); }
export function next(childId,id,body) {
  return tx(()=>{
    let r=row(childId,id);expire(r);r=row(childId,id);
    if(r.status!=='active')return publicRound(r);
    if(!int(body.index,0,JSON.parse(r.questions).length-1))fail('题号无效');
    // Retry of activation never advances, resets the timer, or consumes another attempt.
    if(body.index===r.cursor && r.activated_at)return publicRound(r);
    const answered=q.get('SELECT 1 FROM challenge_answer WHERE round_id=? AND index_no=?',r.id,r.cursor);
    const expected=r.activated_at ? r.cursor+1:r.cursor;
    if(body.index!==expected || (r.activated_at&&!answered))fail('请先完成当前题目',409);
    if(r.rules_version >= 2 && r.mode==='double' && r.correct >= 3 && body.confirmContinue !== true) fail('请先选择领取当前得分，或确认继续挑战',409);
    const question=JSON.parse(r.questions)[body.index];
    q.run('UPDATE challenge_round SET cursor=?,activated_at=?,deadline=? WHERE id=?',body.index,Date.now(),Math.min(Date.now()+question.seconds*1000,r.expires_ms),id);
    return publicRound(row(childId,id));
  });
}
export function answer(childId,id,body) {
  return tx(()=>{
    let r=row(childId,id);
    if(!int(body.index,0,JSON.parse(r.questions).length-1))fail('题号无效');
    if(body.index<r.cursor || q.get('SELECT 1 FROM challenge_answer WHERE round_id=? AND index_no=?',id,body.index))return publicRound(r);
    expire(r);r=row(childId,id);
    if(r.status!=='active')return publicRound(r);
    if(body.index!==r.cursor||!r.activated_at)fail('这道题还没有开始',409);
    const question=JSON.parse(r.questions)[r.cursor];
    let response=body.response;
    if(response!==null && (typeof response!=='string'||response.length>150))fail('答案格式不正确');
    if(question.type==='number'&&response!==null){ if(!/^\d{1,5}$/.test(response.trim()))fail('请输入数字答案');response=String(Number(response)); }
    if(question.type==='choice'&&response!==null&&!question.options.includes(response))fail('请选择题目中的答案');
    const timedOut=Date.now()>=r.deadline;
    if(response===null&&!timedOut)fail('作答时间还没有结束');
    recordAnswer(r,response,timedOut);
    return publicRound(row(childId,id));
  });
}
export function abandon(childId,id) {
  return tx(()=>{let r=row(childId,id);expire(r);r=row(childId,id);if(r.status==='active'&&r.deadline&&Date.now()>=r.deadline&&!q.get('SELECT 1 FROM challenge_answer WHERE round_id=? AND index_no=?',id,r.cursor))recordAnswer(r,null,true,false);finish(row(childId,id),'abandoned');return publicRound(row(childId,id));});
}
export function cashout(childId,id) {
  return tx(()=>{
    let r=row(childId,id);expire(r);r=row(childId,id);
    if(r.status!=='active') return publicRound(r);
    const answered=q.get('SELECT correct FROM challenge_answer WHERE round_id=? AND index_no=?',id,r.cursor);
    if(r.rules_version<2 || r.mode!=='double' || r.correct<3 || !answered?.correct) fail('答对第 3 题起，可在本题反馈页领取；下一题开始后需先完成作答',409);
    finish(r,'cashed_out');return publicRound(row(childId,id));
  });
}
export function wrongBook(childId,params) {
  const subject=params.get('subject')||'',state=params.get('state')||'',relapse=params.get('relapse')||'0';
  const offset=Number(params.get('offset')||0),limit=Number(params.get('limit')||30),query=(params.get('q')||'').trim().slice(0,80),sort=params.get('sort')||'frequent';
  if (!int(offset,0,1000000) || ![20,30,50].includes(limit)) fail('分页参数无效');
  if ((subject&&!['poetry','math'].includes(subject)) || !['','pending','mastered'].includes(state) || !['0','1'].includes(relapse) || !['frequent','recent','relapse'].includes(sort)) fail('错题筛选条件无效');
  const conditions=['child_id=?'],args=[childId];
  if(subject){conditions.push('subject=?');args.push(subject);}
  if(state){conditions.push('state=?');args.push(state);}
  if(relapse==='1')conditions.push('relapse_count>0');
  if(query){conditions.push("(instr(COALESCE(json_extract(snapshot,'$.prompt'),''),?)>0 OR instr(COALESCE(json_extract(snapshot,'$.title'),''),?)>0 OR instr(question_id,?)>0)");args.push(query,query,query);}
  const where=conditions.join(' AND '),total=q.get(`SELECT COUNT(*) n FROM challenge_wrong WHERE ${where}`,...args).n;
  const order=sort==='recent'?'last_wrong_at DESC,wrong_count DESC,question_id':sort==='relapse'?'relapse_count DESC,wrong_count DESC,last_wrong_at DESC,question_id':'wrong_count DESC,last_wrong_at DESC,question_id';
  const summary=q.get(`SELECT COUNT(*) total,COALESCE(SUM(state='pending'),0) pending,COALESCE(SUM(state='mastered'),0) mastered,COALESCE(SUM(relapse_count>0),0) relapse FROM challenge_wrong WHERE child_id=?`,childId);
  const items=q.all(`SELECT * FROM challenge_wrong WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,...args,limit,offset);
  return { total,offset,limit,summary,next:offset+limit<total?offset+limit:null,items:items.map(w=>({ question:JSON.parse(w.snapshot),state:w.state,wrongCount:w.wrong_count,correctCount:w.correct_count,relapseCount:w.relapse_count,firstWrongAt:w.first_wrong_at,lastWrongAt:w.last_wrong_at,masteredAt:w.mastered_at })) };
}
export function adminQuestions(params) {
  const subject=params.get('subject')||'',query=(params.get('q')||'').trim().slice(0,80),grade=Number(params.get('grade'))||0;
  const offset=Number(params.get('offset')||0),limit=Number(params.get('limit')||30),status=params.get('status')||'';
  if (!int(offset,0,1000000) || ![20,30,50].includes(limit)) fail('分页参数无效');
  if ((subject && !['poetry','math'].includes(subject)) || !int(grade,0,6) || !['','enabled','disabled'].includes(status)) fail('题库筛选条件无效');
  const disabled=new Set(q.all('SELECT question_id FROM challenge_disabled WHERE disabled=1').map(x=>x.question_id));
  const all=catalog.filter(x=>(!subject||x.subject===subject)&&(!grade||x.grade===grade)&&(!query||[x.prompt,x.title,x.id].some(s=>s?.includes(query)))&&(!status||(status==='disabled')===disabled.has(x.id)));
  return { total:all.length,offset,limit,next:offset+limit<all.length?offset+limit:null,items:all.slice(offset,offset+limit).map(x=>({...snapshot(x,3),disabled:disabled.has(x.id)})) };
}
export function setQuestion(id,body) {
  if(!byId.has(id))fail('题目不存在',404);
  if(typeof body.disabled!=='boolean')fail('停用标记无效');
  q.run('INSERT INTO challenge_disabled VALUES(?,?) ON CONFLICT(question_id) DO UPDATE SET disabled=excluded.disabled',id,body.disabled?1:0);
  return {ok:true};
}
