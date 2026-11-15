import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PetStage, { type PetStageHandle } from '../mvp/PetStage';
import Adopt from '../mvp/Adopt';
import PetPicker from './PetPicker';
import TodayNote from './TodayNote';
import TaskViewport from './TaskViewport';
import { Sheet } from '../mvp/Sheets';
import { lines } from './lines';
import { v2 } from './api';
import type { StudentState, TaskV2 } from './types';
import { BagPanel, MaterialShop, RewardShop, StatSheet, StudentMenu, TaskDetail, taskStatusText } from './StudentSheets';
import { petAvatar } from '../mvp/petGrowth';
import type { Pet, GrowthMemory } from '../mvp/types';
import { preloadPetAge } from '../mvp/petEngine';
import GrowthCelebration from './GrowthCelebration';
import { atLevel, growthHint } from './petProgress';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const dateLabel = (key: string) => {
  const d = new Date(`${key}T00:00:00`);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${WEEK[d.getDay()]}`;
};
const greet = () => {
  const h = new Date().getHours();
  if (h < 6) return '夜里有我守着，早点睡';
  if (h < 11) return '早上好，今天也一起';
  if (h < 14) return '中午好，吃饱再学';
  if (h < 18) return '下午好，保持节奏';
  return '晚上好，收个尾吧';
};

export default function StudentHome({ onParent, toast }: { onParent: () => void; toast: (msg: string, tone?: string) => void }) {
  const [data, setData] = useState<StudentState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | 'task' | 'shop' | 'bag' | 'rewards' | 'status' | 'menu' | 'plan' | 'pets'>(() => new URLSearchParams(location.search).has('petPreview') ? 'pets' : null);
  const [selected, setSelected] = useState<TaskV2 | null>(null);
  const [bagTab, setBagTab] = useState('all');
  const [feedingFromShop, setFeedingFromShop] = useState(false);
  const [muted, setMuted] = useState(() => localStorage.getItem('island_muted') === '1');
  const [floaters, setFloaters] = useState<{ id: number; text: string }[]>([]);
  const [confetti, setConfetti] = useState(0);
  const [ceremony, setCeremony] = useState<{ event: GrowthMemory; from: Pet; to: Pet; revealed: boolean } | null>(null);
  const readyNotified = useRef(new Set<string>());
  const upgradeRequest = useRef<{ key: string; id: string } | null>(null);
  const ceremonyRef = useRef(false);
  ceremonyRef.current = !!ceremony;
  const petRef = useRef<PetStageHandle | null>(null);
  const announceNote = useCallback((text: string) => { petRef.current?.say(text, Math.max(6500, Math.min(18000, text.length * 230)), 'reminder'); }, []);
  const mainRef = useRef<HTMLElement | null>(null);
  const prevApproved = useRef<number | null>(null);
  const loadingRef = useRef(false);
  const busyRef = useRef(false);
  const lastNeed = useRef(0);
  const statsRef = useRef<any>(null);
  statsRef.current = data?.pet?.stats || null;

  const load = useCallback(async (quiet = false) => {
    if (loadingRef.current || busyRef.current || ceremonyRef.current) return;
    loadingRef.current = true;
    try {
      const d = await v2.student();
      if (busyRef.current || ceremonyRef.current) return;
      setData(d);
      setError('');
      setSelected((prev) => (prev ? d.tasks.find((t) => t.id === prev.id) || prev : prev));
      if (prevApproved.current != null && d.progress.approved > prevApproved.current) {
        petRef.current?.play('greet');
        petRef.current?.say(lines.approved(), 4200);
        setConfetti(Date.now());
        toast('有任务通过审核，星贝到账啦', 'gold');
      }
      prevApproved.current = d.progress.approved;
    } catch (e: any) {
      if (!quiet) setError(e.message || '小岛连不上');
    } finally {
      loadingRef.current = false;
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load(true);
    }, 12000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => { localStorage.setItem('island_muted', muted ? '1' : '0'); }, [muted]);

  useEffect(() => {
    const pet = data?.pet;
    if (!pet?.progression.ready || ceremony) return;
    const key = `${pet.id}:${pet.progression.level}`;
    if (readyNotified.current.has(key)) return;
    readyNotified.current.add(key);
    petRef.current?.say('我准备好长大啦！准备好时，点一下成长按钮吧。', 5200, 'reminder');
  }, [data?.pet?.id, data?.pet?.progression.level, data?.pet?.progression.ready, ceremony]);

  useEffect(() => {
    const timer = window.setInterval(() => setData((prev) => prev ? {
      ...prev, cooldowns: Object.fromEntries(Object.entries(prev.cooldowns).map(([key, value]) => [key, Math.max(0, value - 1)])),
    } : prev), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // 宠物有需求时会主动、礼貌地表达；不刷屏，约 50 秒最多一次
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const s = statsRef.current;
      if (!s) return;
      const now = Date.now();
      if (now - lastNeed.current < 50000) return;
      let line = '';
      if (s.hunger < 30) line = lines.needHungry();
      else if (s.energy < 18) line = lines.needTired();
      else if (s.mood < 30) line = lines.needLonely();
      else if (s.clean < 30) line = lines.needDirty();
      else if (s.mood < 65 && s.energy > 35) line = lines.needPlay();
      else if (Math.random() < 0.25) line = lines.social();
      if (line) { petRef.current?.say(line, 5200, 'reminder'); lastNeed.current = now; }
    }, 18000);
    return () => window.clearInterval(timer);
  }, []);

  const run = async <T,>(fn: () => Promise<T>, ok: (r: T) => void | Promise<void>) => {
    if (busyRef.current || ceremonyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try { await ok(await fn()); }
    catch (e: any) { toast(e.message || '操作失败', 'warn'); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const refreshAfterCare = async () => {
    const d = await v2.student();
    setData(d);
  };

  const care = (action: 'pet' | 'play' | 'hug') => run(
    () => v2.interact(action),
    async (r) => {
      await refreshAfterCare();
      toast(r.msg);
      petRef.current?.play(action === 'pet' ? 'pet' : action === 'play' ? 'play' : 'hug');
      petRef.current?.say(action === 'pet' ? lines.pet() : action === 'play' ? lines.play() : lines.hug(), 3600);
    },
  );

  const petClick = () => {
    const st = petRef.current?.engine()?.getState();
    if (st === 'CLEANING') return;
    if (st === 'SLEEP' || st === 'WAKING') {
      petRef.current?.play('wake');
      petRef.current?.say(lines.wake(), 2800);
      return;
    }
    petRef.current?.play('pet');
    if ((data?.cooldowns.pet || 0) > 0) return;
    run(() => v2.interact('pet'), async (r) => {
      await refreshAfterCare();
      toast(r.msg);
      petRef.current?.say(lines.pet(), 3600);
    });
  };

  const toggleSleep = () => {
    const st = petRef.current?.engine()?.getState();
    if (st === 'SLEEP' || st === 'WAKING') {
      petRef.current?.play('wake');
      petRef.current?.say(lines.wake(), 2600);
    } else {
      run(() => v2.restPet(), (next) => {
        setData(next);
        petRef.current?.play('sleep');
        petRef.current?.say(lines.sleep(), 2600);
        toast('小憩了一会儿，精力 +14');
      });
    }
  };

  const feed = () => {
    const foods = data?.inventory.filter((x) => x.kind === 'food') || [];
    if (!foods.length) {
      toast('还没有食物，先去材料铺换一点');
      setFeedingFromShop(true);
      setSheet('shop');
      return;
    }
    setBagTab('food');
    setSheet('bag');
  };

  const useItem = (key: string, equipped = true) => run(
    () => v2.useItem(key, equipped),
    async (r) => {
      const item = data?.inventory.find((x) => x.key === key);
      // 使用接口已返回最新宠物、背包和钱包，避免已扣材料后刷新失败被误报为使用失败。
      setData(prev => prev ? { ...prev, pet: r.pet, wallet: r.wallet, inventory: r.inventory, shop: r.shop, cooldowns: r.cooldowns, recent: r.recent } : prev);
      setSheet(null);
      if (item) petRef.current?.useMaterial(item);
      petRef.current?.say(item?.kind === 'food' ? lines.feed() : item?.kind === 'toy' ? lines.play() : item?.kind === 'clean' ? '洗刷刷，马上就清清爽爽啦！' : equipped ? '新装扮戴好啦，好喜欢！' : '先收好，下次再戴！', 3600);
      toast(r.msg || '用掉了一件材料');
      if (item?.kind === 'clean') await new Promise(resolve => window.setTimeout(resolve, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1000 : 3000));
    },
  );

  const buy = (key: string) => run(
    () => v2.buyMaterial(key),
    async (r) => {
      setData(prev => prev ? { ...prev, pet: r.pet, wallet: r.wallet, inventory: r.inventory, shop: r.shop, cooldowns: r.cooldowns, recent: r.recent } : prev);
      const item = data?.shop.find((x) => x.key === key);
      if (feedingFromShop && item?.kind === 'food') {
        setBagTab('food'); setFeedingFromShop(false); setSheet('bag');
      }
      toast(`兑换成功 · ${item?.name || '材料'} 已放进背包`);
      petRef.current?.say('谢谢你的礼物！', 2400);
    },
  );

  const submit = (id: string, body: { note?: string; photo?: string | null }) => run(
    () => v2.submitTask(id, body),
    async (task) => {
      await refreshAfterCare();
      setSheet(null);
      setSelected(null);
      if (task.status === 'approved') {
        petRef.current?.play('greet');
        petRef.current?.say(lines.approved(), 4200);
        setConfetti(Date.now());
        toast(`任务通过，+${task.awardedPoints} 星贝`, 'gold');
      } else {
        petRef.current?.play('happy');
        petRef.current?.say(lines.submit(), 3600);
        toast('已提交，等家长审核');
      }
    },
  );

  const redeem = (id: string) => run(
    () => v2.redeem(id),
    (next) => {
      setData(next);
      petRef.current?.play('happy');
      petRef.current?.say('心愿记下啦，等家长兑现。', 3200);
      toast('兑换成功，等家长兑现');
    },
  );

  const rename = (name: string) => run(
    () => v2.rename(name),
    async () => { await refreshAfterCare(); toast('名字改好啦'); },
  );

  const changeBreed = (breed: string) => run(() => v2.changeBreed(breed, data?.pet?.id ?? ''), (next) => {
    setData(next); setSheet(null);
    toast('小伙伴换好啦，成长和计划都在');
  });



  const upgrade = () => {
    const pet = data?.pet;
    if (!pet?.progression.ready) return;
    const key = `${pet.id}:${pet.progression.level}`;
    if (upgradeRequest.current?.key !== key) upgradeRequest.current = { key, id: crypto.randomUUID() };
    const requestId = upgradeRequest.current.id;
    run(async () => {
      await preloadPetAge(pet.breed, Math.ceil((pet.progression.level + 1) / 2));
      return v2.levelUp(pet.id, pet.progression.level, requestId);
    }, next => {
      if (!next.pet) return;
      ceremonyRef.current = true;
      setCeremony({ event: next.levelupEvent, from: pet, to: next.pet, revealed: false });
      setData(next);
      petRef.current?.engine()?.focusForGrowth();
    });
  };

  const replayGrowth = async (event: GrowthMemory) => {
    const pet = data?.pet;
    if (!pet || ceremonyRef.current || busyRef.current) return;
    setSheet(null);
    busyRef.current = true; setBusy(true);
    try {
      await preloadPetAge(pet.breed, Math.ceil(event.toLevel / 2));
      ceremonyRef.current = true;
      setCeremony({ event, from: atLevel(pet, event.fromLevel), to: atLevel(pet, event.toLevel), revealed: false });
      petRef.current?.engine()?.focusForGrowth();
    } finally { busyRef.current = false; setBusy(false); }
  };

  const finishGrowth = () => {
    if (!ceremony) return;
    const event = ceremony.event;
    setCeremony(null); ceremonyRef.current = false;
    setData(prev => prev?.pet ? { ...prev, pet: { ...prev.pet, growthMemories: prev.pet.growthMemories.map(e => e.id === event.id ? { ...e, seen: true } : e) } } : prev);
    v2.seenLevel(event.id).catch(() => {});
    toast(`已收好一起长大的回忆 · ${event.name}`, 'gold');
    requestAnimationFrame(() => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) petRef.current?.engine()?.focusForGrowth();
      else petRef.current?.play('greet');
      petRef.current?.say('和你一起长大，真好！', 4000);
    });
  };

  const tasks = data?.tasks || [];
  const progress = data?.progress;
  const stats = data?.pet?.stats;
  const growth = data?.pet?.progression;
  const growthPercent = growth?.ready || growth?.terminal ? 100 : Math.min(99, Math.round((growth?.progress || 0) * 100));
  const growthDescription = growth ? growthHint(growth) : '';
  const unseenMemory = data?.pet?.growthMemories?.find(e => !e.seen);
  const stagePet = ceremony ? (ceremony.revealed ? ceremony.to : ceremony.from) : data?.pet;
  const stage = data?.pet?.stageInfo;
  const openTask = (t: TaskV2) => { setSelected(t); setSheet('task'); };
  const hour = new Date().getHours();
  const tone = hour < 7 ? 'dawn' : hour >= 19 ? 'dusk' : 'day';

  const pending = useMemo(() => tasks.filter((t) => t.status === 'submitted'), [tasks]);
  const pendingPoints = pending.reduce((sum, task) => sum + (task.awardedPoints ?? task.basePoints), 0);
  const todayEarned = tasks.reduce((sum, task) => sum + (task.status === 'approved' ? (task.awardedPoints ?? 0) : 0), 0);

  if (error && !data) {
    return (
      <div className="island-error"><div className="error-card"><span>🌧️</span><h2>小岛暂时连不上</h2><p>{error}</p><button className="btn primary" onClick={() => load()}>再试一次</button></div></div>
    );
  }
  if (!data) return <div className="island-loading"><div className="loading-orb" /><p>正在划船去小岛…</p></div>;
  if (!data.pet) return <Adopt embedded onParent={onParent} onDone={() => load()} onToast={toast} adoptFn={(p) => v2.adopt(p)} />;

  return (
    <div className="v2-student">
      <header className="v2-top" inert={!!ceremony}>
        <div className="brand">
          <span className="brand-mark">🏝️</span>
          <div><h1>伴学小岛</h1><p>{greet()}，{data.pet.name}在等你</p></div>
        </div>
        <div className="island-entrances">
          <button onClick={() => setSheet('rewards')}><span>🎁</span>心愿奖励</button>
          <button onClick={() => setSheet('shop')}><span>🏪</span>材料铺</button>
        </div>
        <div className="v2-top-right">
          <span className="date-chip">{dateLabel(data.today)}</span>
          <span className={`streak-chip ${data.wallet.streak > 1 ? 'is-hot' : ''}`}>
            <i>{data.wallet.streak > 0 ? '🔥' : '🌱'}</i>{data.wallet.streak > 0 ? `连续 ${data.wallet.streak} 天` : '今天开始'}
          </span>
          <button className="star-pill" onClick={() => setSheet('shop')}><span>★</span>{data.wallet.balance}<em>星贝</em></button>
          <button className="parent-btn" onClick={onParent}><span>👨‍👩‍👧</span>家长</button>
        </div>
      </header>

      <main className="v2-main" ref={mainRef}>
        <section className="v2-scene-col">
          <div className={`scene tone-${tone} ${ceremony ? 'is-growing' : ''}`}>
            <div className="scene-bg" /><div className="scene-vignette" /><div className="scene-glow" />
            <div className="scene-topline" inert={!!ceremony}>
            <div className="pet-chip">
              <img src={petAvatar(data.pet.breed, data.pet.stage)} alt="" />
              <div><b>{data.pet.name}</b><span>{growth?.name || stage?.name} · 第 {Math.max(1, Math.floor(stage?.days || 0) + 1)} 天</span></div>
              <button className="chip-edit" aria-label="宠物菜单" onClick={() => setSheet('menu')}>⋯</button>
            </div>
          <div className="status-card v2-status" aria-label="宠物状态">
            <div className="stats">
              <Stat icon="🍚" label="饱食" value={stats?.hunger ?? 0} tone="warm" />
              <Stat icon="⚡" label="精力" value={stats?.energy ?? 0} tone="mint" />
              <Stat icon="💛" label="心情" value={stats?.mood ?? 0} tone="gold" />
              <Stat icon="🫧" label="清洁" value={stats?.clean ?? 0} tone="sky" />
            </div>
            <div className={`growth-block age-progress ${growth?.ready ? 'is-ready' : ''}`}>
              <div className="growth-top">
                <span className="growth-next" title={`${growth?.terminal ? '陪伴一直继续' : `下一次长大：${growth?.nextName}`}（${growthDescription}）`}>
                  {growth?.terminal ? '陪伴一直继续' : `下一次长大：${growth?.nextName}`}<em className="growth-inline-hint">（{growthDescription}）</em>
                </span>
                <span className="growth-summary">成长 {data.pet.growth} · 还差{data.pet.nextChest}开百宝箱 <b>{growthPercent}%</b></span>
                <button className="stat-help-btn" aria-label="成长规则与宠物状态" title="成长规则与宠物状态" onClick={() => setSheet('status')}>?</button>
              </div>
              <div className="growth-bar" role="progressbar" aria-label="下一阶段成长进度" aria-valuenow={growthPercent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${(growth?.progress || 0) * 100}%` }} /></div>
            </div>
          </div>
            </div>
            {(growth?.ready || unseenMemory) && <div className="scene-growth-actions" inert={!!ceremony}>
              {growth?.ready && <button className="growth-upgrade-btn" disabled={busy} onClick={upgrade}>{busy ? '正在准备成长时刻…' : `✦ ${growth.nextLevel! % 2 ? '长大到' : '进入'}${growth.nextName}`}</button>}
              {unseenMemory && <button className="growth-replay-link" disabled={busy} title="有一段成长回忆还没看，点这里补看" onClick={() => replayGrowth(unseenMemory)}>补看成长时刻</button>}
            </div>}
            <div className="scene-hint">点地面让它走过去 · 点它摸摸头</div>
            <PetStage ref={petRef} pet={stagePet || data.pet} muted={muted} onPetClick={petClick} />
            {floaters.map((f) => <span key={f.id} className="floater">★ {f.text}</span>)}
            {confetti > 0 && <Confetti key={confetti} />}
            {ceremony && <GrowthCelebration key={ceremony.event.id} event={ceremony.event} petName={data.pet.name} muted={muted}
              onMute={() => setMuted(m => !m)} onReveal={() => {
                setCeremony(c => c ? { ...c, revealed: true } : c);
                requestAnimationFrame(() => {
                  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) petRef.current?.engine()?.focusForGrowth();
                  else petRef.current?.stageUp();
                });
              }} onFinish={finishGrowth} />}
            <div className="care-dock" inert={!!ceremony}>
              <button onClick={feed} className="care-btn"><span>🍚</span><b>喂食</b></button>
              <button onClick={() => care('play')} className="care-btn" disabled={busy || (data.cooldowns.play || 0) > 0}><span>🧶</span><b>{data.cooldowns.play ? `${data.cooldowns.play}s` : '陪玩'}</b></button>
              <button onClick={() => care('pet')} className="care-btn" disabled={busy || (data.cooldowns.pet || 0) > 0}><span>🫶</span><b>{data.cooldowns.pet ? `${data.cooldowns.pet}s` : '摸摸'}</b></button>
              <button onClick={() => care('hug')} className="care-btn" disabled={busy || (data.cooldowns.hug || 0) > 0}><span>🤗</span><b>{data.cooldowns.hug ? `${data.cooldowns.hug}s` : '抱抱'}</b></button>
              <button onClick={toggleSleep} className="care-btn" disabled={busy} title={data.cooldowns.rest ? `恢复精力还需 ${Math.ceil(data.cooldowns.rest / 60)} 分钟` : '小憩恢复精力'}><span>🌙</span><b>小憩</b></button>
            </div>
          </div>


        </section>

        <aside className="v2-plan-col" inert={!!ceremony}>
          <section className={`plan-card v2-plan ${progress?.total && progress.approved === progress.total ? 'is-complete' : ''}`}>
            <div className="plan-head">
              <div><span className="eyebrow">TODAY</span><h2>今日计划</h2>
                <p>{progress?.total ? `${progress.approved} / ${progress.total} 已通过` : '今天还没有安排'}</p>
              </div>
              <ProgressRing percent={progress?.percent || 0} approved={progress?.approved || 0} total={progress?.total || 0} />
            </div>

            <div className="plan-meta">
              <span><i>✓</i>已通过 {progress?.approved || 0}</span>
              <span className="pending-summary" title={`${pending.length} 项等家长审核，通过可赚 ${pendingPoints} 星贝`}>
                <i>⏳</i>待审核 {pending.length}
              </span>
              <span className="all-bonus">今日已赚 {todayEarned} ★</span>
            </div>

            <TaskViewport count={tasks.length}>
              {tasks.length === 0 && (
                <div className="task-empty">
                  <img src="pets/banner_task.jpg" alt="" />
                  <h4>今天还没有计划</h4>
                  <p>让家长在家长端安排今天的任务，或者先休息一下。</p>
                </div>
              )}
              {tasks.map((t) => (
                <button key={t.id} className={`v2-task status-${t.status}`} onClick={() => openTask(t)}>
                  <span className="v2-task-icon">{t.icon}</span>
                  <span className="v2-task-main">
                    <span className="v2-task-title">{t.title}</span>
                    <span className="v2-task-meta">
                      <span className={`subject subject-${t.subject}`}>{t.subject}</span>
                      <span>{t.timeLabel}</span>
                      {t.timingLabel && <span className={t.timing === 'late' ? 'is-late' : t.timing === 'early' ? 'is-early' : ''}>{t.timingLabel}</span>}
                      {t.status !== 'approved' && <span>★ {t.awardedPoints ?? t.basePoints}</span>}
                      {t.photoRequired && <span className="tiny-tag">拍照</span>}
                    </span>
                    {t.rejectReason && <span className="v2-task-reject">退回：{t.rejectReason}</span>}
                  </span>
                  <span className={`v2-status-badge ${t.status}`}>{taskStatusText(t)}</span>
                </button>
              ))}
            </TaskViewport>


          </section>

          <TodayNote data={data} paused={sheet !== null || !!ceremony} onSay={announceNote} />
        </aside>
      </main>

      <nav className="v2-dock" inert={!!ceremony}>
        <button className="is-on" onClick={() => { setSheet(null); mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }}><span>🏝️</span>小岛</button>
        <button onClick={() => setSheet('plan')}><span>🗓️</span>计划</button>
        <button onClick={() => setSheet('shop')}><span>🏪</span>材料</button>
        <button onClick={() => setSheet('rewards')}><span>🎁</span>心愿</button>
        <button onClick={() => setSheet('bag')}><span>🧺</span>背包</button>
      </nav>

      <TaskDetail open={sheet === 'task'} task={selected} onClose={() => setSheet(null)} onSubmit={submit} busy={busy} />
      <MaterialShop open={sheet === 'shop'} onClose={() => { setSheet(null); setFeedingFromShop(false); }} data={data} onBuy={buy} busy={busy} feeding={feedingFromShop} />
      <BagPanel open={sheet === 'bag'} onClose={() => setSheet(null)} data={data} onUse={useItem} busy={busy} tab={bagTab} setTab={setBagTab} />
      <RewardShop open={sheet === 'rewards'} onClose={() => setSheet(null)} data={data} onRedeem={redeem} busy={busy} />
      <StatSheet open={sheet === 'status'} onClose={() => setSheet(null)} pet={data.pet} />
      <StudentMenu open={sheet === 'menu'} onClose={() => setSheet(null)} data={data} muted={muted}
        onToggleMute={() => setMuted((m) => !m)} onRename={rename}
        onReplay={replayGrowth} onStat={() => setSheet('status')} onParent={() => { setSheet(null); onParent(); }} onPets={() => setSheet('pets')} />
      {data.pet && <PetPicker open={sheet === 'pets'} onClose={() => setSheet(null)} pet={data.pet} busy={busy} onChoose={changeBreed} />}
      <PlanOverview open={sheet === 'plan'} onClose={() => setSheet(null)} data={data} />
    </div>
  );
}

