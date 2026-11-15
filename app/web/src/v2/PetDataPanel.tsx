import { useCallback, useEffect, useRef, useState } from 'react';
import { Sheet } from '../mvp/Sheets';
import { PET_BREEDS } from '../mvp/petBreeds';
import type { Pet } from '../mvp/types';
import { v2 } from './api';
import PetPicker from './PetPicker';
import type { PetBackup } from './types';

const REASONS = { manual: '手动备份', before_switch: '切换品种前', before_restart: '重新养宠前', before_restore: '恢复备份前' };
const breedInfo = (breed: string) => PET_BREEDS.find(b => b.id === breed);
const at = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });

export default function PetDataPanel({ pet, onReload, toast }: { pet: Pet | null; onReload: () => Promise<void>; toast: (m: string, tone?: string) => void }) {
  const [picker, setPicker] = useState(false), [records, setRecords] = useState(false), [restart, setRestart] = useState(false);
  const [selected, setSelected] = useState<PetBackup | null>(null);
  const [items, setItems] = useState<PetBackup[]>([]), [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [listError, setListError] = useState('');
  const lock = useRef(false), request = useRef(0);
  const load = useCallback(async (before = '') => {
    const id = ++request.current; setLoading(true); setListError('');
    try { const page = await v2.petBackups(before); if (id !== request.current) return;
      setItems(old => before ? [...old, ...page.items] : page.items); setNext(page.next);
    } catch (e: any) { if (id === request.current) setListError(e.message || '备份读取失败'); }
    finally { if (id === request.current) setLoading(false); }
  }, []);
  useEffect(() => { if (records) { setItems([]); setNext(null); setSelected(null); load(); } return () => { request.current++; }; }, [records, load]);
  const run = async (fn: () => Promise<unknown>, message: string) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await fn(); setPicker(false); setRestart(false); setSelected(null); await onReload(); if (records) await load(); toast(message, 'gold'); }
    catch (e: any) { setError(e.message || '操作失败，请重试'); toast(e.message || '操作失败', 'warn'); }
    finally { lock.current = false; setBusy(false); }
  };
  const expectedPetId = pet?.id ?? null;
  return <div className="parent-card pet-data-panel">
    <div className="parent-card-head"><div><h2>数据与边界</h2><p>家庭中的家长共同管理当前孩子。宠物操作只影响这个孩子，学习计划、审核记录、星贝、背包和心愿兑换都会保留。</p></div>
      <button className="btn ghost sm" disabled={busy} onClick={() => setRecords(true)}>备份记录</button></div>
    <div className="pet-data-current">{pet ? <><img src={breedInfo(pet.breed)?.avatar} alt="" /><div><h3>{pet.name}<span>{breedInfo(pet.breed)?.name || pet.breed}</span></h3><p>{pet.progression.name} · 成长 {pet.growth} · 已照顾 {pet.careCount} 次</p></div></> : <div><h3>当前还没有小伙伴</h3><p>可到学生端领养，也可以从备份记录恢复。</p></div>}</div>
    <div className="pet-data-actions">
      <button className="btn primary sm" disabled={busy || !pet} onClick={() => setPicker(true)}>切换宠物品种</button>
      <button className="btn ghost sm" disabled={busy} onClick={() => run(() => v2.backupPet(expectedPetId), '当前宠物状态已备份')}>备份当前状态</button>
      <button className="btn ghost sm danger-text" disabled={busy || !pet} onClick={() => setRestart(true)}>重新养宠</button>
    </div>
    <p className="pet-backup-hint">切换、重养和恢复前都会自动备份。备份保存宠物的年龄阶段、时间进度、成长、状态、装扮与冷却；归档期间进度冻结，恢复后继续。今日成长额度和已领材料不会随备份回退。</p>
    {restart && pet && <div className="pet-confirm" role="alert"><h3>让 {pet.name} 重新开始成长？</h3><p>先自动备份当前宠物，再回到待领养状态。仅重置宠物养成，任务、星贝和背包等记录保留，之后可在备份记录中找回它。</p>
      <div className="settings-actions"><button className="btn ghost sm" disabled={busy} onClick={() => setRestart(false)}>继续陪伴</button><button className="btn danger sm" disabled={busy} onClick={() => run(() => v2.restartPet(pet.id), '宠物已备份，可以去学生端重新领养了')}>{busy ? '正在备份…' : '备份并重新养宠'}</button></div></div>}
    {error && <p className="settings-error" role="alert">{error}</p>}
    {pet && <PetPicker open={picker} onClose={() => { if (!busy) setPicker(false); }} pet={pet} busy={busy} onChoose={breed => run(() => v2.changeBreed(breed, pet.id), '品种已切换，原宠物已自动备份，成长和学习记录都在')} />}
    <Sheet open={records} onClose={() => { if (!busy) setRecords(false); }} wide title="宠物备份记录" sub="只恢复宠物养成，不回退任务、积分和材料。每次恢复前，还会备份当前状态。">
      <div className="record-toolbar"><p className="muted">切换、重养、恢复和手动备份都记录在这里。</p><button className="btn ghost sm" disabled={loading || busy} onClick={() => load()}>刷新备份</button></div>
      {listError && <p role="alert" className="settings-error">{listError}<button className="btn ghost sm" onClick={() => load()}>重试</button></p>}
      {!items.length && <p className="record-empty">{loading ? '正在读取备份…' : listError ? '暂时无法读取备份' : '还没有备份。可先保存一份当前宠物状态。'}</p>}
      <div className="settings-records">{items.map(item => <article className="settings-record" key={item.id}>
        <div className="record-head"><b>{!item.available ? '备份暂不可用' : item.pet?.name || '待领养状态'}<small>{!item.available ? '原记录已保留' : item.pet ? breedInfo(item.pet.breed)?.name || item.pet.breed : '无宠物'}</small></b><span className="record-status">{REASONS[item.reason]}</span></div>
        <time>{at(item.createdAt)}</time>
        {item.pet && <p className="backup-stats">{item.pet.phaseName} · 成长 {item.pet.growth} · 饱食 {Math.round(item.pet.stats.hunger)} · 精力 {Math.round(item.pet.stats.energy)} · 心情 {Math.round(item.pet.stats.mood)} · 清洁 {Math.round(item.pet.stats.clean)}</p>}
        {!item.available ? <p className="settings-error">{item.error || '备份数据不完整，无法恢复。可以继续使用其他备份。'}</p> : selected?.id === item.id ? <div className="pet-confirm" role="alert"><h3>恢复这份{item.pet ? '宠物备份' : '待领养状态'}？</h3><p>会先备份{pet ? `当前的 ${pet.name}` : '当前待领养状态'}，再恢复到这份记录。任务、星贝、背包和兑换记录保持当前进度。</p><div className="settings-actions"><button className="btn ghost sm" disabled={busy} onClick={() => setSelected(null)}>取消</button><button className="btn primary sm" disabled={busy} onClick={() => run(() => v2.restorePet(item.id, expectedPetId), '备份已恢复，恢复前的状态也已保存')}>{busy ? '正在备份并恢复…' : '备份当前并恢复'}</button></div></div> : <button className="btn ghost sm" disabled={busy} onClick={() => setSelected(item)}>恢复这份备份</button>}
      </article>)}</div>
      {loading && !!items.length && <p className="record-empty" role="status">正在加载…</p>}
      {next && <button className="btn ghost record-more" disabled={loading || busy} onClick={() => load(next)}>加载更早备份</button>}
    </Sheet>
  </div>;
}
