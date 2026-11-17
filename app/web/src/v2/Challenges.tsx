import { useCallback, useEffect, useRef, useState } from 'react';
import { Sheet } from '../mvp/Sheets';
import { challengeApi as api, levelName, subjectName, subjectLabel, type Lobby, type Round, type Subject, type WrongPage } from './challenge-api';
import './challenges.css';

export default function Challenges({onClose,onChanged}:{onClose:()=>void;onChanged:()=>void}) {
  const [data,setData]=useState<Lobby|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [subject,setSubject]=useState<Subject>('poetry'),[difficulty,setDifficulty]=useState(1),[mode,setMode]=useState<'standard'|'double'>('standard');
  const [round,setRound]=useState<Round|null>(null),[wrong,setWrong]=useState(false);
  const busyRef=useRef(false),requestId=useRef<string|null>(null);
  const load=useCallback(async()=>{try{setData(await api.lobby());setError('');}catch(e:any){setError(e.message);}},[]);
  useEffect(()=>{void load();},[load]);
  const start=async()=>{
    if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');
    // Keep the same request identity after a network failure; a lost response must not consume another round.
    requestId.current ||= crypto.randomUUID();
    try{setRound(await api.start(subject,difficulty,mode,requestId.current));requestId.current=null;}catch(e:any){setError(e.message);try{setData(await api.lobby());}catch{/* Preserve the original failed action and request identity. */}}finally{busyRef.current=false;setBusy(false);}
  };
  const total=data?.policy.questionsPerRound||10;
  const rewardTiers=[Math.ceil(total*.8),Math.ceil(total*.9),total].map((n,i)=>({n,i})).filter((t,i,all)=>!all.slice(i+1).some(x=>x.n===t.n));
  if(round)return <AnswerRound initial={round} onDone={()=>{setRound(null);onChanged();void load();}}/>;
  return <main className="challenge-page">
    <header className="challenge-header"><button className="challenge-back" onClick={onClose}>← 回到小岛</button><span className="challenge-brand">伴学小岛 · 学习挑战</span><button className="btn ghost" onClick={()=>setWrong(!wrong)}>{wrong?'回到挑战':'我的错题本'}</button></header>
    {wrong?<WrongBook/>:<div className="challenge-lobby">
      <div className="challenge-heading"><span className="eyebrow">每天一点，学得更牢</span><h1>来一场学习挑战</h1><p>一轮 {total} 题，认真想一想，再收获星贝。</p></div>
      {error&&<p className="challenge-error" role="alert">{error}<button onClick={load}>重新连接</button></p>}
      {!data?<p role="status">正在准备挑战…</p>:<>
        <div className="challenge-quota"><span>今天还可挑战 <b>{data.usage.remainingRounds} / {data.policy.dailyRounds} 次</b></span><span>每轮最多 <b>{data.policy.roundMinutes} 分钟</b></span><span>今日累计 <b>★ {data.usage.earned}</b> · 得分无上限</span></div>
        {data.active?<section className="challenge-resume"><h2>还有一轮挑战等着你</h2><p>{subjectName(data.active.subject)} · {levelName(data.active.difficulty)} · 已答 {data.active.index+(data.active.feedback?1:0)} / {data.active.total} 题</p><button className="btn primary" onClick={()=>setRound(data.active)}>继续这轮挑战</button><p>刷新或离开页面不会重新计时，也不会额外消耗次数。</p></section>:<>
        <div className="challenge-subjects" role="group" aria-label="选择学科">
          {(['poetry','math'] as Subject[]).map(s=><button key={s} aria-pressed={subject===s} className={subject===s?'selected':''} disabled={busy} onClick={()=>{setSubject(s);requestId.current=null;}}><span aria-hidden="true">{s==='poetry'?'诗':'×'}</span><div><h2>{subjectName(s)}</h2><p>{s==='poetry'?'接诗句 · 懂注释':'练口算 · 用好长度单位'}</p></div><i aria-hidden="true">{subject===s?'✓':'○'}</i></button>)}
        </div>
        <section className="challenge-config"><div className="challenge-config-main"><h2>选一个难度</h2><div className="challenge-levels" role="group" aria-label="选择难度">{[1,2,3].map(d=><button key={d} disabled={busy} aria-pressed={difficulty===d} className={difficulty===d?'selected':''} onClick={()=>{setDifficulty(d);requestId.current=null;}}><b>{levelName(d)}</b><span>{subject==='poetry'?['','已学诗句','加些拓展和注释','更丰富的拓展'][d]:['','基础计算','进退位与两步计算','混合计算和单位换算'][d]}</span></button>)}</div>
          <h2>选择玩法</h2><div className="challenge-modes" role="group" aria-label="选择玩法"><button disabled={busy} aria-pressed={mode==='standard'} className={mode==='standard'?'selected':''} onClick={()=>{setMode('standard');requestId.current=null;}}>普通模式<span>答对 {Math.ceil(total*.8)} 题起，获得星贝</span></button>{data.policy.doubleEnabled&&<button disabled={busy} aria-pressed={mode==='double'} className={mode==='double'?'selected':''} onClick={()=>{setMode('double');requestId.current=null;}}>翻倍模式<span>连续答对，得分翻倍；第 3 题起可领</span></button>}</div>
          <p className="challenge-scope">{data.policy.grade} 年级{data.policy.term==='upper'?'上':'下'}学期 · {subject==='math'?`${data.policy.textbook} · ${data.policy.mathScope==='2upper'?'二上已学内容':data.policy.mathScope==='1upper'?'一上计算':'一下计算'}`:'范围由家长设置'}<br/>{subject==='math'?'计算题限时 20–50 秒，先看清单位。':`接诗句每题 ${difficulty===1?8:difficulty===2?7:6} 秒，注释题 8 秒。点选后提交。`}</p>
        </div><aside className="challenge-rules"><span className="eyebrow">开始前看一看</span><h2>{mode==='double'?'每答对一题，当前得分翻倍':'答对越多，星贝越多'}</h2>
          {mode==='standard'?<><dl>{rewardTiers.map(({n,i})=><div key={n}><dt>答对 {n} 题</dt><dd>★ {data.rewards[difficulty][i]}</dd></div>)}</dl><p>正确率达到 80% 才发奖；少于 {Math.ceil(total*.8)} 题正确，本轮得 0 星贝。难度每升一级，奖励翻倍。</p><p>普通模式需要完成 {total} 题，中途结束不发奖。</p></>:<><div className="challenge-score-ladder" aria-label="连续答对题数对应当前得分">{Array.from({length:Math.min(total,10)},(_,i)=>2**i).map((n,i)=><span key={n}><small>{i+1} 题</small><b>{n}</b></span>)}</div><p>答对 1 / 2 / 3 题，当前得分是 1 / 2 / 4 星贝；{total} 题全对领取 <b>{2**Math.min(total-1,9)} 星贝</b>。三个难度使用同一阶梯，暂存上限为 512 星贝。</p><p>从答对第 3 题起，每道题后都可以选择<b>结束答题，领取当前得分</b>，或继续挑战下一题。</p><p><b>答错或超时，本轮暂存清零，挑战结束。</b>已拥有的星贝不受影响。</p></>}
          <p>所有学科、难度和玩法每天共用 {data.policy.dailyRounds} 次机会；得分累计，不设每日总分上限。已开始的次数不退回。</p><p>可能遇到以前的错题，答对就会标记为已掌握。</p>
          <button className="btn primary challenge-start" disabled={busy||!data.usage.remainingRounds||data.available[subject][difficulty-1]<total||(mode==='double'&&!data.policy.doubleEnabled)} onClick={start}>{busy?'正在准备…':'准备好，开始挑战'}</button>
          {!data.usage.remainingRounds?<p>今天已经努力过啦，明天再来。</p>:data.available[subject][difficulty-1]<total?<p>范围内题目不足 {total} 道，请家长调整已学内容。</p>:null}
        </aside></section></>}
        {data.wrong.total>0&&<button className="challenge-wrong-link" onClick={()=>setWrong(true)}>错题本 · {data.wrong.pending} 道待巩固，{data.wrong.relapse} 道掌握后再错 <span>去看看 →</span></button>}
        {!!data.recent.length&&<section className="challenge-history"><h2>最近的挑战</h2>{data.recent.slice(0,3).map(r=><button key={r.id} onClick={async()=>{try{setRound(await api.round(r.id));}catch(e:any){setError(e.message);}}}><span>{subjectName(r.subject)} · {levelName(r.difficulty)}</span><span>{r.correct} / {r.total} 题 · {r.status==='completed'?'已完成':r.status==='cashed_out'?'已领取':r.status==='failed'?'本轮结束':r.status==='active'?'进行中':r.status==='expired'?'已到时':'已结束'} <b>★ {r.reward}</b></span></button>)}</section>}
      </>}
    </div>}
  </main>;
}

