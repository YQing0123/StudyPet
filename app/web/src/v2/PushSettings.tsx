import { useCallback, useEffect, useRef, useState } from 'react';
import { Sheet } from '../mvp/Sheets';
import { v2 } from './api';
import type { NotifyChannel, NotifyLog, NotifyProvider, NotifyEvent, NotifyEvents } from './types';

const CHANNELS: Record<NotifyProvider, { name: string; mark: string; help: string }> = {
  wecom: { name: '企业微信', mark: '企', help: '在群设置中添加群机器人，复制完整 Webhook 地址。' },
  dingtalk: { name: '钉钉', mark: '钉', help: '添加自定义群机器人，安全设置选择「加签」，复制 Webhook 和 SEC 开头的密钥。' },
  pushplus: { name: 'PushPlus', mark: 'P', help: '在 PushPlus 获取 Token，用于接收个人微信提醒。' },
};
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
const events: Record<string, string> = { test: '测试消息', submission: '需审核提交', completed: '无需审核完成', approved: '审核通过', rejected: '任务退回', batch_approved: '批量通过', resubmission: '退回后重新提交', daily_summary: '每日任务汇总', notification: '任务提醒' };
const SCENARIOS: { key: NotifyEvent; label: string; description: string }[] = [
  { key: 'submission', label: '需审核的任务提交', description: '孩子首次提交任务，提醒家长前往审核。' },
  { key: 'completed', label: '无需审核的任务完成', description: '任务直接完成后，通知完成情况和实际到账星贝。' },
  { key: 'approved', label: '审核通过', description: '单项任务审核通过后，通知最终奖励。' },
  { key: 'batch_approved', label: '批量通过', description: '批量审核通过后，发送一条合计消息。' },
  { key: 'rejected', label: '任务退回', description: '家长退回任务后，通知退回原因。' },
  { key: 'resubmission', label: '退回后重新提交', description: '孩子修改后再次提交，重新提醒家长审核。' },
  { key: 'daily_summary', label: '每日任务汇总', description: '定时汇总当天任务完成情况、待审核任务和已赚星贝。' },
];
type Props = { channels: NotifyChannel[]; eventSettings: NotifyEvents; summaryTime: string; publicUrl: string; onReload: () => Promise<void>; toast: (m: string, tone?: string) => void };

export default function PushSettings({ channels, eventSettings, summaryTime, publicUrl, onReload, toast }: Props) {
  const [logsOpen, setLogsOpen] = useState(false);
  return <div className="parent-card push-settings">
    <div className="parent-card-head"><div><h2>消息推送</h2><p>为当前孩子选择推送场景和接收通道。场景与通道都开启时才会发送，开关即时保存。</p></div>
      <button className="btn ghost sm" onClick={() => setLogsOpen(true)}>发送日志</button></div>
    <ScenarioSettings eventSettings={eventSettings} summaryTime={summaryTime} onReload={onReload} toast={toast} />
    <div className="push-channel-list">{channels.map(channel => <ChannelCard key={channel.provider} channel={channel} onReload={onReload} toast={toast} />)}</div>
    <PublicUrlSetting value={publicUrl} onReload={onReload} toast={toast} />
    <NotifyLogs open={logsOpen} onClose={() => setLogsOpen(false)} />
  </div>;
}

function ScenarioSettings({eventSettings,summaryTime,onReload,toast}:Pick<Props,'eventSettings'|'summaryTime'|'onReload'|'toast'>) {
 const [saved,setSaved]=useState(eventSettings),[savedTime,setSavedTime]=useState(summaryTime);
 const [draft,setDraft]=useState<string|null>(null),[working,setWorking]=useState<string|null>(null),[error,setError]=useState('');
 const lock=useRef(false);
 useEffect(()=>{if(!lock.current){setSaved(eventSettings);setSavedTime(summaryTime);}},[eventSettings,summaryTime]);
 const save=async(key:NotifyEvent|'time',enabled?:boolean)=>{
  if(lock.current)return;
  const saveTime=key==='time'||(key==='daily_summary'&&enabled&&draft!==null);
  if(saveTime&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(draft??savedTime)){setError('请选择有效的推送时间。');return;}
  lock.current=true;setWorking(key);setError('');
  try{
   const data=await v2.saveSettings({...(key!=='time'?{notifyEvents:{[key]:enabled}}:{}),...(saveTime?{notifySummaryTime:draft??savedTime}:{})});
   setSaved(data.settings.notifyEvents);setSavedTime(data.settings.notifySummaryTime);
   if(saveTime)setDraft(null);
   toast(key==='time'?`每日汇总时间已保存：${data.settings.notifySummaryTime}`:`${events[key]}推送已${enabled?'开启':'关闭'}`);
   await onReload();
  }catch(e:any){setError(e.message||'保存失败，请重试。');}
  finally{lock.current=false;setWorking(null);}
 };
 return <section className="push-scenarios" aria-label="推送场景设置">
  <h3>推送场景</h3><p className="push-scenario-intro">各场景独立开关，同家庭的家长共同管理当前孩子的设置。</p>
  <div className="push-scenario-list">{SCENARIOS.map(item=><div className="push-scenario-row" key={item.key}>
   <div><h4>{item.label}</h4><p id={`notify-desc-${item.key}`}>{item.description}</p></div>
   <button className={`scenario-switch ${saved[item.key]?'is-on':''}`} role="switch" aria-checked={saved[item.key]} aria-label={`${item.label}推送`} aria-describedby={`notify-desc-${item.key}`} disabled={!!working} onClick={()=>save(item.key,!saved[item.key])}><span aria-hidden="true"/><b>{working===item.key?'保存中':saved[item.key]?'已开启':'已关闭'}</b></button>
  </div>)}</div>
  <div className="summary-time-setting"><label htmlFor="notify-summary-time">每日汇总推送时间（北京时间）</label>
   <div><input id="notify-summary-time" className="text-input" type="time" required value={draft??savedTime} disabled={!!working} onChange={e=>setDraft(e.target.value)}/><button className="btn primary sm" disabled={!!working||draft===null||draft===savedTime} onClick={()=>save('time')}>{working==='time'?'保存中…':'保存时间'}</button></div>
   <p>开启每日汇总后，每天在所选时间发送一次。当天错过时间，会在服务恢复运行后补发一次。</p>
  </div>
  {error&&<p className="settings-error" role="alert">{error}</p>}
 </section>;
}

