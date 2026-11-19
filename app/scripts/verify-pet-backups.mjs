/** Recoverability and transaction tests, in a disposable database. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'banxue-backups-'));process.env.BANXUE_DATA_DIR=dir;
const {db,q}=await import('../server/db.mjs'),D=await import('../server/daily.mjs'),V=await import('../server/v2.mjs'),P=await import('../server/pet-backups.mjs');
let checks=0;const ok=(c,label)=>{assert.ok(c,label);checks++;console.log('✓ '+label);};
const child='backup-child';
const protectedTables=['v2_task','plan_rule','point_ledger','material_inv','daily_task','reward_item','redemption'];
const learning=()=>Object.fromEntries(protectedTables.map(table=>[table,q.all(`SELECT * FROM ${table} WHERE child_id=? ORDER BY rowid`,child)]));
try{
 q.run('INSERT INTO child(id,name,created_at) VALUES(?,?,?)',child,'验收孩子',new Date().toISOString());
 V.adoptWithStarter(child,{breed:'alpaca_toon',name:'豆包'});q.run("UPDATE pet_life SET breed='dog_corgi',species='dog' WHERE child_id=?",child);V.giftPoints(child,{amount:150});D.buy(child,{key:'kibble'});D.interact(child,{action:'pet'});
 const pet=D.getPetRow(child),id=pet.pet_id;
 q.run('UPDATE pet_life SET growth=48,care_count=7,outfit=? WHERE child_id=?',JSON.stringify({neck:'bow'}),child);
 V.getStudentState(child);
 // Learning data and wallet must remain exactly as they were for every pet operation.
 const before=learning();
 const manual=P.backupPet(child,id).id;
 const saved=q.get('SELECT snapshot FROM pet_backup WHERE id=?',manual);
 const original=JSON.parse(saved.snapshot).pet;
 P.migratePet(child,'alpaca_toon',id);
 let current=D.getPetRow(child);
 ok(current.pet_id===id&&current.breed==='alpaca_toon'&&current.growth===48&&current.name==='豆包'&&current.care_count===7,'切换品种保留同一宠物的名字、成长、照顾次数和ID');
 assert.deepEqual(learning(),before);ok(true,'切换品种保留全部学习、钱包、材料、兑换记录');
 ok(P.listPetBackups(child).items.some(b=>b.reason==='before_switch'&&b.pet.breed==='dog_corgi'),'切换前自动备份原品种');
 P.restartPet(child,id);ok(!D.getPetRow(child),'重新养宠仅移除当前宠物，回到待领养');
 assert.deepEqual(learning(),before);ok(true,'重养不会清空任务、星贝、背包、计划和兑换记录');
 ok(P.listPetBackups(child).items.some(b=>b.reason==='before_restart'&&b.pet.breed==='alpaca_toon'),'重养前自动备份宠物');
 const empty=P.backupPet(child,null).id;
 P.restorePet(child,manual,null);current=D.getPetRow(child);
 ok(current.pet_id===id&&current.breed===original.breed&&current.growth===48&&current.outfit===original.outfit,'可从待领养状态恢复原宠物、成长和装扮');
 ok(P.listPetBackups(child).items.some(b=>b.reason==='before_restore'&&b.pet===null),'恢复前也备份当前无宠物状态');
 ok(D.cooldownLeft(current,'pet',90000)>0,'恢复保留尚未结束的照顾冷却');
 assert.deepEqual(learning(),before);ok(true,'恢复只处理宠物，学习进度和材料不回退');
 P.restorePet(child,empty,id);ok(!D.getPetRow(child),'无宠物备份也可以恢复，当前宠物已另存');
 const displaced=P.listPetBackups(child).items.find(b=>b.reason==='before_restore'&&b.pet);
 P.restorePet(child,displaced.id,null);ok(D.getPetRow(child)?.pet_id===id,'恢复前的自动备份可以再次恢复，操作可往返');
 const newBefore=learning();assert.deepEqual(newBefore,before);
 assert.throws(()=>P.restartPet(child,'stale-id'));assert.throws(()=>P.migratePet(child,'unknown',id));assert.throws(()=>P.restorePet('other-child',manual,null));
 ok(D.getPetRow(child)?.pet_id===id,'过期的宠物ID、未知品种、跨孩子备份均拒绝且保留当前宠物');
 const broken={...JSON.parse(saved.snapshot),cooldowns:[{action:null,used_at:new Date().toISOString()}]};
 q.run('INSERT INTO pet_backup VALUES(?,?,?,?,?)','broken',child,'manual',JSON.stringify(broken),new Date().toISOString());
 const beforeFailure=q.get('SELECT count(*) n FROM pet_backup WHERE child_id=?',child).n;
 assert.throws(()=>P.restorePet(child,'broken',id));
 ok(D.getPetRow(child)?.pet_id===id&&q.get('SELECT count(*) n FROM pet_backup WHERE child_id=?',child).n===beforeFailure,'损坏的冷却数据在恢复前被拒绝，当前宠物与原备份不丢失');
 const validSnapshot=JSON.parse(saved.snapshot);
 const badSnapshots=[
  '{invalid-json', 'null', JSON.stringify({version:1,cooldowns:[]}),
  JSON.stringify({...validSnapshot,pet:{...validSnapshot.pet,hunger:101}}),
  JSON.stringify({...validSnapshot,pet:{...validSnapshot.pet,adopted_at:'invalid-date'}}),
  JSON.stringify({...validSnapshot,pet:{...validSnapshot.pet,outfit:'[]'}}),
  JSON.stringify({...validSnapshot,pet:{...validSnapshot.pet,species:'wrong-species'}}),
  JSON.stringify({...validSnapshot,cooldowns:[{action:'pet',used_at:new Date().toISOString()},{action:'pet',used_at:new Date().toISOString()}]}),
  JSON.stringify({version:1,pet:null,cooldowns:[{action:'pet',used_at:new Date().toISOString()}]})
 ];
 const petBeforeInvalid=q.get('SELECT * FROM pet_life WHERE child_id=?',child);
 badSnapshots.forEach((snapshot,i)=>{
  q.run('INSERT INTO pet_backup VALUES(?,?,?,?,?)','invalid-'+i,child,'manual',snapshot,new Date().toISOString());
  const n=q.get('SELECT count(*) n FROM pet_backup WHERE child_id=?',child).n;
  assert.throws(()=>P.restorePet(child,'invalid-'+i,id),/备份/);
  assert.deepEqual(q.get('SELECT * FROM pet_life WHERE child_id=?',child),petBeforeInvalid);
  assert.equal(q.get('SELECT count(*) n FROM pet_backup WHERE child_id=?',child).n,n);
 });
 ok(true,'非法JSON、空结构、缺失字段、越界属性、错误时间、装扮、物种和重复冷却全部拒绝且不写入');
 const mixed=P.listPetBackups(child).items;
 ok(badSnapshots.every((_,i)=>mixed.some(b=>b.id==='invalid-'+i&&!b.available&&b.error))&&mixed.some(b=>b.available),'损坏备份独立标明不可恢复，正常备份仍能查看，原记录全部保留');
 db.exec(`CREATE TRIGGER reject_pet_restore BEFORE INSERT ON pet_life WHEN NEW.child_id='backup-child' BEGIN SELECT RAISE(ABORT,'模拟恢复写入失败'); END;`);
 const beforeRollback={pet:q.get('SELECT * FROM pet_life WHERE child_id=?',child),cooldowns:q.all('SELECT * FROM pet_cooldown WHERE pet_id=? ORDER BY action',id),count:q.get('SELECT count(*) n FROM pet_backup WHERE child_id=?',child).n};
 assert.throws(()=>P.restorePet(child,manual,id),/模拟恢复写入失败/);
 assert.deepEqual(q.get('SELECT * FROM pet_life WHERE child_id=?',child),beforeRollback.pet);
 assert.deepEqual(q.all('SELECT * FROM pet_cooldown WHERE pet_id=? ORDER BY action',id),beforeRollback.cooldowns);
 assert.equal(q.get('SELECT count(*) n FROM pet_backup WHERE child_id=?',child).n,beforeRollback.count);
 assert.deepEqual(learning(),before);
 db.exec('DROP TRIGGER reject_pet_restore');
 ok(true,'恢复写入中途失败整笔回滚，宠物、冷却、备份与学习记录完全保留');
 for(let i=0;i<24;i++)P.backupPet(child,id);
 let page=P.listPetBackups(child),ids=[];while(page.items.length){ids.push(...page.items.map(i=>i.id));if(!page.next)break;page=P.listPetBackups(child,page.next);}
 ok(ids.length===new Set(ids).size&&ids.length===q.get('SELECT count(*) n FROM pet_backup WHERE child_id=?',child).n,'备份记录分页无遗漏且无重复');
 console.log(`${checks} pet backup checks passed`);
}finally{db.close();rmSync(dir,{recursive:true,force:true});}