function AnswerRound({initial,onDone}:{initial:Round;onDone:()=>void}) {
  const [round,setRound]=useState(initial),[response,setResponse]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[exit,setExit]=useState(false);
  const [result,setResult]=useState(initial.status!=='active'),[clock,setClock]=useState(0);
  const busyRef=useRef(false),heading=useRef<HTMLHeadingElement>(null),feedbackRef=useRef<HTMLDivElement>(null),time=useRef({server:initial.serverNow,local:performance.now()}),retry=useRef<null|(()=>Promise<void>)>(null);
  const apply=(r:Round)=>{time.current={server:r.serverNow,local:performance.now()};setRound(r);setClock(x=>x+1);setResponse('');};
  const run=async(fn:()=>Promise<Round>,showResult=false)=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');retry.current=async()=>{await run(fn,showResult);};try{apply(await fn());retry.current=null;if(showResult){setExit(false);setResult(true);}}catch(e:any){setError(e.message);}finally{busyRef.current=false;setBusy(false);}};
  useEffect(()=>{if(!round.question&&round.status==='active')void run(()=>api.next(round.id,round.index));},[round.id]);
  useEffect(()=>{heading.current?.focus({preventScroll:true});heading.current?.closest('.account-content')?.scrollTo({top:0});},[round.index,!!round.question]);
  useEffect(()=>{if(round.feedback)feedbackRef.current?.scrollIntoView({block:'nearest',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});},[round.feedback]);
  useEffect(()=>{if(round.feedback||!round.deadline||round.status!=='active')return;const timer=window.setInterval(()=>setClock(x=>x+1),150);return()=>window.clearInterval(timer);},[round.feedback,round.deadline,round.status]);
  const remaining=round.deadline?Math.max(0,Math.ceil((round.deadline-time.current.server-(performance.now()-time.current.local))/1000)):0;
  useEffect(()=>{if(round.deadline&&remaining===0&&!round.feedback&&round.status==='active'&&!error&&!busyRef.current)void run(()=>api.answer(round.id,round.index,null));},[clock,round.deadline,remaining,round.feedback,round.status,error]);
  useEffect(()=>{const block=(e:BeforeUnloadEvent)=>{if(round.status==='active'){e.preventDefault();}};window.addEventListener('beforeunload',block);return()=>window.removeEventListener('beforeunload',block);},[round.status]);
  const submit=()=>{if(response&&!round.feedback)void run(()=>api.answer(round.id,round.index,response));};
  const next=()=>{if(round.status!=='active'){setResult(true);return;}void run(()=>api.next(round.id,round.index+1,round.canCashOut));};
  const cashout=()=>void run(()=>api.cashout(round.id),true);
  const feedback=round.feedback,q=round.question;
  if(result)return <main className="challenge-page"><div className="challenge-result"><div className="challenge-result-icon" aria-hidden="true">{round.reward?'★':'✓'}</div><span className="eyebrow">{subjectName(round.subject)} · {levelName(round.difficulty)}</span><h1>{round.status==='cashed_out'?'得分已领取，收获星贝':round.reward?'挑战完成，收获星贝':'这一轮，学到新知识'}</h1><p>{round.status==='completed'?`答对 ${round.correct} / ${round.total} 题，正确率 ${Math.round(round.correct/round.total*100)}%`:`本轮已结束，答对 ${round.correct} 题`}</p><strong className="challenge-prize">+ {round.reward} 星贝</strong><p>{round.reward?'奖励已存入你的星贝账户。':round.mode==='double'?'本轮暂存已清零；已有的星贝不受影响。':round.status==='completed'?`答对 ${Math.ceil(round.total*.8)} 题起发奖，再巩固一下就更稳了。`:'中途结束或时间用完，本轮不发奖。'}</p><p>做错的题已经记在错题本里，下次挑战还会遇见。</p><button className="btn primary" onClick={onDone}>回到挑战首页</button><small>星贝余额 ★ {round.balance} · 休息一下，看看远处吧。</small></div></main>;
  return <main className="challenge-page challenge-answer-page">
    <header className="challenge-header"><button className="challenge-back" onClick={()=>setExit(true)}>← 结束本轮</button><span className="challenge-brand">{subjectLabel(round.subject)} · {levelName(round.difficulty)}</span><span className="challenge-round-count">第 <b>{round.index+1}</b> / {round.total} 题</span></header>
    <div className="challenge-answer-wrap"><div className="challenge-answer-top"><div className="challenge-progress" aria-label={`已完成 ${round.index+(feedback?1:0)} 题`}>{Array.from({length:round.total},(_,i)=><i key={i} className={i<round.index||(i===round.index&&feedback)?'done':i===round.index?'current':''}/>)}</div><span className={`challenge-timer ${remaining<=3&&!feedback?'urgent':''}`} role="timer" aria-label={feedback?'本题已作答':`剩余 ${remaining} 秒`}>{feedback?'已作答':`◷ ${remaining} 秒`}</span></div>
      <div className="challenge-answer-meta"><span>{round.mode==='double'?`翻倍模式 · 暂存 ★ ${round.pending}`:`普通模式 · 答对 ${Math.ceil(round.total*.8)} 题起发奖`}</span><span>{q?.review?'错题再巩固':q?.title}</span></div>
      {round.mode==='double'&&round.rulesVersion>=2&&round.status==='active'&&<div className="challenge-double-score" role="status"><div><span>{round.canCashOut?'现在结束可领取':'本轮暂存'}</span><strong>★ {round.pending}</strong></div><div><span>下一题答对后</span><strong>★ {round.nextReward}</strong></div><p>{round.canCashOut?'选择继续后，下一题开始计时；答错或超时，本轮暂存变为 0。':round.correct<3?`再答对 ${3-round.correct} 题就可以选择领取。答错或超时，本轮暂存变为 0。`:'这一题开始后，需先答对才能领取；答错或超时，本轮暂存变为 0。'}</p></div>}
      {round.rulesVersion<2&&<p className="challenge-gentle">本轮在规则更新前开始，仍按开始时的奖励结算；下一轮使用新规则。</p>}
      {error&&<p className="challenge-error" role="alert">{error} <button disabled={busy} onClick={()=>void retry.current?.()}>重试本次操作</button></p>}
      <section className={`challenge-question ${q?.type==='number'?'is-math':''}`} aria-busy={busy}>
        {!q?<><h1>题目正在准备</h1><p>准备好后才开始计时。</p></>:<>
          {q.cue&&!q.prompt.includes(q.cue)&&<p className="challenge-poem-cue">{q.cue}</p>}
          <h1 ref={heading} tabIndex={-1}>{q.prompt}</h1>
          {q.type==='choice'?<div className={`challenge-options ${q.options?.length===4?'has-four':''}`}>{q.options?.map((option,i)=><button key={option} disabled={busy||!!feedback||remaining===0} aria-pressed={response===option} className={`${response===option?'selected':''} ${feedback?.answer===option?'correct':''} ${feedback&&!feedback.correct&&feedback.response===option?'incorrect':''}`} onClick={()=>setResponse(option)}><span>{'ABCD'[i]}</span><b>{option}</b>{feedback?.answer===option&&<em>✓ 正确答案</em>}</button>)}</div>:<form className="challenge-number" onSubmit={e=>{e.preventDefault();submit();}}><label htmlFor="challenge-number">填入数字答案</label><input id="challenge-number" aria-label="数字答案" inputMode={window.matchMedia('(pointer: coarse)').matches?'none':'numeric'} autoComplete="off" maxLength={5} value={feedback?feedback.response||'':response} disabled={busy||!!feedback||remaining===0} onChange={e=>setResponse(e.target.value.replace(/\D/g,'').slice(0,5))}/>{!feedback&&<div className="challenge-keypad">{['1','2','3','4','5','6','7','8','9','清空','0','退格'].map(n=><button key={n} type="button" aria-label={n==='退格'?'删除最后一位':n} disabled={busy||remaining===0} onClick={()=>setResponse(r=>n==='清空'?'':n==='退格'?r.slice(0,-1):(r+n).slice(0,5))}>{n}</button>)}</div>}</form>}
          {feedback?<div ref={feedbackRef} className={`challenge-feedback ${feedback.correct?'good':'learn'}`} role="status"><h2>{feedback.correct?'✓ 答对了':feedback.timedOut?'时间到，一起记住它':'这道题再记一记'}</h2>{!feedback.correct&&<p><b>正确答案：{feedback.answer}</b></p>}<p>{feedback.explanation}</p>{feedback.wrong&&<small>错过 {feedback.wrong.wrongCount} 次 · {feedback.wrong.state==='mastered'?'已掌握':'待巩固'}{feedback.wrong.relapseCount>0?` · 掌握后再错 ${feedback.wrong.relapseCount} 次`:''}</small>}</div>:<p className="challenge-answer-hint">{q.type==='choice'?'选好答案，再点“提交答案”。':'可以点数字键，也可以直接输入。'}</p>}
          {feedback&&round.canCashOut?<div className="challenge-decision"><button className="btn challenge-cashout" disabled={busy} onClick={cashout}>结束答题<span>领取 {round.pending} 星贝</span></button><button className="btn primary" disabled={busy} onClick={next}>继续挑战<span>下一题答对后 {round.nextReward} 星贝</span></button></div>:<button className="btn primary challenge-submit" disabled={busy||(!feedback&&(!response||remaining===0))} onClick={feedback?next:submit}>{busy?'正在保存…':feedback?(round.status==='active'?'下一题 →':'查看本轮结果'):'提交答案'}</button>}
        </>}
      </section>
      <p className="challenge-gentle">{round.mode==='double'?'本轮答错或超时，暂存星贝清零；已有星贝不变。':'超时算未答对。看懂解析后，再开始下一题。'}</p>
    </div>
    <Sheet open={exit} onClose={()=>setExit(false)} title="现在结束这轮挑战？" sub={round.canCashOut?`现在结束可领取 ${round.pending} 星贝。今天的这次机会已经使用，错题记录会保留。`:round.status!=='active'?'本轮已经结束，可以查看最终结果。':'现在结束不发放星贝，今天的这次机会已经使用。已记录的错题会保留。'}><div className="challenge-exit"><button className="btn challenge-cashout" disabled={busy} onClick={round.canCashOut?cashout:()=>{if(round.status!=='active'){setExit(false);setResult(true);}else void run(()=>api.abandon(round.id),true);}}>{round.canCashOut?`结束答题，领取 ${round.pending} 星贝`:'结束并查看结果'}</button><button className="btn primary" disabled={busy} onClick={()=>setExit(false)}>{round.status==='active'?'继续答题':'返回解析'}</button></div></Sheet>
  </main>;
}

