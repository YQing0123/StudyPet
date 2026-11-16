/** Real HTTP identities, tenant boundaries and session lifecycle, disposable DB only. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {testActivationCode} from './fixtures/activation.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..'),dir=mkdtempSync(join(tmpdir(),'banxue-family-'));
const port='17729',base=`http://127.0.0.1:${port}`;
let server,checks=0;
function ok(value,label){assert.ok(value,label);checks++;console.log('✓ '+label);}
async function start(){server=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,PORT:port,BANXUE_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('exit',c=>reject(Error('server exited '+c)));server.stderr.on('data',d=>process.stderr.write(d));});}
async function stop(){if(!server||server.exitCode!==null||server.signalCode)return;const active=server;const done=new Promise(r=>active.once('exit',r));active.kill();await done;server=null;}
class Client {
 cookie='';scope={};
 async call(path,body,expect=200,method=body===undefined?'GET':'POST',extra={}){
  const res=await fetch(base+path,{method,headers:{'content-type':'application/json',cookie:this.cookie,...this.scope,...extra},body:body===undefined?undefined:JSON.stringify(body)});
  if(res.headers.has('set-cookie'))this.cookie=res.headers.get('set-cookie').split(';')[0];
  const data=await res.json();assert.equal(res.status,expect,`${path}: ${JSON.stringify(data)}`);return data;
 }
 use(s){this.scope={'x-family-id':s.family.id,'x-child-id':s.activeChildId};return s;}
}
const password='Test-Only-2026!',dad=new Client(),mom=new Client(),outsider=new Client(),student=new Client(),anon=new Client();
const register=(login,name)=>({activationCode:testActivationCode(dir),login,password,name,familyName:name+'的家',childName:name+'孩子'});
try{
 await start();
 await anon.call('/api/v2/student',undefined,401);await anon.call('/api/v2/parent',undefined,401);ok(true,'业务接口必须登录');
 const a=dad.use(await dad.call('/api/auth/register',register('family-dad','爸爸'))),aid=a.activeChildId;
 let s=await dad.call('/api/family/children',{name:'二宝',grade:4});const bid=s.children.find(c=>c.id!==aid).id;
 ok(s.children.length===2,'同一家庭支持多个孩子');
 await dad.call('/api/family/children/'+bid,{name:'二宝',grade:99},400);
 const inv=await dad.call('/api/family/invites',{});
 const m=mom.use(await mom.call('/api/auth/join',{...register('family-mom','妈妈'),code:inv.code,relation:'妈妈'}));
 ok(m.family.id===a.family.id&&m.members.filter(x=>x.role==='parent').length===2,'爸爸妈妈各自账号，同家庭同权');
 await anon.call('/api/auth/join',{...register('reused-invite','无效'),code:inv.code},400);
 await anon.call('/api/auth/login',{login:'reused-invite',password},401);ok(true,'邀请码一次性，无效邀请不创建账号');
 const b=outsider.use(await outsider.call('/api/auth/register',register('family-other','另一家庭')));
 await outsider.call('/api/v2/student',undefined,403,'GET',{'x-family-id':a.family.id,'x-child-id':aid});
 await dad.call('/api/v2/student',undefined,403,'GET',{'x-child-id':b.activeChildId});ok(true,'家庭与孩子请求头均验证归属');
 await dad.call('/api/family/children/'+aid+'/account',{login:'family-kid',password});
 const kid=student.use(await student.call('/api/auth/login',{login:'family-kid',password}));
 ok(kid.role==='student'&&kid.children.length===1,'学生账号只返回自己的孩子记录');
 await student.call('/api/v2/parent',undefined,403);await student.call('/api/v2/rules',{title:'越权'},403);
 await student.call('/api/auth/unlock',{password},403);await student.call('/api/family/invites',{},403);
 await student.call('/api/v2/student',undefined,403,'GET',{'x-child-id':bid});ok(true,'学生不能解锁家长、管理、邀请或访问兄弟姐妹');
 await dad.call('/api/v2/rules',{title:'家庭A专属',weekdays:[1,2,3,4,5,6,7],basePoints:9,reviewRequired:true});
 let state=await student.call('/api/v2/student');const task=state.tasks.find(t=>t.title==='家庭A专属');
 await outsider.call('/api/v2/tasks/'+task.id+'/submit',{},400);
 await outsider.call('/api/v2/tasks/'+task.id+'/review',{approve:true},400);
 await outsider.call('/api/v2/rules',{id:state.rules[0].id,title:'伪造修改',weekdays:[1,2,3,4,5,6,7]},400);
 ok((await student.call('/api/v2/student')).tasks.find(t=>t.id===task.id).status==='open','跨家庭资源 ID 不能读写或冒名修改');
 await student.call('/api/v2/tasks/'+task.id+'/submit',{note:'孩子提交'});
 const balance=(await student.call('/api/v2/student')).wallet.balance;
 const results=await Promise.allSettled([dad.call('/api/v2/tasks/'+task.id+'/review',{approve:true}),mom.call('/api/v2/tasks/'+task.id+'/review',{approve:true})]);
 ok(results.filter(r=>r.status==='fulfilled').length===1&&(await student.call('/api/v2/student')).wallet.balance===balance+9,'双家长同时审核只成功一次、只发一次星贝');
 dad.use(await dad.call('/api/auth/context',{familyId:a.family.id,childId:bid}));
 ok(!(await dad.call('/api/v2/student')).tasks.some(t=>t.id===task.id),'切换孩子后计划、钱包和任务隔离');
 dad.use(await dad.call('/api/auth/context',{familyId:a.family.id,childId:aid}));
 await dad.call('/api/auth/lock',{});await dad.call('/api/v2/points/gift',{amount:1},403);
 await dad.call('/api/auth/unlock',{password:'wrong-pass'},401);await dad.call('/api/auth/unlock',{password});ok(true,'家长学生视图上锁，须本人密码解锁管理');
 const revoked=await dad.call('/api/family/invites',{});await dad.call('/api/family/invites/'+revoked.id,{},200,'DELETE');
 await anon.call('/api/auth/join',{...register('revoked-invite','无效'),code:revoked.code},400);ok(true,'撤销邀请立即失效');
 const second=new Client();second.use(await second.call('/api/auth/login',{login:'family-dad',password}));
 await dad.call('/api/auth/password',{currentPassword:password,password:'Changed-Only-2026!'});
 await second.call('/api/v2/student',undefined,401);ok(true,'修改密码撤销其他设备会话');
 await stop();await start();ok((await dad.call('/api/auth/session')).authenticated,'服务重启后保留有效登录');
 await dad.call('/api/family/parents/'+m.user.id,{},200,'DELETE');await mom.call('/api/v2/student',undefined,401);ok(true,'移除家长立即撤销家庭访问与会话');
 await dad.call('/api/family/children/'+aid+'/account',{password:'Student-New-2026!'});await student.call('/api/v2/student',undefined,401);ok(true,'重设学生密码撤销学生旧会话');
 const crossInvite=await outsider.call('/api/family/invites',{});dad.use(await dad.call('/api/family/join',{code:crossInvite.code,relation:'爸爸'}));
 ok((await dad.call('/api/auth/session')).families.length===2,'一个家长账号可以加入多个家庭');
 dad.use(await dad.call('/api/auth/context',{familyId:a.family.id,childId:aid}));ok((await dad.call('/api/v2/student')).tasks.some(t=>t.id===task.id),'切回原家庭保留原记录');
 await dad.call('/api/v2/points/gift',{amount:3,reason:'有操作者的鼓励'});
 const db=new DatabaseSync(join(dir,'banxue.db'));
 ok(!!db.prepare("SELECT * FROM account_audit WHERE account_id=? AND action LIKE '%/review'").get(a.user.id)||!!db.prepare("SELECT * FROM account_audit WHERE account_id=? AND action LIKE '%/review'").get(m.user.id),'审核日志保留实际家长身份');
 const cred=db.prepare('SELECT password_hash FROM user_account WHERE id=?').get(a.user.id).password_hash;
 ok(cred.startsWith('scrypt:')&&!cred.includes('Changed-Only'),'密码加盐散列，数据库不存明文');
 ok(!JSON.stringify(await dad.call('/api/family')).includes('password_hash'),'身份响应不返回凭证散列');
 const invalid=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:'https://evil.example'},body:'{}'});ok(invalid.status===403,'拒绝其他站点跨域修改');
 const plain=await fetch(base+'/api/auth/login',{method:'POST',body:'{}'});ok(plain.status===415,'修改接口拒绝非 JSON 表单请求');
 await anon.call('/api/books',undefined,410);await anon.call('/mcp',{},410);ok(true,'停用不具备家庭隔离的原型接口');
 await dad.call('/api/auth/logout',{});await dad.call('/api/v2/student',undefined,401);ok(true,'退出后凭证立即失效');
 // A fresh local database with legacy records exercises explicit migration.
 db.prepare('DELETE FROM account_audit').run();db.close();await stop();
 const legacyDir=mkdtempSync(join(tmpdir(),'banxue-legacy-'));
 // Reuse schema only by backing up empty tables through an isolated fresh service.
 const legacyServer=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,PORT:'17730',BANXUE_DATA_DIR:legacyDir},stdio:['ignore','pipe','pipe']});
 await new Promise(r=>legacyServer.stdout.once('data',r));
 try{
  const legacyDb=new DatabaseSync(join(legacyDir,'banxue.db'));
  legacyDb.prepare('INSERT INTO child(id,name,avatar,grade,created_at) VALUES(?,?,?,?,?)').run('legacy-kid','原孩子','🌱',3,new Date().toISOString());
  const send=async body=>{const r=await fetch('http://127.0.0.1:17730/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return [r.status,await r.json()];};
  const form={...register('legacy-dad','原家长'),activationCode:testActivationCode(legacyDir),claimLegacy:true,legacyPin:'9999'};
  ok((await send(form))[0]===400,'关联原记录须验证原家长密码');
  const [status,claimed]=await send({...form,legacyPin:'1234'});
  ok(status===200&&claimed.activeChildId==='legacy-kid'&&claimed.children[0].name==='原孩子','首次注册保留原孩子 ID 和记录');
  ok(legacyDb.prepare('SELECT COUNT(*) AS n FROM child').get().n===1,'迁移不创建替代孩子或删除原孩子');legacyDb.close();
 }finally{const done=new Promise(r=>legacyServer.once('exit',r));legacyServer.kill();await done;rmSync(legacyDir,{recursive:true,force:true});}
 console.log(`${checks} family/account checks passed`);
}finally{if(server?.exitCode===null)await stop();rmSync(dir,{recursive:true,force:true});}
