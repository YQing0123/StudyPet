/** Test-only preload. All non-loopback traffic is blocked; no real delivery. */
import { createHmac } from 'node:crypto';
import { appendFileSync } from 'node:fs';
const original=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const url=new URL(String(input));
 if(['127.0.0.1','localhost','[::1]'].includes(url.hostname))return original(input,init);
 const body=JSON.parse(init?.body||'{}');
 const token=url.searchParams.get('access_token')||url.searchParams.get('key')||body.token||'';
 if(!token.startsWith('dummy_'))throw Error('隔离验收禁止使用真实推送凭据');
 if(!['oapi.dingtalk.com','qyapi.weixin.qq.com','www.pushplus.plus'].includes(url.hostname))throw Error('隔离验收禁止外网访问');
 if(process.env.BANXUE_NOTIFY_CAPTURE_PATH)appendFileSync(process.env.BANXUE_NOTIFY_CAPTURE_PATH,JSON.stringify({provider:url.hostname,body})+'\n');
 if(url.hostname==='oapi.dingtalk.com'){
  const secret='SECdummySigningSecret20261114';
  const expected=createHmac('sha256',secret).update(`${url.searchParams.get('timestamp')}\n${secret}`).digest('base64');
  if(expected!==url.searchParams.get('sign')||token.includes('fail'))return new Response(JSON.stringify({errcode:310000,errmsg:'sign not match'}),{status:200});
 }
 if(token.includes('fail'))return new Response(JSON.stringify({errcode:93000,code:500,msg:'模拟业务失败',errmsg:'模拟业务失败'}),{status:200});
 return new Response(JSON.stringify(url.hostname==='www.pushplus.plus'?{code:200,msg:'success'}:{errcode:0,errmsg:'ok'}),{status:200});
};
