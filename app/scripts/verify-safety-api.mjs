/** Family permissions and notification event integration in an isolated service. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root=join(dirname(fileURLToPath(import.meta.url)),'..'),dir=mkdtempSync(join(tmpdir(),'banxue-safety-api-')),base='http://127.0.0.1:17732';
let server,checks=0;const ok=(c,label)=>{assert.ok(c,label);checks++;console.log('✓ '+label);};
class Client{cookie='';scope={};async call(path,body,expect=200,method=body===undefined?'GET':'POST'){
 const r=await fetch(base+path,{method,headers:{'content-type':'application/json',cookie:this.cookie,...this.scope},body:body===undefined?undefined:JSON.stringify(body)});
 if(r.headers.has('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];const d=await r.json();assert.equal(r.status,expect,path+': '+JSON.stringify(d));return d;
 }use(s){this.scope={'x-family-id':s.family.id,'x-child-id':s.activeChildId};return s;}}
const dad=new Client(),mom=new Client(),kid=new Client(),other=new Client(),password='Safety-Only-2026!';
const form=(login,name)=>({login,password,name,familyName:name+'家',childName:'验收孩子'});
const waitLogs=async n=>{for(let i=0;i<40;i++){const logs=(await dad.call('/api/v2/notify/logs')).items;if(logs.length>=n&&logs.every(l=>l.status!=='sending'))return logs;await new Promise(r=>setTimeout(r,20));}throw Error('日志等待超时');};
try{
 server=spawn(process.execPath,['--import','./scripts/fixtures/notify-fetch.mjs','server/index.mjs'],{cwd:root,env:{...process.env,PORT:'17732',BANXUE_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('exit',c=>reject(Error('server exit '+c)));server.stderr.on('data',d=>process.stderr.write(d));});
 const session=dad.use(await dad.call('/api/auth/register',form('safety-dad','验收爸爸')));
 const invite=await dad.call('/api/family/invites',{});mom.use(await mom.call('/api/auth/join',{...form('safety-mom','验收妈妈'),code:invite.code,relation:'妈妈'}));other.use(await other.call('/api/auth/register',form('safety-other','其他家庭')));
 await dad.call('/api/family/children/'+session.activeChildId+'/account',{login:'safety-kid',password});kid.use(await kid.call('/api/auth/login',{login:'safety-kid',password}));
 const settings={notifyChannels:[{provider:'wecom',enabled:true,target:'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=dummy_wecom'},{provider:'dingtalk',enabled:true,target:'https://oapi.dingtalk.com/robot/send?access_token=dummy_dingtalk',secret:'SECdummySigningSecret20261114'},{provider:'pushplus',enabled:true,target:'dummy_pushplus'}]};
 const state=await dad.call('/api/v2/settings',settings);
 ok(state.settings.notifyChannels.every(c=>c.enabled)&&!JSON.stringify(state).includes('dummy_'),'配置接口支持并行通道且不返回凭据');
 ok((await mom.call('/api/v2/parent')).settings.notifyChannels.every(c=>c.enabled),'同家庭另一位家长可以查看并共同管理配置');
 ok(state.settings.notifyEvents.submission&&state.settings.notifyEvents.completed&&state.settings.notifyEvents.resubmission&&!state.settings.notifyEvents.approved&&!state.settings.notifyEvents.daily_summary&&state.settings.notifySummaryTime==='20:30','配置接口返回默认场景开关与北京时间');
 await kid.call('/api/v2/settings',{notifyEvents:{daily_summary:true},notifySummaryTime:'00:00'},403);
 await dad.call('/api/v2/settings',{notifyEvents:{approved:'false'}},400);
 await dad.call('/api/v2/settings',{notifySummaryTime:'25:00'},400);
 await mom.call('/api/v2/settings',{notifySummaryTime:'21:20'});
 ok((await dad.call('/api/v2/parent')).settings.notifySummaryTime==='21:20'&&(await other.call('/api/v2/parent')).settings.notifySummaryTime==='20:30','同家庭家长共同管理时间，学生不能修改，其他家庭不受影响');
 await kid.call('/api/v2/settings',settings,403);await kid.call('/api/v2/notify/logs',undefined,403);await kid.call('/api/v2/notify/test',{},403);ok(true,'学生无权读取日志、修改配置或发送测试');
 ok(!(await other.call('/api/v2/parent')).settings.notifyChannels.some(c=>c.enabled),'其他家庭看不到推送配置');
 let s=await dad.call('/api/v2/adopt',{breed:'dog_corgi_toon',name:'豆包'}),petId=s.pet.id;
 const b=await dad.call('/api/v2/pet/backups',{expectedPetId:petId});
 await kid.call('/api/v2/pet/backups',undefined,403);await kid.call('/api/v2/pet/restart',{expectedPetId:petId},403);await kid.call('/api/v2/pet/backups/'+b.id+'/restore',{expectedPetId:petId},403);
 await other.call('/api/v2/pet/backups/'+b.id+'/restore',{expectedPetId:null},400);ok(true,'学生和其他家庭无法操作当前孩子的备份');
 const task=s.tasks.find(t=>t.reviewRequired);await kid.call('/api/v2/tasks/'+task.id+'/submit',{note:'已完成'});
 let logs=await waitLogs(3);ok(logs.length===3&&logs.every(l=>l.event==='submission'&&l.status==='success'),'学生真实提交事件分发给全部三个通道并写日志');
 await mom.call('/api/v2/settings',{notifyChannels:[{provider:'wecom',enabled:false}],notifyEvents:{approved:true}});
 await dad.call('/api/v2/tasks/'+task.id+'/review',{approve:true});logs=await waitLogs(5);
 ok(logs.filter(l=>l.event==='approved').length===2&&!logs.some(l=>l.event==='approved'&&l.provider==='wecom'),'开启审核通过场景且关闭企业微信后，仅发送到另两个通道');
 await dad.call('/api/v2/settings',{notifyChannels:[{provider:'dingtalk',target:'https://oapi.dingtalk.com/robot/send?access_token=dummy_fail'}]});
 const result=await dad.call('/api/v2/notify/test',{});ok(!result.ok&&result.results.some(r=>r.ok)&&result.results.some(r=>!r.ok),'全部通道测试分别返回成功与失败，不相互阻断');
 const failed=await dad.call('/api/v2/notify/logs?status=failed');ok(failed.items.length===1&&failed.items[0].httpStatus===200,'日志筛选与 HTTP 200 业务失败结果一致');
 const before=await dad.call('/api/v2/student');
 await dad.call('/api/v2/pet/breed',{breed:'cat_orange',expectedPetId:petId});
 await dad.call('/api/v2/pet/restart',{expectedPetId:petId});
 const after=await dad.call('/api/v2/student');
 ok(!after.pet&&after.wallet.balance===before.wallet.balance&&after.tasks.length===before.tasks.length,'API重养仅清宠物，余额和计划任务保留');
 await dad.call('/api/v2/pet/backups/'+b.id+'/restore',{expectedPetId:null});s=await dad.call('/api/v2/student');
 ok(s.pet.breed==='dog_corgi_toon'&&s.wallet.balance===before.wallet.balance,'无宠物时可通过备份恢复，已发学习奖励仍在');
 const count=(await dad.call('/api/v2/pet/backups')).items.length;
 await dad.call('/api/v2/pet/restart',{expectedPetId:'old-id'},400);ok((await dad.call('/api/v2/pet/backups')).items.length===count,'过期操作被拒绝，不生成误导性备份');
 await dad.call('/api/auth/lock',{});await dad.call('/api/v2/pet/backups',undefined,403);await dad.call('/api/v2/notify/logs',undefined,403);ok(true,'家长端锁定后不能读取备份和发送日志');
 console.log(`${checks} safety API checks passed`);
}finally{if(server?.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill();await done;}rmSync(dir,{recursive:true,force:true});}