export function WrongBook() {
  const [subject,setSubject]=useState(''),[state,setState]=useState(''),[relapse,setRelapse]=useState(false),[data,setData]=useState<WrongPage|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const load=useCallback(async(offset=0)=>{setBusy(true);setError('');try{const d=await api.wrong(new URLSearchParams({subject,state,relapse:relapse?'1':'0',offset:String(offset)}));setData(old=>offset&&old?{...d,items:[...old.items,...d.items]}:d);}catch(e:any){setError(e.message);}finally{setBusy(false);}},[subject,state,relapse]);
  useEffect(()=>{setData(null);void load();},[load]);
  return <section className="challenge-wrong-book"><div className="challenge-heading"><span className="eyebrow">每次回顾，都更熟悉一点</span><h1>我的错题本</h1><p>按做错次数从多到少排列。答对后标记已掌握，记录仍保留。</p></div><div className="challenge-wrong-filters"><label>学科<select value={subject} disabled={busy} onChange={e=>setSubject(e.target.value)}><option value="">全部学科</option><option value="poetry">古诗词</option><option value="math">数学计算</option></select></label><label>状态<select value={state} disabled={busy} onChange={e=>setState(e.target.value)}><option value="">全部状态</option><option value="pending">待巩固</option><option value="mastered">已掌握</option></select></label><label className="challenge-check"><input type="checkbox" checked={relapse} disabled={busy} onChange={e=>setRelapse(e.target.checked)}/>只看掌握后再错</label></div>
    {error&&<p className="challenge-error" role="alert">{error}<button onClick={()=>void load()}>重试</button></p>}{busy&&!data&&<p role="status">正在打开错题本…</p>}{data&&<><p className="challenge-list-count">共 {data.total} 道 · 下次挑战会随机加入符合当前范围的错题</p>{!data.items.length?<div className="challenge-empty"><h2>这里还没有符合条件的错题</h2><p>挑战中答错的题会自动记下来；答对后会变为已掌握。</p></div>:data.items.map(w=><details className="challenge-wrong-item" key={w.question.id}><summary><div><span className="challenge-badge">{w.state==='mastered'?'✓ 已掌握':'待巩固'}</span>{w.relapseCount>0&&<span className="challenge-badge relapse">掌握后再错 {w.relapseCount} 次</span>}<h2>{w.question.prompt}</h2><p>{w.question.title} · 累计错 {w.wrongCount} 次 · 答对 {w.correctCount} 次</p></div><span className="challenge-details-label">看解析 ＋</span></summary><div className="challenge-wrong-detail"><b>正确答案：{w.question.answer}</b><p>{w.question.explanation}</p><small>最近做错：{new Date(w.lastWrongAt).toLocaleString('zh-CN')}</small></div></details>)}{data.next!==null&&<button className="btn ghost" disabled={busy} onClick={()=>void load(data.next!)}>{busy?'加载中…':'再看 30 道'}</button>}</>}
  </section>;
}
