import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { durationLabel, playtimeApi, type PlaytimeState } from './playtime-api';
import type { StudentState } from './types';
import './playtime.css';
type Clock = {state: PlaytimeState|null; remaining: number|null; paused: boolean; publish: (s: StudentState) => void};
const PlaytimeContext = createContext<Clock>({state:null,remaining:null,paused:false,publish:()=>{}});
export const usePlaytime = () => useContext(PlaytimeContext);
export function PlaytimeCountdown() {
  const {state, remaining} = usePlaytime();
  if (!state) return null;
  return <span className={`playtime-countdown ${remaining !== null && remaining <= 300 ? 'is-low' : ''}`} title={`今日已游玩 ${Math.floor(state.usedSeconds/60)} 分钟`} aria-label={remaining === null ? '游玩时间未限时' : `游玩喂养剩余 ${durationLabel(remaining)}`}><span aria-hidden="true">◷</span> 游玩喂养 <b>{remaining === null ? '未限时' : durationLabel(remaining)}</b></span>;
}
export default function PlaytimeGate({children,onParent,onLogout,parentSuspended=false}: {children:ReactNode;onParent:()=>void;onLogout:()=>void;parentSuspended?:boolean}) {
  const [record,setRecord] = useState<{state:PlaytimeState;received:number}|null>(null), [tick,setTick] = useState(performance.now());
  const [idle,setIdle] = useState(false), [offline,setOffline] = useState(''), [snapshot,setSnapshot] = useState<StudentState|null>(null);
  const [pin,setPin] = useState(''), [pinError,setPinError] = useState(''), [busy,setBusy] = useState(false);
  const client = useRef(crypto.randomUUID()), activity = useRef(performance.now()), interacted = useRef(true), request = useRef<string|null>(null);
  const latest = useRef({idle,offline,parentSuspended,record}); latest.current = {idle,offline,parentSuspended,record};
  const dialog = useRef<HTMLDivElement>(null), sendRef = useRef<(stop?:boolean)=>Promise<void>>(async()=>{});
  const publish = useCallback((s:StudentState)=>setSnapshot(s),[]);
  const elapsed = record && !idle && !offline && !parentSuspended && !document.hidden ? Math.max(0,(tick-record.received)/1000) : 0;
  const remaining = record?.state.remainingSeconds == null ? null : Math.max(0,Math.ceil(record.state.remainingSeconds-elapsed));
  const locked = !!record?.state.locked || remaining === 0;
  const covered = !record || idle || locked || !!offline;
  useEffect(() => {
    let alive = true, sending = false, pendingStop = false;
    const accept = (s:PlaytimeState) => {if(alive){setRecord({state:s,received:performance.now()});setOffline('');if(s.idle)setIdle(true);}};
    const send = async (stop=false) => {
      if (sending) {pendingStop ||= stop;return;}
      sending = true;
      const current = latest.current, changed = interacted.current;interacted.current=false;
      const active = !stop && !document.hidden && !current.idle && !current.offline && !current.parentSuspended;
      try {accept(await playtimeApi.heartbeat(client.current,active,changed,stop));}
      catch(e:any) {interacted.current ||= changed;if(alive)setOffline(e.message);}
      finally {sending=false;if(pendingStop){pendingStop=false;void send(true);}}
    };
    sendRef.current=send;
    void send();
    const action = (e:Event) => {
      if (document.hidden || latest.current.idle || latest.current.record?.state.locked || latest.current.offline || latest.current.parentSuspended) return;
      if (!(e.target instanceof Element) || !e.target.closest('.playtime-content')) return;
      activity.current=performance.now();interacted.current=true;
    };
    const events=['pointerdown','pointermove','keydown','wheel','touchstart'];
    events.forEach(name=>window.addEventListener(name,action,{passive:true}));
    const timer=window.setInterval(()=>{
      const now=performance.now();setTick(now);
      const c=latest.current;
      if (!document.hidden && !c.idle && !c.parentSuspended && now-activity.current >= (c.record?.state.idleMinutes||5)*60000) {setIdle(true);void send(true);}
    },1000);
    const heartbeat=window.setInterval(()=>{void send();},10000);
    const visibility=()=>{
      const now=performance.now();
      if(!document.hidden)setRecord(r=>r?{state:{...r.state,serverNow:r.state.serverNow+now-r.received},received:now}:r);
      setTick(now);void send(document.hidden);
    };
    const forced=()=>{void playtimeApi.state().then(accept).catch(e=>{if(alive)setOffline(e.message);});};
    const pagehide=()=>{void send(true);};
    document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',pagehide);window.addEventListener('island-playtime-locked',forced);
    return()=>{alive=false;void playtimeApi.heartbeat(client.current,false,false,true).catch(()=>{});window.clearInterval(timer);window.clearInterval(heartbeat);events.forEach(name=>window.removeEventListener(name,action));document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',pagehide);window.removeEventListener('island-playtime-locked',forced);};
  },[]);
  // Opening the account-password sheet pauses this child's activity, too.
  useEffect(()=>{
    if(parentSuspended)void sendRef.current(true);
    else {const now=performance.now();setRecord(r=>r?{state:{...r.state,serverNow:r.state.serverNow+now-r.received},received:now}:r);void sendRef.current();}
  },[parentSuspended]);
  useEffect(()=>{
    if(!covered||parentSuspended)return;
    const first=()=>dialog.current?.querySelector<HTMLElement>('input,button')?.focus();
    const frame=requestAnimationFrame(first);
    const key=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();}
      if(e.key!=='Tab')return;
      e.preventDefault();e.stopImmediatePropagation();
      const list=Array.from(dialog.current?.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)')||[]);
      const index=list.indexOf(document.activeElement as HTMLElement);list[(index+(e.shiftKey?-1:1)+list.length)%list.length]?.focus();
    };
    window.addEventListener('keydown',key,true);return()=>{cancelAnimationFrame(frame);window.removeEventListener('keydown',key,true);};
  },[covered,parentSuspended,locked]);
  const resume=async()=>{
    if(busy)return;setBusy(true);setPinError('');
    try {
      const s=locked ? await playtimeApi.unlock(pin,request.current ||= crypto.randomUUID()) : await playtimeApi.state();
      if(s.locked){setRecord({state:s,received:performance.now()});return;}
      const active=await playtimeApi.heartbeat(client.current,true,true);
      activity.current=performance.now();interacted.current=false;setIdle(false);setOffline('');setRecord({state:active,received:performance.now()});setTick(performance.now());setPin('');request.current=null;
    }catch(e:any){setPinError(e.message);request.current=null;}finally{setBusy(false);}
  };
  const value=useMemo(()=>({state:record?.state||null,remaining,paused:covered||parentSuspended,publish}),[record,remaining,covered,parentSuspended,publish]);
  const clockNow=new Date((record?.state.serverNow||Date.now())+(record?Math.max(0,tick-record.received):0));
  const clock=clockNow.toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,hour:'2-digit',minute:'2-digit'});
  const date=clockNow.toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric',weekday:'long'});
  return <PlaytimeContext.Provider value={value}><div className={`playtime-content${covered?' is-covered':''}`} inert={covered||parentSuspended}>{record && children}</div>
    {covered&&!parentSuspended&&<div className="island-screensaver" role="dialog" aria-modal="true" aria-label={locked?'今日游玩已锁定':'小岛屏保'} ref={dialog}>
      <div className="screensaver-wrap"><div className="screensaver-clock"><time>{clock}</time><p>{date} · 北京时间</p></div>
      <section className="screensaver-card"><span className="eyebrow">伴学小岛 · {locked?'今日休息时间':'安静陪伴'}</span><h1>{locked?'今天的小岛游玩时间用完啦':offline?'暂时连不上小岛':!record?'正在核验游玩时间…':'歇一会儿，也很棒'}</h1>
      <p>{locked?`请家长输入 6 位数字密码，再陪伴 ${record?.state.unlockMinutes||15} 分钟。宠物会继续以一半速度消耗状态。`:offline||`超过 ${record?.state.idleMinutes||5} 分钟没有操作，已进入屏保，游玩计时暂停。`}</p>
      {snapshot&&<><div className="screensaver-stats">{([['hunger','饱食'],['energy','精力'],['mood','心情'],['clean','清洁']] as const).map(([key,label])=><div key={key}><span>{label}</span><strong>{snapshot.pet?Math.round(snapshot.pet.stats[key]):'—'}</strong></div>)}</div>
      <div className="screensaver-totals"><div><span>今日任务已完成</span><strong>{snapshot.progress.approved} / {snapshot.progress.total}</strong></div><div><span>待家长审核</span><strong>{snapshot.progress.submitted}</strong></div><div><span>星贝积分</span><strong>★ {snapshot.wallet.balance}</strong></div><div><span>今日获得积分</span><strong>+{snapshot.wallet.todayEarned}</strong></div></div></>}
      <form onSubmit={e=>{e.preventDefault();void resume();}}>{locked&&<label className="screensaver-pin">家长 6 位数字密码<input aria-label="家长 6 位数字密码" type="password" inputMode="numeric" autoComplete="off" maxLength={6} pattern="[0-9]{6}" required value={pin} onChange={e=>{setPin(e.target.value.replace(/\D/g,''));setPinError('');}}/></label>}
      {pinError&&<p className="screensaver-error" role="alert">{pinError}</p>}<button className="btn primary" disabled={busy||!record}>{busy?'正在验证…':locked?'家长解锁，延长 15 分钟':offline?'重新连接，回到小岛':'解锁，回到小岛'}</button></form>
      <div className="screensaver-actions"><button onClick={onParent}>进入家长端</button><button onClick={onLogout}>退出登录</button></div></section>
      <p className="screensaver-foot">{snapshot?.pet?.name||'学习伙伴'}在小岛等你 · 今日已游玩 {Math.floor((record?.state.usedSeconds||0)/60)} 分钟</p></div>
    </div>}
  </PlaytimeContext.Provider>;
}
