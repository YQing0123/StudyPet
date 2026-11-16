import { useEffect, useRef, useState } from 'react';
import { validateSleepSchedule, type SleepSchedule } from '../shared/petSleep.mjs';
import { v2 } from './api';

export default function PetSleepSettings({ value, onReload, toast }: {
  value: SleepSchedule; onReload: () => Promise<void>; toast: (m: string, tone?: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(value);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => { setDraft(value); setSaved(value); }, [value.nightEnabled, value.nightStart, value.nightEnd, value.napEnabled, value.napStart, value.napEnd]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    setError('');
    try { validateSleepSchedule(draft); } catch (e: any) { setError(e.message); return; }
    lock.current = true; setWorking(true);
    try {
      const next = await v2.saveSettings({ petSleep: draft });
      setDraft(next.settings.petSleep); setSaved(next.settings.petSleep);
      toast(next.settings.petSleep.nightEnabled || next.settings.petSleep.napEnabled ? '宠物作息已保存，到点就会自动睡觉' : '宠物作息已保存，自动睡眠已关闭');
      await onReload();
    } catch (e: any) { setError(e.message || '保存失败，请重试'); }
    finally { lock.current = false; setWorking(false); }
  };
  return <form className="parent-card pet-sleep-settings" onSubmit={save} aria-label="宠物作息设置">
    <div className="parent-card-head"><div><h2>宠物作息</h2><p>为当前孩子安排休息时间，按北京时间每天重复。开启后，到点会自动睡觉，休息时缓慢恢复精力，起床后再一起玩。</p></div></div>
    {(['night', 'nap'] as const).map(kind => <fieldset className="sleep-period" key={kind} disabled={working}>
      <legend>{kind === 'night' ? '🌙 夜间睡眠' : '☀️ 午休'}</legend>
      <label className="sleep-enable"><input type="checkbox" checked={draft[`${kind}Enabled`]} onChange={e => setDraft(d => ({ ...d, [`${kind}Enabled`]: e.target.checked }))} />开启{kind === 'night' ? '夜间睡眠' : '午休'}</label>
      <div className="sleep-time-fields">
        <label>{kind === 'night' ? '晚上睡觉' : '午休开始'}<input className="text-input" type="time" required value={draft[`${kind}Start`]} onChange={e => setDraft(d => ({ ...d, [`${kind}Start`]: e.target.value }))} /></label>
        <span aria-hidden="true">至</span>
        <label>{kind === 'night' ? '次日早上起床' : '午休结束'}<input className="text-input" type="time" required value={draft[`${kind}End`]} onChange={e => setDraft(d => ({ ...d, [`${kind}End`]: e.target.value }))} /></label>
      </div>
    </fieldset>)}
    <p className="sleep-policy">睡觉时可以听到迷糊的梦话。前两次只提醒，第三次会先告知：继续打扰会影响心情；之后仍持续打扰才扣 2 点，每分钟最多一次，每段睡眠最多 6 点。安静 5 分钟后重新温柔提醒。睡觉期间可查看计划、提交学习记录和兑换材料，喂食、清洁、装扮等留到醒来，材料不会被消耗。</p>
    {error && <p className="settings-error" role="alert">{error}</p>}
    <div className="sleep-settings-foot"><span>{dirty ? '有未保存的作息' : '夜间睡眠和午休可分别开启'}</span><button className="btn primary sm" disabled={!dirty || working}>{working ? '保存中…' : '保存作息'}</button></div>
  </form>;
}
