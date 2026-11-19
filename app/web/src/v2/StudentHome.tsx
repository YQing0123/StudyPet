import RoomDecor from './RoomDecor';
import RoomBackdrop, { useRoomPhase } from './RoomBackdrop';
import { PET_SCENARIOS, scenarioForItem } from '../shared/petScenarios.mjs';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import Challenges from './Challenges';
import IslandIcon from './IslandIcon';
import PointHistorySheet from './PointHistory';
import Confetti, { CONFETTI_DURATION } from '../mvp/Confetti';
import { atLevel, growthHint } from './petProgress';
import { TravelScene, TravelSheet, TravelRewardsSheet } from './Travel';
import { usePetSleep } from './usePetSleep';
import './care-revision.css';
import { PlaytimeCountdown, usePlaytime } from './PlaytimeGate';

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

const careDuration = (key: string, fallback = 6000) => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1000 : PET_SCENARIOS[key]?.duration || fallback;
const waitForCare = (milliseconds: number) => new Promise<void>(resolve => window.setTimeout(resolve, milliseconds));
const NEED_LIMITS = { hunger: 30, energy: 25, mood: 35, clean: 65 };
const needBand = (value: number, limit: number) => value < limit ? value < Math.min(18, limit / 2) ? 2 : 1 : 0;

