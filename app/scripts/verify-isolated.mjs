/** Create a disposable service for destructive API suites; app/data is never used. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {testActivationCode} from './fixtures/activation.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const dir=mkdtempSync(join(tmpdir(),'banxue-api-'));
const port=process.env.TEST_PORT || '17727';
const base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,PORT:port,BANXUE_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
let ready=false;
server.stdout.on('data',()=>{ready=true;});
server.stderr.on('data',d=>process.stderr.write(d));
const run=(file)=>new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[file],{cwd:root,env:{...process.env,BASE:base,BANXUE_TEST_DB:dir},stdio:'inherit'});
 child.on('exit',code=>code===0?resolve():reject(Error(`${file} exited ${code}`)));
});
try {
 const deadline=Date.now()+8000;
 while(!ready && Date.now()<deadline) await new Promise(r=>setTimeout(r,100));
 if(!ready)throw Error('Isolated server did not start');
 const setup=await fetch(base+'/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({activationCode:testActivationCode(dir),login:'suite-parent',password:'Suite-Only-2026!',name:'验收家长',familyName:'隔离验收家庭',childName:'验收孩子'})});
 if(!setup.ok)throw Error(await setup.text());
 await run('scripts/verify-v2.mjs');
 await run('scripts/verify-travel.mjs');
 await run('scripts/verify-mvp.mjs');
 await run('scripts/verify-continuation.mjs');
 await run('scripts/verify-materials.mjs');
 await run('scripts/verify-pet-scenarios.mjs');
 await run('scripts/verify-pet-play.mjs');
 await run('scripts/verify-pet-scenarios-api.mjs');
  await run('scripts/verify-pet-sleep.mjs');
  await run('scripts/verify-pet-sleep-api.mjs');
 await run('scripts/verify-pet-selection.mjs');
 await run('scripts/verify-pet-growth.mjs');
 await run('scripts/verify-pet-progression.mjs');
 await run('scripts/verify-family.mjs');
 await run('scripts/verify-notes.mjs');
 await run('scripts/verify-notifications.mjs');
 await run('scripts/verify-notify-scheduler.mjs');
 await run('scripts/verify-notify-cards.mjs');
 await run('scripts/verify-pet-backups.mjs');
 await run('scripts/verify-safety-api.mjs');
 await run('scripts/verify-subscriptions.mjs');
} finally {
 const closed=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await closed;
 rmSync(dir,{recursive:true,force:true});
}
