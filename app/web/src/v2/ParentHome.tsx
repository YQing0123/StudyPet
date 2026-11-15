import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sheet } from '../mvp/Sheets';
import { v2 } from './api';
import DailyNotesPanel from './DailyNotesPanel';
import ReviewTaskSheet from './ReviewTaskSheet';
import PushSettings from './PushSettings';
import PetDataPanel from './PetDataPanel';
import type { CalendarDay, ParentState, RewardV2, RuleV2, TaskV2 } from './types';

const WEEK_CN = ['一', '二', '三', '四', '五', '六', '日'];
const SUBJECTS = ['语文', '数学', '英语', '阅读', '运动', '其他'];
const ICONS = ['📖', '📐', '🔤', '✏️', '🎨', '🎹', '🏃', '🧹', '🧠', '🌱', '🧪', '🗣️'];
const KIND = [{ k: 'experience', n: '体验' }, { k: 'item', n: '物品' }, { k: 'privilege', n: '特权' }];

type Tab = 'approve' | 'plan' | 'calendar' | 'rewards' | 'settings' | 'notes';

export default function ParentHome({ onStudent, toast, reviewId, onReviewClose }: { onStudent: () => void; toast: (m: string, tone?: string) => void; reviewId?: string; onReviewClose?: () => void }) {
  const [data, setData] = useState<ParentState | null>(null);
  const [tab, setTab] = useState<Tab>('approve');
  const [month, setMonth] = useState(() => `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [ruleSheet, setRuleSheet] = useState<{ open: boolean; rule: RuleV2 | null }>({ open: false, rule: null });
  const [rewardSheet, setRewardSheet] = useState<{ open: boolean; reward: RewardV2 | null }>({ open: false, reward: null });
  const [dayTasks, setDayTasks] = useState<TaskV2[]>([]);
  const [selectedDay, setSelectedDay] = useState<string>('');
  const calendarRequest = useRef(0), loadRequest = useRef(0);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async (m = month) => {
    const request = ++loadRequest.current;
    try {
      const d = await v2.parent(undefined, m);
      if (request !== loadRequest.current) return;
      setData(d);
      setDayTasks(d.todayTasks);
      setSelectedDay(d.today);
      setError('');
    } catch (e: any) { if (request === loadRequest.current) setError(e.message || '加载失败'); }
  }, [month]);

  useEffect(() => { load(month); }, [load, month]);

  const run = async <T,>(fn: () => Promise<T>, ok: (r: T) => void | Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try { await ok(await fn()); }
    catch (e: any) { toast(e.message || '操作失败', 'warn'); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const approve = (id: string) => run(() => v2.reviewTask(id, { approve: true }), async () => {
    await load();
    toast('已通过，星贝已发给学生', 'gold');
  });
  const reject = (id: string) => {
    if (!rejectReason.trim()) { toast('写一句退回原因吧', 'warn'); return; }
    run(() => v2.reviewTask(id, { approve: false, reason: rejectReason.trim() }), async () => {
      setRejectId(null); setRejectReason('');
      await load();
      toast('已退回，学生可以重新提交');
    });
  };

  const pickDay = async (d: CalendarDay) => {
    const request = ++calendarRequest.current;
    try {
      const next = await v2.parent(d.date, month);
      if(request !== calendarRequest.current)return;
      setSelectedDay(d.date);setData(next);setDayTasks(next.todayTasks);
    } catch (e:any) {if(request === calendarRequest.current)toast(e.message || '这天的记录暂时没加载好，请重试','warn');}
  };

  const changeMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  if (error && !data) {
    return <div className="island-error"><div className="error-card"><span>🌧️</span><h2>家长端连不上</h2><p>{error}</p><button className="btn primary" onClick={() => load()}>再试一次</button></div></div>;
  }
  if (!data) return <div className="island-loading"><div className="loading-orb" /><p>正在打开家长端…</p></div>;

  return (
    <div className="parent-app">
      {reviewId && <ReviewTaskSheet id={reviewId} onClose={()=>onReviewClose?.()} onChanged={load} toast={toast} />}
      <header className="parent-top">
        <div className="brand">
          <span className="brand-mark parent-mark">🗂️</span>
          <div><h1>伴学小岛 · 家长端</h1><p>安排节奏、看看进展，把奖励给到对的地方</p></div>
        </div>
        <div className="parent-top-right">
          <span className="parent-pet">🐾 {data.pet?.name || '未领养'} · ★ {data.wallet.balance}</span>
          <button className="parent-btn ghost" onClick={onStudent}>回到学生端</button>
        </div>
      </header>

      <nav className="parent-tabs">
        {[
          ['approve', '待审核', data.approvals.length],
          ['plan', '周计划', data.rules.filter((r) => r.active).length],
          ['calendar', '日历', 0],
          ['rewards', '奖励', data.redemptions.filter((r) => r.status === 'pending').length],
          ['notes', '小纸条', 0],
          ['settings', '设置', 0],
        ].map(([k, n, badge]) => (
          <button key={k as string} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k as Tab)}>
            {n as string}{Number(badge) > 0 && <em>{badge}</em>}
          </button>
        ))}
      </nav>

      <main className="parent-main">
        {tab === 'notes' && <DailyNotesPanel notes={data.dailyNotes || []} onChange={dailyNotes => setData(prev => prev ? { ...prev, dailyNotes } : prev)} toast={toast} />}
        {tab === 'approve' && (
          <section className="parent-section">
            <div className="parent-summary-row">
              <SummaryCard label="待审核" value={data.approvals.length} tone="amber" note="学生提交后在这里看" />
              <SummaryCard label="今日已通过" value={data.progress.approved} tone="green" note={`共 ${data.progress.total} 项`} />
              <SummaryCard label="本周提前完成" value={data.week.early} tone="gold" note={`本周通过 ${data.week.approved} 项`} />
              <SummaryCard label="连续打卡" value={data.wallet.streak} tone="rose" note="天" />
            </div>

            <div className="parent-card">
              <div className="parent-card-head"><div><h2>待审核任务</h2><p>看到照片和留言后，决定通过或退回；通过才会发星贝。</p></div>
                {data.approvals.length > 1 && <button className="btn ghost sm" onClick={() => run(() => v2.approveAll(), async () => { await load(); toast('已全部通过', 'gold'); })} disabled={busy}>全部通过</button>}
              </div>
              {data.approvals.length === 0 ? (
                <div className="parent-empty"><span>☕</span><h4>现在没有待审核</h4><p>学生提交后会出现在这里，也会推送提醒。</p></div>
              ) : (
                <div className="approve-list">
                  {data.approvals.map((t) => (
                    <article key={t.id} className="approve-card">
                      <div className="approve-top">
                        <span className="approve-icon">{t.icon}</span>
                        <div className="approve-title"><h3>{t.title}</h3><p>{t.subject} · {t.timeLabel} · {t.timingLabel || '已提交'}</p></div>
                        <div className="approve-points">★ {t.awardedPoints ?? t.basePoints}</div>
                      </div>
                      {t.photo && <img className="approve-photo" src={t.photo} alt="学生上传的任务照片" />}
                      {t.note && <p className="approve-note">“{t.note}”</p>}
                      <div className="approve-rules">{t.rulesText.map((r) => <span key={r}>{r}</span>)}</div>
                      {rejectId === t.id ? (
                        <div className="reject-box">
                          <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="写一句退回原因，比如：生词还没标" autoFocus />
                          <div className="reject-presets">
                            {['字再工整一点', '照片看不清', '生词还没标', '再读一遍再来'].map((p) => (
                              <button key={p} type="button" onClick={() => setRejectReason(p)}>{p}</button>
                            ))}
                          </div>
                          <div className="reject-actions">
                            <button className="btn ghost sm" onClick={() => { setRejectId(null); setRejectReason(''); }}>取消</button>
                            <button className="btn danger sm" onClick={() => reject(t.id)} disabled={busy}>确认退回</button>
                          </div>
                        </div>
                      ) : (
                        <div className="approve-actions">
                          <button className="btn ghost sm" onClick={() => { setRejectId(t.id); setRejectReason(''); }}>退回重做</button>
                          <button className="btn primary sm" onClick={() => approve(t.id)} disabled={busy}>通过，发 ★{t.awardedPoints ?? t.basePoints}</button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {tab === 'plan' && (
          <section className="parent-section">
            <div className="parent-card">
              <div className="parent-card-head">
                <div><h2>每周固定计划</h2><p>可以每天一样，也可以给周一到周日安排不同的任务；改计划不会重置已经发出的奖励。</p></div>
                <button className="btn primary sm" onClick={() => setRuleSheet({ open: true, rule: null })}>＋ 新建计划</button>
              </div>
              {data.rules.length === 0 ? (
                <div className="parent-empty"><span>🗓️</span><h4>还没有固定计划</h4><p>先建一条，比如“每天 16:00–18:00 晨读 15 分钟”。</p></div>
              ) : (
                <div className="rule-list-parent">
                  {data.rules.map((r) => (
                    <article key={r.id} className={`rule-row ${r.active ? '' : 'is-paused'}`}>
                      <span className="rule-icon">{r.icon}</span>
                      <div className="rule-main">
                        <h3>{r.title} {!r.active && <i>已暂停</i>}</h3>
                        <p>{r.subject} · {r.minutes} 分钟 · {r.timeLabel} · {r.weekdaysLabel}</p>
                        <div className="rule-chips">
                          <span>按时 +{r.basePoints}</span>
                          {r.earlyBonus > 0 && <span>提前 +{r.earlyBonus}</span>}
                          {r.latePenalty > 0 && <span className="warn">超时 −{r.latePenalty}</span>}
                          <span>{r.reviewRequired ? '需审核' : '免审核'}</span>
                          {r.photoRequired && <span>需拍照</span>}
                        </div>
                      </div>
                      <div className="rule-actions">
                        <button className="link-btn" onClick={() => setRuleSheet({ open: true, rule: r })}>编辑</button>
                        <button className="link-btn danger-text" onClick={() => run(() => v2.deleteRule(r.id), async () => { await load(); toast('计划已删除'); })}>删除</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {tab === 'calendar' && (
          <section className="parent-section">
            <div className="parent-summary-row">
              <SummaryCard label="本周完成" value={`${data.week.approved}/${data.week.total}`} tone="green" note={`${data.week.start} ~ ${data.week.end}`} />
              <SummaryCard label="本周提前" value={data.week.early} tone="gold" note="提前完成项" />
              <SummaryCard label="本月完成" value={`${data.monthSummary.approved}/${data.monthSummary.total}`} tone="green" note={data.month} />
              <SummaryCard label="本月待审" value={data.monthSummary.pending} tone="amber" note="项" />
            </div>

            <div className="parent-card">
              <div className="calendar-head">
                <button className="icon-btn" onClick={() => changeMonth(-1)}>‹</button>
                <h2>{data.month.replace('-', ' 年 ')} 月</h2>
                <button className="icon-btn" onClick={() => changeMonth(1)}>›</button>
              </div>
              <div className="calendar-grid">
                {WEEK_CN.map((w) => <div key={w} className="cal-weekday">周{w}</div>)}
                {Array.from({ length: (data.calendar[0]?.weekday || 1) - 1 }).map((_, i) => <div key={`b${i}`} />)}
                {data.calendar.map((d) => (
                  <button key={d.date} className={`cal-day ${d.date === selectedDay ? 'is-on' : ''} ${d.date === data.today ? 'is-today' : ''}`} onClick={() => pickDay(d)}>
                    <b>{d.day}</b>
                    <span className="cal-count">{d.approved}/{d.total}</span>
                    <span className="cal-dots">
                      {d.total > 0 && d.approved === d.total && <i className="dot-green" />}
                      {d.submitted > 0 && <i className="dot-amber" />}
                      {d.rejected > 0 && <i className="dot-rose" />}
                      {d.early > 0 && <i className="dot-gold" />}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="parent-card">
              <div className="parent-card-head"><div><h2>{selectedDay} 的情况</h2><p>点日历上的某一天，看当天每一项的状态。</p></div></div>
              {dayTasks.length === 0 ? <div className="parent-empty small"><p>这一天没有安排。</p></div> : (
                <div className="day-task-list">
                  {dayTasks.map((t) => (
                    <div key={t.id} className="day-task-row">
                      <span>{t.icon}</span><b>{t.title}</b>
                      <em className={`status-chip status-${t.status}`}>{t.status === 'approved' ? '已通过' : t.status === 'submitted' ? '待审核' : t.status === 'rejected' ? '已退回' : '未完成'}</em>
                      <i>{t.awardedPoints != null ? `★ ${t.awardedPoints}` : `★ ${t.basePoints}`}</i>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {tab === 'rewards' && (
          <RewardsTab data={data} toast={toast} busy={busy} onReload={load}
            onEdit={(r) => setRewardSheet({ open: true, reward: r })}
            onAdd={() => setRewardSheet({ open: true, reward: null })}
            run={run} />
        )}

        {tab === 'settings' && (
          <SettingsTab data={data} toast={toast} onReload={load} />
        )}
      </main>

      <RuleSheet open={ruleSheet.open} rule={ruleSheet.rule} onClose={() => setRuleSheet({ open: false, rule: null })}
        onSaved={async (rules) => { setRuleSheet({ open: false, rule: null }); await load(); toast('计划已保存'); }} toast={toast} />
      <RewardSheet open={rewardSheet.open} reward={rewardSheet.reward} onClose={() => setRewardSheet({ open: false, reward: null })}
        onSaved={async () => { setRewardSheet({ open: false, reward: null }); await load(); toast('奖励已保存'); }} toast={toast} />
    </div>
  );
}

function SummaryCard({ label, value, tone, note }: { label: string; value: number | string; tone: string; note: string }) {
  return <div className={`summary-card tone-${tone}`}><span>{label}</span><b>{value}</b><p>{note}</p></div>;
}

/* ---------------- 规则表单 ---------------- */
function RuleSheet({ open, rule, onClose, onSaved, toast }: {
  open: boolean; rule: RuleV2 | null; onClose: () => void; onSaved: (r: RuleV2[]) => void;
  toast: (m: string, tone?: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('语文');
  const [icon, setIcon] = useState('📖');
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [start, setStart] = useState('16:00');
  const [end, setEnd] = useState('18:00');
  const [minutes, setMinutes] = useState(15);
  const [base, setBase] = useState(12);
  const [early, setEarly] = useState(5);
  const [late, setLate] = useState(3);
  const [review, setReview] = useState(true);
  const [photo, setPhoto] = useState(false);
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(rule?.title || '');
    setSubject(rule?.subject || '语文');
    setIcon(rule?.icon || '📖');
    setWeekdays(rule?.weekdays?.length ? rule.weekdays : [1, 2, 3, 4, 5]);
    setStart(rule?.startTime || '16:00');
    setEnd(rule?.endTime || '18:00');
    setMinutes(rule?.minutes || 15);
    setBase(rule?.basePoints || 12);
    setEarly(rule?.earlyBonus ?? 5);
    setLate(rule?.latePenalty ?? 3);
    setReview(rule?.reviewRequired ?? true);
    setPhoto(rule?.photoRequired ?? false);
    setActive(rule?.active ?? true);
  }, [open, rule]);

  const toggleDay = (d: number) => setWeekdays((w) => w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort());

  const save = async () => {
    if (!title.trim()) { toast('给计划起个名字', 'warn'); return; }
    if (!weekdays.length) { toast('至少选一天', 'warn'); return; }
    setBusy(true);
    try {
      const rules = await v2.saveRule({
        id: rule?.id, title: title.trim(), subject, icon, weekdays, minutes,
        startTime: start || null, endTime: end || null,
        basePoints: base, earlyBonus: early, latePenalty: late,
        reviewRequired: review, photoRequired: photo, active,
      });
      onSaved(rules);
    } catch (e: any) { toast(e.message || '保存失败', 'warn'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} wide title={rule ? '编辑计划' : '新建每日计划'}
      sub="每天重复或按星期安排；每一项的规则学生端都能看到"
      footer={<button className="btn primary block" onClick={save} disabled={busy}>{busy ? '保存中…' : '保存计划'}</button>}
    >
      <label className="field-label">计划名称</label>
      <input className="text-input" value={title} maxLength={60} placeholder="比如：晨读 15 分钟" onChange={(e) => setTitle(e.target.value)} />

      <div className="form-grid-2">
        <div>
          <label className="field-label">学科</label>
          <div className="filter-row">{SUBJECTS.map((s) => <button key={s} className={`chip ${subject === s ? 'is-on' : ''}`} onClick={() => setSubject(s)}>{s}</button>)}</div>
        </div>
        <div>
          <label className="field-label">预计用时</label>
          <div className="stepper"><button onClick={() => setMinutes((m) => Math.max(5, m - 5))}>−</button><b>{minutes}<i>分钟</i></b><button onClick={() => setMinutes((m) => Math.min(240, m + 5))}>＋</button></div>
        </div>
      </div>

      <label className="field-label">小图标</label>
      <div className="icon-picker">{ICONS.map((i) => <button key={i} className={icon === i ? 'is-on' : ''} onClick={() => setIcon(i)}>{i}</button>)}</div>

      <label className="field-label">重复日</label>
      <div className="weekday-row">
        <button className={`chip ${weekdays.length === 7 ? 'is-on' : ''}`} onClick={() => setWeekdays(weekdays.length === 7 ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6, 7])}>每天</button>
        {WEEK_CN.map((w, i) => <button key={w} className={`chip ${weekdays.includes(i + 1) ? 'is-on' : ''}`} onClick={() => toggleDay(i + 1)}>周{w}</button>)}
      </div>

      <label className="field-label">建议完成时段（留空表示全天）</label>
      <div className="time-row">
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        <span>到</span>
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>

      <label className="field-label">积分规则</label>
      <div className="points-grid">
        <label>按时完成<input type="number" min={1} max={300} value={base} onChange={(e) => setBase(Number(e.target.value))} /></label>
        <label>提前完成加<input type="number" min={0} max={200} value={early} onChange={(e) => setEarly(Number(e.target.value))} /></label>
        <label>超出时段扣<input type="number" min={0} max={200} value={late} onChange={(e) => setLate(Number(e.target.value))} /></label>
      </div>

      <div className="switch-list">
        <Toggle label="需要家长审核" desc="关闭后学生提交即到账" value={review} onChange={setReview} />
        <Toggle label="需要拍照上传" desc="学生提交时必须附一张照片" value={photo} onChange={setPhoto} />
        <Toggle label="启用这个计划" desc="暂停后不再生成新的每日任务" value={active} onChange={setActive} />
      </div>
    </Sheet>
  );
}

function Toggle({ label, desc, value, onChange }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`switch-row ${value ? 'is-on' : ''}`} onClick={() => onChange(!value)}>
      <div><b>{label}</b><p>{desc}</p></div><span className="switch"><i /></span>
    </button>
  );
}

/* ---------------- 奖励表单 ---------------- */
function RewardSheet({ open, reward, onClose, onSaved, toast }: {
  open: boolean; reward: RewardV2 | null; onClose: () => void; onSaved: () => void;
  toast: (m: string, tone?: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState('🎁');
  const [cost, setCost] = useState(60);
  const [kind, setKind] = useState<'experience' | 'item' | 'privilege'>('experience');
  const [stock, setStock] = useState(-1);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(reward?.title || '');
    setIcon(reward?.icon || '🎁');
    setCost(reward?.cost || 60);
    setKind(reward?.kind || 'experience');
    setStock(reward?.stock ?? -1);
    setNote(reward?.note || '');
  }, [open, reward]);

  const save = async () => {
    if (!title.trim()) { toast('给奖励起个名字', 'warn'); return; }
    setBusy(true);
    try {
      await v2.saveReward({ id: reward?.id, title: title.trim(), icon, cost, kind, stock, note });
      onSaved();
    } catch (e: any) { toast(e.message || '保存失败', 'warn'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} title={reward ? '编辑心愿奖励' : '上架一个心愿'}
      sub="比如：Switch 30 分钟、一次公园、买个新玩具"
      footer={<button className="btn primary block" onClick={save} disabled={busy}>{busy ? '保存中…' : '保存奖励'}</button>}
    >
      <label className="field-label">奖励名称</label>
      <input className="text-input" value={title} maxLength={40} placeholder="比如：Switch 30 分钟" onChange={(e) => setTitle(e.target.value)} />
      <label className="field-label">图标</label>
      <div className="icon-picker">{['🎮', '🍿', '🎬', '🚲', '🧸', '🍦', '🎟️', '🎁', '🛝', '📚'].map((i) => <button key={i} className={icon === i ? 'is-on' : ''} onClick={() => setIcon(i)}>{i}</button>)}</div>
      <div className="form-grid-2">
        <div><label className="field-label">需要星贝</label><input className="text-input" type="number" min={1} value={cost} onChange={(e) => setCost(Number(e.target.value))} /></div>
        <div><label className="field-label">库存（-1 不限）</label><input className="text-input" type="number" min={-1} value={stock} onChange={(e) => setStock(Number(e.target.value))} /></div>
      </div>
      <label className="field-label">类型</label>
      <div className="filter-row">{KIND.map((k) => <button key={k.k} className={`chip ${kind === k.k ? 'is-on' : ''}`} onClick={() => setKind(k.k as any)}>{k.n}</button>)}</div>
      <label className="field-label">说明（可选）</label>
      <textarea className="text-area" value={note} maxLength={160} onChange={(e) => setNote(e.target.value)} placeholder="兑换后怎么兑现，比如：周末找爸爸开电视" />
    </Sheet>
  );
}

/* ---------------- 奖励 / 设置 tab ---------------- */
function RewardsTab({ data, toast, busy, onReload, onEdit, onAdd, run }: {
  data: ParentState; toast: (m: string, tone?: string) => void; busy: boolean;
  onReload: () => Promise<void>; onEdit: (r: RewardV2) => void; onAdd: () => void;
  run: <T>(fn: () => Promise<T>, ok: (r: T) => void) => Promise<void>;
}) {
  const [amount, setAmount] = useState(20);
  const [reason, setReason] = useState('这周很自觉');
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [savingPrice, setSavingPrice] = useState(false);

  useEffect(() => {
    setPrices(Object.fromEntries(data.shop.map((s) => [s.key, s.cost])));
  }, [data.shop]);

  const gift = () => run(() => v2.gift(amount, reason), async () => { await onReload(); toast(`已奖励 ${amount} 星贝`, 'gold'); });
  const savePrices = async () => {
    setSavingPrice(true);
    try {
      await v2.saveSettings({ materialPrices: prices });
      await onReload();
      toast('材料价格已更新');
    } catch (e: any) { toast(e.message || '保存失败', 'warn'); }
    finally { setSavingPrice(false); }
  };

  return (
    <section className="parent-section">
      <div className="parent-grid-2">
        <div className="parent-card">
          <div className="parent-card-head"><div><h2>送一点星贝</h2><p>看到孩子主动、坚持、有进步，可以直接奖励；不用等任务。</p></div></div>
          <div className="gift-box">
            <div className="gift-amounts">{[5, 10, 20, 50].map((n) => <button key={n} className={`chip ${amount === n ? 'is-on' : ''}`} onClick={() => setAmount(n)}>★ {n}</button>)}</div>
            <input className="text-input" type="number" min={1} max={500} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            <input className="text-input" value={reason} maxLength={60} onChange={(e) => setReason(e.target.value)} placeholder="奖励原因" />
            <button className="btn primary" onClick={gift} disabled={busy}>奖励 ★{amount}</button>
          </div>
        </div>

        <div className="parent-card">
          <div className="parent-card-head"><div><h2>待兑现心愿</h2><p>学生兑换后，这里提醒你兑现或退回。</p></div></div>
          {data.redemptions.filter((r) => r.status === 'pending').length === 0 ? (
            <div className="parent-empty small"><p>暂时没有待兑现的心愿。</p></div>
          ) : (
            <div className="redeem-list-parent">
              {data.redemptions.filter((r) => r.status === 'pending').map((r) => (
                <div key={r.id} className="redeem-row-parent">
                  <span>{r.icon}</span><b>{r.title}</b><em>★ {r.cost}</em>
                  <button className="btn ghost sm" onClick={() => run(() => v2.handleRedemption(r.id, 'rejected'), async () => { await onReload(); toast('已退回星贝'); })}>退回</button>
                  <button className="btn primary sm" onClick={() => run(() => v2.handleRedemption(r.id, 'fulfilled'), async () => { await onReload(); toast('已标记兑现'); })}>已兑现</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="parent-card">
        <div className="parent-card-head"><div><h2>心愿奖励</h2><p>除宠物材料外，上架 Switch 时间、零食、玩具等；学生用星贝兑换。</p></div><button className="btn primary sm" onClick={onAdd}>＋ 上架奖励</button></div>
        {data.rewards.length === 0 ? <div className="parent-empty small"><p>还没有上架奖励。</p></div> : (
          <div className="parent-reward-grid">
            {data.rewards.map((r) => (
              <article key={r.id} className={`parent-reward ${r.active ? '' : 'is-off'}`}>
                <span className="pr-icon">{r.icon}</span>
                <div className="pr-main"><h3>{r.title}</h3><p>{r.note || r.kind}{r.stock >= 0 ? ` · 剩 ${r.stock}` : ' · 不限量'}</p></div>
                <b>★ {r.cost}</b>
                <button className="link-btn" onClick={() => onEdit(r)}>编辑</button>
                <button className="link-btn danger-text" onClick={() => run(() => v2.deleteReward(r.id), async () => { await onReload(); toast('已删除'); })}>删除</button>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="parent-card">
        <div className="parent-card-head"><div><h2>宠物材料价格</h2><p>内置材料不删除，只改需要的星贝；会影响学生端显示和实际扣分。</p></div><button className="btn ghost sm" onClick={savePrices} disabled={savingPrice}>{savingPrice ? '保存中…' : '保存价格'}</button></div>
        <div className="price-grid">
          {data.shop.map((s) => (
            <label key={s.key} className="price-row">
              <span>{s.icon}</span><b>{s.name}</b>
              <input type="number" min={1} max={999} value={prices[s.key] ?? s.cost} onChange={(e) => setPrices((p) => ({ ...p, [s.key]: Number(e.target.value) }))} />
              <i>★</i>
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}

function SettingsTab({ data, toast, onReload }: {
  data: ParentState; toast: (m: string, tone?: string) => void; onReload: () => Promise<void>;
}) {
  return <section className="parent-section">
    <div className="parent-card">
      <div className="parent-card-head"><div><h2>家庭与账号</h2><p>在顶部「家庭管理」添加孩子、邀请家长、开通学生账号和修改自己的密码。家庭中的家长共同管理，以下配置和记录属于当前选择的孩子。</p></div></div>
    </div>
    <PushSettings channels={data.settings.notifyChannels} eventSettings={data.settings.notifyEvents} summaryTime={data.settings.notifySummaryTime} publicUrl={data.settings.notifyPublicUrl} onReload={onReload} toast={toast} />
    <PetDataPanel pet={data.pet} onReload={onReload} toast={toast} />
  </section>;
}
