import { useCallback, useEffect, useRef, useState } from 'react';
import StudentHome from './StudentHome';
import ParentHome from './ParentHome';
import AccountEntry from './AccountEntry';
import FamilyPanel from './FamilyPanel';
import ChildSwitcher from './ChildSwitcher';
import {readReviewLink,clearReviewLink,type ReviewLink} from './ReviewLink';
import {Sheet} from '../mvp/Sheets';
import {accounts,setAccountScope,type FamilySession} from './accounts';
import {chinaDateTime} from './SubscriptionInfo';
import './accounts.css';
type Toast = { id: number; text: string; tone?: string };
export default function V2App(){
 const [reviewLink,setReviewLink]=useState<ReviewLink|null>(readReviewLink),[linkError,setLinkError]=useState('');
 const [session,setSession]=useState<FamilySession|null>(null),[bootError,setBootError]=useState('');
 const [mode,setMode]=useState<'student'|'parent'|'family'>('student');
 const [unlockOpen,setUnlockOpen]=useState(false),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [toasts,setToasts]=useState<Toast[]>([]),idRef=useRef(0),busyRef=useRef(false);
 const apply=useCallback((s:FamilySession)=>{setAccountScope(s);setSession(s);},[]);
 const load=useCallback(async()=>{try{const s=await accounts.session();apply(s);setBootError('');if(s.parentUnlocked&&s.role==='parent')setMode('parent');}catch(e:any){setBootError(e.message);}},[apply]);
 useEffect(()=>{load();},[load]);
 useEffect(()=>{
  if(!session?.authenticated)return;
  const refresh=()=>{void accounts.session().then(apply).catch(()=>{});};
  const refreshVisible=()=>{if(!document.hidden)refresh();};
  const timer=window.setInterval(refreshVisible,60000);
  const s=session.family?.subscription;
  const remaining=s?.expiresAt===null?null:s?Math.max(0,s.expiresAt!-s.serverTime):null;
  const expiryTimer=remaining!==null&&remaining>0?window.setTimeout(refresh,Math.min(remaining+50,2147483647)):null;
  window.addEventListener('focus',refreshVisible);window.addEventListener('island-subscription-expired',refresh);document.addEventListener('visibilitychange',refreshVisible);
  return()=>{window.clearInterval(timer);if(expiryTimer!==null)window.clearTimeout(expiryTimer);window.removeEventListener('focus',refreshVisible);window.removeEventListener('island-subscription-expired',refresh);document.removeEventListener('visibilitychange',refreshVisible);};
 },[session,apply]);
 useEffect(()=>{const expired=()=>{apply({authenticated:false});setMode('student');};const locked=()=>{setMode('student');setUnlockOpen(true);};window.addEventListener('island-session-expired',expired);window.addEventListener('island-parent-expired',locked);return()=>{window.removeEventListener('island-session-expired',expired);window.removeEventListener('island-parent-expired',locked);};},[apply]);
 const toast=useCallback((text:string,tone?:string)=>{const id=++idRef.current;setToasts(t=>[...t,{id,text,tone}]);window.setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)),4500);},[]);
 const run=async(fn:()=>Promise<void>)=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');try{await fn();}catch(e:any){setError(e.message);toast(e.message,'warn');}finally{busyRef.current=false;setBusy(false);}};
 const closeReview=useCallback(()=>{clearReviewLink();setReviewLink(null);setLinkError('');},[]);
 useEffect(()=>{
  if(!reviewLink||!session?.authenticated)return;
  if(session.role!=='parent'){setLinkError('这是一条家长审核链接，请退出学生账号后使用家长账号登录。');return;}
  if(!session.parentUnlocked){setUnlockOpen(true);return;}
  if(!session.families?.some(f=>f.id===reviewLink.family)){setLinkError('当前账号不属于这项任务的家庭，请切换到对应家长账号。');return;}
  if(session.family?.id===reviewLink.family&&session.activeChildId===reviewLink.child){setLinkError('');setMode('parent');return;}
  let canceled=false;setLinkError('正在打开对应孩子的提交…');
  accounts.select(reviewLink.family,reviewLink.child).then(s=>{if(!canceled){apply(s);setLinkError('');setMode('parent');}}).catch(e=>{if(!canceled)setLinkError(e.message||'无法打开对应的孩子，请检查账号。');});
  return()=>{canceled=true;};
 },[reviewLink,session,apply]);
 const reviewReady=!!reviewLink&&session?.role==='parent'&&session.parentUnlocked&&session.family?.id===reviewLink.family&&session.activeChildId===reviewLink.child;
 const enterParent=()=>{if(session?.role==='student'){toast('请先退出学生账号，再使用家长账号登录。','warn');return;}if(session?.parentUnlocked)setMode('parent');else{setPassword('');setError('');setUnlockOpen(true);}};
 const student=()=>run(async()=>{apply(await accounts.lock());setMode('student');history.replaceState(null,'','#/');});
 const logout=()=>run(async()=>{apply(await accounts.logout());setMode('student');if(!reviewLink)history.replaceState(null,'',location.pathname);});
 const select=(familyId:string,childId?:string)=>run(async()=>{const s=await accounts.select(familyId,childId);apply(s);});
 if(!session){if(bootError)return <div className="island-error"><div className="error-card"><h2>暂时连不上小岛</h2><p>{bootError}</p><button className="btn primary" onClick={load}>再试一次</button></div></div>;return <div className="island-loading"><div className="loading-orb"/><p>正在打开小岛…</p></div>;}
 if(!session.authenticated)return <AccountEntry initial={session} onDone={s=>{apply(s);setMode(s.role==='parent'?'parent':'student');if(new URLSearchParams(location.search).has('invite'))if(!reviewLink)history.replaceState(null,'',location.pathname);}}/>;
 const child=session.children?.find(c=>c.id===session.activeChildId);
 const subscription=session.family?.subscription;
 const studentView=!!child&&!(session.parentUnlocked&&(mode==='family'||mode==='parent'));
 const companion=<><label htmlFor="active-child" title={session.family?.name}>{session.family?.name || '我的家'}</label><ChildSwitcher children={session.children||[]} disabled={busy||!session.parentUnlocked||session.role==='student'} value={session.activeChildId||''} onChange={id=>select(session.family!.id,id)}/></>;
 return <div className="account-shell">{reviewLink&&linkError&&<div className="notify-link-banner" role="status"><span>{linkError}</span><button className="btn ghost sm" onClick={closeReview}>关闭审核链接</button></div>}{!studentView&&<header className="family-context">{(session.families?.length||0)>1&&<div className="family-context-identity"><span>🏡</span><select aria-label="当前家庭" value={session.family?.id} disabled={busy||!session.parentUnlocked} onChange={e=>select(e.target.value)}>{session.families?.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></div>}
 <div className="family-context-child">{companion}</div>
 <div className="family-context-actions"><span>{session.user?.name}{session.role==='student'?' · 学生':''}</span>{session.role==='parent'&&session.parentUnlocked&&<button className={mode==='family'?'is-on':''} onClick={()=>{run(async()=>{apply(await accounts.family());setMode('family');});}}>家庭管理</button>}<button onClick={logout} disabled={busy}>退出</button></div></header>}
 {subscription&&session.role==='parent'&&session.parentUnlocked&&mode!=='student'&&<aside className={`subscription-banner ${subscription.status}`} role={subscription.readOnly?'alert':'status'}><span>{subscription.readOnly?'家庭使用期限已到，当前为只读模式。':subscription.status==='expiring'?`家庭即将到期，剩余 ${subscription.daysRemaining} 天。`:'家庭使用期限：'}{subscription.expiresAt===null?'不限期':`有效至 ${chinaDateTime(subscription.expiresAt)}（北京时间）`}{subscription.readOnly&&' 打卡、奖励和宠物操作已暂停，请家长续期。'}</span>{session.role==='parent'&&session.parentUnlocked&&<button onClick={()=>void run(async()=>{apply(await accounts.family());setMode('family');})}>{subscription.expiresAt===null?'查看详情':'查看与续期'}</button>}</aside>}
 {error&&!unlockOpen&&<p className="context-error" role="alert">{error}</p>}
 <div className="account-content" key={`${session.family?.id}:${session.activeChildId}:${session.user?.id}`}>
 {mode==='family'&&session.parentUnlocked?<FamilyPanel session={session} onChange={apply} onBack={()=>setMode('parent')} onLogout={logout}/>:mode==='parent'&&session.parentUnlocked?<ParentHome onStudent={student} toast={toast} reviewId={reviewReady?reviewLink?.task:undefined} onReviewClose={closeReview}/>:child?<StudentHome onParent={enterParent} onLogout={logout} parentName={session.role==='parent'?session.user?.name:undefined} accountBusy={busy} companion={companion} toast={toast}/>:<div className="island-error"><h2>为家庭添加第一个孩子</h2><button className="btn primary" onClick={()=>setMode('family')}>添加孩子</button></div>}
 </div>
 <Sheet open={unlockOpen} onClose={()=>{if(!busy)setUnlockOpen(false);}} title="解锁家长模式" sub={`使用 ${session.user?.login} 的账号密码，继续管理与审核。`}><form className="account-edit-form" onSubmit={e=>{e.preventDefault();run(async()=>{apply(await accounts.unlock(password));setPassword('');setUnlockOpen(false);setMode('parent');history.replaceState(null,'','#/parent');});}}><label>家长账号密码<input type="password" autoComplete="current-password" autoFocus required value={password} onChange={e=>{setPassword(e.target.value);setError('');}}/></label>{error&&<p className="account-error" role="alert">{error}</p>}<button className="btn primary" type="submit" disabled={busy}>{busy?'验证中…':'进入家长端'}</button></form></Sheet>
 <div className="toast-stack" role="status" aria-live="polite">{toasts.map(t=><div key={t.id} className={`toast ${t.tone||''}`}>{t.text}</div>)}</div></div>;
}
