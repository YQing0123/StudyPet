import { useEffect, useRef, useState } from 'react';
import { Sheet } from '../mvp/Sheets';
import { v2 } from './api';
import type { PointHistory } from './types';
import './points.css';

const time = (date: string) => new Date(date).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

export default function PointHistorySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Sheet open={open} onClose={onClose} title="积分明细" sub="每一笔星贝的获得与扣除，都记在这里。" wide>
    {open && <History />}
  </Sheet>;
}

function History() {
  const [filter, setFilter] = useState('all');
  const [data, setData] = useState<PointHistory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0), loading = useRef(false), retryBefore = useRef('');
  const load = async (before = '', selected = filter) => {
    const version = ++request.current;
    retryBefore.current = before;
    loading.current = true; setBusy(true); setError('');
    try {
      const result = await v2.pointHistory(selected, before);
      if (version !== request.current) return;
      setData(previous => ({ ...result, items: before && previous ? [...previous.items, ...result.items] : result.items }));
    } catch (e: any) { if (version === request.current) setError(e.message || '积分记录加载失败'); }
    finally { if (version === request.current) { loading.current = false; setBusy(false); } }
  };
  useEffect(() => {
    setData(null); void load('', filter);
    return () => { request.current++; loading.current = false; };
  }, [filter]);

  return <div className="point-history">
    {data && <div className="point-summary">
      <div><span>当前星贝</span><b>{data.summary.balance}</b></div>
      <div><span>累计得分</span><b className="point-income">+{data.summary.earned}</b></div>
      <div><span>累计扣除</span><b className="point-expense">−{data.summary.spent}</b></div>
    </div>}
    <div className="point-filter-row"><nav className="filter-row" aria-label="积分明细筛选">
      {([['all', '全部'], ['income', '得分'], ['expense', '扣分与支出']] as const).map(([key, label]) => <button key={key} className={`chip ${filter === key ? 'is-on' : ''}`} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
    </nav><button className="link-btn" disabled={busy} onClick={() => void load()}>刷新</button></div>
    <p className="point-help">扣除包含家长惩罚、兑换奖励和材料等支出。时间为北京时间。</p>
    <div aria-live="polite" aria-busy={busy}>
      {data && data.items.length === 0 && <div className="parent-empty small"><p>还没有{filter === 'income' ? '得分' : filter === 'expense' ? '扣分或支出' : '积分'}记录。</p></div>}
      <ol className="point-list">{data?.items.map(item => <li key={item.id} className="point-row">
        <span className={`point-mark ${item.delta > 0 ? 'is-income' : item.delta === 0 ? 'is-neutral' : ''}`} aria-hidden="true">{item.kind === 'penalty' ? '!' : item.delta > 0 ? '+' : item.delta < 0 ? '−' : '·'}</span>
        <div className="point-row-main"><h4>{item.reason}</h4><p><span>{item.kind === 'penalty' ? '家长惩罚' : item.delta > 0 ? '积分获得' : item.delta < 0 ? '兑换支出' : '积分未变'}</span> · <time dateTime={item.createdAt}>{time(item.createdAt)}</time></p></div>
        <b className={item.delta > 0 ? 'point-income' : item.delta < 0 ? 'point-expense' : 'point-help'}>{item.delta > 0 ? '+' : item.delta < 0 ? '−' : ''}{Math.abs(item.delta)}</b>
      </li>)}</ol>
      {busy && <p className="point-help" role="status">正在加载积分记录…</p>}
      {error && <div className="point-error" role="alert"><p>{error}</p><button className="btn ghost sm" disabled={busy} onClick={() => void load(retryBefore.current)}>重试</button></div>}
      {data?.next && !error && <button className="btn ghost point-more" disabled={busy} onClick={() => { if (!loading.current) void load(data.next!); }}>{busy ? '加载中…' : '加载更多记录'}</button>}
    </div>
  </div>;
}
