import { useEffect, useRef, useState } from 'react';
import { playtimeApi, type PlaytimeState, type PlaytimeDraft } from './playtime-api';
export default function PlaytimeSettings({toast}: {toast: (text: string, tone?: string) => void}) {
  const [saved, setSaved] = useState<PlaytimeState|null>(null), [draft, setDraft] = useState<PlaytimeDraft>({enabled:false,dailyMinutes:60,idleMinutes:5});
  const [pin, setPin] = useState(''), [confirm, setConfirm] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const working = useRef(false);
  const load = () => playtimeApi.settings().then(s => {setSaved(s);setDraft(s);setError('');}).catch(e => setError(e.message));
  useEffect(() => {void load();}, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (working.current) return;
    if ((pin || !saved?.pinSet && draft.enabled) && !/^\d{6}$/.test(pin)) {setError('请设置 6 位数字密码');return;}
    if (pin !== confirm) {setError('两次输入的解锁密码不一致');return;}
    working.current = true;setBusy(true);setError('');
    try {const s = await playtimeApi.save({...draft, ...(pin ? {pin} : {})});setSaved(s);setDraft(s);setPin('');setConfirm('');toast('游玩时间设置已保存');}
    catch (e: any) {setError(e.message);} finally {working.current = false;setBusy(false);}
  };
  if (!saved) return <div className="parent-card">{error ? <><p role="alert">{error}</p><button className="btn" onClick={load}>重新加载</button></> : <p>正在读取游玩设置…</p>}</div>;
  return <form className="parent-card playtime-settings" onSubmit={save} aria-label="游玩时间设置">
    <div className="parent-card-head"><div><h2>每天游玩时间</h2><p>设置属于当前孩子。操作页面时计时，切到后台、屏保或锁定后暂停；北京时间每天零点重新开始。</p></div></div>
    <fieldset disabled={busy}><label className="sleep-enable"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft(d => ({...d,enabled:e.target.checked}))}/>开启每日游玩限时</label>
    <div className="playtime-fields"><label>每日最长时间（分钟）<input className="text-input" type="number" min="1" max="480" required value={draft.dailyMinutes} onChange={e => setDraft(d => ({...d,dailyMinutes:Number(e.target.value)}))}/></label>
    <label>无操作多久进入屏保（分钟）<input className="text-input" type="number" min="1" max="60" required value={draft.idleMinutes} onChange={e => setDraft(d => ({...d,idleMinutes:Number(e.target.value)}))}/></label>
    <label>{saved.pinSet ? '更换 6 位数字密码（留空保留）' : '设置 6 位数字解锁密码'}<input className="text-input" aria-label="6 位数字解锁密码" type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="new-password" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g,''))}/></label>
    <label>再次输入解锁密码<input className="text-input" type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value.replace(/\D/g,''))}/></label></div></fieldset>
    <p className="sleep-policy">屏保可直接点击「解锁，回到小岛」。每日额度用完后，需要输入家长设置的 6 位数字密码；每次解锁增加 {saved.unlockMinutes} 分钟。锁定期间宠物仍消耗状态，速度为清醒时的一半。忘记密码可用家长账号进入这里重新设置。</p>
    <p>今日已游玩 {Math.floor(saved.usedSeconds/60)} 分钟{saved.bonusSeconds > 0 ? ` · 家长已延长 ${saved.bonusSeconds/60} 分钟` : ''}</p>
    {error && <p className="settings-error" role="alert">{error}</p>}
    <button className="btn primary" disabled={busy}>{busy ? '保存中…' : '保存游玩设置'}</button>
  </form>;
}
