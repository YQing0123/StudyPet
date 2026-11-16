/** China-time daily summaries, claimed once per child/day across server processes. */
import { q, db, tx } from './db.mjs';
import * as NOTIFY from './notifications.mjs';
import { taskSummary } from './v2.mjs';
import { childIsActive } from './subscriptions.mjs';

db.exec(`CREATE TABLE IF NOT EXISTS notify_summary_run (
 child_id TEXT NOT NULL, date TEXT NOT NULL, status TEXT NOT NULL,
 created_at TEXT NOT NULL, completed_at TEXT, PRIMARY KEY(child_id,date)
);`);

export function chinaClock(at=Date.now()) {
 const stamp=new Date(Number(at)+8*3600000).toISOString();
 return {date:stamp.slice(0,10),time:stamp.slice(11,16)};
}

export async function runDueSummaries({at=Date.now(),fetchImpl=fetch}={}) {
 const clock=chinaClock(at),results=[];
 const children=q.all("SELECT c.id FROM child c JOIN family_setting s ON s.child_id=c.id AND s.key='notify_event_daily_summary' AND s.value='1'");
 for(const child of children){
  try {
   if(!childIsActive(child.id,at)||clock.time<NOTIFY.summaryTime(child.id)||!NOTIFY.notificationsEnabled(child.id))continue;
   const claim=tx(()=>{
    const inserted=q.run("INSERT OR IGNORE INTO notify_summary_run(child_id,date,status,created_at) VALUES(?,?,'sending',?)",child.id,clock.date,new Date(at).toISOString());
    return inserted.changes?taskSummary(child.id,clock.date):null;
   });
   if(claim===null)continue;
   const sent=await NOTIFY.sendNotification(child.id,claim,{event:'daily_summary',fetchImpl});
   q.run('UPDATE notify_summary_run SET status=?,completed_at=? WHERE child_id=? AND date=?',sent.ok?'success':'failed',new Date().toISOString(),child.id,clock.date);
   results.push({childId:child.id,...sent});
  }catch{
   q.run("UPDATE notify_summary_run SET status='failed',completed_at=? WHERE child_id=? AND date=?",new Date().toISOString(),child.id,clock.date);
   console.error('每日任务汇总发送失败，请查看发送日志');
  }
 }
 return results;
}

export function startNotificationScheduler() {
 let running=false;
 const tick=async()=>{
  if(running)return;
  running=true;
  try{await runDueSummaries();}catch{console.error('每日任务汇总检查失败');}finally{running=false;}
 };
 const timer=setInterval(tick,30000);
 timer.unref();
 void tick();
 return ()=>clearInterval(timer);
}
