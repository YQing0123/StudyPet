import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import PetStage, { type PetStageHandle } from './PetStage';
import Confetti, { CONFETTI_DURATION } from './Confetti';
import Adopt from './Adopt';
import { BagSheet, MenuSheet, ShopSheet, TaskSheet } from './Sheets';
import type { InvItem, ShopItem, Task, TodayData } from './types';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

const PRAISE = ['好棒！今天又向前一小步', '我看到了，你超认真', '完成啦！给你转个圈', '记下了，离目标更近了', '这页翻过去啦～'];
const IDLE_LINES = ['今天想先做哪一件？', '我在这儿陪着你', '写完记得来摸摸我', '慢慢来，我会等你'];

function dateLabel(key: string) {
  const d = new Date(`${key}T00:00:00`);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${WEEK[d.getDay()]}`;
}

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了，早点休息';
  if (h < 11) return '早上好，今天也一起';
  if (h < 14) return '中午好，吃饱再学';
  if (h < 18) return '下午好，保持节奏';
  return '晚上好，收个尾吧';
}

const KIND_ICON: Record<string, string> = { food: '🍚', toy: '🧶', clean: '🫧', deco: '🎀' };

export default function Today() {
  const [data, setData] = useState<TodayData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | 'shop' | 'bag' | 'task' | 'menu'>(null);
  const [bagTab, setBagTab] = useState('all');
  const [muted, setMuted] = useState(() => localStorage.getItem('island_muted') === '1');
  const [toasts, setToasts] = useState<{ id: number; text: string; tone?: string }[]>([]);
  const [floaters, setFloaters] = useState<{ id: number; text: string }[]>([]);
  const [confetti, setConfetti] = useState(0);
  useEffect(() => {
    if (!confetti) return;
    const timer = window.setTimeout(() => setConfetti(0), CONFETTI_DURATION);
    return () => window.clearTimeout(timer);
  }, [confetti]);
  const [newTaskId, setNewTaskId] = useState<string | null>(null);
  const petRef = useRef<PetStageHandle | null>(null);
  const prevStage = useRef<number | null>(null);
  const prevBalance = useRef<number | null>(null);
  const toastId = useRef(0);

  const toast = useCallback((text: string, tone?: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await api.today();
      setData(d);
      setLoadError('');
      if (d.pet) prevStage.current = d.pet.stage;
      prevBalance.current = d.wallet.balance;
    } catch (e: any) {
      setLoadError(e.message || '小岛暂时连不上');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    localStorage.setItem('island_muted', muted ? '1' : '0');
  }, [muted]);

  const apply = useCallback((next: TodayData, opts: { say?: string; float?: number } = {}) => {
    setData(next);
    if (next.pet && prevStage.current != null && next.pet.stage > prevStage.current) {
      window.setTimeout(() => {
        petRef.current?.stageUp();
        petRef.current?.say(`${next.pet?.name}长大了一点！`, 4200);
        toast(`成长阶段提升：${next.pet?.stageInfo.name}`, 'gold');
      }, 280);
    }
    if (next.pet) prevStage.current = next.pet.stage;
    if (opts.float) {
      const id = Date.now() + Math.random();
      setFloaters((f) => [...f, { id, text: `+${opts.float}` }]);
      window.setTimeout(() => setFloaters((f) => f.filter((x) => x.id !== id)), 1800);
    }
    if (opts.say) petRef.current?.say(opts.say, 4200);
    prevBalance.current = next.wallet.balance;
  }, [toast]);

  const run = useCallback(async <T,>(fn: () => Promise<T>, onOk: (r: T) => void) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fn();
      onOk(r);
    } catch (e: any) {
      toast(e.message || '操作失败', 'warn');
    } finally {
      setBusy(false);
    }
  }, [busy, toast]);

  /* ---------------- 任务 ---------------- */
  const toggleTask = (task: Task) => run(
    () => api.toggleTask(task.id, task.status !== 'done'),
    (r) => {
      if (r.changed) {
        if (task.status !== 'done') {
          apply(r, {
            float: task.points,
            say: PRAISE[Math.floor(Math.random() * PRAISE.length)],
          });
          petRef.current?.play('happy');
          if (r.bonus?.awarded) {
            window.setTimeout(() => {
              petRef.current?.play('greet');
              setConfetti(Date.now());
              toast(`今日计划全部完成，额外 +${r.bonus?.points || 15} 星贝`, 'gold');
            }, 900);
          }
        } else {
          apply(r, { say: '没关系，重新安排也可以' });
          toast('已撤回这次打卡');
        }
      }
    },
  );

  const deleteTask = (task: Task) => run(
    () => api.deleteTask(task.id),
    (r) => { apply(r); toast('任务已移除'); },
  );

  const addTask = (t: { title: string; subject: string; minutes: number; points: number }) => run(
    () => api.addTask(t),
    (r) => {
      apply(r);
      setSheet(null);
      const added = r.tasks.find((x) => x.title === t.title && x.status === 'open');
      if (added) setNewTaskId(added.id);
      petRef.current?.say('记在小本本上啦', 2600);
      toast(`已加入今日计划 · ${t.points} 星贝`);
    },
  );

  /* ---------------- 商店 / 背包 ---------------- */
  const buy = (key: string) => run(
    () => api.buy(key, 1),
    (r) => {
      const item = data?.shop.find((x) => x.key === key);
      apply(r);
      petRef.current?.say(`谢谢你的${item?.name || '礼物'}！`, 2600);
      toast(`兑换成功 · ${item?.name || '材料'} 已放进背包`);
    },
  );

  const useItem = (key: string) => run(
    () => api.use(key),
    (r) => {
      const item = data?.inventory.find((x) => x.key === key) || data?.shop.find((x) => x.key === key);
      apply(r, { say: r.msg });
      setSheet(null);
      const action = item?.kind === 'food' ? 'feed' : item?.kind === 'toy' ? 'play' : item?.kind === 'clean' ? 'pet' : 'happy';
      petRef.current?.play(action as any);
      if (r.loot?.length) {
        const names = r.loot.map((x) => `${x.icon}${x.name}`).join('、');
        toast(`成长满 50，百宝箱开出：${names}`, 'gold');
      } else if (item) {
        toast(r.msg || '用掉了一件材料');
      }
    },
  );

  const interact = (action: 'pet' | 'play' | 'hug') => run(
    () => api.interact(action),
    (r) => {
      apply(r, { say: r.msg });
      petRef.current?.play(action === 'pet' ? 'pet' : action === 'play' ? 'play' : 'hug');
    },
  );

  const petByClick = () => {
    const st = petRef.current?.engine()?.getState();
    if (st === 'SLEEP' || st === 'WAKING') {
      petRef.current?.play('wake');
      petRef.current?.say('唔…醒啦', 2600);
      return;
    }
    petRef.current?.play('pet');
    if ((data?.cooldowns.pet || 0) > 0) return;
    run(() => api.interact('pet'), (r) => apply(r, { say: r.msg }));
  };

  const toggleSleep = () => {
    const st = petRef.current?.engine()?.getState();
    if (st === 'SLEEP' || st === 'WAKING') {
      petRef.current?.play('wake');
      petRef.current?.say('睡饱啦，继续陪你', 2600);
    } else {
      petRef.current?.play('sleep');
      petRef.current?.say('那就眯一小会儿…', 2400);
    }
  };

  const feed = () => {
    const foods = data?.inventory.filter((x) => x.kind === 'food') || [];
    if (!foods.length) {
      toast('还没有食物，先用星贝换一点吧');
      setSheet('shop');
      return;
    }
    setBagTab('food');
    setSheet('bag');
  };

  const reset = () => run(
    () => fetch('/api/pet/reset', { method: 'POST' }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json()).error || '重置失败');
      return r.json() as Promise<TodayData>;
    }),
    (r) => {
      setData(r);
      setSheet(null);
      prevStage.current = null;
      toast('小岛已经重新开始');
    },
  );

  const rename = (name: string) => run(
    () => api.rename(name),
    (r) => { apply(r); toast('名字改好啦'); },
  );

  const progress = data?.progress;
  const stats = data?.pet?.stats;
  const stage = data?.pet?.stageInfo;

  const shopPicks = useMemo(() => {
    if (!data) return [];
    const order = ['fish', 'ball', 'bath'];
    return order.map((k) => data.shop.find((x) => x.key === k)).filter(Boolean) as ShopItem[];
  }, [data]);

  if (loadError) {
    return (
      <div className="island-error">
        <div className="error-card">
          <span>🌧️</span>
          <h2>小岛暂时连不上</h2>
          <p>{loadError}</p>
          <button className="btn primary" onClick={load}>再试一次</button>
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="island-loading"><div className="loading-orb" /><p>正在划船去小岛…</p></div>;
  }

  if (data.isNew || !data.pet) {
    return (
      <>
        <Adopt onDone={(d) => { setData(d); prevStage.current = d.pet?.stage ?? null; }} onToast={toast} />
        <div className="toast-stack">{toasts.map((t) => <div key={t.id} className={`toast ${t.tone || ''}`}>{t.text}</div>)}</div>
      </>
    );
  }

  const hour = new Date().getHours();
  const sceneTone = hour < 7 ? 'dawn' : hour >= 19 ? 'dusk' : 'day';

  return (
    <div className="island">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">🏝️</span>
          <div>
            <h1>伴学小岛</h1>
            <p>{timeGreeting()}，{data.pet.name}在等你</p>
          </div>
        </div>
        <div className="top-right">
          <span className="date-chip">{dateLabel(data.today)}</span>
          <span className={`streak-chip ${data.wallet.streak > 1 ? 'is-hot' : ''}`}>
            <i>{data.wallet.streak > 0 ? '🔥' : '🌱'}</i>
            {data.wallet.streak > 0 ? `连续 ${data.wallet.streak} 天` : '今天开始'}
          </span>
          <button className="star-pill" onClick={() => setSheet('shop')} title="去材料铺">
            <span>★</span>{data.wallet.balance}
            <em>星贝</em>
          </button>
          <button className="icon-btn round" onClick={() => setSheet('menu')} aria-label="小岛档案">⋯</button>
        </div>
      </header>

      <main className="grid">
        <section className="left">
          <div className={`scene tone-${sceneTone}`}>
            <div className="scene-bg" />
            <div className="scene-vignette" />
            <div className="scene-glow" />

            <div className="pet-chip">
              <img src={`pets/avatars/${data.pet.breed}.png`} alt="" />
              <div>
                <b>{data.pet.name}</b>
                <span>{stage?.name} · 第 {Math.max(1, Math.floor(stage?.days || 0) + 1)} 天</span>
              </div>
              <button className="chip-edit" onClick={() => setSheet('menu')} aria-label="查看档案">⋯</button>
            </div>

            <div className="scene-hint">点地面让它走过去 · 点它摸摸头</div>

            <PetStage ref={petRef} pet={data.pet} muted={muted} onPetClick={petByClick} />

            {floaters.map((f) => (
              <span key={f.id} className="floater">★ {f.text}</span>
            ))}

            {confetti > 0 && <Confetti key={confetti} />}

            <div className="care-dock">
              <button onClick={feed} className="care-btn">
                <span>🍚</span><b>喂食</b>
              </button>
              <button onClick={() => interact('play')} className="care-btn" disabled={busy || (data.cooldowns.play || 0) > 0}>
                <span>🧶</span><b>{data.cooldowns.play ? `${data.cooldowns.play}s` : '陪玩'}</b>
              </button>
              <button onClick={() => interact('pet')} className="care-btn" disabled={busy || (data.cooldowns.pet || 0) > 0}>
                <span>🫶</span><b>{data.cooldowns.pet ? `${data.cooldowns.pet}s` : '摸摸'}</b>
              </button>
              <button onClick={() => interact('hug')} className="care-btn" disabled={busy || (data.cooldowns.hug || 0) > 0}>
                <span>🤗</span><b>{data.cooldowns.hug ? `${data.cooldowns.hug}s` : '抱抱'}</b>
              </button>
              <button onClick={toggleSleep} className="care-btn">
                <span>🌙</span><b>小憩</b>
              </button>
            </div>
          </div>

          <div className="status-card">
            <div className="stats">
              <Stat icon="🍚" label="饱食" value={stats?.hunger ?? 0} tone="warm" />
              <Stat icon="⚡" label="精力" value={stats?.energy ?? 0} tone="mint" />
              <Stat icon="💛" label="心情" value={stats?.mood ?? 0} tone="gold" />
              <Stat icon="🫧" label="清洁" value={stats?.clean ?? 0} tone="sky" />
            </div>
            <div className="growth-block">
              <div className="growth-top">
                <span>成长 {data.pet.growth}</span>
                <em>还差 {data.pet.nextChest} 开百宝箱</em>
              </div>
              <div className="growth-bar"><i style={{ width: `${((data.pet.growth % 50) / 50) * 100}%` }} /></div>
              <div className="stage-line">
                <span>{stage?.name} · 体型 {Math.round((stage?.scale || 1) * 100)}%</span>
                <span>{stage?.nextDays ? `再 ${Math.max(0, Math.ceil((stage.nextDays - (stage.effectiveDays || 0))))} 天到下一阶段` : '已长大'}</span>
              </div>
            </div>
          </div>
        </section>

        <aside className="right">
          <section className={`plan-card ${progress?.total && progress.done === progress.total ? 'is-complete' : ''}`}>
            <div className="plan-head">
              <div>
                <span className="eyebrow">TODAY</span>
                <h2>今日计划</h2>
                <p>{progress?.total ? `${progress.done} / ${progress.total} 件已完成` : '今天还没有安排'}</p>
              </div>
              <ProgressRing percent={progress?.percent || 0} done={progress?.done || 0} total={progress?.total || 0} />
            </div>

            <div className="plan-meta">
              <span><i>⏱</i>{progress?.minutes || 0} 分钟</span>
              <span><i>★</i>已赚 {progress?.points || 0}</span>
              <span className="all-bonus">全清 +{data.dailyBonus}</span>
            </div>

            <div className="task-list">
              {data.tasks.length === 0 && (
                <div className="task-empty">
                  <img src="pets/banner_task.jpg" alt="" />
                  <h4>今天想完成点什么？</h4>
                  <p>把一个任务写下来，就已经开始一半了。</p>
                  <button className="btn primary sm" onClick={() => setSheet('task')}>添加第一个任务</button>
                </div>
              )}

              {data.tasks.map((task) => (
                <div
                  key={task.id}
                  className={`task-row ${task.status === 'done' ? 'is-done' : ''} ${newTaskId === task.id ? 'is-new' : ''}`}
                >
                  <button
                    className="check"
                    onClick={() => toggleTask(task)}
                    disabled={busy}
                    aria-label={task.status === 'done' ? '撤回完成' : '完成'}
                  >
                    {task.status === 'done' ? '✓' : ''}
                  </button>
                  <div className="task-main" onClick={() => toggleTask(task)}>
                    <div className="task-title">{task.title}</div>
                    <div className="task-sub">
                      <span className={`subject subject-${task.subject}`}>{task.subject}</span>
                      <span>⏱ {task.minutes} 分钟</span>
                      <span className="task-points">★ {task.points}</span>
                    </div>
                  </div>
                  <button className="task-del" onClick={() => deleteTask(task)} title="删除任务">×</button>
                </div>
              ))}
            </div>

            {data.tasks.length > 0 && (
              <button className="add-task" onClick={() => setSheet('task')}>
                <span>＋</span> 再加一件
              </button>
            )}

            {!!progress && progress.total > 0 && progress.done === progress.total && (
              <div className="complete-banner">
                <span>🎉</span>
                <div><b>今天的计划全部完成</b><p>星贝 +{data.dailyBonus} 已到账，去陪陪它吧</p></div>
              </div>
            )}
          </section>

          <div className="quick-row">
            <button className="quick-card" onClick={() => { setBagTab('all'); setSheet('bag'); }}>
              <span className="quick-icon">🧺</span>
              <div><b>背包</b><p>{data.inventory.reduce((s, x) => s + x.qty, 0)} 件材料</p></div>
            </button>
            <button className="quick-card" onClick={() => setSheet('shop')}>
              <span className="quick-icon">🏪</span>
              <div><b>材料铺</b><p>用星贝换好吃的</p></div>
            </button>
          </div>

          <div className="shop-strip">
            <div className="shop-strip-head">
              <h4>今日推荐</h4>
              <button onClick={() => setSheet('shop')}>全部 ›</button>
            </div>
            <div className="shop-strip-list">
              {shopPicks.map((item) => (
                <button key={item.key} className="mini-item" onClick={() => setSheet('shop')}>
                  <span>{item.icon}</span>
                  <b>{item.name}</b>
                  <em>★ {item.cost}</em>
                </button>
              ))}
            </div>
          </div>

          <button className="ledger-line" onClick={() => setSheet('menu')}>
            <span>最近积分</span>
            <span className="ledger-last">
              {data.recent[0] ? `${data.recent[0].reason} · ${data.recent[0].delta > 0 ? '+' : ''}${data.recent[0].delta}` : '还没有记录'}
            </span>
          </button>
        </aside>
      </main>

      <ShopSheet open={sheet === 'shop'} onClose={() => setSheet(null)} data={data} onBuy={buy} busy={busy} />
      <BagSheet open={sheet === 'bag'} onClose={() => setSheet(null)} data={data} onUse={useItem} busy={busy} tab={bagTab} setTab={setBagTab} />
      <TaskSheet open={sheet === 'task'} onClose={() => setSheet(null)} onAdd={addTask} busy={busy} />
      <MenuSheet
        open={sheet === 'menu'} onClose={() => setSheet(null)} pet={data.pet} muted={muted}
        onToggleMute={() => setMuted((m) => !m)} onRename={rename} onReset={reset} wallet={data.wallet}
      />

      <div className="toast-stack">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.tone || ''}`}>{t.text}</div>)}
      </div>
    </div>
  );
}

function Stat({ icon, label, value, tone }: { icon: string; label: string; value: number; tone: string }) {
  const v = Math.round(value);
  return (
    <div className={`stat tone-${tone}`}>
      <div className="stat-top"><span>{icon}</span><b>{label}</b><em>{v}</em></div>
      <div className="stat-bar"><i style={{ width: `${Math.max(0, Math.min(100, v))}%` }} /></div>
    </div>
  );
}

function ProgressRing({ percent, done, total }: { percent: number; done: number; total: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring">
      <svg viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} className="ring-bg" />
        <circle
          cx="36" cy="36" r={r} className="ring-fg"
          strokeDasharray={`${(percent / 100) * c} ${c}`}
          transform="rotate(-90 36 36)"
        />
      </svg>
      <div className="ring-label"><b>{total ? percent : 0}<i>%</i></b><span>{done}/{total}</span></div>
    </div>
  );
}
