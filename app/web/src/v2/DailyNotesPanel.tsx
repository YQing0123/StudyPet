import { useEffect, useRef, useState } from 'react';
import { accounts } from './accounts';
import { v2 } from './api';
import type { DailyNote } from './types';

export default function DailyNotesPanel({ notes, onChange, toast }: {
  notes: DailyNote[]; onChange: (notes: DailyNote[]) => void; toast: (text: string, tone?: string) => void;
}) {
  const [text, setText] = useState('');
  const [sender, setSender] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const initialized = useRef(false);
  const edited = useRef(false);
  const own = notes.find(n => n.senderId === sender);
  useEffect(() => { let live = true; accounts.session().then(s => { if (live) setSender(s.user?.id || ''); }).catch(() => {}); return () => { live = false; }; }, []);
  useEffect(() => { if (sender && !initialized.current) { if (!edited.current) setText(own?.text || ''); initialized.current = true; } }, [sender, own]);
  const send = async () => {
    if (busy) return;
    if (!text.trim()) { setError('先写一句想对孩子说的话吧'); return; }
    setBusy(true); setError('');
    try { onChange(await v2.sendNote(text)); toast(own ? '今日小纸条已更新' : '小纸条已送到孩子的小岛'); }
    catch (e: any) { setError(e.message || '发送失败，内容已保留，请重试'); }
    finally { setBusy(false); }
  };
  const remove = async (note: DailyNote) => {
    if (busy) return;
    setBusy(true); setError('');
    try { onChange(await v2.deleteNote(note.id)); if (note.senderId === sender) setText(''); toast('已撤回小纸条'); }
    catch (e: any) { setError(e.message || '撤回失败，请重试'); }
    finally { setBusy(false); }
  };
  return <section className="parent-section daily-notes-panel">
    <div className="parent-card"><div className="parent-card-head"><div><h2>给孩子一张今日小纸条</h2><p>宠物会把你的话带给孩子，与今日计划提醒轮播。每位家长每天可留一张，仅今天显示。</p></div><span className="note-today">仅今天</span></div>
      <label className="note-editor-label" htmlFor="daily-note-text">想对孩子说的话</label>
      <textarea id="daily-note-text" value={text} onChange={e => { edited.current = true; setText(Array.from(e.target.value).slice(0, 80).join('')); }} placeholder="例如：认真完成今天的阅读，晚上我们一起聊聊书里的故事。妈妈为你的坚持加油！" rows={4} aria-describedby="daily-note-help" disabled={busy} />
      <div className="note-editor-footer"><span id="daily-note-help">{Array.from(text).length}/80 字 · 发送给当前选中的孩子</span><button className="btn primary" disabled={busy || !text.trim()} onClick={send}>{busy ? '正在处理…' : own ? '更新今日小纸条' : '发送小纸条'}</button></div>
      {error && <p className="note-error" role="alert">{error}</p>}
    </div>
    <div className="parent-card"><div className="parent-card-head"><div><h2>今天收到的小纸条 <small>{notes.length}</small></h2><p>家庭里的家长都可以查看和撤回。过往纸条不会在孩子今天的小岛展示。</p></div></div>
      {notes.length === 0 ? <div className="parent-empty"><span>💌</span><h4>今天还没有小纸条</h4><p>留下一句具体的鼓励，让宠物替你传达。</p></div> : <div className="parent-note-list">{notes.map(n => <article className="parent-note" key={n.id}><div><b>{n.senderName}</b><span>{new Date(n.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}{n.senderId === sender ? ' · 我' : ''}</span></div><p>{n.text}</p><button className="btn ghost sm" disabled={busy} onClick={() => remove(n)}>撤回纸条</button></article>)}</div>}
    </div>
  </section>;
}
