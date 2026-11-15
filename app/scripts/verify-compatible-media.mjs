/** Validate the shipped iPad-compatible motion library without application data. */
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..','web/public/pets');
const manifest=JSON.parse(readFileSync(join(root,'manifest.json'),'utf8')),seen=new Set();let looks=0,refs=0;
const probe=file=>JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,width,height,pix_fmt,avg_frame_rate:format=duration','-of','json',file],{encoding:'utf8'}));
for(const breed of Object.values(manifest.breeds))for(const look of [breed,...Object.values(breed.growth||{})]){
 looks++;
 for(const [action,entry]of Object.entries(look.videos)){
  refs++;assert.ok(entry.compatible,`${breed.name}/${action} missing compatible video`);
  const c=entry.compatible;assert.ok(/^compatible\/[a-f0-9]{20}\.mp4$/.test(c.file));
  assert.equal(c.mode,entry.mode==='alpha'?'packed-alpha':entry.mode);assert.ok(existsSync(join(root,c.file)));
  if(seen.has(c.file))continue;seen.add(c.file);
  const a=probe(join(root,entry.file)),b=probe(join(root,c.file)),source=a.streams[0],target=b.streams[0];
  assert.equal(target.codec_name,'h264');assert.equal(target.pix_fmt,'yuv420p');
  assert.equal(target.width,source.width*(entry.mode==='alpha'?2:1));assert.equal(target.height,source.height);
  const fps=value=>{const [n,d]=value.split('/').map(Number);return n/d;};
  assert.ok(Math.abs(fps(source.avg_frame_rate)-fps(target.avg_frame_rate))<.02,'Original frame rate changed');
  assert.ok(Math.abs(Number(a.format.duration)-Number(b.format.duration))<.08,'Original timing changed');
 }
}
console.log(JSON.stringify({breeds:Object.keys(manifest.breeds).length,appearances:looks,actionReferences:refs,uniqueClips:seen.size,checks:'complete H.264/matte variants; original dimensions, frame rates and duration preserved'}));
