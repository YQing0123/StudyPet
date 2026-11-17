import {useEffect,useRef,useState} from 'react';
import {challengeApi as api,type Settings,type Policy} from './challenge-api';
import ParentWrongBook from './ParentWrongBook';
import './challenges.css';
type View='rules'|'scope'|'wrong';
export default function ChallengeSettings(){
 const [data,setData]=useState<Settings|null>(null),[form,setForm]=useState<Policy|null>(null),[limits,setLimits]=useState({dailyRounds:'3',questionsPerRound:'10',roundMinutes:'10'});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(''),[gradeFilter,setGradeFilter]=useState(2),[view,setView]=useState<View>('rules'),[wrongOpened,setWrongOpened]=useState(false);
 const busyRef=useRef(false);
 const apply=(d:Settings)=>{setData(d);setForm(d.policy);setLimits({dailyRounds:String(d.policy.dailyRounds),questionsPerRound:String(d.policy.questionsPerRound),roundMinutes:String(d.policy.roundMinutes)});};
 const load=async()=>{try{const d=await api.settings();apply(d);setGradeFilter(d.policy.grade);setError('');}catch(e:any){setError(e.message);}};
 useEffect(()=>{void load();},[]);
 const update=(patch:Partial<Policy>)=>{setForm(f=>f?{...f,...patch}:f);setSaved('');};
 return <section className="parent-section challenge-settings">
  {view!=='wrong'&&<header className="workspace-section-head"><div><h2>学习挑战</h2><p>安排合适的练习节奏，再按孩子的学习进度选择范围。</p></div></header>}
  <nav className="section-tabs" aria-label="学习挑战设置分区">{([['rules','挑战规则'],['scope','学习范围'],['wrong','孩子的错题本']] as const).map(([key,label])=><button key={key} className={view===key?'is-on':''} aria-current={view===key?'page':undefined} onClick={()=>{setView(key);if(key==='wrong')setWrongOpened(true);}}>{label}</button>)}</nav>
  {wrongOpened&&<div hidden={view!=='wrong'}><ParentWrongBook/></div>}
  {view!=='wrong'&&<>
   {!form||!data?<div className="workspace-panel"><p role="status">{error?'设置暂未加载。':'正在读取设置…'}</p>{error&&<p className="account-error" role="alert">{error}<button className="link-btn" onClick={load}>重新读取</button></p>}</div>:<form noValidate onSubmit={async e=>{e.preventDefault();
    const fields=[['dailyRounds',0,20],['questionsPerRound',5,20],['roundMinutes',1,60]] as const;
    if(fields.some(([key,min,max])=>limits[key].trim()===''||!Number.isInteger(Number(limits[key]))||Number(limits[key])<min||Number(limits[key])>max)){setView('rules');setError('请填写有效的每日次数（0–20）、每轮题量（5–20）和时长（1–60 分钟），均需为整数。');return;}
    if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');setSaved('');try{await api.save({...form,dailyRounds:Number(limits.dailyRounds),questionsPerRound:Number(limits.questionsPerRound),roundMinutes:Number(limits.roundMinutes)});apply(await api.settings());setSaved('挑战设置已保存。每日次数立即生效，题量、时长与范围从下一轮开始生效。');}catch(e:any){setError(e.message);}finally{busyRef.current=false;setBusy(false);}}}>
    <div hidden={view!=='rules'}><section className="workspace-panel">
     <div className="workspace-section-head"><div><h3>每日机会与每轮规则</h3><p>各学科、难度与玩法共用次数。<br/>开始挑战后不退回机会。</p></div></div>
     <div className="challenge-settings-grid limits-grid">
      <label htmlFor="challenge-daily-rounds">每天免费挑战<input id="challenge-daily-rounds" type="number" min={0} max={20} step={1} required value={limits.dailyRounds} disabled={busy} onChange={e=>{setLimits({...limits,dailyRounds:e.target.value});setSaved('');}}/><small>0–20 次，0 次表示暂停挑战</small></label>
      <label htmlFor="challenge-round-questions">每次挑战题量<input id="challenge-round-questions" type="number" min={5} max={20} step={1} required value={limits.questionsPerRound} disabled={busy} onChange={e=>{setLimits({...limits,questionsPerRound:e.target.value});setSaved('');}}/><small>5–20 题，按孩子的专注力安排</small></label>
      <label htmlFor="challenge-round-minutes">每轮最长时间<input id="challenge-round-minutes" type="number" min={1} max={60} step={1} required value={limits.roundMinutes} disabled={busy} onChange={e=>{setLimits({...limits,roundMinutes:e.target.value});setSaved('');}}/><small>1–60 分钟，到时结束本轮</small></label>
     </div>
     <p className="settings-callout">单题仍有独立倒计时，整轮到时也会结束。题量和时长调整会在下一轮应用，正在进行的挑战保持原规则。</p>
     <label className="challenge-check challenge-option"><input type="checkbox" disabled={busy} checked={form.doubleEnabled} onChange={e=>update({doubleEnabled:e.target.checked})}/><span><b>允许翻倍模式</b><small>第 3 题起可领取；答错或超时，清空本轮暂存星贝。</small></span></label>
    </section>
    <section className="workspace-panel challenge-reward-explainer"><div className="workspace-section-head"><div><h3>星贝奖励</h3><p>调整题量后按正确率分档，每日得分累计。</p></div></div><div className="reward-policy-grid"><div><h4>普通模式</h4><p>完成整轮且正确率达到 80% / 90% / 100%，普通难度分别得 10 / 13 / 16 星贝；挑战难度奖励 ×2，困难难度 ×4。</p><p>例如 10 题需答对 8 / 9 / 10 题。中途退出或整轮到时不发奖。</p></div><div><h4>翻倍模式</h4><p>连续答对得分按 1、2、4、8…递增，第 3 题起可结束领取；第 10 题达到 512 星贝，后续保持这个上限。</p><p>答错或超时结束本轮，已有钱包余额不受影响。</p></div></div></section></div>
    <div hidden={view!=='scope'}><section className="workspace-panel"><div className="workspace-section-head"><div><h3>年级与学期</h3><p>设置孩子当前进度，具体练习内容仍以勾选范围为准。</p></div></div><div className="challenge-settings-grid"><label>孩子当前年级<select value={form.grade} disabled={busy} onChange={e=>update({grade:Number(e.target.value)})}>{[1,2,3,4,5,6].map(g=><option key={g} value={g}>{g} 年级</option>)}</select></label><label>当前学期<select value={form.term} disabled={busy} onChange={e=>update({term:e.target.value as Policy['term']})}><option value="upper">上学期</option><option value="lower">下学期</option></select></label><label>数学教材<select value="人教版" disabled><option>人教版</option></select></label></div></section>
     <section className="workspace-panel"><div className="workspace-section-head"><div><h3>数学计算范围</h3><p>已支持一上、一下和二上计算；三至六年级目前可选二上内容复习。</p></div></div><div className="challenge-settings-grid"><label>训练内容<select disabled={busy} value={form.mathScope} onChange={e=>update({mathScope:e.target.value,topics:e.target.value.startsWith('1')?['add']:['add','multiply','length']})}><option value="1upper">一上：20 以内加减</option><option value="1lower">一下：100 以内加减</option><option value="2upper">二上：加减、口诀、厘米和米</option></select></label></div><div className="challenge-topic-options">{data.topics.map(t=><label key={t.id} className="challenge-check"><input type="checkbox" disabled={busy||(form.mathScope.startsWith('1')&&t.id!=='add')} checked={form.topics.includes(t.id)} onChange={e=>update({topics:e.target.checked?[...form.topics,t.id]:form.topics.filter(x=>x!==t.id)})}/>{t.id==='add'&&form.mathScope==='1upper'?'20 以内加减法':t.name}</label>)}</div><p className="workspace-footnote">不包含除法和应用题，困难难度只增加计算步骤。</p></section>
     <section className="workspace-panel"><div className="workspace-section-head"><div><h3>古诗词已学篇目 <span className="workspace-tag">已选 {form.poemIds.length} 首</span></h3><p>普通难度仅考勾选篇目的上下句，挑战和困难加入本年级及以前的清单拓展与注释。</p></div></div><label className="challenge-check"><input type="checkbox" disabled={busy} checked={form.nextGrade} onChange={e=>update({nextGrade:e.target.checked})}/>困难难度允许少量下一年级的短诗句</label><label className="poem-grade-filter">查看清单年级<select disabled={busy} value={gradeFilter} onChange={e=>setGradeFilter(Number(e.target.value))}>{[1,2,3,4,5,6].map(g=><option key={g} value={g}>{g} 年级</option>)}</select></label><p className="workspace-footnote">清单编排与教材可能不同，请按孩子真正学过的篇目勾选。</p><div className="challenge-poem-picker">{data.poems.filter(p=>p.grade===gradeFilter).map(p=><label key={p.id}><input type="checkbox" disabled={busy} checked={form.poemIds.includes(p.id)} onChange={e=>update({poemIds:e.target.checked?[...form.poemIds,p.id]:form.poemIds.filter(id=>id!==p.id)})}/><span>{p.title}<small>{p.source} · {p.group==='core'?'清单必背':'清单拓展'}</small></span></label>)}</div></section></div>
    <div className="challenge-settings-save">{saved&&<p className="account-notice" role="status">{saved}</p>}{error&&<p className="account-error" role="alert">{error}</p>}<div><span>规则与学习范围将一起保存</span><button className="btn primary" disabled={busy}>{busy?'正在保存…':'保存挑战设置'}</button></div></div>
   </form>}
  </>}
 </section>;
}
