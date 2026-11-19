/** Operator, invitation, expiry and public-host regression tests. Disposable SQLite only. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,scryptSync} from 'node:crypto';
import {request as httpRequest} from 'node:http';
const root=join(dirname(fileURLToPath(import.meta.url)),'..'),dir=mkdtempSync(join(tmpdir(),'banxue-subscriptions-'));
const port='17735',base=`http://127.0.0.1:${port}`,origin='https://island.example.test',password='Subscription-Only-2026!';
let server,checks=0,db;
const ok=(value,label)=>{assert.ok(value,label);checks++;console.log('✓ '+label);};
async function start(){
 server=spawn(process.execPath,['server/index.mjs','--static'],{cwd:root,env:{...process.env,PORT:port,NODE_ENV:'production',BANXUE_PUBLIC_ORIGIN:origin,BANXUE_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('exit',c=>reject(Error('server exited '+c)));server.stderr.on('data',d=>process.stderr.write(d));});
}
async function stop(){if(!server||server.exitCode!==null)return;const done=new Promise(r=>server.once('exit',r));server.kill();await done;server=null;}
class Client {
 cookie='';headers={};
 async call(path,body,status=200,method=body===undefined?'GET':'POST',headers={}){
  const r=await fetch(base+path,{method,headers:{origin,'content-type':'application/json',cookie:this.cookie,...this.headers,...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await r.json();assert.equal(r.status,status,`${method} ${path}: ${JSON.stringify(data)}`);
  if(r.headers.has('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];return data;
 }
 scope(s){this.headers={'x-family-id':s.family.id,'x-child-id':s.activeChildId};return s;}
}
async function provision(pass=password){
 const proc=spawn(process.execPath,['scripts/admin-account.mjs','operator'],{cwd:root,env:{...process.env,BANXUE_DATA_DIR:dir},stdio:['pipe','pipe','pipe']});
 let output='';proc.stdout.on('data',d=>output+=d);proc.stderr.on('data',d=>output+=d);proc.stdin.end(pass+'\n');
 const code=await new Promise(r=>proc.once('exit',r));assert.equal(code,0,output);assert.ok(!output.includes(pass));
}
const anon=new Client(),admin=new Client(),parent=new Client(),other=new Client(),student=new Client(),mom=new Client();
const form=(login,code)=>({login,password,name:login,familyName:login+'的家',childName:'孩子',activationCode:code});
const issue=(purpose='create',durationDays=30)=>admin.call('/api/admin/invites',{purpose,durationDays,redeemDays:7,planName:purpose==='create'?'家庭月度体验':'续期套餐'});
try{
 // Simulate an existing installation before the entitlement columns existed.
 db=new DatabaseSync(join(dir,'banxue.db'));
 db.exec('CREATE TABLE family(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL)');
 db.prepare('INSERT INTO family VALUES(?,?,?)').run('legacy-family','迁移家庭',new Date().toISOString());
 await start();await provision();
 await anon.call('/api/admin/invites',undefined,401);
 await anon.call('/api/admin/register',{login:'attacker',password},401);ok(true,'管理员不能通过公网注册，未登录不能管理邀请码');
 await admin.call('/api/admin/login',{login:'operator',password});ok(admin.cookie.startsWith('island_admin='),'本地创建独立管理员，使用独立会话');
 const legacy=(await admin.call('/api/admin/families')).items.find(f=>f.id==='legacy-family');
 ok(legacy.subscription.status==='lifetime'&&legacy.subscription.expiresAt===null,'旧数据库自动迁移，已有家庭保留不限期');
 await anon.call('/api/auth/register',form('without-code'),400);
 ok(!db.prepare('SELECT id FROM user_account WHERE login=?').get('without-code'),'开放注册已关闭，无开通码不创建账号');
 await admin.call('/api/admin/invites',{purpose:'create',durationDays:0,redeemDays:7,planName:'错误'},400);
 await admin.call('/api/admin/invites',{purpose:'create',durationDays:30,redeemDays:0,planName:'错误'},400);ok(true,'拒绝无效使用时长和兑换时长');
 const invite=await issue(),before=Date.now();
 const registration=await fetch(base+'/api/auth/register',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(form('family-one',invite.code))});
 assert.equal(registration.status,200);const s=await registration.json();parent.cookie=registration.headers.get('set-cookie').split(';')[0];parent.scope(s);
 ok(/HttpOnly/.test(registration.headers.get('set-cookie'))&&/Secure/.test(registration.headers.get('set-cookie'))&&/SameSite=Strict/.test(registration.headers.get('set-cookie')),'公网家庭会话具有 Secure、HttpOnly 和 SameSite 属性');
 ok(s.family.subscription.expiresAt>=before+30*86400000&&s.family.subscription.expiresAt<=Date.now()+30*86400000,'家庭使用天数从成功兑换时开始，由服务端计算');
 ok(s.family.subscription.status==='active'&&s.family.subscription.planName==='家庭月度体验','家庭快照返回套餐、期限、剩余天数和状态');
 const stored=db.prepare('SELECT * FROM activation_invite WHERE id=?').get(invite.id);
 ok(stored.used_family_id===s.family.id&&!JSON.stringify(stored).includes(invite.code)&&!JSON.stringify(await admin.call('/api/admin/invites')).includes(invite.code),'开通码兑换绑定家庭，完整码不落库、不在列表回显');
 await anon.call('/api/auth/register',form('code-reuse',invite.code),400);
 ok(!db.prepare('SELECT id FROM user_account WHERE login=?').get('code-reuse'),'已用开通码无法复用，失败不留下孤立账号');
 const failedCode=await issue();await anon.call('/api/auth/register',{...form('bad-child',failedCode.code),childName:''},400);
 ok(!db.prepare('SELECT used_at FROM activation_invite WHERE id=?').get(failedCode.id).used_at&&!db.prepare('SELECT id FROM user_account WHERE login=?').get('bad-child'),'注册失败整体回滚，不消耗开通码');
 const once=await issue();
 const race=await Promise.all(['race-one','race-two'].map(login=>fetch(base+'/api/auth/register',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(form(login,once.code))}).then(r=>r.status)));
 assert.deepEqual(race.sort(),[200,400]);
 ok(db.prepare("SELECT COUNT(*) n FROM user_account WHERE login IN ('race-one','race-two')").get().n===1,'并发兑换同一个开通码仅一个家庭成功');
 const revoked=await issue();await admin.call('/api/admin/invites/'+revoked.id,{},200,'DELETE');await anon.call('/api/auth/register',form('revoked-code',revoked.code),400);
 const expiredCode=await issue();db.prepare('UPDATE activation_invite SET redeem_by=? WHERE id=?').run(Date.now()-1,expiredCode.id);await anon.call('/api/auth/register',form('expired-code',expiredCode.code),400);ok(true,'撤销和超过兑换期限的开通码都不能使用');
 await parent.call('/api/admin/invites',{},401);await admin.call('/api/v2/parent',undefined,401);ok(true,'家长会话与平台管理员会话互相不能越权');
 const member=await parent.call('/api/family/invites',{});const m=mom.scope(await mom.call('/api/auth/join',{...form('family-mom'),code:member.code}));
 ok(m.family.subscription.expiresAt===s.family.subscription.expiresAt,'加入家长共用家庭期限，成员邀请不会延长期限');
 await anon.call('/api/auth/register',form('member-as-create',member.code),400);ok(true,'成员邀请码不能用于新建家庭');
 await parent.call('/api/family/children/'+s.activeChildId+'/account',{login:'family-student',password});student.scope(await student.call('/api/auth/login',{login:'family-student',password}));
 const renew=await issue('renew',10);await student.call('/api/family/renew',{code:renew.code},403);await anon.call('/api/auth/register',form('renew-as-create',renew.code),400);
 const extended=await parent.call('/api/family/renew',{code:renew.code});
 ok(extended.family.subscription.expiresAt===s.family.subscription.expiresAt+10*86400000,'未到期续期接在原有效期后，学生无权兑换，续期码不能建家');
 await parent.call('/api/family/renew',{code:renew.code},400);
 const creationOnly=await issue();await parent.call('/api/family/renew',{code:creationOnly.code},400);ok(true,'续期码一次性，开通码不能挪作续期');
 const f2=other.scope(await other.call('/api/auth/register',form('other-family',creationOnly.code)));
 await parent.call('/api/admin/families/'+f2.family.id+'/subscription',{expiresAt:0,planName:'越权',note:'不允许'},401);
 await parent.call('/api/family/renew',{code:(await issue('renew',1)).code,familyId:f2.family.id},403,'POST',{'x-family-id':f2.family.id,'x-child-id':f2.activeChildId});ok(true,'家长不能修改平台期限或给不属于自己的家庭续期');
 await admin.call(`/api/admin/families/${s.family.id}/subscription`,{expiresAt:Date.now()+3*86400000,planName:'临近到期',note:'验证七天内提醒'});
 ok((await parent.call('/api/auth/session')).family.subscription.status==='expiring','到期前七天进入提醒状态');
 const pendingInvite=await parent.call('/api/family/invites',{});
 const state=await parent.call('/api/v2/adopt',{breed:'alpaca_toon',name:'小岛伙伴'});const task=state.tasks[0];
 const delayedStatus=await new Promise((resolve,reject)=>{
  const request=httpRequest(base+'/api/v2/points/gift',{method:'POST',headers:{origin,'content-type':'application/json',cookie:parent.cookie,...parent.headers}},response=>{response.resume();response.once('end',()=>resolve(response.statusCode));});
  request.on('error',reject);request.write('{"amount":');
  setTimeout(()=>{db.prepare('UPDATE family SET expires_at=? WHERE id=?').run(Date.now()-1,s.family.id);request.end('1}');},100);
 });
 ok(delayedStatus===402,'请求体传输期间到期也会重新校验，不能用慢请求绕过期限');
 await admin.call(`/api/admin/families/${s.family.id}/subscription`,{expiresAt:Date.now()-1000,planName:'试用已结束',note:'验证到期限制'});
 const expired=(await parent.call('/api/auth/session')).family.subscription;
 ok(expired.status==='expired'&&expired.readOnly&&expired.daysRemaining===0,'管理员调整即时生效，已登录设备也变为到期只读');
 await parent.call('/api/v2/parent');await student.call('/api/v2/student');await parent.call('/api/family');ok(true,'到期仍可登录、查看家长后台和历史记录');
 const writes=[['/api/v2/rules',{title:'被拦截'}],['/api/v2/tasks/'+task.id+'/submit',{}],['/api/v2/tasks/'+task.id+'/review',{approve:true}],['/api/v2/points/gift',{amount:100}],['/api/v2/rewards',{}],['/api/v2/rewards/none/redeem',{}],['/api/shop/buy',{key:'kibble'}],['/api/pet/interact',{action:'pet'}],['/api/pet/use',{key:'kibble'}],['/api/v2/pet/level-up',{}],['/api/v2/reset',{}],['/api/v2/settings',{}],['/api/v2/notify/test',{}],['/api/v2/notes',{text:'已暂停'}],['/api/v2/pet/backups',{}],['/api/family/children',{name:'被拦截'}],['/api/family/invites',{}]];
 for(const [path,body] of writes)await parent.call(path,body,402);
 await student.call('/api/v2/tasks/'+task.id+'/submit',{},402);ok(true,`${writes.length} 类写操作及学生提交均由服务端阻断，不能直接调用接口绕过`);
 await anon.call('/api/auth/join',{...form('expired-join'),code:pendingInvite.code},402);ok(true,'旧成员邀请不能绕过到期限制');
 await parent.call('/api/auth/lock',{});await parent.call('/api/auth/unlock',{password});ok(true,'到期仍可锁定与解锁家长身份');
 await parent.call('/api/family/children/'+s.activeChildId+'/account',{password:'Student-Reset-2026!'});await student.call('/api/v2/student',undefined,401);ok(true,'到期仍可重设已有学生密码并撤销旧会话');
 await parent.call('/api/family/invites/'+pendingInvite.id,{},200,'DELETE');ok(true,'到期仍可撤销已发出的成员邀请');
 const taskCount=db.prepare('SELECT COUNT(*) n FROM v2_task WHERE child_id=?').get(s.activeChildId).n;
 await parent.call('/api/v2/student?date=2099-01-01');ok(db.prepare('SELECT COUNT(*) n FROM v2_task WHERE child_id=?').get(s.activeChildId).n===taskCount,'到期只读不会通过查询继续生成新任务');
 const resumed=await parent.call('/api/family/renew',{code:(await issue('renew',30)).code});
 ok(resumed.family.subscription.expiresAt>Date.now()+29.99*86400000&&!resumed.family.subscription.readOnly,'到期后的续期从当前时间计时，立即恢复权限');
 await parent.call('/api/v2/points/gift',{amount:1});ok(true,'续期后无需重新登录即可恢复业务写入');
 const legacySalt=randomBytes(16).toString('hex');
 db.prepare('UPDATE user_account SET password_hash=? WHERE id=?').run(`scrypt:${legacySalt}:${scryptSync(password,legacySalt,64).toString('hex')}`,s.user.id);
 await new Client().call('/api/auth/login',{login:'family-one',password});
 ok(db.prepare('SELECT password_hash FROM user_account WHERE id=?').get(s.user.id).password_hash.startsWith('scrypt:v2:'),'旧密码兼容登录并自动升级 scrypt 计算成本，无需重设密码');
 const persistentExpiry=resumed.family.subscription.expiresAt;await stop();await start();
 ok((await parent.call('/api/auth/session')).family.subscription.expiresAt===persistentExpiry&&(await admin.call('/api/admin/session')).authenticated,'家庭期限与家庭、管理员会话均能跨重启保留');
 const events=await admin.call(`/api/admin/families/${s.family.id}/subscription`);
 ok(events.some(e=>e.action==='family.activate')&&events.filter(e=>e.action==='family.renew').length===2&&events.some(e=>e.action==='admin.subscription.set'),'开通、续期、管理员调整均有审计记录');
 await admin.call(`/api/admin/families/${s.family.id}/subscription`,{expiresAt:null,planName:'永久家庭',note:'验证不限期'});
 ok((await parent.call('/api/auth/session')).family.subscription.status==='lifetime','管理员可显式设置不限期');
 const unusedRenew=await issue('renew',1);await parent.call('/api/family/renew',{code:unusedRenew.code},400);ok(!db.prepare('SELECT used_at FROM activation_invite WHERE id=?').get(unusedRenew.id).used_at,'不限期家庭不会误消耗续期码');
 await admin.call(`/api/admin/families/${s.family.id}/subscription`,{expiresAt:null,planName:'缺少原因'},400);ok(true,'调整期限必须填写原因');
 // Production source checks do not trust Host or forwarded headers.
 await anon.call('/api/auth/login',{},403,'POST',{origin:'https://evil.example'});
 await anon.call('/api/auth/login',{},403,'POST',{origin:base});
 await anon.call('/api/auth/login',{},403,'POST',{origin:'',referer:'https://evil.example/'});
 await anon.call('/api/auth/login',{},403,'POST',{'sec-fetch-site':'cross-site'});ok(true,'公网模式只信任配置的 HTTPS 来源，拒绝 Host 回退和跨站请求');
 await anon.call('/api/auth/login',{},400,'POST',{origin:'http://127.0.0.1:7788',referer:origin+'/','sec-fetch-site':'same-origin'});
 ok(true,'NAS改写Origin后，仅精确公网Referer和浏览器same-origin元数据共同允许请求');
 for(const headers of [
  {origin:base,referer:origin+'/'},
  {origin:base,referer:origin+'/','sec-fetch-site':'same-site'},
  {origin:base,referer:'https://evil.example/','sec-fetch-site':'same-origin'},
  {origin:'null',referer:origin+'/','sec-fetch-site':'same-origin'},
  {origin:base,referer:origin+'/','sec-fetch-site':'cross-site'},
 ]) await anon.call('/api/auth/login',{},403,'POST',headers);
 ok(true,'单独Referer、同站不同源、恶意来源和不透明来源均不能绕过来源限制');
 const external=await fetch(base+'/api/notify-images/invalid',{headers:{origin:'https://external.example','sec-fetch-site':'cross-site'}});
 ok(external.status===404,'外部推送图片保留受随机令牌保护的读取入口，跨站来源不覆盖其失效检查');
 await anon.call('/api/auth/login',{},415,'POST',{'content-type':'application/json-bypass'});
 const large=await fetch(base+'/api/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({value:'x'.repeat(270000)})});ok(large.status===413,'敏感 JSON 接口拒绝超大请求体');
 const malformed=await fetch(base+'/api/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:'null'});ok(malformed.status===400,'拒绝空值、数组和无效 JSON 结构');
 const headers=await fetch(base+'/api/health');
 ok(headers.headers.get('x-content-type-options')==='nosniff'&&headers.headers.get('x-frame-options')==='DENY'&&headers.headers.get('content-security-policy').includes("frame-ancestors 'none'")&&headers.headers.get('strict-transport-security').includes('31536000'),'所有响应带防嗅探、防嵌入、CSP 与公网 HSTS 响应头');
 for(let i=0;i<8;i++)await anon.call('/api/admin/login',{login:'wrong-operator',password},401);
 await anon.call('/api/admin/login',{login:'wrong-operator',password},429);ok(true,'管理员登录失败受到持久化尝试次数限制');
 await provision('Changed-Admin-2026!');await admin.call('/api/admin/invites',undefined,401);ok(true,'本地重设管理员密码立即撤销旧管理会话');
 await admin.call('/api/admin/login',{login:'operator',password:'Changed-Admin-2026!'});await admin.call('/api/admin/logout',{});await admin.call('/api/admin/invites',undefined,401);ok(true,'退出管理台立即撤销管理权限');
 console.log(`${checks} subscription/security checks passed`);
}finally{await stop();db?.close();rmSync(dir,{recursive:true,force:true});}
