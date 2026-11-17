import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {join} from 'node:path';import {testActivationCode} from './fixtures/activation.mjs';
const base=process.env.BASE,dir=process.env.BANXUE_TEST_DB;if(!base||!dir)throw Error('游玩验收只能使用隔离服务');
class Client{cookie='';scope={};async call(path,body,status=200){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',cookie:this.cookie,...this.scope},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();assert.equal(r.status,status,`${path}: ${JSON.stringify(d)}`);if(r.headers.has('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];return d;}use(s){this.scope={'x-family-id':s.family.id,'x-child-id':s.activeChildId};return s;}}
const dad=new Client(),kid=new Client(),other=new Client();const suffix=Date.now(),password='Playtime-Only-2026!';let checks=0;const ok=(v,s)=>{assert.ok(v,s);checks++;console.log('✓ '+s);};
const form=login=>({activationCode:testActivationCode(dir),login:login+suffix,password,name:'计时验收',familyName:'隔离验收',childName:'测试孩子'});
const db=new DatabaseSync(join(dir,'banxue.db'));db.exec('PRAGMA busy_timeout=5000');
try{
 const s=dad.use(await dad.call('/api/auth/register',form('time-dad'))),id=s.activeChildId;other.use(await other.call('/api/auth/register',form('time-other')));
 await dad.call(`/api/family/children/${id}/account`,{login:'time-student'+suffix,password});kid.use(await kid.call('/api/auth/login',{login:'time-student'+suffix,password}));
 const settings={enabled:true,dailyMinutes:1,idleMinutes:1,pin:'123456'};await kid.call('/api/v2/playtime/settings',undefined,403);await kid.call('/api/v2/playtime/settings',settings,403);ok(true,'学生不能读取配置或更改家长限时');
 let state=await dad.call('/api/v2/playtime/settings',settings);ok(state.pinSet&&state.enabled&&!JSON.stringify(state).includes('hash')&&!JSON.stringify(state).includes('123456'),'家长配置成功且所有接口隐藏密码');
 ok(!(await other.call('/api/v2/playtime')).enabled,'家庭之间设置隔离');
 const hb={clientId:crypto.randomUUID(),active:true,interacted:true};await kid.call('/api/v2/playtime/heartbeat',hb);await kid.call('/api/v2/playtime/heartbeat',{...hb,active:'true'},400);
 const date=(await kid.call('/api/v2/playtime')).date;db.prepare('UPDATE playtime_usage SET used_ms=60000 WHERE child_id=? AND date=?').run(id,date);
 state=await kid.call('/api/v2/playtime');ok(state.locked&&state.remainingSeconds===0,'服务端用时耗尽进入锁定');
 for(const path of ['/api/pet/interact','/api/v2/adopt','/api/v2/challenges/rounds','/api/shop/buy'])await kid.call(path,{},423);
 await kid.call('/api/v2/student');await kid.call('/api/v2/ledger');ok(true,'锁定后拒绝互动、领养、挑战、购买，同时保留屏保所需只读统计');
 await kid.call('/api/v2/playtime/unlock',{pin:'654321',requestId:crypto.randomUUID()},400);const requestId=crypto.randomUUID();state=await kid.call('/api/v2/playtime/unlock',{pin:'123456',requestId});ok(!state.locked&&state.bonusSeconds===900,'学生页面使用正确家长密码可延长时间');state=await kid.call('/api/v2/playtime/unlock',{pin:'123456',requestId});ok(state.bonusSeconds===900,'网络重试不重复追加游玩额度');
 await dad.call('/api/v2/playtime/settings',{enabled:false,dailyMinutes:1,idleMinutes:5});ok(!(await kid.call('/api/v2/playtime')).locked,'家长可关闭限时且保留屏保设置');
 console.log(`${checks} playtime HTTP checks passed`);
}finally{db.close();}
