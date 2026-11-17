import { useEffect, useRef, useState } from 'react';
import { Sheet } from '../mvp/Sheets';
import { v2 } from './api';
import PointHistorySheet from './PointHistory';
import type { PenaltyItem } from './types';
import './points.css';

export default function PenaltyPanel({ onChanged, toast }: { onChanged: () => Promise<void>; toast: (message: string, tone?: string) => void }) {
  const [items, setItems] = useState<PenaltyItem[]>([]);
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), busyRef = useRef(false);
  const pending = useRef<{ itemId: string; requestId: string } | null>(null);
  const [edit, setEdit] = useState<PenaltyItem | null | undefined>(undefined);
  const [history, setHistory] = useState(false);
  const load = async () => {
    try { setItems(await v2.penalties()); setReady(true); setError(''); }
    catch (e: any) { setError(e.message || '惩罚清单加载失败'); }
  };
  useEffect(() => { void load(); }, []);
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await action(); }
    catch (e: any) { toast(e.message || '操作失败，请重试', 'warn'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const apply = (item: PenaltyItem) => run(async () => {
    if (pending.current?.itemId !== item.id) pending.current = { itemId: item.id, requestId: Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('') };
    const result = await v2.applyPenalty(item.id, pending.current.requestId);
    pending.current = null;
    toast(`${result.repeated ? '这笔扣分已记录' : '已扣除'} ${Math.abs(result.entry.delta)} 星贝，可在积分明细查看`, 'warn');
    await onChanged();
  });

  return <div className="parent-card penalty-panel">
    <div className="parent-card-head"><div><h2>快捷惩罚清单</h2><p>为当前孩子约定扣分规则，点击清单中的「扣除」即可记账。余额不足仍会按设定扣除，可为负数。</p></div>
      <div className="penalty-head-actions"><button className="btn ghost sm" onClick={() => setHistory(true)}>积分明细</button><button className="btn primary sm" disabled={busy} onClick={() => setEdit(null)}>＋ 新增惩罚</button></div>
    </div>
    {error && <div className="point-error" role="alert"><p>{error}</p><button className="btn ghost sm" onClick={() => void load()}>重新加载</button></div>}
    {!ready && !error && <p className="point-help">正在加载惩罚清单…</p>}
    {ready && items.length === 0 && <div className="parent-empty small"><p>还没有惩罚项目。先和孩子约定规则，再添加到快捷清单。</p></div>}
    <div className="penalty-list">{items.map(item => <article key={item.id} className={`penalty-item ${item.active ? '' : 'is-off'}`}>
      <div className="penalty-item-copy"><h3>{item.title}{!item.active && <span>已停用</span>}</h3><p>{item.note || '按约定扣除星贝，记录会同步给学生。'}</p></div>
      <button className="btn penalty-apply" disabled={busy || !item.active} onClick={() => void apply(item)} aria-label={`扣除 ${item.title} ${item.points} 星贝`}>扣除 {item.points} 星贝</button>
      <div className="penalty-item-actions"><button className="link-btn" disabled={busy} onClick={() => setEdit(item)}>编辑</button><button className="link-btn danger-text" disabled={busy} onClick={() => void run(async () => { setItems(await v2.deletePenalty(item.id)); toast('已删除项目，历史扣分记录保留'); })}>删除</button></div>
    </article>)}</div>
    {edit !== undefined && <PenaltyForm item={edit} busy={busy} onClose={() => { if (!busyRef.current) setEdit(undefined); }} onSave={body => void run(async () => { setItems(await v2.savePenalty(body)); setReady(true); setEdit(undefined); toast('惩罚项目已保存'); })} />}
    <PointHistorySheet open={history} onClose={() => setHistory(false)} />
  </div>;
}

function PenaltyForm({ item, busy, onClose, onSave }: { item: PenaltyItem | null; busy: boolean; onClose: () => void; onSave: (body: Partial<PenaltyItem>) => void }) {
  const [title, setTitle] = useState(item?.title || '');
  const [points, setPoints] = useState(String(item?.points ?? 10));
  const [note, setNote] = useState(item?.note || '');
  const [active, setActive] = useState(item?.active ?? true);
  return <Sheet open onClose={onClose} title={item ? '编辑惩罚项目' : '新增惩罚项目'} sub="保存为当前孩子的快捷扣分项目。">
    <form className="penalty-form" onSubmit={e => { e.preventDefault(); onSave({ ...(item ? { id: item.id } : {}), title: title.trim(), points: Number(points), note: note.trim(), active }); }}>
      <label className="field-label">惩罚名称<input className="text-input" required maxLength={40} value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：超过约定的游戏时间" /></label>
      <label className="field-label">扣除星贝<input className="text-input" required type="number" min={1} max={9999} step={1} value={points} onChange={e => setPoints(e.target.value)} /></label>
      <label className="field-label">规则说明（可选）<textarea className="text-area" maxLength={160} value={note} onChange={e => setNote(e.target.value)} placeholder="写清楚约定，学生也能在扣分明细中看到。" /></label>
      <label className="penalty-enabled"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />启用此快捷扣分项目</label>
      <button className="btn primary" type="submit" disabled={busy || !title.trim()}>{busy ? '保存中…' : '保存惩罚项目'}</button>
    </form>
  </Sheet>;
}