function PlanOverview({ open, onClose, data }: { open: boolean; onClose: () => void; data: StudentState }) {
  const week = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  return (
    <Sheet open={open} onClose={onClose} title="本周固定计划" sub="家长安排好的节奏，每天按自己的时间完成">
      {data.rules.length === 0 ? (
        <div className="bag-empty"><div className="bag-empty-art">🗓️</div><h4>这周还没有固定计划</h4><p>去家长端安排一下每天想做的事。</p></div>
      ) : (
        <div className="plan-overview-list">
          {data.rules.map((r) => (
            <div key={r.id} className="plan-overview-row">
              <span className="po-icon">{r.icon}</span>
              <div className="po-main">
                <b>{r.title}</b>
                <p>{r.subject} · {r.minutes} 分钟 · {r.timeLabel}</p>
                <div className="po-days">{week.map((w, i) => <i key={w} className={r.weekdays.includes(i + 1) ? 'on' : ''}>{w.slice(1)}</i>)}</div>
              </div>
              <div className="po-points">★ {r.basePoints}<em>{r.reviewRequired ? '需审核' : '免审核'}</em></div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
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

function ProgressRing({ percent, approved, total }: { percent: number; approved: number; total: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring">
      <svg viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} className="ring-bg" />
        <circle cx="36" cy="36" r={r} className="ring-fg" strokeDasharray={`${(percent / 100) * c} ${c}`} transform="rotate(-90 36 36)" />
      </svg>
      <div className="ring-label"><b>{total ? percent : 0}<i>%</i></b><span>{approved}/{total}</span></div>
    </div>
  );
}

function Confetti() {
  return (
    <div className="confetti">
      {Array.from({ length: 26 }).map((_, i) => (
        <i key={i} style={{
          ['--x' as any]: `${Math.random() * 100}%`,
          ['--c' as any]: ['#F2B36B', '#E88C7D', '#8FC3A6', '#E7C566', '#B9D8F0'][i % 5],
          ['--d' as any]: `${0.9 + Math.random() * 0.9}s`,
          ['--r' as any]: `${Math.random() * 360}deg`,
        }} />
      ))}
    </div>
  );
}
