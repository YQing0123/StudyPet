/** Daily-note permission, tenant, persistence and date regression; disposable DB only. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const root=join(dirname(fileURLToPath(import.meta.url)),'..'),dir=mkdtempSync(join(tmpdir(),'banxue-notes-')),base='http://127.0.0.1:17731';
let server,checks=0;
function ok(v,label){assert.ok(v,label);checks++;console.log('✓ '+label);}
async function start(){server=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,PORT:'17731',BANXUE_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('exit',c=>reject(Error('exit '+c)));server.stderr.on('data',d=>process.stderr.write(d));});}
async function stop(){if(!server||server.exitCode!==null||server.signalCode)return;const done=new Promise(r=>server.once('exit',r));server.kill();await done;server=null;}
class Client{cookie='';scope={};async call(path,body,expect=200,method=body===undefined?'GET':'POST'){const r=await fetch(base+path,{method,headers:{'content-type':'application/json',cookie:this.cookie,...this.scope},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.has('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];const data=await r.json();assert.equal(r.status,expect,path+': '+JSON.stringify(data));return data;}use(s){this.scope={'x-family-id':s.family.id,'x-child-id':s.activeChildId};return s;}}
const dad=new Client(),mom=new Client(),other=new Client(),kid=new Client(),anon=new Client(),password='Notes-Only-2026!';
const form=(login,name)=>({login,password,name,familyName:name+'家',childName:'小米'});
try{
 await start();await anon.call('/api/v2/notes',{text:'未登录'},401);ok(true,'写入必须登录');
 const a=dad.use(await dad.call('/api/auth/register',form('notes-dad','小米爸爸')));
 const invitation=await dad.call('/api/family/invites',{});
 mom.use(await mom.call('/api/auth/join',{...form('notes-mom','小米妈妈'),code:invitation.code,relation:'妈妈'}));
 other.use(await other.call('/api/auth/register',form('notes-other','另一个家庭')));
 await dad.call('/api/v2/notes',{text:'   '},400);await dad.call('/api/v2/notes',{text:'字'.repeat(81)},400);ok(true,'空内容与超过80字拒绝保存');
 let notes=await dad.call('/api/v2/notes',{text:'  阅读后一起聊故事。  ',senderName:'伪造妈妈',date:'2099-01-01',senderId:'fake'});const id=notes[0].id;
 ok(notes[0].senderName==='小米爸爸'&&notes[0].senderId===a.user.id&&notes[0].text==='阅读后一起聊故事。'&&notes[0].date!=='2099-01-01','服务器身份与日期不可伪造');
 notes=await dad.call('/api/v2/notes',{text:'更新鼓励的话'});ok(notes.length===1&&notes[0].id===id&&notes[0].text==='更新鼓励的话','当天更新原纸条，无重复');
 notes=await mom.call('/api/v2/notes',{text:'🧡'.repeat(80)});ok(notes.length===2&&notes.some(n=>n.senderName==='小米妈妈'),'双家长独立发送，支持80个Unicode字符');
 await dad.call('/api/family/children/'+a.activeChildId+'/account',{login:'notes-kid',password});kid.use(await kid.call('/api/auth/login',{login:'notes-kid',password}));
 ok((await kid.call('/api/v2/student')).dailyNotes.length===2,'学生读到自己的当天纸条');
 await kid.call('/api/v2/notes',{text:'学生越权'},403);await kid.call('/api/v2/notes/'+id,undefined,403,'DELETE');ok(true,'学生不能发送或撤回');
 await dad.call('/api/auth/lock',{});await dad.call('/api/v2/notes',{text:'未解锁'},403);await dad.call('/api/v2/notes/'+id,undefined,403,'DELETE');await dad.call('/api/auth/unlock',{password});ok(true,'锁定家长不能管理纸条');
 ok((await other.call('/api/v2/student')).dailyNotes.length===0,'跨家庭读隔离');await other.call('/api/v2/notes/'+id,undefined,400,'DELETE');ok(true,'跨家庭按ID撤回被拒绝');
 const family=await dad.call('/api/family/children',{name:'二宝',grade:2}),bid=family.children.find(c=>c.id!==a.activeChildId).id;
 dad.use(await dad.call('/api/auth/context',{familyId:a.family.id,childId:bid}));ok((await dad.call('/api/v2/parent')).dailyNotes.length===0,'同家庭不同孩子隔离');await dad.call('/api/v2/notes/'+id,undefined,400,'DELETE');
 dad.use(await dad.call('/api/auth/context',{familyId:a.family.id,childId:a.activeChildId}));await stop();await start();ok((await kid.call('/api/v2/student')).dailyNotes.length===2,'服务重启后会话和纸条保留');
 const db=new DatabaseSync(join(dir,'banxue.db'));db.prepare('UPDATE daily_note SET date=? WHERE id=?').run('2020-01-01',id);db.close();
 ok((await kid.call('/api/v2/student')).dailyNotes.length===1,'历史纸条不混入今天');ok((await kid.call('/api/v2/student?date=2020-01-01')).dailyNotes[0].id===id,'历史读取对应日期');
 notes=await dad.call('/api/v2/notes',{text:'今天新的鼓励'});const todayDad=notes.find(n=>n.senderId===a.user.id);notes=await mom.call('/api/v2/notes/'+todayDad.id,undefined,200,'DELETE');ok(notes.length===1&&(await kid.call('/api/v2/student')).dailyNotes.length===1,'同权家长撤回后学生读取生效');
 console.log(`${checks} daily-note checks passed`);
}finally{await stop();rmSync(dir,{recursive:true,force:true});}
