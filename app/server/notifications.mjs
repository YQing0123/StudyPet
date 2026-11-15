/** Per-child independent notification channels. Credentials never leave the server. */
import { createHmac } from 'node:crypto';
import { q, db, uid, tx } from './db.mjs';
import { submissionContent } from './notification-cards.mjs';

export const PROVIDERS = ['wecom', 'dingtalk', 'pushplus'];
export const DEFAULT_EVENTS = Object.freeze({ submission: true, completed: true, approved: false, batch_approved: false, rejected: false, resubmission: true, daily_summary: false });
export function notificationEvents(childId) {
 const saved=Object.fromEntries(q.all("SELECT key,value FROM family_setting WHERE child_id=? AND key LIKE 'notify_event_%'",childId).map(r=>[r.key,r.value]));
 return Object.fromEntries(Object.entries(DEFAULT_EVENTS).map(([event,fallback])=>[event,saved[`notify_event_${event}`]===undefined?fallback:saved[`notify_event_${event}`]==='1']));
}
export function summaryTime(childId) {
 const value=q.get("SELECT value FROM family_setting WHERE child_id=? AND key='notify_summary_time'",childId)?.value;
 return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value||'')?value:'20:30';
}
export function saveNotificationPreferences(childId, { events, time } = {}) {
 if(events!==undefined&&(!events||typeof events!=='object'||Array.isArray(events)))throw Error('推送场景配置格式不正确');
 const updates=Object.entries(events||{});
 if(updates.some(([event,value])=>!Object.hasOwn(DEFAULT_EVENTS,event)||typeof value!=='boolean'))throw Error('推送场景或开关值不正确');
 if(time!==undefined&&(typeof time!=='string'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)))throw Error('请填写有效的推送时间（00:00–23:59）');
 tx(()=>{
  for(const [event,value] of updates)q.run('INSERT INTO family_setting VALUES(?,?,?) ON CONFLICT(child_id,key) DO UPDATE SET value=excluded.value',childId,`notify_event_${event}`,value?'1':'0');
  if(time!==undefined)q.run("INSERT INTO family_setting VALUES(?,'notify_summary_time',?) ON CONFLICT(child_id,key) DO UPDATE SET value=excluded.value",childId,time);
 });
}
db.exec(`
CREATE TABLE IF NOT EXISTS notify_channel (
 child_id TEXT NOT NULL, provider TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
 target TEXT NOT NULL DEFAULT '', secret TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
 PRIMARY KEY(child_id,provider)
);
CREATE TABLE IF NOT EXISTS notify_log (
 id TEXT PRIMARY KEY, child_id TEXT NOT NULL, provider TEXT NOT NULL, event TEXT NOT NULL,
 content TEXT NOT NULL, status TEXT NOT NULL, http_status INTEGER, provider_code TEXT,
 error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notify_log_child ON notify_log(child_id,created_at DESC,id DESC);
`);
// One-time lazy compatibility migration. A saved channel always wins over old settings.
function migrate(childId) {
 const legacy=Object.fromEntries(q.all('SELECT key,value FROM family_setting WHERE child_id=?',childId).map(r=>[r.key,r.value]));
 const provider=legacy.notify_provider || 'wecom';
 if (PROVIDERS.includes(provider) && legacy.notify_target) {
  let target='';try{target=validatedTarget(provider,legacy.notify_target);}catch{}
  const enabled=!!target && provider!=='dingtalk' && legacy.notify_enabled==='1';
  q.run(`INSERT OR IGNORE INTO notify_channel(child_id,provider,enabled,target,secret,updated_at) VALUES(?,?,?,?,?,?)`,childId,provider,enabled?1:0,target,'',new Date().toISOString());
 }
}
function configs(childId) {
 migrate(childId);
 return PROVIDERS.map(provider=>q.get('SELECT * FROM notify_channel WHERE child_id=? AND provider=?',childId,provider)||{provider,enabled:0,target:'',secret:''});
}
export function notificationChannels(childId) {
 return configs(childId).map(c=>({provider:c.provider,enabled:!!c.enabled,targetConfigured:!!c.target,secretConfigured:!!c.secret,
  maskedTarget:c.target ? c.provider==='pushplus' ? 'Token 已保存' : `${c.provider==='dingtalk'?'钉钉':'企业微信'} Webhook 已保存` : ''}));
}
export function notificationsEnabled(childId) { return configs(childId).some(c=>c.enabled && c.target); }
function validatedTarget(provider,raw) {
 const target=String(raw ?? '').trim();
 if (!target) return '';
 if (target.length>2048) throw Error('推送地址或 Token 过长');
 if(provider==='pushplus') {
  if(!/^[A-Za-z0-9_-]{8,256}$/.test(target))throw Error('PushPlus Token 格式不正确');
  return target;
 }
 let url;try{url=new URL(target);}catch{throw Error('请输入完整的 HTTPS Webhook 地址');}
 const host=provider==='dingtalk'?'oapi.dingtalk.com':'qyapi.weixin.qq.com';
 const pathname=provider==='dingtalk'?'/robot/send':'/cgi-bin/webhook/send';
 const key=provider==='dingtalk'?'access_token':'key';
 if(url.protocol!=='https:'||url.hostname!==host||url.pathname!==pathname||url.port||url.username||url.password||!url.searchParams.get(key))throw Error(`请填写${provider==='dingtalk'?'钉钉':'企业微信'}官方完整 Webhook 地址`);
 // Persist the endpoint token only; timestamp/sign are generated fresh for every send.
 return `https://${host}${pathname}?${new URLSearchParams({[key]:url.searchParams.get(key)})}`;
}
export function saveNotificationChannels(childId, updates) {
 if(!Array.isArray(updates)||updates.length>3)throw Error('推送配置格式不正确');
 const existing=configs(childId),seen=new Set();
 const next=updates.map(update=>{
  if(!update||!PROVIDERS.includes(update.provider)||seen.has(update.provider))throw Error('推送通道不正确或重复');
  seen.add(update.provider);
  const old=existing.find(c=>c.provider===update.provider);
  const target=validatedTarget(update.provider,update.target===undefined?old.target:update.target);
  const secret=update.clearSecret===true?'':update.secret===undefined||update.secret===''?old.secret:String(update.secret).trim();
  if(update.provider==='dingtalk'&&secret&&!/^SEC[A-Za-z0-9]{8,252}$/.test(secret))throw Error('钉钉加签密钥应为机器人安全设置中以 SEC 开头的密钥');
  const enabled=update.enabled===undefined?!!old.enabled:update.enabled===true;
  if(enabled&&!target)throw Error('请先填写该通道的 Webhook 地址或 Token');
  if(enabled&&update.provider==='dingtalk'&&!secret)throw Error('请先填写钉钉机器人的加签密钥');
  return {provider:update.provider,enabled,target,secret:update.provider==='dingtalk'?secret:''};
 });
 tx(()=>{for(const c of next)q.run(`INSERT INTO notify_channel VALUES(?,?,?,?,?,?) ON CONFLICT(child_id,provider) DO UPDATE SET enabled=excluded.enabled,target=excluded.target,secret=excluded.secret,updated_at=excluded.updated_at`,childId,c.provider,c.enabled?1:0,c.target,c.secret,new Date().toISOString());});
 return notificationChannels(childId);
}
export function signedDingTalkUrl(target,secret,timestamp=Date.now()) {
 const url=new URL(target),stamp=String(timestamp);
 const sign=createHmac('sha256',secret).update(`${stamp}\n${secret}`,'utf8').digest('base64');
 url.searchParams.set('timestamp',stamp);url.searchParams.set('sign',sign);
 return url.toString();
}
function cleanError(raw,cfg) {
 let text=String(raw||'发送失败');
 const sensitive=[cfg.target,cfg.secret];
 try{for(const value of new URL(cfg.target).searchParams.values())sensitive.push(value);}catch{}
 for(const value of sensitive.filter(Boolean))text=text.split(value).join('[已隐藏]');
 return text.replace(/https?:\/\/[^\s]+/g,'[服务地址已隐藏]').slice(0,400);
}
function errorHint(provider,code,message) {
 if(provider==='dingtalk' && /sign|timestamp|310000/i.test(`${code} ${message}`))return `钉钉安全校验失败，请检查加签密钥、机器人安全设置和服务器时间。${message?`（${message}）`:''}`;
 return message || '推送服务返回失败';
}
export async function sendNotification(childId,text,{provider,event='notification',fetchImpl=fetch,timeoutMs=10000,submission}={}) {
 if(provider&&!PROVIDERS.includes(provider))throw Error('未知推送通道');
 if(Object.hasOwn(DEFAULT_EVENTS,event)&&!notificationEvents(childId)[event])return {ok:true,skipped:true,results:[]};
 const all=configs(childId),selected=all.filter(c=>(!provider||c.provider===provider)&&c.enabled&&c.target);
 if(!selected.length)return {ok:false,skipped:true,error:'没有已开启且配置完整的推送通道',results:[]};
 const child=q.get('SELECT name FROM child WHERE id=?',childId);
 const content=`${child?.name?`【${child.name}】`:''}${text}`.slice(0,4000);
 const results=await Promise.all(selected.map(async cfg=>{
  const id=uid(),created=new Date().toISOString();
  q.run('INSERT INTO notify_log(id,child_id,provider,event,content,status,created_at) VALUES(?,?,?,?,?,?,?)',id,childId,cfg.provider,event,content,'sending',created);
  let result;
  try {
   if(cfg.provider==='dingtalk'&&!cfg.secret)throw Error('尚未配置钉钉加签密钥，请在家长端保存密钥后重试');
   const target=validatedTarget(cfg.provider,cfg.target);
   const card=cfg.provider==='dingtalk'&&submission?submissionContent(childId,submission):null;
   if(card)q.run('UPDATE notify_log SET content=? WHERE id=?',card.summary.slice(0,4000),id);
   const url=cfg.provider==='pushplus'?'https://www.pushplus.plus/send':cfg.provider==='dingtalk'?signedDingTalkUrl(target,cfg.secret):target;
   const payload=cfg.provider==='pushplus'?{token:cfg.target,title:'伴学小岛',content,template:'txt'}:cfg.provider==='dingtalk'&&card?card.payload:{msgtype:'text',text:{content}};
   const res=await fetchImpl(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
   let body;try{body=await res.json();}catch{body=null;}
   const code=cfg.provider==='pushplus'?body?.code:body?.errcode;
   const ok=res.ok&&code===(cfg.provider==='pushplus'?200:0);
   const message=body?.errmsg||body?.msg||body?.message;
   result={ok,status:res.status,code:code===undefined?null:cleanError(String(code),cfg),error:ok?'':cleanError(!res.ok?`HTTP ${res.status}：${message||'服务请求失败'}`:body?errorHint(cfg.provider,code,message):'推送服务未返回有效 JSON 结果',cfg)};
  }catch(e){result={ok:false,error:cleanError(e.name==='TimeoutError'||e.name==='AbortError'?'请求超时，无法确认群消息是否送达，请查看群消息后再测试。':e.message,cfg)};}
  q.run('UPDATE notify_log SET status=?,http_status=?,provider_code=?,error=?,completed_at=? WHERE id=?',result.ok?'success':'failed',result.status??null,result.code??null,result.error||'',new Date().toISOString(),id);
  return {provider:cfg.provider,id,...result};
 }));
 return {ok:results.every(r=>r.ok),results,error:results.filter(r=>!r.ok).map(r=>`${{wecom:'企业微信',dingtalk:'钉钉',pushplus:'PushPlus'}[r.provider]}：${r.error}`).join('；')||undefined};
}
export function notificationLogs(childId,{status='',before=''}={}) {
 if(status&&!['success','failed','sending'].includes(status))throw Error('日志状态不正确');
 let clauses='child_id=?',args=[childId];
 if(status){clauses+=' AND status=?';args.push(status);}
 if(before){const cursor=q.get('SELECT created_at,id FROM notify_log WHERE child_id=? AND id=?',childId,before);if(!cursor)throw Error('日志游标无效');clauses+=' AND (created_at<? OR (created_at=? AND id<?))';args.push(cursor.created_at,cursor.created_at,cursor.id);}
 // A terminated process may leave an in-flight log. Never claim delivery succeeded.
 q.run("UPDATE notify_log SET status='failed',error='发送未完成或服务已重启，无法确认是否送达，请先查看群消息。',completed_at=? WHERE child_id=? AND status='sending' AND created_at<?",new Date().toISOString(),childId,new Date(Date.now()-120000).toISOString());
 const rows=q.all(`SELECT id,provider,event,content,status,http_status AS httpStatus,provider_code AS providerCode,error,created_at AS createdAt,completed_at AS completedAt FROM notify_log WHERE ${clauses} ORDER BY created_at DESC,id DESC LIMIT 21`,...args);
 return {items:rows.slice(0,20),next:rows.length>20?rows[19].id:null};
}
