/** Clock-controlled tests use a disposable database, never a real family's clock/data. */
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'island-playtime-'));process.env.BANXUE_DATA_DIR=dir;
const {q,db}=await import('../server/db.mjs');const P=await import('../server/playtime.mjs');const D=await import('../server/daily.mjs');
await import('../server/v2.mjs');
const RealDate=Date;let time=Date.parse('2026-11-17T08:00:00+08:00');
globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[time]));}static now(){return time;}};
const advance=ms=>time+=ms;const at=s=>time=RealDate.parse(s);let checks=0;
const ok=(condition,label)=>{assert.ok(condition,label);checks++;console.log('✓ '+label);};
const beat=(id,active=true,interacted=true,clientId='playtime-client-00001')=>P.heartbeat(id,'session', {clientId,active,interacted});
const configure=(id,extra={})=>P.savePlaytimeSettings(id,{enabled:true,dailyMinutes:1,idleMinutes:5,pin:'123456',...extra});
const spend=(id,seconds)=>{for(let i=0;i<seconds;i+=10){beat(id);advance(Math.min(10,seconds-i)*1000);}return P.playtimeState(id);};
try {
  ok(!P.playtimeSettings('existing').enabled&&P.playtimeSettings('existing').idleMinutes===5,'现有孩子默认不限时，5 分钟屏保');
  for(const change of [{dailyMinutes:0},{dailyMinutes:481},{idleMinutes:0},{idleMinutes:61},{pin:'abc123'},{pin:'12345'},{enabled:'true'}])await assert.rejects(()=>configure('invalid',change));
  await assert.rejects(()=>P.savePlaytimeSettings('no-pin',{enabled:true,dailyMinutes:60,idleMinutes:5}));
  await configure('active');ok(!JSON.stringify(P.playtimeState('active')).includes('scrypt'),'公开响应不包含密码哈希');
  beat('active');advance(10000);let s=beat('active',true,false);ok(s.usedSeconds===10,'由服务器时钟累积前台操作时间');
  advance(10000);s=beat('active',true,true,'playtime-client-00002');ok(s.usedSeconds===20,'第二个标签页不重复计时');
  advance(10000);beat('active',false,false);s=beat('active',false,false,'playtime-client-00002');ok(s.usedSeconds===30,'所有标签页转后台立即停止');
  advance(3600000);ok(P.playtimeState('active').usedSeconds===30,'后台和离线时间不计入额度');
  beat('active');advance(10000);s=beat('active',true,true,'playtime-client-refresh');ok(s.usedSeconds===40,'刷新或更换标签页不会清除当天用时');
  advance(20000);s=P.playtimeState('active');ok(s.locked&&s.remainingSeconds===0,'额度边界自动锁定');assert.throws(()=>P.requirePlaytime('active'),e=>e.status===423||e.statusCode===423);
  advance(3600000);ok(P.playtimeState('active').usedSeconds===60,'锁定期间不增加游玩用时');
  await assert.rejects(()=>P.unlockPlaytime('active',{pin:'654321',requestId:'unlock-wrong-000001'}));
  const unlock={pin:'123456',requestId:'unlock-success-00001'};s=await P.unlockPlaytime('active',unlock);ok(!s.locked&&s.remainingSeconds===900,'正确密码解锁并增加 15 分钟');
  s=await P.unlockPlaytime('active',unlock);ok(s.bonusSeconds===900,'解锁请求重试不重复增加时间');
  await configure('abandoned',{dailyMinutes:60});beat('abandoned');advance(3600000);ok(P.playtimeState('abandoned').usedSeconds===30,'标签页意外关闭最多结算 30 秒租约');
  await configure('idle',{dailyMinutes:60,idleMinutes:1});beat('idle');for(let i=0;i<6;i++){advance(10000);s=beat('idle',true,false);}ok(s.idle&&s.usedSeconds===60,'无操作边界停止租约并返回屏保状态');advance(60000);ok(P.playtimeState('idle').usedSeconds===60,'屏保后持续心跳不再扣时');
  await configure('throttle');for(let i=0;i<5;i++)await assert.rejects(()=>P.unlockPlaytime('throttle',{pin:'654321',requestId:'unlock-attempt-00001'}));await assert.rejects(()=>P.unlockPlaytime('throttle',unlock));await configure('throttle',{pin:'654321'});ok(!(await P.unlockPlaytime('throttle',{pin:'654321',requestId:'unlock-after-reset-01'})).locked,'连续错误密码被限流，家长重设可恢复');
  at('2026-11-17T23:59:00+08:00');await configure('midnight');s=spend('midnight',60);ok(!s.locked&&s.usedSeconds===0&&s.remainingSeconds===60,'额度恰在北京时间零点用完不会锁住新一天');ok(P.lockedIntervals('midnight',time,time+1000).length===0,'零点边界不产生错误的跨天锁定区间');
  at('2026-11-18T23:58:30+08:00');await configure('cross');s=spend('cross',60);ok(s.locked,'跨天前正常到时锁定');advance(30000);s=P.playtimeState('cross');ok(!s.locked&&s.remainingSeconds===60,'锁定到新一天自动恢复额度');
  at('2026-11-19T08:00:00+08:00');q.run('INSERT INTO child(id,name,created_at) VALUES(?,?,?)','decay','状态验收',new Date().toISOString());D.adopt('decay',{breed:'capybara_toon',name:'测试'});await configure('decay');spend('decay',60);D.getPetRow('decay');q.run('UPDATE pet_life SET hunger=90,energy=90,mood=90,clean=90,last_tick=? WHERE child_id=?',new Date().toISOString(),'decay');advance(3600000);const pet=D.getPetRow('decay');ok(Math.abs(pet.hunger-(90-4.2/2))<.001&&Math.abs(pet.energy-(90-3.3/2))<.001&&Math.abs(pet.mood-(90-2.7/2))<.001,'锁定一小时状态按清醒时一半速度下降');
  ok(D.DECAY_PER_HOUR.hunger===4.2&&D.DECAY_PER_HOUR.clean===1.95,'清醒状态消耗提高至原来的 1.5 倍');
  console.log(`${checks} playtime checks passed`);
} finally {globalThis.Date=RealDate;db.close();rmSync(dir,{recursive:true,force:true});}
