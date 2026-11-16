import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseGIF, decompressFrames } from 'gifuct-js';
import { ROOM_CATALOG } from '../web/src/shared/roomCatalog.mjs';
const result=[];
for(const name of ['shower','bath','bug','fly']) {
 const src=`web/public/pets/effects/${name}.gif`, bytes=readFileSync(src);
 assert.match(bytes.subarray(0,6).toString(),/^GIF8[79]a$/);
 const gif=parseGIF(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));const frames=decompressFrames(gif,true);
 const duration=frames.reduce((n,f)=>n+f.delay,0);assert.ok(frames.length>1&&duration>0,`${name} must be a native animation`);
 // Every frame is fully decoded; returned original GIF bytes are never reconstructed.
 assert.ok(frames.every(f=>f.patch.length===f.dims.width*f.dims.height*4));
 assert.ok(new Set(frames.map(f=>createHash('sha256').update(f.patch).digest('hex'))).size>1,`${name} frames must contain motion`);
 const original=`output/imagegen/pet-scenarios/${name==='fly'?'fly-sunburst':name}.gif`;
 if(existsSync(original)) assert.deepEqual(bytes,readFileSync(original));
 result.push({name,frames:frames.length,durationMs:duration,width:gif.lsd.width,height:gif.lsd.height,sha256:createHash('sha256').update(bytes).digest('hex')});
}
for(const item of ROOM_CATALOG) {
 assert.ok(existsSync(`web/public/${item.asset}`),item.asset);
 if(item.kind==='scene') {
  assert.ok(item.nightAsset && item.nightAsset!==item.asset,`${item.key} requires a separate night scene`);
  assert.ok(existsSync(`web/public/${item.nightAsset}`),item.nightAsset);
  const night=readFileSync(`web/public/${item.nightAsset}`);
  assert.equal(night.subarray(0,4).toString(),'RIFF',item.nightAsset);
  assert.equal(night.subarray(8,12).toString(),'WEBP',item.nightAsset);
 }
}
console.log(JSON.stringify({nativeGif:result,scenes:ROOM_CATALOG.filter(x=>x.kind==='scene').length,furniture:ROOM_CATALOG.filter(x=>x.kind==='furniture').length},null,2));