function ChannelCard({ channel, onReload, toast }: { channel: NotifyChannel } & Pick<Props, 'onReload' | 'toast'>) {
  const [saved, setSaved] = useState(channel);
  const [target, setTarget] = useState('');
  const [secret, setSecret] = useState('');
  const [clearSecret, setClearSecret] = useState(false);
  const [working, setWorking] = useState<'save' | 'test' | null>(null);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const info = CHANNELS[channel.provider];
  const dirty = !!(target.trim() || secret.trim() || clearSecret);
  useEffect(() => { setSaved(channel); }, [channel]);
  const save = async (enabled = saved.enabled, toggleOnly = false) => {
    if (lock.current) return;
    lock.current = true; setWorking('save'); setError('');
    try {
      const onlyDisable = toggleOnly && !enabled;
      const data = await v2.saveSettings({ notifyChannels: [{ provider: saved.provider, ...(toggleOnly ? { enabled } : {}),
        ...(!onlyDisable ? { ...(target.trim() ? { target: target.trim() } : {}), ...(secret.trim() ? { secret: secret.trim() } : {}), clearSecret } : {}) }] });
      const updated = data.settings.notifyChannels.find(c => c.provider === saved.provider)!;
      setSaved(updated);
      if (!onlyDisable) { setTarget(''); setSecret(''); setClearSecret(false); }
      toast(`${info.name}${updated.enabled ? '已开启，配置已保存' : '配置已保存，当前关闭'}`);
      await onReload();
    } catch (e: any) { setError(e.message || '保存失败，填写的内容已保留'); }
    finally { lock.current = false; setWorking(null); }
  };
  const test = async () => {
    if (lock.current) return;
    lock.current = true; setWorking('test'); setError('');
    try {
      const result = await v2.testNotify(saved.provider);
      if (!result.ok) setError(result.error || '发送失败，请查看发送日志');
      toast(result.ok ? `${info.name}测试消息已送达服务` : `${info.name}发送失败，请查看原因和发送日志`, result.ok ? 'gold' : 'warn');
    } catch (e: any) { setError(e.message || '测试请求失败，请先查看发送日志再重试'); }
    finally { lock.current = false; setWorking(null); }
  };
  return <section className={`push-channel ${saved.enabled ? 'is-enabled' : ''}`} aria-label={`${info.name}推送配置`}>
    <div className="push-channel-head"><span className={`push-mark ${saved.provider}`} aria-hidden="true">{info.mark}</span>
      <div className="push-channel-title"><h3>{info.name}<span className={`record-status ${saved.enabled ? 'success' : ''}`}>{saved.enabled ? '已开启' : '已关闭'}</span></h3><p>{info.help}</p></div>
      <button className={`channel-switch ${saved.enabled ? 'is-on' : ''}`} role="switch" aria-checked={saved.enabled} aria-label={`${info.name}推送`} disabled={!!working}
        onClick={() => save(!saved.enabled, true)}><span /></button>
    </div>
    <div className="push-channel-fields">
      <label>{saved.provider === 'pushplus' ? 'PushPlus Token' : 'Webhook 地址'}
        <input className="text-input" type="password" autoComplete="new-password" spellCheck={false} value={target} disabled={!!working}
          onChange={e => setTarget(e.target.value)} placeholder={saved.targetConfigured ? `${saved.maskedTarget}，留空保留` : saved.provider === 'pushplus' ? '填写 PushPlus Token' : '粘贴完整的 HTTPS Webhook 地址'} /></label>
      {saved.provider === 'dingtalk' && <label>加签密钥
        <input className="text-input" type="password" autoComplete="new-password" spellCheck={false} value={secret} disabled={!!working || clearSecret}
          onChange={e => setSecret(e.target.value)} placeholder={saved.secretConfigured ? '密钥已保存，留空保留' : '填写 SEC 开头的加签密钥'} /></label>}
    </div>
    {saved.provider === 'dingtalk' && saved.secretConfigured && <label className="push-clear-secret"><input type="checkbox" checked={clearSecret} disabled={!!working || saved.enabled} onChange={e => setClearSecret(e.target.checked)} />删除已保存的加签密钥（请先关闭通道）</label>}
    <div className="push-channel-foot"><p>{dirty ? '有未保存的配置，请保存后再测试。' : saved.targetConfigured ? '凭据已安全保存在本机服务端，留空不会覆盖。' : '填写配置后保存，开启时会先校验必填项。'}</p>
      <div className="settings-actions"><button className="btn ghost sm" disabled={!!working || !saved.enabled || dirty} onClick={test}>{working === 'test' ? '发送中…' : '测试此通道'}</button>
        <button className="btn primary sm" disabled={!!working} onClick={() => save()}>{working === 'save' ? '保存中…' : '保存配置'}</button></div></div>
    {error && <p role="alert" className="settings-error">{error}</p>}
  </section>;
}

