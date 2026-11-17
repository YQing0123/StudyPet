/** Shared paging controls: replace the current page instead of appending to a long feed. */
export default function Pagination({page,pageSize,total,hasNext,busy,onPage,onPageSize}:{page:number;pageSize:number;total?:number;hasNext?:boolean;busy?:boolean;onPage:(page:number)=>void;onPageSize?:(size:number)=>void}) {
  const pages=total===undefined?null:Math.max(1,Math.ceil(total/pageSize));
  const numbers=pages?Array.from({length:pages},(_,i)=>i+1).filter(n=>n===1||n===pages||Math.abs(n-page)<=1):[];
  return <nav className="pagination" aria-label="列表分页">
    <span className="pagination-summary" role="status">{total===undefined?`第 ${page} 页`:`共 ${total} 条 · 第 ${page} / ${pages} 页`}</span>
    {onPageSize&&<label className="pagination-size">每页<select aria-label="每页条数" value={pageSize} disabled={busy} onChange={e=>onPageSize(Number(e.target.value))}>{[20,30,50].map(n=><option key={n} value={n}>{n} 条</option>)}</select></label>}
    <div className="pagination-buttons"><button className="btn ghost sm" disabled={busy||page<=1} onClick={()=>onPage(page-1)} aria-label="上一页">上一页</button>
      {numbers.map((n,i)=><span key={n} className={Math.abs(n-page)>1?'pagination-edge':undefined}>{i>0&&n>numbers[i-1]+1&&<span className="pagination-gap">…</span>}<button className={`pagination-number ${page===n?'is-on':''}`} aria-label={`第 ${n} 页`} aria-current={page===n?'page':undefined} disabled={busy} onClick={()=>onPage(n)}>{n}</button></span>)}
      <button className="btn ghost sm" disabled={busy||(pages?page>=pages:!hasNext)} onClick={()=>onPage(page+1)} aria-label="下一页">下一页</button></div>
  </nav>;
}
