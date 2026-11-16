/** Pet-only snapshots: learning records, wallet and inventory are never rolled back. */
import { q, db, uid, tx } from './db.mjs';
import * as DAILY from './daily.mjs';
import { migratedFields, CURVE_VERSION, levelName } from './pet-progression.mjs';

db.exec(`CREATE TABLE IF NOT EXISTS pet_backup (
 id TEXT PRIMARY KEY, child_id TEXT NOT NULL, reason TEXT NOT NULL, snapshot TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pet_backup_child ON pet_backup(child_id,created_at DESC,id DESC);`);
const reasons=new Set(['manual','before_switch','before_restart','before_restore']);
function currentPet(childId) { return DAILY.getPetRow(childId); }
function expectCurrent(childId,expectedPetId) {
 const pet=currentPet(childId);
 if(expectedPetId===undefined || (pet?.pet_id??null)!==expectedPetId)throw Error('当前宠物已经变化，请刷新后重新操作');
 return pet;
}
function makeBackup(childId,reason) {
 if(!reasons.has(reason))throw Error('备份原因不正确');
 const pet=currentPet(childId),id=uid(),createdAt=new Date().toISOString();
 const snapshot={version:1,pet:pet||null,cooldowns:pet?q.all('SELECT action,used_at FROM pet_cooldown WHERE pet_id=?',pet.pet_id):[]};
 q.run('INSERT INTO pet_backup VALUES(?,?,?,?,?)',id,childId,reason,JSON.stringify(snapshot),createdAt);
 return id;
}
function readSnapshot(row) {
 let snapshot;try{snapshot=JSON.parse(row.snapshot);}catch{throw Error('备份内容损坏，无法恢复；当前宠物未修改');}
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
 const invalid=()=>{throw Error('备份数据不完整或格式不支持，无法恢复；当前宠物未修改');};
 if(!object(snapshot)||snapshot.version!==1||!timestamp(row.created_at)||!Array.isArray(snapshot.cooldowns))invalid();
 if(snapshot.pet===null){if(snapshot.cooldowns.length)invalid();return snapshot;}
 const pet=snapshot.pet,breed=object(pet)&&DAILY.breedList({includeUnavailable:true}).find(b=>b.id===pet.breed);
 if(!breed||pet.species!==breed.species)invalid();
 for(const field of ['pet_id','name','gender','personality'])if(typeof pet[field]!=='string'||!pet[field].trim())invalid();
 if(!Number.isInteger(pet.stage)||pet.stage<1||pet.stage>6)invalid();
 if(pet.progression_version!=null){
  if(pet.progression_version!==CURVE_VERSION||!Number.isInteger(pet.confirmed_level)||pet.confirmed_level<1||pet.confirmed_level>12||pet.stage!==Math.ceil(pet.confirmed_level/2))invalid();
  if(!timestamp(pet.natural_anchor_at)||!Number.isFinite(pet.progression_seed)||pet.progression_seed<0||!Number.isSafeInteger(pet.eligible_growth)||pet.eligible_growth<0)invalid();
  if(pet.adoption_anniversary!=null&&!timestamp(pet.adoption_anniversary))invalid();
 }
 for(const field of ['hunger','energy','mood','clean'])if(!Number.isFinite(pet[field])||pet[field]<0||pet[field]>100)invalid();
 for(const field of ['growth','care_count'])if(!Number.isSafeInteger(pet[field])||pet[field]<0)invalid();
 for(const field of ['adopted_at','last_tick','created_at'])if(!timestamp(pet[field]))invalid();
 if(pet.last_care_at!=null&&!timestamp(pet.last_care_at))invalid();
 if(pet.last_care_kind!=null&&typeof pet.last_care_kind!=='string')invalid();
 try{if(typeof pet.outfit!=='string'||!object(JSON.parse(pet.outfit)))invalid();}catch{invalid();}
 const actions=new Set();
 for(const cooldown of snapshot.cooldowns){
  if(!object(cooldown)||typeof cooldown.action!=='string'||!cooldown.action.trim()||actions.has(cooldown.action)||!timestamp(cooldown.used_at))invalid();
  actions.add(cooldown.action);
 }
 return snapshot;
}
function summarize(row) {
 const metadata={id:row.id,reason:row.reason,createdAt:row.created_at};
 try{
  const {pet}=readSnapshot(row);
  return {...metadata,available:true,pet:pet?{name:pet.name,breed:pet.breed,growth:pet.growth,stage:pet.stage,phaseName:levelName(pet.confirmed_level || pet.stage*2-1),stats:{hunger:pet.hunger,energy:pet.energy,mood:pet.mood,clean:pet.clean}}:null};
 }catch(error){return {...metadata,available:false,error:error.message,pet:null};}
}
export function listPetBackups(childId,before='') {
 let clause='child_id=?',args=[childId];
 if(before){const cursor=q.get('SELECT created_at,id FROM pet_backup WHERE child_id=? AND id=?',childId,before);if(!cursor)throw Error('备份游标无效');clause+=' AND (created_at<? OR (created_at=? AND id<?))';args.push(cursor.created_at,cursor.created_at,cursor.id);}
 const rows=q.all(`SELECT * FROM pet_backup WHERE ${clause} ORDER BY created_at DESC,id DESC LIMIT 21`,...args);
 return {items:rows.slice(0,20).map(summarize),next:rows.length>20?rows[19].id:null};
}
export function backupPet(childId,expectedPetId) {
 return tx(()=>{expectCurrent(childId,expectedPetId);const id=makeBackup(childId,'manual');return {id};});
}
export function migratePet(childId,breed,expectedPetId) {
 return tx(()=>{
  const pet=expectCurrent(childId,expectedPetId);
  if(!pet)throw Error('请先领养小伙伴');
  if(!DAILY.breedList().some(b=>b.id===breed))throw Error('还没有这种小伙伴');
  if(pet.breed===breed)throw Error('已经是当前品种');
  const backupId=makeBackup(childId,'before_switch');DAILY.changeBreed(childId,breed);return {backupId};
 });
}
export function restartPet(childId,expectedPetId) {
 return tx(()=>{
  const pet=expectCurrent(childId,expectedPetId);if(!pet)throw Error('当前没有宠物，无需重新开始');
  const backupId=makeBackup(childId,'before_restart');
  q.run('DELETE FROM pet_life WHERE child_id=?',childId);
  return {backupId};
 });
}
export function restorePet(childId,id,expectedPetId) {
 return tx(()=>{
  const row=q.get('SELECT * FROM pet_backup WHERE child_id=? AND id=?',childId,id);
  if(!row)throw Error('找不到当前孩子的这条备份');
  const snapshot=readSnapshot(row);
  expectCurrent(childId,expectedPetId);
  const backupId=makeBackup(childId,'before_restore');
  q.run('DELETE FROM pet_life WHERE child_id=?',childId);
  if(snapshot.pet){
   const now=Date.now(),savedAt=Date.parse(row.created_at);
   const p={...snapshot.pet,...migratedFields(snapshot.pet,savedAt)};
   // Freeze archived age and needs; cooldowns resume from their saved remaining time.
   for(const field of ['adopted_at','last_care_at','natural_anchor_at'])if(p[field])p[field]=new Date(Date.parse(p[field])+now-savedAt).toISOString();
   p.child_id=childId;p.last_tick=new Date(now).toISOString();
   const columns=['pet_id','child_id','name','breed','species','gender','personality','stage','hunger','energy','mood','clean','growth','care_count','outfit','adopted_at','last_tick','last_care_at','last_care_kind','created_at','confirmed_level','progression_version','progression_seed','natural_anchor_at','eligible_growth','adoption_anniversary'];
   q.run(`INSERT INTO pet_life(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`,...columns.map(key=>p[key]??null));
   for(let n=1;n<=Math.floor(p.growth/50);n++)q.run('INSERT OR IGNORE INTO pet_chest_claim VALUES(?,?)',p.pet_id,n);
   for(const cooldown of snapshot.cooldowns)q.run('INSERT INTO pet_cooldown VALUES(?,?,?)',p.pet_id,cooldown.action,new Date(Date.parse(cooldown.used_at)+now-savedAt).toISOString());
  }
  return {backupId,restoredId:id};
 });
}
