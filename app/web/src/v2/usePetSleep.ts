import { useEffect, useRef, useState, type RefObject } from 'react';
import type { PetStageHandle } from '../mvp/PetStage';
import { sleepWindow, sleepWindows } from '../shared/petSleep.mjs';
import type { PetSleepState } from './types';

export function usePetSleep(state: PetSleepState | undefined, petId: string | undefined,
  petRef: RefObject<PetStageHandle | null>, enabled: boolean, refresh: () => void, announce: (text: string) => void) {
  const [, tick] = useState(0);
  const clock = useRef({ source: 0, server: 0, received: 0 });
  const latest = useRef(state); latest.current = state;
  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  const refreshRef = useRef(refresh); refreshRef.current = refresh;
  const announceRef = useRef(announce); announceRef.current = announce;
  if (state && clock.current.source !== state.serverNow) {
    const received = performance.now();
    const estimated = clock.current.source ? clock.current.server + received - clock.current.received : 0;
    // A slow, older response must not rewind the clock across a wake boundary.
    clock.current = { source: state.serverNow, server: Math.max(state.serverNow, estimated), received };
  }
  const now = () => clock.current.server + performance.now() - clock.current.received;
  const getActive = () => enabledRef.current && latest.current ? sleepWindow(latest.current.schedule, now()) : null;
  const active = getActive();
  const lastWindow = useRef<string | null>(null);
  const lastPet = useRef(petId);

  useEffect(() => {
    let timer = 0;
    const update = () => {
      clearTimeout(timer);
      if (document.hidden || !enabledRef.current || !latest.current) return;
      tick(n => n + 1);
      const next = Math.min(...sleepWindows(latest.current.schedule, now())
        .flatMap(w => [w.startsAt, w.endsAt]).filter(t => t > now()));
      if (Number.isFinite(next)) timer = window.setTimeout(update, Math.min(2147483647, Math.max(20, next - now() + 20)));
    };
    const visible = () => { clearTimeout(timer); if (!document.hidden) { update(); refreshRef.current(); } };
    update(); document.addEventListener('visibilitychange', visible); window.addEventListener('focus', visible);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible); };
  }, [state?.serverNow, petId, enabled]);

  useEffect(() => {
    if (!petId || !enabled) { lastWindow.current = null; return; }
    if (lastPet.current !== petId) { lastWindow.current = null; lastPet.current = petId; }
    const id = active?.id || null;
    if (lastWindow.current === id) return;
    const wasSleeping = !!lastWindow.current;
    lastWindow.current = id;
    // This also interrupts an in-flight cleaning or care animation at the exact boundary.
    petRef.current?.engine()?.setScheduledSleep(!!active);
    if (active) {
      const message = `小主人，${active.kind === 'night' ? '夜晚' : '中午'}了，到了睡觉时间啦，我要去睡觉了。等我睡醒再一起玩哦。`;
      announceRef.current(message);
    }
    else if (wasSleeping) petRef.current?.say('睡饱啦，伸个懒腰！小主人，现在可以一起玩啦。', 5000);
    refreshRef.current();
  }, [active?.id, enabled, petId, petRef]);

  return { active, getActive };
}
