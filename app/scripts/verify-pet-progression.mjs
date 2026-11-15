/** Business and HTTP concurrency tests; every mutation uses a disposable SQLite database. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'banxue-progression-'));
process.env.BANXUE_DATA_DIR = dir;
const { db, q, tx } = await import('../server/db.mjs');
const D = await import('../server/daily.mjs'), V = await import('../server/v2.mjs');
const B = await import('../server/pet-backups.mjs'), P = await import('../server/pet-progression.mjs');
let checks = 0, server;
const check = (condition, label) => { assert.ok(condition, label); checks++; console.log('✓ ' + label); };
const makeChild = id => { q.run('INSERT INTO child(id,name,created_at) VALUES(?,?,?)', id, id, new Date().toISOString()); D.adopt(id, { breed: 'dog_corgi_toon' }); return D.getPetRow(id); };
try {
 const clock = Date.parse('2026-11-14T00:00:00Z');
 let combinations = 0;
 for (const n of [0,.1,1,24,48,96,120,144,240,1000,5000]) for (const g of [0,1,12,24,84,200,9999]) for (const level of [1,2,3,6,10,11,12]) {
  const model = { confirmed_level: level, progression_seed: 0, eligible_growth: g, natural_anchor_at: new Date(clock-n*3600000).toISOString() };
  const state = P.progressionFor(model,clock);
  assert.ok(Math.abs(state.effectiveHours-(n+Math.min(g,n)))<1e-8);
  assert.ok(state.effectiveHours<=2*n+1e-8&&state.progress>=0&&state.progress<=1);
  assert.equal(state.level,level);
  if(state.waitHours!=null){
   assert.ok(P.progressionFor(model,clock+state.waitHours*3600000+2).ready);
   if(state.waitHours>.001)assert.equal(P.progressionFor(model,clock+state.waitHours*3600000-1000).ready,false);
  }
  combinations++;
 }
 check(combinations===539,'539组公式、准确倒计时、最快两倍和终点组合');
 const example=P.progressionFor({confirmed_level:2,progression_seed:0,eligible_growth:84,natural_anchor_at:new Date(clock-144*3600000).toISOString()},clock);
 check(example.growthNeeded===12&&example.waitHours===12&&Math.abs(example.progress-11/12)<1e-8,'144自然小时+84成长：还差12成长或12小时，分段进度92%');
 check(P.chinaDate('2026-11-14T15:59:59Z')==='2026-11-14'&&P.chinaDate('2026-11-14T16:00:00Z')==='2026-11-15','每日额度按北京时间零点跨日');
 const pet=makeChild('manual');
 q.run('UPDATE pet_life SET natural_anchor_at=? WHERE pet_id=?',new Date(Date.now()-200*86400000).toISOString(),pet.pet_id);
 for(let i=0;i<3;i++)assert.equal(D.getToday('manual').pet.progression.level,1);
 check(D.getToday('manual').pet.stage===1&&D.getToday('manual').pet.progression.ready,'长期离线、刷新和读取只会达标，不自动改年龄和外观');
 const manualBackup=B.backupPet('manual',pet.pet_id).id;
 const request={expectedPetId:pet.pet_id,expectedLevel:1,requestId:crypto.randomUUID()};
 const first=P.confirmLevel('manual',request);
 assert.equal(P.confirmLevel('manual',request).id,first.id);
 assert.throws(()=>P.confirmLevel('manual',{...request,requestId:crypto.randomUUID()}),/阶段已经变化/);
 assert.equal(D.getToday('manual').pet.stage,1);
 check(D.getToday('manual').pet.progression.level===2,'每次只升一阶，同请求重试幂等，旧等级新请求被拒绝');
 assert.throws(()=>P.confirmLevel('other-child',request),/宠物已经变化/);check(true,'拒绝跨孩子升级');
 B.restorePet('manual',manualBackup,pet.pet_id);
 const restoredRequest={...request,requestId:crypto.randomUUID()};
 const restoredEvent=P.confirmLevel('manual',restoredRequest);
 assert.equal(restoredEvent.id,first.id);assert.equal(P.confirmLevel('manual',restoredRequest).id,first.id);
 check(P.levelEvents('manual',pet.pet_id).length===1&&D.getToday('manual').pet.progression.level===2,'恢复升级前备份可手动补回阶段，同里程碑不重复生成回忆，新的重试仍幂等');
 const young=makeChild('young');tx(()=>P.grantGrowth('young',young,'task',99999,'first-task'));
 assert.throws(()=>P.confirmLevel('young',{expectedPetId:young.pet_id,expectedLevel:1,requestId:crypto.randomUUID()}),/慢慢长大/);
 check(D.getToday('young').pet.progression.minimumWaitHours>47.9,'成长不能越过最小自然等待');
 const legacy=makeChild('legacy');
 q.run('UPDATE pet_life SET progression_version=NULL,confirmed_level=NULL,stage=4,growth=157,adopted_at=? WHERE pet_id=?',new Date(Date.now()-12*86400000).toISOString(),legacy.pet_id);
 const migrated=D.getToday('legacy').pet;
 check(migrated.stage===4&&migrated.progression.level===7&&migrated.progression.seedHours===54*24&&migrated.progression.eligibleGrowth===0&&migrated.growth===157&&!migrated.progression.ready,'旧宠物保留成年与历史成长，从成年初阶继续，无历史暴冲');
 check(q.get('SELECT COUNT(*) n FROM pet_chest_claim WHERE pet_id=?',legacy.pet_id).n===3,'迁移标记历史百宝箱');
 const quotaPet=makeChild('quota');let total=0;
 for(const action of ['pet','play','hug'])for(let i=0;i<5;i++){
  q.run('DELETE FROM pet_cooldown WHERE pet_id=?',quotaPet.pet_id);q.run('UPDATE pet_life SET last_care_at=NULL,energy=90 WHERE pet_id=?',quotaPet.pet_id);
  const response=D.interact('quota',{action});assert.equal(response.growthGained,i<2?1:0);total+=response.growthGained;
 }
 check(total===6,'三种互动各限前两次有成长，额度外仍可回应');
 const count=q.get('SELECT COUNT(*) n FROM pet_growth_ledger WHERE child_id=?','quota').n;
 assert.throws(()=>D.interact('quota',{action:'hug'}),/回味/);
 q.run('UPDATE pet_life SET energy=0 WHERE pet_id=?',quotaPet.pet_id);assert.throws(()=>D.interact('quota',{action:'play'}),/太累/);
 check(q.get('SELECT COUNT(*) n FROM pet_growth_ledger WHERE child_id=?','quota').n===count,'失败动作不记成长');
 for(const key of ['fish','feather','brush']){q.run('INSERT INTO material_inv VALUES(?,?,5)','quota',key);for(let i=0;i<3;i++)D.useMaterial('quota',{key});}
 assert.equal(D.getToday('quota').pet.growth,12);
 for(let i=0;i<5;i++)tx(()=>D.awardTaskGrowth('quota',{id:`today-${i}`,date:P.chinaDate()}));
 tx(()=>D.awardTaskGrowth('quota',{id:'today-0',date:P.chinaDate()}));tx(()=>D.awardTaskGrowth('quota',{id:'history',date:'2020-01-01'}));
 check(D.getToday('quota').pet.growth===24&&P.dailyGrowth('quota').remaining===0,'材料分类限额、前3项任务各4点，历史与重复任务不加速，每天合计24');
 check(P.dailyGrowth('quota',Date.now()+86400000).remaining===24,'隔天额度重置');
 const backup=B.backupPet('quota',quotaPet.pet_id).id;
 B.migratePet('quota','bird_parakeet',quotaPet.pet_id);assert.equal(D.getToday('quota').pet.progression.level,1);
 B.restartPet('quota',quotaPet.pet_id);D.adopt('quota',{breed:'turtle_grass'});const newPet=D.getPetRow('quota');
 assert.equal(D.interact('quota',{action:'pet'}).growthGained,0);B.restorePet('quota',backup,newPet.pet_id);
 check(P.dailyGrowth('quota').remaining===0,'换品种、重养与恢复备份不能刷新当日额度');
 const saved=JSON.parse(q.get('SELECT snapshot FROM pet_backup WHERE id=?',backup).snapshot);
 saved.pet.natural_anchor_at=new Date(Date.parse(saved.pet.natural_anchor_at)-20*86400000).toISOString();
 q.run('UPDATE pet_backup SET snapshot=?,created_at=? WHERE id=?',JSON.stringify(saved),new Date(Date.now()-20*86400000).toISOString(),backup);
 B.restorePet('quota',backup,quotaPet.pet_id);
 check(D.getToday('quota').pet.progression.naturalHours<.01,'归档20天恢复后冻结自然进度');
 const chestPet=makeChild('chest');q.run('UPDATE pet_life SET growth=49 WHERE pet_id=?',chestPet.pet_id);
 const chestBackup=B.backupPet('chest',chestPet.pet_id).id;
 assert.equal(D.interact('chest',{action:'pet'}).loot.length,1);const inventory=D.getToday('chest').inventory;
 B.restorePet('chest',chestBackup,chestPet.pet_id);
 assert.equal(D.interact('chest',{action:'hug'}).loot.length,0);assert.deepEqual(D.getToday('chest').inventory,inventory);
 check(true,'恢复49成长备份后再次跨50，不重复掉落材料');
 makeChild('tasks');
 V.saveRule('tasks',{title:'无需审核',weekdays:[1,2,3,4,5,6,7],basePoints:1,reviewRequired:false,photoRequired:false});
 V.saveRule('tasks',{title:'需要审核',weekdays:[1,2,3,4,5,6,7],basePoints:80,reviewRequired:true,photoRequired:false});
 const tasks=V.getStudentState('tasks').tasks,automatic=tasks.find(t=>t.title==='无需审核'),reviewed=tasks.find(t=>t.title==='需要审核');
 V.submitTask('tasks',automatic.id);assert.equal(D.getToday('tasks').pet.growth,4);
 V.submitTask('tasks',reviewed.id);assert.equal(D.getToday('tasks').pet.growth,4);
 V.reviewTask('tasks',reviewed.id,{approve:false});V.submitTask('tasks',reviewed.id);V.reviewTask('tasks',reviewed.id,{approve:true});
 assert.equal(D.getToday('tasks').pet.growth,8);assert.throws(()=>V.reviewTask('tasks',reviewed.id,{approve:true}));
 check(D.getToday('tasks').pet.growth===8,'自动通过及时奖励；退回不奖励，重审通过仅一次，与星贝多少无关');
 const port='17729',base=`http://127.0.0.1:${port}`;
 server=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,PORT:port,BANXUE_DATA_DIR:dir},stdio:['ignore','ignore','pipe']});
 let serverError='';server.stderr.on('data',d=>{serverError+=d;});let ready=false;
 for(let i=0;i<80;i++){try{ready=(await fetch(base+'/api/health')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,100));}assert.ok(ready,serverError);
 let cookie='';const api=async(path,body)=>{const r=await fetch(base+path,{method:body==null?'GET':'POST',headers:{'content-type':'application/json',cookie},body:body==null?undefined:JSON.stringify(body)});const c=r.headers.get('set-cookie');if(c)cookie=c.split(';')[0];return {status:r.status,data:await r.json()};};
 const registration=await api('/api/auth/register',{login:'progression-api',password:'Suite-Only-2026!',name:'验收',familyName:'隔离',childName:'孩子',claimLegacy:true,legacyPin:"1234"});assert.equal(registration.status,200,JSON.stringify(registration.data));
 const claimed=(await api('/api/v2/student')).data.pet;if(claimed)assert.equal((await api('/api/v2/pet/restart',{expectedPetId:claimed.id})).status,200);
 const adopted=await api('/api/v2/adopt',{breed:'capybara_toon',name:'卡卡'});assert.equal(adopted.status,200);const httpPet=adopted.data.pet;
 q.run('UPDATE pet_life SET natural_anchor_at=? WHERE pet_id=?',new Date(Date.now()-200*86400000).toISOString(),httpPet.id);
 const payload={expectedPetId:httpPet.id,expectedLevel:1,requestId:crypto.randomUUID()};
 const [a,b]=await Promise.all([api('/api/v2/pet/level-up',payload),api('/api/v2/pet/level-up',{...payload,requestId:crypto.randomUUID()})]);assert.deepEqual([a.status,b.status].sort(),[200,400]);
 const success=a.status===200?a:b;if(a.status===200)assert.equal((await api('/api/v2/pet/level-up',payload)).data.levelupEvent.id,success.data.levelupEvent.id);
 check((await api('/api/v2/student')).data.pet.progression.level===2,'真实HTTP并发只有一个升级成功，另一个因旧等级拒绝，无家长授权要求');
 const event=success.data.levelupEvent;await api(`/api/v2/pet/level-up/${event.id}/seen`,{});
 assert.equal((await api('/api/v2/student')).data.pet.growthMemories.find(e=>e.id===event.id).seen,true);
 for(let level=2;level<12;level++)assert.equal((await api('/api/v2/pet/level-up',{expectedPetId:httpPet.id,expectedLevel:level,requestId:crypto.randomUUID()})).status,200);
 const terminal=(await api('/api/v2/student')).data.pet;
 check(terminal.stage===6&&terminal.progression.terminal&&terminal.progression.nextName===null&&terminal.growthMemories.length===11,'11次手动升级完成十二阶，回忆持久化，老年进阶没有下一年龄');
 console.log(`${checks} progression business checks passed, including ${combinations} numerical cases.`);
} finally {
 if(server){const closed=new Promise(resolve=>server.once('exit',resolve));server.kill();await closed;}
 db.close();rmSync(dir,{recursive:true,force:true});
}