function NotifyLogs({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState<NotifyLog[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const load = useCallback(async (before = '') => {
    const id = ++request.current; setLoading(true); setError('');
    try { const page = await v2.notifyLogs(filter, before); if (request.current !== id) return;
      setItems(old => before ? [...old, ...page.items] : page.items); setNext(page.next);
    } catch (e: any) { if (request.current === id) setError(e.message || '日志加载失败'); }
    finally { if (request.current === id) setLoading(false); }
  }, [filter]);
  useEffect(() => { if (open) { setItems([]); setNext(null); load(); } return () => { request.current++; }; }, [open, load]);
  return <Sheet open={open} onClose={onClose} wide title="发送日志" sub="当前孩子的消息记录；同一条消息发送到不同通道，会分别记录结果。">
    <div className="record-toolbar"><div className="filter-row">{[['', '全部'], ['success', '成功'], ['failed', '失败'], ['sending', '发送中']].map(([key, label]) =>
      <button className={`chip ${filter === key ? 'is-on' : ''}`} key={key} onClick={() => setFilter(key)}>{label}</button>)}</div><button className="btn ghost sm" disabled={loading} onClick={() => load()}>刷新日志</button></div>
    {error && <p role="alert" className="settings-error">{error}<button className="btn ghost sm" onClick={() => load()}>重试</button></p>}
    {!items.length && <p className="record-empty">{loading ? '正在读取发送记录…' : error ? '暂时无法读取日志' : '暂无发送记录。开启通道后，可发送一条测试消息。'}</p>}
    <div className="settings-records">{items.map(log => <article className="settings-record" key={log.id}>
      <div className="record-head"><b>{CHANNELS[log.provider]?.name || log.provider}<small>{events[log.event] || '任务提醒'}</small></b>
        <span className={`record-status ${log.status}`}>{log.status === 'success' ? '发送成功' : log.status === 'failed' ? '发送失败' : '发送中'}</span></div>
      <time>{time(log.createdAt)}</time><p className="record-content">{log.content}</p>
      {log.error && <p className="settings-error">{log.error}</p>}
      {(log.httpStatus != null || log.providerCode != null) && <p className="record-meta">HTTP {log.httpStatus ?? '—'} · 服务返回码 {log.providerCode ?? '—'}</p>}
    </article>)}</div>
    {loading && !!items.length && <p className="record-empty" role="status">正在加载…</p>}
    {next && <button className="btn ghost record-more" disabled={loading} onClick={() => load(next)}>加载更早记录</button>}
  </Sheet>;
}

function PublicUrlSetting({value,onReload,toast}:{value:string}&Pick<Props,'onReload'|'toast'>){
 const [draft,setDraft]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');const lock=useRef(false);
 const save=async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await v2.saveSettings({notifyPublicUrl:draft??value});setDraft(null);await onReload();toast('审核链接地址已保存，新提交将使用这个地址');}catch(e:any){setError(e.message||'保存失败，输入已保留');}finally{lock.current=false;setBusy(false);}};
 return <section className="push-channel notify-public-url" aria-label="钉钉图文卡片设置"><h3>钉钉图文卡片与审核链接</h3><p className="muted">待审核提交自动展示学习内容、孩子留言和预计星贝。配置站点地址后，还会展示作业图片和「打开家长端审核」按钮。</p>
 <label>外部访问地址<input className="text-input" type="url" value={draft??value} disabled={busy} onChange={e=>setDraft(e.target.value)} placeholder="https://你的小岛域名" autoComplete="off" spellCheck={false}/></label>
 <p className="pet-backup-hint">填写钉钉和家长手机可访问的 HTTPS 根地址。图片链接有效期为7天，链接持有者可查看该张照片；重新提交会使旧照片链接失效。审核仍需家长登录或解锁。未配置时发送文字卡片，照片到家长端查看。</p>
 <div className="settings-actions"><button className="btn primary sm" disabled={busy} onClick={save}>{busy?'保存中…':'保存审核链接地址'}</button></div>{error&&<p className="settings-error" role="alert">{error}</p>}</section>;
}
