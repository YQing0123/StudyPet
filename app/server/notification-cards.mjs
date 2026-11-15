/** Existing Webhook cards and bounded photo access; no review authority in message URLs. */
import { randomBytes, createHash } from 'node:crypto';
import { db, q } from './db.mjs';

db.exec(`CREATE TABLE IF NOT EXISTS notify_photo (
 token_hash TEXT PRIMARY KEY, child_id TEXT NOT NULL, task_id TEXT NOT NULL,
 submitted_at TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notify_photo_expiry ON notify_photo(expires_at);`);
const digest=value=>createHash('sha256').update(value).digest('hex');
export function validatePublicUrl(raw) {
 const value=String(raw??'').trim();if(!value)return '';
 let url;try{url=new URL(value);}catch{throw Error('请填写完整的 HTTPS 站点地址');}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('请填写家长手机和钉钉可访问的 HTTPS 站点根地址，不含路径、参数或本机地址');
 return url.origin;
}
export function publicUrl(childId) {
 const row=q.get("SELECT value FROM family_setting WHERE child_id=? AND key='notify_public_url'",childId);
 try{return validatePublicUrl(row?row.value:process.env.BANXUE_PUBLIC_ORIGIN||'');}catch{return '';}
}
export function savePublicUrl(childId,value) {
 const normalized=validatePublicUrl(value);
 q.run("INSERT INTO family_setting VALUES(?,'notify_public_url',?) ON CONFLICT(child_id,key) DO UPDATE SET value=excluded.value",childId,normalized);
}
const plain=value=>String(value??'').replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
// User text stays text: no injected images, links, headings or @mentions.
const md=value=>plain(value).replace(/@/g,'＠').replace(/[\\`*_{}\[\]()<>#!|]/g,'\\$&').replace(/\n/g,'  \n');
export function submissionContent(childId,task,{now=Date.now()}={}) {
 const child=q.get('SELECT name,family_id FROM child WHERE id=?',childId);
 const points=task.awarded_points??task.base_points;
 const timing={early:'提前完成',ontime:'按时完成',late:'延后完成'}[task.timing]||'已提交';
 const stamp=new Date(task.submitted_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
 const summary=`【${child?.name||'孩子'}】${task.subject}｜${task.title}\n学习内容：${task.title} · 计划 ${task.minutes} 分钟\n孩子留言：${task.note||'未填写'}\n提交时间：${stamp}（${timing}）\n预计得分：${points} 星贝${task.photo?'\n[附1张作业照片]':''}`;
 const base=publicUrl(childId);
 const reviewUrl=base?`${base}/?${new URLSearchParams({review:task.id,family:child?.family_id||'',child:childId})}#/parent`:'';
 let imageUrl='';
 if(base&&task.photo){
  const token=randomBytes(32).toString('base64url');
  q.run('DELETE FROM notify_photo WHERE expires_at<=?',now);
  q.run('INSERT INTO notify_photo VALUES(?,?,?,?,?)',digest(token),childId,task.id,task.submitted_at,now+7*86400000);
  imageUrl=`${base}/api/notify-images/${token}`;
 }
 const adjustment=points-task.base_points;
 const scoreRule=`基础 ${task.base_points}${adjustment?` ${adjustment>0?'＋':'−'} ${Math.abs(adjustment)}（${timing}）`:''}`;
 const text=[`### ${md(child?.name||'孩子')}的学习提交`,
  `**${md(task.subject)}｜${md(task.title)}**`,
  `计划 ${task.minutes} 分钟 · ${md(task.date)}`,
  `**孩子的一句话**\n\n${md(task.note||'这次没有填写留言。')}`,
  imageUrl?`![作业照片](${imageUrl})`:task.photo?'已上传1张作业照片，请在家长端查看。':'本次未上传照片。',
  `**预计获得 ${points} 星贝**\n\n${md(scoreRule)}`,
  `提交于 ${md(stamp)} · ${timing}`,
  reviewUrl?'等待家长审核，通过后发放星贝。':'等待家长审核。尚未配置外部访问地址，请到家长端查看。'].join('\n\n');
 const title=`${child?.name||'孩子'}提交了${task.subject}任务 · 预计${points}星贝`;
 return {summary,payload:reviewUrl?{msgtype:'actionCard',actionCard:{title,text,singleTitle:'打开家长端审核',singleURL:reviewUrl,btnOrientation:'0'}}:{msgtype:'markdown',markdown:{title,text}}};
}
export function notificationPhoto(token,now=Date.now()) {
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
 const row=q.get(`SELECT t.photo FROM notify_photo n JOIN v2_task t ON t.id=n.task_id AND t.child_id=n.child_id AND t.submitted_at=n.submitted_at WHERE n.token_hash=? AND n.expires_at>?`,digest(token),now);
 const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(row?.photo||'');
 return match?{type:`image/${match[1]}`,bytes:Buffer.from(match[2],'base64')}:null;
}
