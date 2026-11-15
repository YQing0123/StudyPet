/** Publish only the reviewed capybara repair; retain every other breed verbatim. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,copyFileSync,renameSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {buildCompatiblePetVideos} from './build-compatible-pet-videos.mjs';

const app=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const work=join(app,'../output/capybara-motion-20261115'),pack=join(app,'assets/pets/capybara_toon'),pub=join(app,'web/public/pets');
const manifestPath=join(pub,'manifest.json'),manifest=JSON.parse(readFileSync(manifestPath)),spec=JSON.parse(readFileSync(join(pack,'pet.json')));
const verification=JSON.parse(readFileSync(join(work,'verification.json'))),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
assert.equal(spec.version,'2026-11-15.capybara-motion-v3');
assert.ok(verification.ok&&verification.clipCount===48);
const before=structuredClone(manifest),files=[];
writeFileSync(join(work,'manifest-before-publication.json'),JSON.stringify(before,null,2));
const breed=manifest.breeds.capybara_toon;
for(let age=1;age<=6;age++){
 const source=age===1?spec:spec.growth[age],target=age===1?breed:breed.growth[age];
 const actions=verification.clips.filter(c=>c.age===age);
 for(const clip of actions){
  const from=join(pack,source.videos[clip.action].file),to=join(pub,target.videos[clip.action].file);
  assert.equal(hash(from),clip.sha256);copyFileSync(from,to);files.push({file:target.videos[clip.action].file,sha256:hash(to)});
  if(clip.action==='walk')target.videos.walk.gait=source.videos.walk.gait;
 }
 for(const key of ['sit','walk','sleep']){
  const from=source.frames.find(f=>f.key===key),to=target.frames.find(f=>f.key===key);
  copyFileSync(join(pack,from.file),join(pub,to.file));files.push({file:to.file,sha256:hash(join(pub,to.file))});
 }
}
breed.sourceVersion=spec.version;
writeFileSync(manifestPath+'.tmp',JSON.stringify(manifest,null,2));renameSync(manifestPath+'.tmp',manifestPath);
// Existing content-addressed MP4s are reused; only changed source bytes encode.
const result=await buildCompatiblePetVideos();
const after=JSON.parse(readFileSync(manifestPath));
for(const [id,info] of Object.entries(before.breeds))if(id!=='capybara_toon')assert.deepEqual(after.breeds[id],info,id+' unexpectedly changed');
for(const clip of verification.clips){
 const look=clip.age===1?after.breeds.capybara_toon:after.breeds.capybara_toon.growth[clip.age];
 const file=look.videos[clip.action].compatible.file;files.push({file,sha256:hash(join(pub,file))});
}
writeFileSync(join(work,'public-publication.json'),JSON.stringify({ok:true,version:spec.version,compatible:result,otherBreedManifestsPreserved:true,files},null,2));
console.log('Published capybara media only:',files.length,'files; other breed manifests preserved');
