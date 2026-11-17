import {useCallback,useEffect,useRef,useState} from 'react';
import {Sheet} from '../mvp/Sheets';
import Pagination from './Pagination';
import type {Question} from './challenge-api';
import './challenges.css';
type Item=Question&{disabled:boolean;grade:number;group:string;topic:string};
type Page={total:number;offset:number;limit:number;next:number|null;items:Item[]};
async function request<T>(path:string,body?:unknown):Promise<T>{
 const r=await fetch('/api/admin/challenges/questions'+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const d=await r.json();if(!r.ok){if(r.status===401)window.dispatchEvent(new Event('island-admin-expired'));throw Error(d.error||'题库操作失败');}return d;
}
export default function ChallengeAdmin(){
 const [filters,setFilters]=useState({subject:'poetry',grade:'',status:'',q:''}),[search,setSearch]=useState('');
 const [page,setPage]=useState(1),[limit,setLimit]=useState(20),[data,setData]=useState<Page|null>(null),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[selected,setSelected]=useState<Item|null>(null);
 const [filtersOpen,setFiltersOpen]=useState(false);
 const requestSeq=useRef(0),list=useRef<HTMLDivElement>(null),savingRef=useRef(false);
 const load=useCallback(async()=>{const seq=++requestSeq.current;setBusy(true);setError('');try{const d=await request<Page>('?'+new URLSearchParams({...filters,offset:String((page-1)*limit),limit:String(limit)}));if(seq===requestSeq.current){if(d.total>0&&d.offset>=d.total){setPage(Math.ceil(d.total/limit));return;}if(d.total===0&&page!==1){setPage(1);return;}setData(d);}}catch(e:any){if(seq===requestSeq.current)setError(e.message);}finally{if(seq===requestSeq.current)setBusy(false);}},[filters,page,limit]);
 useEffect(()=>{void load();return()=>{requestSeq.current++;};},[load]);
 const filter=(patch:Partial<typeof filters>)=>{setFilters(f=>({...f,...patch}));setPage(1);setNotice('');};
 const changePage=(n:number)=>{setPage(n);list.current?.closest('.workspace-panel')?.scrollIntoView({block:'start'});};
 const toggle=async()=>{if(!selected||savingRef.current)return;savingRef.current=true;setSaving(true);setError('');try{await request('/'+encodeURIComponent(selected.id),{disabled:!selected.disabled});setSelected({...selected,disabled:!selected.disabled});setNotice(selected.disabled?'题目已恢复，可用于新挑战。':'题目已停用，已开始的挑战保留原题。');await load();}catch(e:any){setError(e.message);}finally{savingRef.current=false;setSaving(false);}};
 return <section className="workspace-panel question-bank-panel" aria-labelledby="question-bank-title">
  <div className="workspace-section-head"><div><h2 id="question-bank-title">学习挑战题库</h2><p>查看答案，管理题目的出题状态。</p></div><span className="workspace-tag">155 首古诗词 · 规则计算题</span></div>
  <form className="workspace-toolbar question-filters" onSubmit={e=>{e.preventDefault();filter({q:search.trim()});}}>
   <div id="question-filter-options" className={`question-filter-options ${filtersOpen?'is-open':''}`}><label>学科<select value={filters.subject} onChange={e=>filter({subject:e.target.value})}><option value="poetry">古诗词</option><option value="math">数学计算</option></select></label>
   <label>清单年级<select value={filters.grade} onChange={e=>filter({grade:e.target.value})}><option value="">全部年级</option>{[1,2,3,4,5,6].map(g=><option value={g} key={g}>{g} 年级</option>)}</select></label>
   <label>出题状态<select value={filters.status} onChange={e=>filter({status:e.target.value})}><option value="">全部状态</option><option value="enabled">可出题</option><option value="disabled">已停用</option></select></label></div>
   <label className="toolbar-search">题目 / 诗名<input aria-label="搜索题目或诗名" value={search} onChange={e=>setSearch(e.target.value)} maxLength={80} placeholder="输入题目、诗名或题目 ID"/></label><button className="btn primary" disabled={busy}>查询</button>
   <button type="button" className="question-filter-toggle" aria-expanded={filtersOpen} aria-controls="question-filter-options" onClick={()=>setFiltersOpen(x=>!x)}>筛选条件 · {filters.subject==='poetry'?'古诗词':'数学'} / {filters.grade?`${filters.grade} 年级`:'全部年级'} / {filters.status==='disabled'?'已停用':filters.status==='enabled'?'可出题':'全部状态'}<span aria-hidden="true">{filtersOpen?'收起 −':'展开 ＋'}</span></button>
  </form>
  {error&&!selected&&<p role="alert" className="account-error">{error}<button className="link-btn" onClick={()=>void load()}>重试</button></p>}
  {notice&&<p role="status" className="account-notice">{notice}</p>}
  {data&&<Pagination page={Math.floor(data.offset/data.limit)+1} pageSize={data.limit} total={data.total} busy={busy} onPage={changePage} onPageSize={n=>{setLimit(n);setPage(1);}}/>}
  <div ref={list} className="question-list" aria-busy={busy}>
   <div className="question-list-head" aria-hidden="true"><span>题目与来源</span><span>年级</span><span>状态</span><span>操作</span></div>
   {!data?<div className="workspace-empty" role="status">{busy?'正在读取题库…':'题库暂未加载，请重试。'}</div>:<>
    {data.items.map(item=><article className="question-row" key={item.id}><div className="question-row-main"><h3>{item.prompt}</h3><p>{item.title} · {item.group==='core'?'清单必背':item.subject==='math'?'规则计算题':'清单拓展'}</p></div><span className="question-grade">{item.grade} 年级</span><span className={`workspace-status ${item.disabled?'is-muted':''}`}>{item.disabled?'已停用':'可出题'}</span><button className="btn ghost sm" disabled={busy} onClick={()=>{setSelected(item);setError('');}}>查看详情</button></article>)}
    {!data.items.length&&<div className="workspace-empty"><h3>没有匹配的题目</h3><p>可以调整筛选条件或更换搜索词。</p><button className="btn ghost" onClick={()=>{setSearch('');filter({grade:'',q:'',status:''});}}>清除筛选</button></div>}
   </>}
  </div>
  <p className="workspace-footnote">停用只影响新挑战；古诗词原文与注释来自提供的 155 首清单。</p>
  <Sheet open={!!selected} onClose={()=>{if(!saving){setSelected(null);setError('');}}} title="题目详情" sub={selected?`${selected.grade} 年级 · ${selected.title}`:undefined}>
   {selected&&<div className="question-detail"><span className={`workspace-status ${selected.disabled?'is-muted':''}`}>{selected.disabled?'已停用':'可出题'}</span><h2>{selected.prompt}</h2><div className="question-answer"><span>正确答案</span><strong>{selected.answer}</strong></div>{selected.options&&<p>候选项：{selected.options.join(' / ')}</p>}<h3>答案解析</h3><p>{selected.explanation}</p><p className="workspace-footnote">来源：{selected.source}<br/>题目 ID：{selected.id}</p>{error&&<p role="alert" className="account-error">{error}</p>}<div className="account-edit-actions"><button className="btn ghost" disabled={saving} onClick={()=>setSelected(null)}>关闭</button><button className={`btn ${selected.disabled?'primary':'danger'}`} disabled={saving} onClick={()=>void toggle()}>{saving?'正在保存…':selected.disabled?'恢复出题':'停用这道题'}</button></div></div>}
  </Sheet>
 </section>;
}