export default function StudentHome({ onParent, onLogout, parentName, accountBusy, companion, toast }: {
  onParent: () => void; onLogout: () => void; parentName?: string; accountBusy: boolean;
  companion: ReactNode; toast: (msg: string, tone?: string) => void;
}) {
  const [data, setData] = useState<StudentState | null>(null);
  const playtime = usePlaytime();
  useEffect(() => {if(data)playtime.publish(data);}, [data,playtime.publish]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | 'task' | 'shop' | 'bag' | 'rewards' | 'status' | 'menu' | 'plan' | 'pets' | 'travel' | 'challenge' | 'points'>(() => new URLSearchParams(location.search).has('petPreview') ? 'pets' : null);
  const challengeActive = useRef(false);
  challengeActive.current = sheet === 'challenge';
  const [selected, setSelected] = useState<TaskV2 | null>(null);
  const [bagTab, setBagTab] = useState('all');
  const [feedingFromShop, setFeedingFromShop] = useState(false);
  const [travelRewardsOpen, setTravelRewardsOpen] = useState(false);
  const shownTravelRewards = useRef<string | null>(null);
  const [muted, setMuted] = useState(() => localStorage.getItem('island_muted') === '1');
  const [floaters, setFloaters] = useState<{ id: number; text: string }[]>([]);
  const [confetti, setConfetti] = useState(0);
  useEffect(() => {
    if (!confetti) return;
    const timer = window.setTimeout(() => setConfetti(0), CONFETTI_DURATION);
    return () => window.clearTimeout(timer);
  }, [confetti]);
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
  const activeTripRef = useRef<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (loadingRef.current || busyRef.current || ceremonyRef.current) return;
    loadingRef.current = true;
    try {
      const d = await v2.student();
      if (busyRef.current || ceremonyRef.current) return;
      setData(d);
      setError('');
      setSelected((prev) => (prev ? d.tasks.find((t) => t.id === prev.id) || prev : prev));
      const tripEnded = !!activeTripRef.current && !d.travel.activeTrip && d.travel.lastTrip?.id === activeTripRef.current;
      activeTripRef.current = d.travel.activeTrip?.id || null;
      if (!challengeActive.current && d.travel.pendingTrip && shownTravelRewards.current !== d.travel.pendingTrip.id) {
        shownTravelRewards.current = d.travel.pendingTrip.id;
        setSheet(null);
        setTravelRewardsOpen(true);
      }
      if (tripEnded) toast('旅行回家啦，打开行囊查收明信片吧', 'gold');
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
  const { active: sleepingWindow, getActive: currentSleep } = usePetSleep(data?.sleep, data?.pet?.id, petRef, !data?.travel?.activeTrip, () => { void load(true); }, toast);
  const roomPhase = useRoomPhase(data?.sleep?.serverNow);

  useEffect(() => {
    if (sleepingWindow && ceremony) { setCeremony(null); ceremonyRef.current = false; }
  }, [sleepingWindow?.id, ceremony]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load(true);
    }, 20000);
    const refresh = () => {
      if (document.visibilityState === 'visible') load(true);
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
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
    if (!data || !Object.values(data.cooldowns).some(value => value > 0)) return;
    const initial = data.cooldowns, started = performance.now();
    let timer = 0;
    const update = () => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      const elapsed = Math.floor((performance.now() - started) / 1000);
      if (elapsed > 0) setData(prev => !prev || prev.cooldowns !== initial ? prev : {
        ...prev, cooldowns: Object.fromEntries(Object.entries(initial).map(([key, value]) => [key, Math.max(0, value - elapsed)])),
      });
      else timer = window.setTimeout(update, 1000);
    };
    timer = window.setTimeout(update, 1000);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', update); };
  }, [data?.cooldowns]);

  // Needs wait until the island is idle. Throttles survive refreshes and are
  // scoped to this pet, so opening another child's island never suppresses it.
  const reminderContext = useRef({ data, busy, sheet, sleepingWindow, ceremony: !!ceremony, travelRewardsOpen });
  reminderContext.current = { data, busy, sheet, sleepingWindow, ceremony: !!ceremony, travelRewardsOpen };
  const remindNeeds = useCallback(() => {
    const ctx = reminderContext.current;
    const pet = ctx.data?.pet;
    const engine = petRef.current?.engine();
    if (!pet || !engine || document.visibilityState !== 'visible' || ctx.busy || ctx.sheet || ctx.sleepingWindow || ctx.ceremony || ctx.travelRewardsOpen || ctx.data?.travel.activeTrip) return;
    if (!['IDLE', 'WANDER', 'SLEEPY'].includes(engine.getState())) return;
    const now = Date.now(), key = `island-care-reminders:${pet.id}`;
    let history: Record<string, number> = {};
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) history = saved;
    } catch { /* Private browsing can disable storage. */ }
    if (now - Number(history.any || 0) < 60000) return;
    const stats = pet.stats;
    const choices = (Object.keys(NEED_LIMITS) as (keyof typeof NEED_LIMITS)[])
      .filter(stat => stats[stat] < NEED_LIMITS[stat] && now - Number(history[stat] || 0) >= 5 * 60000)
      .sort((a, b) => stats[a] / NEED_LIMITS[a] - stats[b] / NEED_LIMITS[b]);
    const stat = choices[0];
    const text = stat === 'hunger' ? '小主人，我的肚子有点空啦，去背包给我一点食物好吗？吃饱了心情也会变好。'
      : stat === 'energy' ? '玩了一会儿，我有点累啦。让我小憩一下，你也去完成一个小计划吧，睡醒再一起玩。'
      : stat === 'clean' ? stats.clean < 50 ? '小主人，我身上脏脏的，需要背包里的泡泡浴认真洗个澡啦。' : ctx.data?.hygiene.showerAvailable ? '小主人，我想洗个澡啦。背包里今天还有一次免费淋浴，冲一冲会更清爽。' : '小主人，我身上有点脏啦。可以去背包用梳子整理一下，或者泡个香香浴吗？'
      : stat === 'mood' ? '小主人，我有一点点想你啦。摸摸头或抱一抱，就会开心起来；完成计划后再来陪我也可以。'
      : pet.playSession?.restRecommended && now - Number(history.play || 0) >= 10 * 60000 ? '已经一起玩了一会儿啦，继续玩会越来越累。让我休息一下，你也去完成一个小计划吧。' : '';
    if (!text) return;
    engine.say(text, 8500, 'reminder');
    try { localStorage.setItem(key, JSON.stringify({ ...history, any: now, [stat || 'play']: now })); } catch { /* Reminders still work without persistence. */ }
  }, []);
  const needsSignature = data?.pet ? Object.entries(NEED_LIMITS).map(([key, limit]) => needBand(data.pet!.stats[key as keyof Pet['stats']], limit)).join(':') : '';
  useEffect(() => {
    const first = window.setTimeout(remindNeeds, 2200);
    const timer = window.setInterval(remindNeeds, 20000);
    const focus = () => { if (document.visibilityState === 'visible') remindNeeds(); };
    document.addEventListener('visibilitychange', focus);
    return () => { window.clearTimeout(first); window.clearInterval(timer); document.removeEventListener('visibilitychange', focus); };
  }, [remindNeeds, data?.pet?.id, needsSignature, busy, sheet, sleepingWindow?.id, !!data?.travel.activeTrip, travelRewardsOpen, data?.pet?.playSession?.restRecommended]);

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

  const handleSleepResult = (next: StudentState) => {
    const reaction = next.sleepInteraction;
    if (!reaction) return false;
    setData(prev => prev ? { ...prev, pet: next.pet, wallet: next.wallet, inventory: next.inventory, shop: next.shop,
      cooldowns: next.cooldowns, recent: next.recent, sleep: next.sleep, room: next.room, hygiene: next.hygiene } : prev);
    if (reaction.penalty > 0) toast(`一直被叫醒有点不开心 · 心情 -${reaction.penalty}`, 'warn');
    // A sleep-touch response can arrive after the wake boundary. Keep its authoritative
    // stats, but never let a late reaction put an already awake engine back to sleep.
    if (!next.sleep.active || !currentSleep()) return true;
    petRef.current?.engine()?.setScheduledSleep(true);
    if (!reaction.ignored) petRef.current?.engine()?.reactInSleep(reaction.motion);
    petRef.current?.say(reaction.message, reaction.warning ? 8500 : 6200, 'sleep');
    return true;
  };
  const touchSleep = () => run(() => v2.disturbSleep(), next => {
    if (!handleSleepResult(next)) setData(next);
  });

  const care = (action: 'pet' | 'play' | 'hug') => run(
    () => v2.interact(action),
    async (r) => {
      if (handleSleepResult(r)) return;
      await refreshAfterCare();
      toast(r.msg);
      petRef.current?.play(action === 'pet' ? 'pet' : action === 'play' ? 'play' : 'hug');
      petRef.current?.say(action === 'pet' ? lines.pet() : action === 'play' ? lines.play() : lines.hug(), careDuration(action));
      await waitForCare(careDuration(action));
    },
  );

  const petClick = () => {
    if (busyRef.current || ceremonyRef.current) return;
    if (currentSleep()) { touchSleep(); return; }
    const st = petRef.current?.engine()?.getState();
    if (st === 'CLEANING') return;
    if (st === 'SLEEP' || st === 'WAKING') {
      petRef.current?.play('wake');
      petRef.current?.say(lines.wake(), 2800);
      return;
    }
    if ((data?.cooldowns.pet || 0) > 0) return;
    run(() => v2.interact('pet'), async (r) => {
      if (handleSleepResult(r)) return;
      await refreshAfterCare();
      toast(r.msg);
      petRef.current?.play('pet');
      petRef.current?.say(lines.pet(), careDuration('pet'));
      await waitForCare(careDuration('pet'));
    });
  };

  const toggleSleep = () => {
    if (currentSleep()) { touchSleep(); return; }
    const st = petRef.current?.engine()?.getState();
    if (st === 'SLEEP' || st === 'WAKING') {
      petRef.current?.play('wake');
      petRef.current?.say(lines.wake(), 2600);
    } else {
      run(() => v2.restPet(), (next) => {
        if (handleSleepResult(next)) return;
        setData(next);
        petRef.current?.play('sleep');
        petRef.current?.say(lines.sleep(), 2600);
        toast(next.msg || '小憩了一会儿，恢复了一些精力');
      });
    }
  };

  const feed = () => {
    if (currentSleep()) { touchSleep(); return; }
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
      if (handleSleepResult(r)) { setSheet(null); return; }
      const item = data?.inventory.find((x) => x.key === key);
      const materialScenario = item ? scenarioForItem(item) : null;
      // 使用接口已返回最新宠物、背包和钱包，避免已扣材料后刷新失败被误报为使用失败。
      setData(prev => prev ? { ...prev, pet: r.pet, wallet: r.wallet, inventory: r.inventory, shop: r.shop, cooldowns: r.cooldowns, recent: r.recent, sleep: r.sleep, room: r.room, hygiene: r.hygiene } : prev);
      setSheet(null);
      if (item && !['scene','furniture'].includes(item.kind)) petRef.current?.useMaterial(item);
      petRef.current?.say(item?.kind === 'food' ? lines.feed() : item?.kind === 'toy' ? lines.play() : item?.kind === 'clean' ? PET_SCENARIOS[item.key]?.line || '洗刷刷，马上就清清爽爽啦！' : item?.kind === 'scene' ? '我们的新家好漂亮呀！' : item?.kind === 'furniture' ? equipped ? '又添了一件新家具，好喜欢我们的家！' : '先收好，换个位置再摆吧。' : equipped ? '新装扮戴好啦，好喜欢！' : '先收好，下次再戴！', window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1000 : materialScenario?.duration || 3600);
      toast(r.msg || '用掉了一件材料');
      if (item && ['food', 'toy', 'clean'].includes(item.kind)) {
        await waitForCare(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1000 : (materialScenario?.duration || 6000) + (item.kind === 'clean' ? 1000 : 0));
      }
    },
  );

  const shower = () => run(() => v2.shower(), async r => {
    if (handleSleepResult(r)) { setSheet(null); return; }
    setData(prev => prev ? { ...prev, pet: r.pet, hygiene: r.hygiene, room: r.room, sleep: r.sleep } : prev);
    setSheet(null); petRef.current?.scenario('shower'); petRef.current?.say(PET_SCENARIOS.shower.line || '', careDuration('shower')); toast(r.msg);
    await waitForCare(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1000 : (PET_SCENARIOS.shower.duration || 7000) + 1000);
  });

  const buy = (key: string) => run(
    () => v2.buyMaterial(key),
    async (r) => {
      setData(prev => prev ? { ...prev, pet: r.pet, wallet: r.wallet, inventory: r.inventory, shop: r.shop, cooldowns: r.cooldowns, recent: r.recent, room: r.room, hygiene: r.hygiene } : prev);
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

  const startTravel = (cityId: string, durationHours: number) => run(
    () => v2.startTravel(cityId, durationHours),
    (travel) => {
      setData(prev => prev ? { ...prev, travel } : prev);
      activeTripRef.current = travel.activeTrip?.id || null;
      setSheet(null);
      toast(`出发去${travel.activeTrip?.cityName}啦`, 'gold');
    },
  );

  const returnFromTravel = (tripId: string) => run(
    () => v2.returnTravel(tripId),
    async (travel) => {
      const next = await v2.student();
      setData({ ...next, travel });
      activeTripRef.current = null;
      shownTravelRewards.current = travel.pendingTrip?.id || null;
      setSheet(null);
      setTravelRewardsOpen(true);
    },
  );

  const claimTravel = (tripId: string) => run(
    () => v2.claimTravel(tripId),
    async () => {
      const next = await v2.student();
      setData(next);
      setTravelRewardsOpen(false);
      setConfetti(Date.now());
      toast('查收成功，明信片和物品已收入背包，星贝已到账', 'gold');
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
    if (currentSleep()) { toast('小伙伴正在睡觉，睡醒再一起长大吧'); return; }
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
      if (currentSleep()) { setData(next); toast('成长时刻已保存，睡醒后再一起看吧'); return; }
      ceremonyRef.current = true;
      setCeremony({ event: next.levelupEvent, from: pet, to: next.pet, revealed: false });
      setData(next);
      petRef.current?.engine()?.focusForGrowth();
    });
  };

  const replayGrowth = async (event: GrowthMemory) => {
    if (currentSleep()) return;
    const pet = data?.pet;
    if (!pet || ceremonyRef.current || busyRef.current) return;
    setSheet(null);
    busyRef.current = true; setBusy(true);
    try {
      await preloadPetAge(pet.breed, Math.ceil(event.toLevel / 2));
      if (currentSleep()) return;
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
  const travelling = !!data?.travel?.activeTrip;
  const openTask = (t: TaskV2) => { setSelected(t); setSheet('task'); };

  const pending = useMemo(() => tasks.filter((t) => t.status === 'submitted'), [tasks]);
  const pendingPoints = pending.reduce((sum, task) => sum + (task.awardedPoints ?? task.basePoints), 0);
  const todayEarned = tasks.reduce((sum, task) => sum + (task.status === 'approved' ? (task.awardedPoints ?? 0) : 0), 0);

  const parentLabel = parentName ? `${parentName}（家长端）` : '家长端';
  const homeHeader = (
      <header className="v2-top" inert={!!ceremony}>
        <div className="brand">
          <span className="brand-mark island-brand-mark"><IslandIcon name="island"/></span>
            <div><h1>伴学小岛</h1><p>{data?.pet ? travelling ? `${data.pet.name}正在${data.travel.activeTrip?.cityName}旅行` : sleepingWindow ? `${data.pet.name}正在${sleepingWindow.kind === 'nap' ? '午休' : '睡觉'}，醒来再一起玩` : `${greet()}，${data.pet.name}在等你` : '和学习伙伴一起成长'}</p></div>
        </div>
        <div className="island-companion">{companion}</div>
        <div className="v2-top-right">
          <PlaytimeCountdown/>
          {data?.pet && <><span className="date-chip">{dateLabel(data.today)}</span>
          <span className={`streak-chip ${data.wallet.streak > 1 ? 'is-hot' : ''}`}>
            <i>{data.wallet.streak > 0 ? '🔥' : '🌱'}</i>{data.wallet.streak > 0 ? `连续 ${data.wallet.streak} 天` : '今天开始'}
          </span></>}
          {data && <button className="star-pill" onClick={() => setSheet('points')} aria-label={`${data.wallet.balance} 星贝，查看积分明细`}><IslandIcon name="star"/>{data.wallet.balance}<em>星贝</em></button>}
          <button className="parent-btn" onClick={onParent} disabled={accountBusy} title={parentLabel}><IslandIcon name="parent"/><b>{parentLabel}</b></button>
          <button className="island-logout" onClick={onLogout} disabled={accountBusy} aria-label="退出" title="退出登录"><IslandIcon name="logout"/></button>
        </div>
      </header>
  );

  if (error && !data) return <div className="v2-student">{homeHeader}<div className="island-error student-home-fallback"><div className="error-card"><span>🌧️</span><h2>小岛暂时连不上</h2><p>{error}</p><button className="btn primary" onClick={() => load()}>再试一次</button></div></div></div>;
  if (!data) return <div className="v2-student">{homeHeader}<div className="island-loading student-home-fallback"><div className="loading-orb" /><p>正在划船去小岛…</p></div></div>;
  if (sheet === 'challenge') return <Challenges onClose={() => {setSheet(null);void load(true);}} onChanged={() => {void load(true);}} />;
  if (!data.pet) return <div className="v2-student">{homeHeader}<div className="student-home-fallback"><Adopt embedded onParent={onParent} onDone={() => load()} onToast={toast} adoptFn={(p) => v2.adopt(p)} /></div><PointHistorySheet open={sheet === 'points'} onClose={() => { setSheet(null); void load(true); }} /></div>;

  return (
    <div className="v2-student">
      {homeHeader}

      <main className="v2-main" ref={mainRef}>
        <section className={`v2-scene-col${travelling ? ' is-travelling' : ''}`}>
          {travelling && data.travel.activeTrip
            ? <TravelScene trip={data.travel.activeTrip} pet={data.pet} onReturn={() => returnFromTravel(data.travel.activeTrip!.id)} onArrived={() => { void load(true); }} busy={busy} />
            : <>
          <div className={`scene tone-${roomPhase} ${ceremony ? 'is-growing' : ''}`} onPointerDown={e => {
            if ((e.target as HTMLElement).closest('button, .room-tools, .pet-mover, .scene-topline') || ceremony) return;
            const rect = e.currentTarget.getBoundingClientRect(); petRef.current?.engine()?.wanderTo((e.clientX - rect.left) / rect.width * 100);
          }}>
            <RoomBackdrop sceneKey={data.room.sceneKey} phase={roomPhase} />
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
              {growth?.ready && <button className="growth-upgrade-btn" disabled={busy || !!sleepingWindow} onClick={upgrade}>{sleepingWindow ? '睡醒后再一起长大' : busy ? '正在准备成长时刻…' : `✦ ${growth.nextLevel! % 2 ? '长大到' : '进入'}${growth.nextName}`}</button>}
              {unseenMemory && <button className="growth-replay-link" disabled={busy || !!sleepingWindow} title="有一段成长回忆还没看，点这里补看" onClick={() => replayGrowth(unseenMemory)}>补看成长时刻</button>}
            </div>}
            <div className={`scene-hint ${sleepingWindow ? 'sleep-hint' : ''}`} role="status">{sleepingWindow ? `☾ ${sleepingWindow.kind === 'night' ? '夜间睡眠' : '午休中'} · 北京时间 ${new Date(sleepingWindow.endsAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })} 醒来，轻轻等一等` : '点地面让它走过去 · 点它摸摸头'}</div>
            <RoomDecor room={data.room} disabled={busy || !!ceremony} onError={message => toast(message, 'warn')} onSave={async placements => {
              const room = await v2.saveRoom({ placements, revision: data.room.revision }); setData(prev => prev ? { ...prev, room } : prev);
            }} />
            <PetStage ref={petRef} pet={stagePet || data.pet} muted={muted} onPetClick={petClick} scheduledSleep={sleepingWindow?.kind} />
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
              <button onClick={feed} className="care-btn" disabled={busy || !!sleepingWindow} title={sleepingWindow ? '睡醒后再喂食' : undefined}><IslandIcon name="food"/><b>喂食</b></button>
              <button onClick={() => care('play')} className="care-btn" disabled={busy || !!sleepingWindow || (data.cooldowns.play || 0) > 0}><IslandIcon name="play"/><b>{data.cooldowns.play ? `${data.cooldowns.play}s` : '陪玩'}</b></button>
              <button onClick={() => care('pet')} className="care-btn" disabled={busy || !!sleepingWindow || (data.cooldowns.pet || 0) > 0}><IslandIcon name="pet"/><b>{data.cooldowns.pet ? `${data.cooldowns.pet}s` : '摸摸'}</b></button>
              <button onClick={() => care('hug')} className="care-btn" disabled={busy || !!sleepingWindow || (data.cooldowns.hug || 0) > 0}><IslandIcon name="hug"/><b>{data.cooldowns.hug ? `${data.cooldowns.hug}s` : '抱抱'}</b></button>
              <button onClick={() => { setBagTab('clean'); setSheet('bag'); }} className="care-btn" disabled={busy || !!sleepingWindow}><IslandIcon name="shower"/><b>洗澡</b></button>
              <button onClick={toggleSleep} className="care-btn" disabled={busy} title={sleepingWindow ? '正在按作息睡觉，醒来再玩吧' : data.cooldowns.rest ? `恢复精力还需 ${Math.ceil(data.cooldowns.rest / 60)} 分钟` : '小憩恢复精力'}><IslandIcon name="sleep"/><b>{sleepingWindow ? '睡梦中' : '小憩'}</b></button>
            </div>
          </div>
            </>}

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
                  <img src="pets/room/sunroom.webp" alt="" />
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

      <nav className="v2-dock" aria-label="小岛导航" inert={!!ceremony}>
        <button onClick={() => setSheet('plan')}><IslandIcon name="plan"/>计划</button>
        <button onClick={() => data.travel.pendingTrip ? setTravelRewardsOpen(true) : setSheet('travel')} aria-label={travelling ? '旅行，正在旅行中' : data.travel.pendingTrip ? '旅行，查收行囊' : '旅行'}><IslandIcon name="travel"/>{travelling ? '旅行中' : data.travel.pendingTrip ? '查收行囊' : '旅行'}</button>
        <button onClick={() => setSheet('challenge')}><IslandIcon name="challenge"/>挑战</button>
        <button className="is-on" aria-current="page" onClick={() => { setSheet(null); mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }}><IslandIcon name="island"/>小岛</button>
        <button onClick={() => setSheet('shop')} disabled={travelling}><IslandIcon name="materials"/>材料</button>
        <button onClick={() => setSheet('rewards')}><IslandIcon name="wish"/>心愿</button>
        <button onClick={() => setSheet('bag')} disabled={travelling}><IslandIcon name="bag"/>背包</button>
      </nav>

      <TaskDetail open={sheet === 'task'} task={selected} onClose={() => setSheet(null)} onSubmit={submit} busy={busy} />
      <MaterialShop open={sheet === 'shop'} onClose={() => { setSheet(null); setFeedingFromShop(false); }} onBag={() => { setBagTab(feedingFromShop ? 'food' : 'all'); setFeedingFromShop(false); setSheet('bag'); }} data={data} onBuy={buy} busy={busy} feeding={feedingFromShop} />
      <BagPanel open={sheet === 'bag'} onClose={() => setSheet(null)} data={data} onUse={useItem} onShower={shower} busy={busy} tab={bagTab} setTab={setBagTab} />
      <RewardShop open={sheet === 'rewards'} onClose={() => setSheet(null)} data={data} onRedeem={redeem} busy={busy} />
      <PointHistorySheet open={sheet === 'points'} onClose={() => { setSheet(null); void load(true); }} />
      <StatSheet open={sheet === 'status'} onClose={() => setSheet(null)} pet={data.pet} />
      <StudentMenu open={sheet === 'menu'} onClose={() => setSheet(null)} data={data} muted={muted}
        onToggleMute={() => setMuted((m) => !m)} onRename={rename}
        onReplay={replayGrowth} onStat={() => setSheet('status')} onParent={() => { setSheet(null); onParent(); }} onPets={() => setSheet('pets')} />
      {data.pet && <PetPicker open={sheet === 'pets'} onClose={() => setSheet(null)} pet={data.pet} busy={busy} onChoose={changeBreed} />}
      <PlanOverview open={sheet === 'plan'} onClose={() => setSheet(null)} data={data} onTask={task => { setSelected(task); setSheet('task'); }} />
      <TravelSheet open={sheet === 'travel'} onClose={() => setSheet(null)} travel={data.travel} pet={data.pet} busy={busy} onStart={startTravel} onViewRewards={() => { setSheet(null); setTravelRewardsOpen(true); }} />
      <TravelRewardsSheet open={travelRewardsOpen} onClose={() => setTravelRewardsOpen(false)} trip={data.travel.pendingTrip} travel={data.travel} pet={data.pet} busy={busy} onClaim={claimTravel} />
    </div>
  );
}

function PlanOverview({ open, onClose, data, onTask }: { open: boolean; onClose: () => void; data: StudentState; onTask: (task: TaskV2) => void }) {
  const week = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const todayTasks = data.tasks.filter(task => task.date === data.today);
  const nowHM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const taskAction = (task: TaskV2) => task.status === 'approved' ? '查看完成' : task.status === 'submitted' ? '查看审核' : task.status === 'rejected' ? '重新完成' : task.windowStart && nowHM < task.windowStart ? '提前去完成' : '去完成';
  return (
    <Sheet open={open} onClose={onClose} title="我的学习计划" sub="今天的任务可以直接去完成，也可以看看这一周的安排">
      <section className="plan-today-section" aria-label="今日学习任务">
        <h4>今天的任务 <span>{data.progress.approved} / {todayTasks.length} 已完成</span></h4>
        {todayTasks.length ? <div className="plan-overview-list">{todayTasks.map(task => <div className="plan-overview-row plan-today-row" key={task.id}>
          <span className="po-icon" aria-hidden="true">{task.icon}</span>
          <div className="po-main"><b>{task.title}</b><p>{task.subject} · {task.minutes} 分钟 · {task.timeLabel}</p><span className={`plan-task-state is-${task.status}`}>{task.status === 'open' && task.windowStart && nowHM < task.windowStart ? '尚未到计划时段，可以提前完成' : taskStatusText(task)}</span></div>
          <button type="button" className={`btn ${task.status === 'open' || task.status === 'rejected' ? 'primary' : 'ghost'} sm plan-task-action`} onClick={() => onTask(task)} aria-label={`${taskAction(task)}：${task.title}`}>{taskAction(task)}</button>
        </div>)}</div> : <p className="plan-no-tasks">今天没有待安排的任务，先按自己的节奏学习吧。</p>}
      </section>
      <h4 className="plan-week-heading">本周固定安排</h4>
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
              <div className="po-points">★ {r.basePoints}<em>{todayTasks.some(task => task.ruleId === r.id) ? '今日已安排' : '今日未安排'}</em></div>
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
