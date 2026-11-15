/** Local media conversion only. No image/video generation or external API calls.
 * iOS WebKit cannot reliably decode WebM alpha. Pack RGB and its alpha matte
 * side by side in ordinary H.264, then reconstruct alpha in the stage shader.
 * Green/blue screen sources retain their existing keying mode.
 */
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const PETS=join(ROOT,'web/public/pets');
const PROFILE='h264-matte-v1-crf18-main31';
function command(program,args){return new Promise((resolve,reject)=>{
 const child=spawn(program,args,{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
 child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
 child.once('error',reject);child.once('exit',code=>code===0?resolve(stdout):reject(Error(`${program} exited ${code}: ${stderr.slice(-2000)}`)));
});}
export async function buildCompatiblePetVideos(){
 const path=join(PETS,'manifest.json'),manifest=JSON.parse(readFileSync(path,'utf8')),unique=new Map();
 for(const breed of Object.values(manifest.breeds))for(const look of [breed,...Object.values(breed.growth||{})])for(const entry of Object.values(look.videos)){
  const key=entry.file+'|'+entry.mode;if(!unique.has(key))unique.set(key,{entry,refs:[]});unique.get(key).refs.push(entry);
 }
 const jobs=[...unique.values()];let completed=0,converted=0,totalBytes=0;
 async function worker(){while(jobs.length){
  const {entry,refs}=jobs.shift(),source=join(PETS,entry.file);
  const digest=createHash('sha256').update(PROFILE+'|'+entry.mode).update(readFileSync(source)).digest('hex').slice(0,20);
  const relative=`compatible/${digest}.mp4`,target=join(PETS,relative),mode=entry.mode==='alpha'?'packed-alpha':entry.mode;
  mkdirSync(dirname(target),{recursive:true});
  if(!existsSync(target)){
   const temporary=target+'.tmp.mp4';
   const args=['-v','error','-y','-c:v','libvpx-vp9','-i',source];
   if(entry.mode==='alpha')args.push('-filter_complex','[0:v]split=2[c][m];[m]alphaextract,format=yuv420p[a];[c]format=yuv420p[rgb];[rgb][a]hstack=inputs=2[v]','-map','[v]');
   args.push('-an','-c:v','libx264','-crf','18','-preset','fast','-profile:v','main','-level:v','3.1','-pix_fmt','yuv420p','-movflags','+faststart','-threads','2',temporary);
   try{await command('ffmpeg',args);renameSync(temporary,target);converted++;}catch(e){rmSync(temporary,{force:true});throw e;}
  }
  const {streams,format}=JSON.parse(await command('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,width,height,pix_fmt:format=duration,size','-of','json',target]));
  if(streams[0]?.codec_name!=='h264'||streams[0]?.pix_fmt!=='yuv420p'||!(Number(format.duration)>0))throw Error('Invalid compatible video: '+entry.file);
  const info={file:relative,mode};for(const ref of refs)ref.compatible=info;
  totalBytes+=Number(format.size);completed++;if(completed%25===0||completed===unique.size)console.log(`Compatible pet clips: ${completed}/${unique.size}`);
 }}
 await Promise.all([worker(),worker()]);
 // Publish the manifest only when every referenced compatible clip is ready.
 const temporary=path+'.tmp';writeFileSync(temporary,JSON.stringify(manifest,null,2));renameSync(temporary,path);
 console.log(JSON.stringify({clips:unique.size,converted,totalBytes,profile:PROFILE}));
 return {clips:unique.size,converted,totalBytes,profile:PROFILE};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await buildCompatiblePetVideos();
