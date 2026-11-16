import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ROOM_MAP } from '../shared/roomCatalog.mjs';
import { mountVisual } from '../mvp/sceneVisuals';
import type { RoomPlacement, RoomState } from './types';
import type { ShopItem } from '../mvp/types';
import './room.css';
export function ItemArt({ item }: { item: Pick<ShopItem, 'asset' | 'sprite' | 'icon' | 'name'> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current && item.asset && item.sprite != null) return mountVisual(ref.current, item.asset, item.sprite); }, [item.asset, item.sprite]);
  return item.sprite != null ? <canvas ref={ref} className="room-sprite" role="img" aria-label={item.name} /> : item.asset ? <img className="room-thumbnail" src={item.asset} alt={item.name} loading="lazy" /> : <>{item.icon}</>;
}
export default function RoomDecor({ room, onSave, disabled, onError }: { room: RoomState; onSave: (placements: RoomPlacement[]) => Promise<void>; disabled: boolean; onError: (message: string) => void }) {
  const [draft, setDraft] = useState(room.placements);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft); draftRef.current = draft;
  const roomRef = useRef(room); roomRef.current = room;
  const hold = useRef(0);
  const drag = useRef<{ id: number; key: string; x: number; y: number; px: number; py: number; active: boolean } | null>(null);
  const commitRef = useRef<() => void>(() => {});
  useEffect(() => { if (!selected) setDraft(room.placements); }, [room.revision, selected, room.placements]);
  useEffect(() => () => clearTimeout(hold.current), []);
  const finish = async () => {
    if (saving || !selected) return;
    clearTimeout(hold.current); drag.current = null;
    if (JSON.stringify(draftRef.current) === JSON.stringify(roomRef.current.placements)) { setSelected(null); return; }
    setSaving(true);
    try { await onSave(draftRef.current); setSelected(null); }
    catch (e: any) { onError(e.message || '布置没能保存，请再试一次'); }
    finally { setSaving(false); }
  };
  commitRef.current = () => { void finish(); };
  useEffect(() => {
    if (!selected) return;
    const outside = (e: PointerEvent) => { if (!(e.target as Element).closest('.room-furniture, .room-tools')) commitRef.current(); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [selected]);
  const update = (key: string, patch: Partial<RoomPlacement>) => setDraft(prev => { const next = prev.map(p => p.key === key ? { ...p, ...patch } : p); draftRef.current = next; return next; });
  const start = (e: ReactPointerEvent<HTMLButtonElement>, item: RoomPlacement) => {
    if (disabled || saving || e.button !== 0) return;
    e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    const isActive = selected === item.key;
    drag.current = { id: e.pointerId, key: item.key, x: e.clientX, y: e.clientY, px: item.x, py: item.y, active: isActive };
    if (!isActive) hold.current = window.setTimeout(() => { if (drag.current?.key === item.key) { drag.current.active = true; setSelected(item.key); } }, 450);
  };
  const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current, box = root.current?.getBoundingClientRect();
    if (!d || d.id !== e.pointerId || !box) return;
    if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) { clearTimeout(hold.current); drag.current = null; return; }
    if (!d.active) return;
    update(d.key, { x: Math.min(94, Math.max(6, d.px + (e.clientX-d.x)/box.width*100)), y: Math.min(92, Math.max(38, d.py + (e.clientY-d.y)/box.height*100)) });
  };
  const end = () => { clearTimeout(hold.current); drag.current = null; };
  const active = draft.find(p => p.key === selected) || room.placements.find(p => p.key === selected);
  return <div ref={root} className={`room-decor ${selected ? 'is-editing' : ''}`} aria-label="我的房间家具">
    {draft.map(p => { const item = ROOM_MAP[p.key]; if (!item) return null; return <button key={p.key} className={`room-furniture ${selected === p.key ? 'is-selected' : ''}`} style={{ left: `${p.x}%`, top: `${p.y}%`, width: `${(item.width || 20) * p.scale}%`, zIndex: p.layer === 'front' ? 4 : 2, transform: `translate(-50%, -85%) rotate(${p.rotation}deg)` }}
      aria-label={`${item.name}，长按或回车编辑`} disabled={disabled || saving} onPointerDown={e => start(e,p)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(p.key); }
        if (e.key === 'Escape') { setDraft(room.placements); setSelected(null); }
        if (selected !== p.key) return;
        const arrows: Record<string, [number, number]> = { ArrowLeft: [-1,0], ArrowRight: [1,0], ArrowUp: [0,-1], ArrowDown: [0,1] };
        if (arrows[e.key]) { e.preventDefault(); update(p.key, { x: Math.max(6, Math.min(94, p.x + arrows[e.key][0])), y: Math.max(38, Math.min(92, p.y + arrows[e.key][1])) }); }
      }}><ItemArt item={item} /></button>; })}
    {active && <div className="room-tools" role="group" aria-label="家具编辑" onPointerDown={e => e.stopPropagation()}>
      <b>{ROOM_MAP[active.key]?.name}</b><span>拖动家具 · 点空处放好</span>
      <div><button disabled={saving} onClick={() => update(active.key, { rotation: active.rotation <= -180 ? 165 : active.rotation - 15 })}>↶ 左旋转</button>
        <button disabled={saving} onClick={() => update(active.key, { rotation: active.rotation >= 165 ? -180 : active.rotation + 15 })}>↷ 右旋转</button>
        <button disabled={saving} onClick={() => update(active.key, { layer: active.layer === 'front' ? 'back' : 'front' })}>{active.layer === 'front' ? '放到宠物后面' : '放到宠物前面'}</button>
        <button aria-label="缩小家具" disabled={saving || active.scale <= .6} onClick={() => update(active.key, { scale: Math.max(.6, Math.round((active.scale-.1)*10)/10) })}>−</button>
        <button aria-label="放大家具" disabled={saving || active.scale >= 1.5} onClick={() => update(active.key, { scale: Math.min(1.5, Math.round((active.scale+.1)*10)/10) })}>＋</button>
        <button disabled={saving} onClick={() => { setDraft(prev => { const next = prev.filter(p => p.key !== active.key); draftRef.current = next; return next; }); queueMicrotask(() => commitRef.current()); }}>收回</button>
        <button className="primary" disabled={saving} onClick={() => void finish()}>{saving ? '保存中…' : '放好了'}</button>
        <button disabled={saving} onClick={() => { setDraft(room.placements); setSelected(null); }}>取消</button></div>
    </div>}
  </div>;
}
