/** Time-scaled play load, food happiness, persistence and rollback in an isolated database. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const dir = mkdtempSync(join(tmpdir(), 'banxue-play-'));
process.env.BANXUE_DATA_DIR = dir;
const { db, q } = await import('../server/db.mjs');
const D = await import('../server/daily.mjs');
const V = await import('../server/v2.mjs');
const B = await import('../server/pet-backups.mjs');
const { PLAY_IDLE_RESET_MS } = await import('../server/pet-play.mjs');
const { PET_SCENARIOS } = await import('../web/src/shared/petScenarios.mjs');
const RealDate = Date; let clock = RealDate.now();
globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } };
let count = 0;
const check = (label, fn) => { fn(); count++; console.log('✓ ' + label); };
const child = 'play-test', other = 'play-other';
const state = () => D.getToday(child);
const resetNeeds = () => q.run('UPDATE pet_life SET hunger=50,energy=95,mood=30,clean=95,last_tick=? WHERE child_id=?',new Date().toISOString(),child);
const resetLoad = () => q.run('DELETE FROM pet_play_session WHERE child_id=?',child);
const inv = key => q.get('SELECT qty FROM material_inv WHERE child_id=? AND item_key=?',child,key)?.qty || 0;
try {
  for (const id of [child, other]) {
    q.run('INSERT INTO child(id,name,created_at) VALUES(?,?,?)',id,'游玩测试',new Date().toISOString());
    D.adopt(id,{breed:'capybara_toon'});
    V.setParentSettings(id,{petSleep:{nightEnabled:false,nightStart:'21:30',nightEnd:'07:00',napEnabled:false,napStart:'13:00',napEnd:'14:00'}});
  }
  resetNeeds();
  const first = D.interact(child,{action:'play',duration:999999999,elapsedSeconds:999999});
  check('陪玩开心，但会消耗精力和清洁；客户端时间参数不起作用',()=>{
    assert.equal(first.stateDelta.mood,11);assert.equal(first.stateDelta.clean,-2);
    assert.ok(first.stateDelta.energy < -5 && first.stateDelta.energy > -6);
    assert.equal(first.pet.playSession.activeSeconds,9);
  });
  const savedLoad = q.get('SELECT * FROM pet_play_session WHERE child_id=?',child);
  check('失败的冷却请求不增加游玩时间或耗能',()=>{
    const energy=state().pet.stats.energy;assert.throws(()=>D.interact(child,{action:'play'}),/回味/);
    assert.deepEqual(q.get('SELECT * FROM pet_play_session WHERE child_id=?',child),savedLoad);
    assert.equal(state().pet.stats.energy,energy);
  });
  clock += 12001;resetNeeds();const second=D.interact(child,{action:'play'});
  check('同样陪玩动作，连续玩第二次消耗更多精力',()=>assert.ok(Math.abs(second.stateDelta.energy)>Math.abs(first.stateDelta.energy)));
  check('每个孩子的连续游玩负担独立',()=>assert.equal(D.getToday(other).pet.playSession.activeSeconds,0));
  for(let i=0;i<26;i++){clock+=12001;resetNeeds();D.interact(child,{action:'play'});}
  clock+=12001;resetNeeds();const long=D.interact(child,{action:'play'});
  check('持续游玩会提示休息，耗能系数有三倍上限',()=>{
    assert.equal(long.pet.playSession.energyMultiplier,3);assert.equal(long.pet.playSession.restRecommended,true);
    assert.ok(Math.abs(long.stateDelta.energy)<=15.001);
  });
  const loadBeforeReading=q.get('SELECT active_seconds FROM pet_play_session WHERE child_id=?',child).active_seconds;
  clock += PLAY_IDLE_RESET_MS + 1;resetNeeds();state();
  check('查看任务、挂机和读取状态不累计游玩时间，五分钟不玩后负担归零',()=>{
    assert.equal(q.get('SELECT active_seconds FROM pet_play_session WHERE child_id=?',child).active_seconds,loadBeforeReading);
    assert.equal(state().pet.playSession.activeSeconds,0);assert.equal(state().pet.playSession.energyMultiplier,1);
  });
  const rested=D.interact(child,{action:'play'});
  check('休息后新一轮陪玩恢复初始耗能',()=>assert.ok(Math.abs(rested.stateDelta.energy-first.stateDelta.energy)<.001));
  resetLoad();clock+=12001;resetNeeds();
  try {
    PET_SCENARIOS.play.duration=18000;
    const longer=D.interact(child,{action:'play'});
    check('服务端动作持续时间翻倍时按时间比例增加耗能和清洁消耗',()=>{
      assert.equal(longer.pet.playSession.activeSeconds,18);
      assert.ok(Math.abs(longer.stateDelta.energy)>Math.abs(first.stateDelta.energy)*2);
      assert.equal(longer.stateDelta.clean,-4);
    });
  } finally { PET_SCENARIOS.play.duration=9000; }
  resetLoad();clock+=12001;resetNeeds();const touch=D.interact(child,{action:'pet'});
  resetLoad();resetNeeds();const hug=D.interact(child,{action:'hug'});
  check('轻互动按六秒、八秒的实际配置时长计入，长动作消耗相应增加',()=>{
    assert.equal(touch.pet.playSession.activeSeconds,6);assert.equal(hug.pet.playSession.activeSeconds,8);
    assert.ok(Math.abs(hug.stateDelta.energy)>Math.abs(touch.stateDelta.energy));
  });
  for(const key of ['kibble','fish','milk','ball','feather']) q.run('INSERT INTO material_inv(child_id,item_key,qty) VALUES(?,?,?)',child,key,5);
  for(const key of ['kibble','fish','milk']) {
    resetNeeds();q.run('UPDATE pet_life SET hunger=20 WHERE child_id=?',child);
    const meal=D.useMaterial(child,{key});check(key+' 喂食都会增加心情',()=>assert.ok(meal.stateDelta.mood>0));
  }
  resetNeeds();q.run('UPDATE pet_life SET hunger=60 WHERE child_id=?',child);
  const satisfying=D.useMaterial(child,{key:'kibble'});
  check('由未吃饱到饱食八十以上，额外增加两点心情',()=>assert.equal(satisfying.stateDelta.mood,6));
  for(const key of ['ball','feather']) {
    resetNeeds();const play=D.useMaterial(child,{key});check(key+' 玩具同时增加心情、消耗精力与清洁',()=>{
      assert.ok(play.stateDelta.mood>0&&play.stateDelta.energy<0&&play.stateDelta.clean<0);
    });
  }
  q.run('UPDATE pet_life SET energy=9 WHERE child_id=?',child);const beforeQty=inv('ball');
  check('疲劳时拒绝玩具且不消耗库存和累计时间',()=>{
    const session=q.get('SELECT * FROM pet_play_session WHERE child_id=?',child);
    assert.throws(()=>D.useMaterial(child,{key:'ball'}),/太累/);assert.equal(inv('ball'),beforeQty);
    assert.deepEqual(q.get('SELECT * FROM pet_play_session WHERE child_id=?',child),session);
  });
  resetNeeds();const beforeFailure={session:q.get('SELECT * FROM pet_play_session WHERE child_id=?',child),qty:inv('ball')};
  db.exec("CREATE TRIGGER fail_play_state BEFORE UPDATE ON pet_life WHEN NEW.child_id='play-test' AND NEW.energy<>OLD.energy BEGIN SELECT RAISE(ABORT,'injected play'); END");
  check('状态写入失败时，游玩计时、库存和状态整笔回滚',()=>{
    assert.throws(()=>D.useMaterial(child,{key:'ball'}),/injected play/);assert.equal(inv('ball'),beforeFailure.qty);
    assert.deepEqual(q.get('SELECT * FROM pet_play_session WHERE child_id=?',child),beforeFailure.session);
  });db.exec('DROP TRIGGER fail_play_state');
  const pet=D.getPetRow(child);const backup=B.backupPet(child,pet.pet_id).id;
  B.restartPet(child,pet.pet_id);D.adopt(child,{breed:'alpaca_toon'});const newPet=D.getPetRow(child);B.restorePet(child,backup,newPet.pet_id);
  check('重养、切换及恢复备份不能清空当前孩子的连续游玩负担',()=>assert.equal(state().pet.playSession.activeSeconds,beforeFailure.session.active_seconds));
  // A second process must read the same persisted load after server/module restart.
  q.run('UPDATE pet_play_session SET last_action_at=? WHERE child_id=?',new RealDate().toISOString(),child);
  const childProcess=spawnSync(process.execPath,['--input-type=module','-e',"const D=await import('./server/daily.mjs');console.log(JSON.stringify(D.getToday('play-test').pet.playSession));"],{cwd:join(dirname(fileURLToPath(import.meta.url)),'..'),env:{...process.env,BANXUE_DATA_DIR:dir},encoding:'utf8'});
  check('独立服务进程可读回持久化的连续游玩负担',()=>{
    assert.equal(childProcess.status,0,childProcess.stderr);
    assert.equal(JSON.parse(childProcess.stdout).activeSeconds,beforeFailure.session.active_seconds);
  });
  console.log(`${count} pet play checks passed`);
} finally { globalThis.Date=RealDate;db.close();rmSync(dir,{recursive:true,force:true}); }
