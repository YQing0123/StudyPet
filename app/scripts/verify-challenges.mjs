import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {testActivationCode} from './fixtures/activation.mjs';
import {hashPassword} from '../server/credentials.mjs';
import {library,catalog,poemQuestions,mathQuestions,eligible,snapshot} from '../server/challenge-content.mjs';
const BASE=process.env.BASE,dir=process.env.BANXUE_TEST_DB;
if(!BASE||!dir)throw Error('挑战验收必须使用隔离数据库');
let cookie='',scope={};
async function call(path,body,method=body===undefined?'GET':'POST'){
 const r=await fetch(BASE+path,{method,headers:{'content-type':'application/json',cookie,...scope},body:body===undefined?undefined:JSON.stringify(body)});
 if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
 const json=await r.json();return {status:r.status,json};
}
const api=async(path,body,method)=>{const r=await call('/api/v2/challenges'+path,body,method);assert.equal(r.status,200,JSON.stringify(r.json));return r.json;};
const check=(c,msg)=>{assert.ok(c,msg);console.log('✓ '+msg);};
assert.equal(library.poems.length,155);assert.equal(library.poems.filter(p=>p.group==='core').length,75);
check(new Set(catalog.map(x=>x.id)).size===catalog.length,'155 首可追溯清单，所有题目有唯一稳定身份');
const mulan=library.poems.find(p=>p.title.startsWith('木兰诗'));
check(mulan.segments.length>1,'木兰诗省略部分被保留为分段边界');
const lastPoem=library.poems.at(-1).segments.flat();
check(lastPoem.length===10&&lastPoem.at(-1)==='生子当如孙仲谋'&&!library.poems.some(p=>p.segments.flat().some(line=>/本文件|年级归属|说明：/.test(line))),'最后一首原文严格截止，附录引用说明不会变成诗句或干扰项');
for(const question of poemQuestions.filter(x=>!x.id.includes('-note-'))){
 const p=library.poems.find(p=>p.id===question.poemId);
 checkAdjacent: {for(const seg of p.segments)for(let i=0;i<seg.length-1;i++)if((seg[i]===question.cue&&seg[i+1]===question.answer)||(seg[i+1]===question.cue&&seg[i]===question.answer))break checkAdjacent;throw Error('不相邻诗句：'+question.id);}
 assert.ok(!question.distractors.includes(question.answer));
 const step=question.id.endsWith('-next')?1:-1;
 const candidates=new Set(p.segments.flatMap(seg=>seg.flatMap((line,j)=>line===question.cue&&seg[j+step]?[seg[j+step]]:[])));
 assert.equal(candidates.size,1,question.id+' 重复诗句不得产生多个正确答案');
}
check(true,'接诗句题全部来自同一连续原文段，无跨省略出题');
check(!mathQuestions.some(x=>/[÷/]/.test(x.prompt)),'已学数学范围不出现除法');
for(const question of mathQuestions.filter(x=>x.level===1&&/^\d+ \+ \d+ =/.test(x.prompt))){const [,a,b]=/^(\d+) \+ (\d+) =/.exec(question.prompt);assert.ok(Number(a)%10+Number(b)%10<10);}
check(true,'普通加法不含进位，进位题归入挑战难度');
for(const question of mathQuestions){
 let answer;
 if(question.topic==='length'){
  let m;if((m=/^(\d+) 米 (\d+) 厘米/.exec(question.prompt)))answer=Number(m[1])*100+Number(m[2]);
  else if((m=/^(\d+) 米 − (\d+) 厘米/.exec(question.prompt)))answer=Number(m[1])*100-Number(m[2]);
  else if((m=/^(\d+) 米 =/.exec(question.prompt)))answer=Number(m[1])*100;
  else if((m=/^(\d+) 厘米 =/.exec(question.prompt)))answer=Number(m[1])/100;
 }else{
  // Test independently through arithmetic operations, never execute catalog text.
  const tokens=question.prompt.split(' = ')[0].split(' ');const nums=tokens.filter((_,i)=>i%2===0).map(Number),ops=tokens.filter((_,i)=>i%2===1);
  answer=nums[0];for(let i=0;i<ops.length;i++)answer=ops[i]==='×'?answer*nums[i+1]:ops[i]==='+'?answer+nums[i+1]:answer-nums[i+1];
 }
 assert.equal(String(answer),question.answer,question.prompt);
}
check(true,'全部生成计算与单位换算答案经过独立重算');
const r=await call('/api/auth/register',{activationCode:testActivationCode(dir),login:'challenge-'+Date.now(),password:'Challenge-2026!',name:'挑战家长',familyName:'挑战隔离家庭',childName:'二年级孩子'});
assert.equal(r.status,200,JSON.stringify(r.json));const childId=r.json.activeChildId;
const db=new DatabaseSync(join(dir,'banxue.db'));db.exec('PRAGMA busy_timeout=5000');
const policy=(await api('/settings')).policy;
assert.equal(policy.grade,2);assert.deepEqual(policy.topics,['add','multiply','length']);
await api('/settings',{...policy,dailyRounds:5,questionsPerRound:15,roundMinutes:12,dailyPoints:60});
const configured=(await api('/settings')).policy;
check(configured.dailyRounds===5&&configured.questionsPerRound===15&&configured.roundMinutes===12&&configured.dailyPoints===null,'每日次数、每轮题量和时长保存后正确读回，积分总分不限');
await api('/settings',policy);
const bank=(id)=>JSON.parse(db.prepare('SELECT questions FROM challenge_round WHERE id=?').get(id).questions);
let serial=0;
const start=async(subject='math',difficulty=1,mode='standard',requestId='challenge-'+(++serial)+'-request')=>api('/rounds',{subject,difficulty,mode,requestId});
const next=(r,index)=>api(`/rounds/${r.id}/next`,{index,confirmContinue:r.canCashOut});
const answer=(r,response)=>api(`/rounds/${r.id}/answer`,{index:r.index,response});
let round=await start('poetry',1,'standard','idempotent-start');
const repeated=await start('math',3,'double','idempotent-start');assert.equal(repeated.id,round.id);
check((await api('')).usage.rounds===1,'重复开始请求只占一次机会');
assert.equal(round.question,null);
round=await next(round,0);const deadline=round.deadline;assert.equal((await next(round,0)).deadline,deadline);
check(!('answer' in round.question)&&!('notes' in round.question)&&!('explanation' in round.question),'作答前不泄漏答案和注释，重复激活不重置计时');
assert.equal((await call('/api/v2/challenges/rounds/'+round.id+'/next',{index:1})).status,409);
const first=bank(round.id)[0];
const [a,b]=await Promise.all([answer(round,first.answer),answer(round,first.answer)]);assert.equal(a.correct,1);assert.equal(b.correct,1);
assert.equal(db.prepare('SELECT COUNT(*) n FROM challenge_answer WHERE round_id=?').get(round.id).n,1);
check(true,'同一题并发重试只记录一次，未答完不能跳题');
await api(`/rounds/${round.id}/abandon`,{});
check(!(await api(`/rounds/${round.id}`)).reward,'提前结束不发奖');
function resetDay(){db.prepare("UPDATE challenge_round SET date='2000-01-01' WHERE child_id=?").run(childId);}
resetDay();
const before=(await call('/api/v2/student')).json.wallet.balance;
async function complete(correct,level=1,mode='standard'){
 let r=await start('math',level,mode);const questions=bank(r.id);
 for(let i=0;i<r.total;i++){r=await next(r,i);r=await answer(r,i<correct?questions[i].answer:'99999');if(r.status!=='active')break;}
 return r;
}
const seven=await complete(7);assert.equal(seven.reward,0);
for(const level of [1,2,3])for(const correct of [8,9,10]){
 resetDay();const r=await complete(correct,level);assert.equal(r.reward,[10,13,16][correct-8]*2**(level-1));
 const retried=await answer(r,bank(r.id)[9].answer);assert.equal(retried.reward,r.reward);
}
resetDay();const lost=await complete(1,1,'double');assert.equal(lost.reward,0);assert.equal(lost.status,'failed');
check((await call('/api/v2/student')).json.wallet.balance===before+273,'普通三个难度8/9/10题奖励为10/13/16逐级翻倍；答错不扣已有钱包');
check(db.prepare("SELECT COUNT(*) n FROM point_ledger WHERE child_id=? AND dedupe_key LIKE 'challenge:%'").get(childId).n===9,'所有正常结算重复提交均只入账一次');
resetDay();
const double=await complete(10,2,'double');assert.equal(double.reward,512);
check(double.pending===0,'翻倍连续10题全对得512分，完成后清空暂存显示');
async function streak(count,level=1){let r=await start('math',level,'double');const questions=bank(r.id);for(let i=0;i<count;i++){r=await next(r,i);r=await answer(r,questions[i].answer);assert.equal(r.pending,2**i);}return r;}
resetDay();let pot=await streak(2);
assert.equal((await call(`/api/v2/challenges/rounds/${pot.id}/cashout`,{})).status,409);
pot=await next(pot,2);pot=await answer(pot,bank(pot.id)[2].answer);
assert.equal(pot.pending,4);assert.equal(pot.nextReward,8);assert.equal(pot.canCashOut,true);
assert.equal((await api(`/rounds/${pot.id}`)).pending,4);
assert.equal((await call(`/api/v2/challenges/rounds/${pot.id}/next`,{index:3})).status,409);
const [claim1,claim2]=await Promise.all([api(`/rounds/${pot.id}/cashout`,{}),api(`/rounds/${pot.id}/cashout`,{})]);
assert.equal(claim1.reward,4);assert.equal(claim2.reward,4);assert.equal(claim1.status,'cashed_out');
check(db.prepare('SELECT COUNT(*) n FROM point_ledger WHERE dedupe_key=?').get('challenge:'+pot.id).n===1,'第3题起可领取4分，刷新保留，重复/并发领取只到账一次，继续必须明确确认');
resetDay();pot=await streak(3);pot=await api(`/rounds/${pot.id}/next`,{index:3,confirmContinue:true});
assert.equal((await call(`/api/v2/challenges/rounds/${pot.id}/cashout`,{})).status,409);
pot=await answer(pot,'99999');assert.equal(pot.status,'failed');assert.equal(pot.reward,0);assert.equal(pot.pending,0);
check(true,'继续挑战一旦开始计时不能撤回领取；答错立即清空本轮暂存');
resetDay();pot=await streak(3);pot=await api(`/rounds/${pot.id}/next`,{index:3,confirmContinue:true});
db.prepare('UPDATE challenge_round SET deadline=? WHERE id=?').run(Date.now()-1,pot.id);
pot=await answer(pot,bank(pot.id)[3].answer);assert.equal(pot.reward,0);assert.equal(pot.feedback.timedOut,true);
check(pot.status==='failed','翻倍继续后超时同样清零');
resetDay();pot=await streak(3);
const race=await Promise.all([call(`/api/v2/challenges/rounds/${pot.id}/cashout`,{}),call(`/api/v2/challenges/rounds/${pot.id}/next`,{index:3,confirmContinue:true})]);
const raced=await api(`/rounds/${pot.id}`);
check((raced.status==='cashed_out'&&raced.reward===4)||(raced.status==='active'&&raced.index===3&&raced.reward===0),'领取与继续并发只能有一个动作生效');
if(raced.status==='active')await api(`/rounds/${pot.id}/abandon`,{});
resetDay();await api('/settings',{...policy,dailyRounds:3,dailyMinutes:3,dailyPoints:1});
const high1=await complete(10,3,'double');const high2=await complete(10,1,'double');const high3=await complete(10,3);
check(high1.reward===512&&high2.reward===512&&high3.reward===64&&(await api('')).usage.earned===1088,'一天任意模式三次累计1088分，旧每日积分/时长上限不再截断');
check((await call('/api/v2/challenges/rounds',{subject:'poetry',difficulty:1,mode:'standard',requestId:'limit-request'})).status===409,'三个模式/难度合计用满后，第4次由服务端拒绝');
resetDay();let legacy=await start();db.prepare('UPDATE challenge_round SET rules_version=1,reward_cap=4 WHERE id=?').run(legacy.id);
for(let i=0;i<10;i++){legacy=await next(legacy,i);legacy=await answer(legacy,bank(legacy.id)[i].answer);}
check(legacy.reward===4,'更新前开始的旧版本挑战保留原奖励与快照上限');
resetDay();round=await start();round=await next(round,0);assert.equal((await call(`/api/v2/challenges/rounds/${round.id}/cashout`,{})).status,409);await api(`/rounds/${round.id}/abandon`,{});
await api('/settings',{...policy});resetDay();
async function nineThenActivate(){let r=await start();const questions=bank(r.id);for(let i=0;i<9;i++){r=await next(r,i);r=await answer(r,questions[i].answer);}return next(r,9);}
round=await nineThenActivate();
db.prepare('UPDATE challenge_round SET expires_ms=? WHERE id=?').run(Date.now()-1,round.id);
let expired=await api(`/rounds/${round.id}`);
check(expired.status==='expired'&&expired.reward===0,'整轮到时不会因最后一题自动记错而错误发奖');
resetDay();round=await nineThenActivate();
db.prepare('UPDATE challenge_round SET deadline=? WHERE id=?').run(Date.now()-1,round.id);
let abandoned=await api(`/rounds/${round.id}/abandon`,{});
check(abandoned.status==='abandoned'&&abandoned.reward===0,'最后一题超时后主动结束仍不发奖');
resetDay();round=await start();round=await next(round,0);
const familyId=db.prepare('SELECT family_id FROM child WHERE id=?').get(childId).family_id;
const oldExpiry=db.prepare('SELECT expires_at FROM family WHERE id=?').get(familyId).expires_at;
db.prepare('UPDATE family SET expires_at=? WHERE id=?').run(Date.now()-1000,familyId);
db.prepare('UPDATE challenge_round SET expires_ms=? WHERE id=?').run(Date.now()-1,round.id);
const wrongBefore=db.prepare('SELECT SUM(wrong_count) n FROM challenge_wrong WHERE child_id=?').get(childId).n;
expired=await api(`/rounds/${round.id}`);await api('');
check(expired.status==='active'&&db.prepare('SELECT COUNT(*) n FROM challenge_answer WHERE round_id=?').get(round.id).n===0&&db.prepare('SELECT SUM(wrong_count) n FROM challenge_wrong WHERE child_id=?').get(childId).n===wrongBefore,'家庭到期后只读访问不结算挑战、不改变错题');
db.prepare('UPDATE family SET expires_at=? WHERE id=?').run(oldExpiry,familyId);
await api(`/rounds/${round.id}`);
// Stable wrong-question lifecycle, through real authenticated answer endpoints.
db.prepare('DELETE FROM challenge_wrong WHERE child_id=?').run(childId);resetDay();
let target=null;
for(const [i,valid] of [false,false,true,false,true].entries()){
 resetDay();
 let r=await start();let questions=bank(r.id);
 if(!target)target=questions[0];
 if(i)check(questions.some(x=>x.id===target.id),'后续挑战随机插入唯一待复习/已掌握错题原题');
 questions=[{...target,review:true},...questions.filter(x=>x.id!==target.id)].slice(0,10);
 db.prepare('UPDATE challenge_round SET questions=? WHERE id=?').run(JSON.stringify(questions),r.id);
 r=await next(r,0);r=await answer(r,valid?target.answer:'99999');
 await answer(r,valid?target.answer:'99999'); // Retry cannot inflate wrong count.
 await api(`/rounds/${r.id}/abandon`,{});
}
let book=await api('/wrong?subject=math');
assert.equal(book.items[0].state,'mastered');assert.equal(book.items[0].wrongCount,3);assert.equal(book.items[0].correctCount,2);assert.equal(book.items[0].relapseCount,1);
check(true,'错→错→对→错→对：已掌握，累计错3次，掌握后再错1次；记录永久保留');
assert.equal((await api('/wrong?relapse=1&state=mastered')).total,1);
resetDay();round=await start();round=await next(round,0);
db.prepare('UPDATE challenge_round SET deadline=? WHERE id=?').run(Date.now()-1000,round.id);
round=await answer(round,bank(round.id)[0].answer);
check(round.feedback.timedOut&&!round.feedback.correct,'超时以服务端截止时间判定，即使提交正确答案也不算对');
await api(`/rounds/${round.id}/abandon`,{});
resetDay();round=await start();db.prepare('UPDATE challenge_round SET created_ms=?,expires_ms=? WHERE id=?').run(Date.now()-30*60000,Date.now()-1,round.id);
assert.equal((await api(`/rounds/${round.id}`)).status,'expired');
const remainingAttempt=await start();check(remainingAttempt.status==='active','已结束的超时轮次不会额外阻断剩余挑战次数，每轮仍有独立10分钟上限');await api(`/rounds/${remainingAttempt.id}/abandon`,{});
// Configurable limits: service enforcement and immutable running-round snapshots.
for(const patch of [{dailyRounds:-1},{dailyRounds:21},{dailyRounds:1.5},{questionsPerRound:4},{questionsPerRound:21},{roundMinutes:0},{roundMinutes:61},{roundMinutes:'5'}]){
 assert.equal((await call('/api/v2/challenges/settings',{...policy,...patch})).status,400,JSON.stringify(patch));
}
check((await api('/settings')).policy.questionsPerRound===10,'非法设置由服务端拒绝，原配置保留');
resetDay();await api('/settings',{...policy,dailyRounds:0});
assert.equal((await api('')).usage.remainingRounds,0);
assert.equal((await call('/api/v2/challenges/rounds',{subject:'math',difficulty:1,mode:'standard',requestId:'paused-challenge'})).status,409);
check(true,'每日0次暂停新挑战，服务端无法绕过');
await api('/settings',{...policy,dailyRounds:1,questionsPerRound:5,roundMinutes:3});
let short=await start();const shortRow=db.prepare('SELECT * FROM challenge_round WHERE id=?').get(short.id),shortQuestions=bank(short.id);
assert.equal(short.total,5);assert.equal(shortRow.expires_ms-shortRow.created_ms,180000);
await api('/settings',{...policy,dailyRounds:5,questionsPerRound:20,roundMinutes:60});
short=await api(`/rounds/${short.id}`);assert.equal(short.total,5);assert.equal(short.expiresAt,shortRow.expires_ms);
assert.equal((await call(`/api/v2/challenges/rounds/${short.id}/next`,{index:5})).status,400);
for(let i=0;i<5;i++){short=await next(short,i);short=await answer(short,shortQuestions[i].answer);}
assert.equal(short.status,'completed');assert.equal(short.reward,16);
check(true,'5题在第5题结算；中途修改成20题/60分钟不改变原题量和3分钟截止快照');
for(const [count,correct,reward] of [[5,4,10],[15,12,10],[15,14,13],[20,20,16]]){
 resetDay();await api('/settings',{...policy,questionsPerRound:count});const r=await complete(correct);assert.equal(r.total,count);assert.equal(r.reward,reward);
}
resetDay();await api('/settings',{...policy,questionsPerRound:20});
const longDouble=await complete(20,1,'double');assert.equal(longDouble.reward,512);
check(true,'5/15/20题普通奖励按正确率正确分档；20题翻倍模式最高512且只结算一次');
resetDay();await api('/settings',{...policy,dailyRounds:1});
let single=await start();await api(`/rounds/${single.id}/abandon`,{});
assert.equal((await call('/api/v2/challenges/rounds',{subject:'math',difficulty:1,mode:'standard',requestId:'one-limit-reject'})).status,409);
await api('/settings',{...policy,dailyRounds:2});single=await start();await api(`/rounds/${single.id}/abandon`,{});
assert.equal((await api('')).usage.remainingRounds,0);
await api('/settings',{...policy,dailyRounds:1});assert.equal((await api('')).usage.remainingRounds,0);
check(true,'次数由服务端累计执行；提高立即开放剩余机会，降低不会清空已用次数');
// Existing v2 ten-question rounds keep their reward rules after rollout.
resetDay();await api('/settings',policy);let v2=await start();db.prepare('UPDATE challenge_round SET rules_version=2 WHERE id=?').run(v2.id);
await api('/settings',{...policy,questionsPerRound:5});
for(let i=0;i<10;i++){v2=await next(v2,i);v2=await answer(v2,bank(v2.id)[i].answer);}
assert.equal(v2.total,10);assert.equal(v2.reward,16);
await api('/settings',policy);
check(true,'历史v2轮次仍按原10题规则和奖励结算');
// Parent list: SQL pagination, child-wide statistics, filters, sorting, and student compatibility.
const savedWrongIds=new Set(db.prepare('SELECT question_id FROM challenge_wrong WHERE child_id=?').all(childId).map(w=>w.question_id));
const wrongSeeds=[...catalog.filter(x=>x.subject==='poetry'&&!savedWrongIds.has(x.id)).slice(0,35),...catalog.filter(x=>x.subject==='math'&&!savedWrongIds.has(x.id)).slice(0,30)];
const addWrong=db.prepare('INSERT INTO challenge_wrong(child_id,question_id,snapshot,subject,state,wrong_count,correct_count,relapse_count,first_wrong_at,last_wrong_at,mastered_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
for(const [i,question] of wrongSeeds.entries()){
 const at=new Date(Date.now()-i*60000-86400000).toISOString(),mastered=i%3===0;
 addWrong.run(childId,question.id,JSON.stringify(snapshot(question,3)),question.subject,mastered?'mastered':'pending',i%8+1,mastered?2:0,i%5===0?1:0,at,at,mastered?at:null);
}
const allWrong=db.prepare('SELECT * FROM challenge_wrong WHERE child_id=?').all(childId);
const expectedSummary={total:allWrong.length,pending:allWrong.filter(w=>w.state==='pending').length,mastered:allWrong.filter(w=>w.state==='mastered').length,relapse:allWrong.filter(w=>w.relapse_count>0).length};
const wrongFirst=await api('/wrong?limit=20'),wrongSecond=await api('/wrong?limit=20&offset=20');
assert.deepEqual(wrongFirst.summary,expectedSummary);assert.equal(wrongFirst.total,allWrong.length);assert.equal(wrongFirst.limit,20);assert.equal(wrongFirst.next,20);assert.equal(wrongFirst.items.length,20);assert.equal(wrongSecond.offset,20);
assert.ok(!wrongSecond.items.some(x=>wrongFirst.items.some(y=>x.question.id===y.question.id)));
for(let i=1;i<wrongFirst.items.length;i++)assert.ok(wrongFirst.items[i-1].wrongCount>=wrongFirst.items[i].wrongCount);
const filteredWrong=await api('/wrong?subject=poetry&state=pending&relapse=1&limit=50');
assert.equal(filteredWrong.total,allWrong.filter(w=>w.subject==='poetry'&&w.state==='pending'&&w.relapse_count>0).length);assert.deepEqual(filteredWrong.summary,expectedSummary);
assert.ok(filteredWrong.items.every(w=>w.question.subject==='poetry'&&w.state==='pending'&&w.relapseCount>0));
const singleWrong=await api('/wrong?q='+encodeURIComponent(wrongSeeds[0].id));assert.equal(singleWrong.total,1);assert.equal(singleWrong.items[0].question.id,wrongSeeds[0].id);assert.ok(singleWrong.items[0].firstWrongAt);
const noWrong=await api('/wrong?q='+encodeURIComponent("%_' OR 1=1 --"));assert.equal(noWrong.total,0);assert.deepEqual(noWrong.summary,expectedSummary);
const recentWrong=await api('/wrong?sort=recent'),relapseWrong=await api('/wrong?sort=relapse');
for(let i=1;i<recentWrong.items.length;i++)assert.ok(Date.parse(recentWrong.items[i-1].lastWrongAt)>=Date.parse(recentWrong.items[i].lastWrongAt));
for(let i=1;i<relapseWrong.items.length;i++)assert.ok(relapseWrong.items[i-1].relapseCount>=relapseWrong.items[i].relapseCount);
const studentWrong=await api('/wrong');assert.equal(studentWrong.limit,30);assert.equal(studentWrong.items.length,30);assert.equal(studentWrong.next,30);assert.equal((await api('/wrong?offset=30')).offset,30);
for(const query of ['limit=10000','offset=-1','offset=NaN','offset=1.5','subject=invalid','state=invalid','relapse=invalid','sort=invalid'])assert.equal((await call('/api/v2/challenges/wrong?'+query)).status,400,query);
check(true,'家长错题20/30/50分页、全量统计、组合筛选、关键词、三种排序及非法参数通过，学生30条追加接口兼容');
// Ownership and parent guard.
await call('/api/auth/lock',{});
check((await call('/api/v2/challenges/settings',policy)).status===403,'学生模式不能修改家长挑战设置');
const another=await call('/api/auth/register',{activationCode:testActivationCode(dir),login:'challenge-other-'+Date.now(),password:'Challenge-Other-2026!',name:'另一家长',familyName:'另一家庭',childName:'另一孩子'});
assert.equal(another.status,200);
assert.deepEqual((await api('/wrong')).summary,{total:0,pending:0,mastered:0,relapse:0});
check((await call('/api/v2/challenges/rounds/'+round.id)).status===404,'跨家庭无法读取、作答或复用挑战记录');
scope={'x-child-id':childId};check((await call('/api/v2/challenges')).status===403,'伪造孩子请求头不能跨家庭访问');
check((await call('/api/admin/challenges/questions')).status===401,'家庭账号不能访问管理员题库');
const adminLogin='challenge-admin-'+Date.now(),adminPassword='Challenge-Admin-2026!';
db.prepare('INSERT INTO platform_admin VALUES(?,?,?,?)').run(crypto.randomUUID(),adminLogin,await hashPassword(adminPassword,12),new Date().toISOString());
assert.equal((await call('/api/admin/login',{login:adminLogin,password:adminPassword})).status,200);
const firstPage=(await call('/api/admin/challenges/questions?subject=math&limit=20')).json;
const secondPage=(await call('/api/admin/challenges/questions?subject=math&limit=20&offset=20')).json;
assert.equal(firstPage.items.length,20);assert.equal(firstPage.next,20);assert.equal(secondPage.offset,20);
assert.ok(!secondPage.items.some(x=>firstPage.items.some(y=>y.id===x.id)));
assert.equal((await call('/api/admin/challenges/questions?limit=100000')).status,400);
assert.equal((await call('/api/admin/challenges/questions?offset=-1')).status,400);
assert.equal((await call('/api/admin/challenges/questions?offset=NaN')).status,400);
check(true,'题库分页有总数、页大小与偏移，跨页不重复且非法参数被拒绝');
const adminPage=await call('/api/admin/challenges/questions?subject=math&grade=2&q='+encodeURIComponent('1 × 1 = ?'));
assert.equal(adminPage.status,200);const managed=adminPage.json.items[0];assert.equal(managed.answer,'1');
assert.equal((await call('/api/admin/challenges/questions/'+managed.id,{disabled:true})).status,200);
assert.equal((await call('/api/admin/challenges/questions?subject=math&q='+encodeURIComponent(managed.id))).json.items[0].disabled,true);
assert.equal((await call('/api/admin/challenges/questions/'+managed.id,{disabled:false})).status,200);
check((await call('/api/admin/challenges/questions?subject=math&q='+encodeURIComponent(managed.id))).json.items[0].disabled===false,'独立管理员可查询答案、停用及恢复题目');
db.close();console.log('Challenge verification passed.');
