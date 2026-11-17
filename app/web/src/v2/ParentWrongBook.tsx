import {useCallback,useEffect,useRef,useState} from 'react';
import {Sheet} from '../mvp/Sheets';
import Pagination from './Pagination';
import {challengeApi as api,subjectLabel,type WrongPage} from './challenge-api';

type Item=WrongPage['items'][number];
const dateTime=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const shortDate=(value:string)=>new Date(value).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});

export default function ParentWrongBook(){
 const [filters,setFilters]=useState({subject:'',state:'',relapse:'0',sort:'frequent',q:''}),[search,setSearch]=useState('');
 const [page,setPage]=useState(1),[limit,setLimit]=useState(20),[data,setData]=useState<WrongPage|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState<Item|null>(null),[filtersOpen,setFiltersOpen]=useState(false);
 const requestSeq=useRef(0),panel=useRef<HTMLElement>(null);
 const load=useCallback(async()=>{const seq=++requestSeq.current;setBusy(true);setError('');try{
  const d=await api.wrong(new URLSearchParams({...filters,offset:String((page-1)*limit),limit:String(limit)}));
  if(seq!==requestSeq.current)return;
  if(d.total>0&&d.offset>=d.total){setPage(Math.ceil(d.total/limit));return;}
  if(d.total===0&&page!==1){setPage(1);return;}
  setData(d);
 }catch(e:any){if(seq===requestSeq.current)setError(e.message);}finally{if(seq===requestSeq.current)setBusy(false);}},[filters,page,limit]);
 useEffect(()=>{void load();return()=>{requestSeq.current++;};},[load]);
 const filter=(patch:Partial<typeof filters>)=>{setFilters(old=>({...old,...patch}));setPage(1);};
 const clear=()=>{setSearch('');filter({subject:'',state:'',relapse:'0',sort:'frequent',q:''});};
 const hasFilters=!!(filters.subject||filters.state||filters.relapse==='1'||filters.q||filters.sort!=='frequent');
 const filterSummary=[filters.subject?subjectLabel(filters.subject as 'poetry'|'math'):'全部学科',filters.state==='pending'?'待巩固':filters.state==='mastered'?'已掌握':'全部状态',filters.relapse==='1'?'仅掌握后再错':'',filters.sort==='recent'?'最近做错':filters.sort==='relapse'?'掌握后再错最多':''].filter(Boolean).join(' · ');
 return <section ref={panel} className="workspace-panel parent-wrong-book" aria-label="孩子的错题本">
  <div className="wrong-book-overview">{data&&<dl className="wrong-book-summary" aria-label="当前孩子全部错题统计"><div><dt>累计错题</dt><dd>{data.summary.total}<small>道</small></dd></div><div><dt>待巩固</dt><dd>{data.summary.pending}<small>道</small></dd></div><div><dt>已掌握</dt><dd>{data.summary.mastered}<small>道</small></dd></div><div><dt>掌握后再错</dt><dd>{data.summary.relapse}<small>道</small></dd></div></dl>}<button className="btn ghost sm" disabled={busy} onClick={()=>void load()}>刷新统计</button></div>
  <form className="workspace-toolbar wrong-book-filters" onSubmit={e=>{e.preventDefault();filter({q:search.trim()});}}>
   <div id="wrong-book-filter-options" className={`question-filter-options ${filtersOpen?'is-open':''}`}><label>学科<select disabled={busy} value={filters.subject} onChange={e=>filter({subject:e.target.value})}><option value="">全部学科</option><option value="poetry">古诗词</option><option value="math">数学计算</option></select></label><label>掌握状态<select disabled={busy} value={filters.state} onChange={e=>filter({state:e.target.value})}><option value="">全部状态</option><option value="pending">待巩固</option><option value="mastered">已掌握</option></select></label><label>排序<select disabled={busy} value={filters.sort} onChange={e=>filter({sort:e.target.value})}><option value="frequent">做错最多</option><option value="recent">最近做错</option><option value="relapse">掌握后再错最多</option></select></label><label className="wrong-book-relapse"><input type="checkbox" disabled={busy} checked={filters.relapse==='1'} onChange={e=>filter({relapse:e.target.checked?'1':'0'})}/>只看掌握后再错</label></div>
   <label className="toolbar-search">题目 / 诗名<input aria-label="搜索孩子的错题" value={search} onChange={e=>setSearch(e.target.value)} maxLength={80} placeholder="输入题目、诗名或题目 ID"/></label><button className="btn primary" disabled={busy}>查询</button><button type="button" className="btn ghost sm wrong-book-filter-toggle" aria-expanded={filtersOpen} aria-controls="wrong-book-filter-options" onClick={()=>setFiltersOpen(old=>!old)}>{filtersOpen?'收起':'筛选'}</button>
  </form>
  {hasFilters&&<div className="wrong-book-filter-summary"><span>{filterSummary}{filters.q&&` · “${filters.q}”`}</span><button className="link-btn" disabled={busy} onClick={clear}>清除筛选</button></div>}
  {error&&<p className="account-error" role="alert">{error}{data&&' 当前保留上次查询结果。'}<button className="link-btn" onClick={()=>void load()}>重试</button></p>}
  {data&&<Pagination page={Math.floor(data.offset/data.limit)+1} pageSize={data.limit} total={data.total} busy={busy} onPage={n=>{setPage(n);panel.current?.scrollIntoView({block:'start'});}} onPageSize={n=>{setLimit(n);setPage(1);}}/>}
  <div className="question-list" aria-busy={busy}>
   <div className="question-list-head wrong-book-columns" aria-hidden="true"><span>题目与来源</span><span>答题统计</span><span>掌握状态</span><span>最近出错</span><span>操作</span></div>
   {!data?<div className="workspace-empty" role="status">{busy?'正在读取错题…':'错题暂未加载，请重试。'}</div>:<>
    {data.items.map(item=><article className="question-row wrong-book-columns" key={item.question.id}><div className="question-row-main"><h3>{item.question.prompt}</h3><p>{subjectLabel(item.question.subject)} · {item.question.title}</p></div><div className="wrong-book-counts"><span>答错 <b>{item.wrongCount}</b> 次</span><span>答对 <b>{item.correctCount}</b> 次</span></div><div className="wrong-book-state"><span className={`workspace-status ${item.state==='pending'?'is-warning':''}`}>{item.state==='mastered'?'已掌握':'待巩固'}</span>{item.relapseCount>0&&<small>掌握后再错 {item.relapseCount} 次</small>}</div><time className="wrong-book-date" dateTime={item.lastWrongAt} title={dateTime(item.lastWrongAt)}><span className="wrong-book-date-label">最近出错 </span>{shortDate(item.lastWrongAt)}</time><button className="btn ghost sm" disabled={busy} onClick={()=>setSelected(item)}>查看详情</button></article>)}
    {!data.items.length&&<div className="workspace-empty"><h3>{data.summary.total?'没有符合条件的错题':'还没有错题记录'}</h3><p>{data.summary.total?'可以调整筛选条件或更换搜索词。':'孩子在挑战中做错的题会自动记录在这里。'}</p>{hasFilters&&<button className="btn ghost" onClick={clear}>清除筛选</button>}</div>}
   </>}
  </div>
  <p className="workspace-footnote">统计为当前孩子的全部错题，同一道题只计 1 道。已掌握记录会保留，再次答错后回到待巩固；符合学习范围的错题会随机加入后续挑战。</p>
  <Sheet open={!!selected} onClose={()=>setSelected(null)} title="错题详情" sub={selected?`${subjectLabel(selected.question.subject)} · ${selected.question.title}`:undefined}>
   {selected&&<div className="question-detail"><span className={`workspace-status ${selected.state==='pending'?'is-warning':''}`}>{selected.state==='mastered'?'已掌握':'待巩固'}</span><h2>{selected.question.prompt}</h2><dl className="wrong-book-detail-stats"><div><dt>累计答错</dt><dd>{selected.wrongCount} 次</dd></div><div><dt>累计答对</dt><dd>{selected.correctCount} 次</dd></div><div><dt>掌握后再错</dt><dd>{selected.relapseCount} 次</dd></div></dl><div className="question-answer"><span>正确答案</span><strong>{selected.question.answer}</strong></div>{selected.question.options&&<p>候选项：{selected.question.options.join(' / ')}</p>}<h3>答案解析</h3><p>{selected.question.explanation}</p><p className="workspace-footnote">首次做错：{dateTime(selected.firstWrongAt)}<br/>最近做错：{dateTime(selected.lastWrongAt)}{selected.masteredAt&&<><br/>{selected.state==='mastered'?'最近掌握':'上次掌握'}：{dateTime(selected.masteredAt)}</>}<br/>来源：{selected.question.source}<br/>题目 ID：{selected.question.id}</p><div className="account-edit-actions"><button className="btn ghost" onClick={()=>setSelected(null)}>关闭详情</button></div></div>}
  </Sheet>
 </section>;
}
