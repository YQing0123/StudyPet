import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { PetEngine, type PetAction, type PetSpeechPriority } from './petEngine';
import type { Pet, ShopItem } from './types';

export interface PetStageHandle {
  play: (action: PetAction) => void;
  scenario: (key: string) => void;
  useMaterial: (item: Pick<ShopItem, 'key' | 'kind'>) => void;
  say: (text: string, ms?: number, priority?: PetSpeechPriority) => void;
  wanderRandom: () => void;
  stageUp: () => void;
  engine: () => PetEngine | null;
}

interface Props {
  pet: Pet | null;
  muted: boolean;
  onPetClick?: () => void;
  movementRange?: [number, number];
  displayScale?: number;
  scheduledSleep?: 'night' | 'nap';
}

const DESKTOP_SCENE_AREA = 700_000;

function displayScaleForScene(stage: HTMLElement, sleeping: boolean) {
  if (window.innerWidth < 680) return 1;
  const rect = stage.closest<HTMLElement>('.scene')?.getBoundingClientRect();
  if (!rect?.width || !rect.height) return 1;
  const roomScale = Math.min(1.15, Math.max(1, Math.sqrt(rect.width * rect.height / DESKTOP_SCENE_AREA)));
  return Math.min(1.5, roomScale * (sleeping ? 1.3 : 1));
}

const PetStage = forwardRef<PetStageHandle, Props>(function PetStage({ pet, muted, onPetClick, movementRange, displayScale = 1, scheduledSleep }, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<PetEngine | null>(null);
  const clickRef = useRef(onPetClick);
  clickRef.current = onPetClick;

  useEffect(() => {
    if (!hostRef.current || !pet) return;
    const engine = new PetEngine(hostRef.current, {
      onPetClick: () => clickRef.current?.(),
      movementRange,
      displayScale: displayScale * displayScaleForScene(hostRef.current, !!scheduledSleep),
    });
    engineRef.current = engine;
    engine.setPet({
      breed: pet.breed,
      stage: pet.stage,
      phase: pet.progression?.phase || 1,
      sound: pet.sound,
      outfit: pet.outfit,
    });
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // 只在换宠物（id 变化）时重建舞台
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pet?.id, displayScale]);

  useEffect(() => {
    const stage = hostRef.current;
    if (!stage || !pet) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        engineRef.current?.setDisplayScale(displayScale * displayScaleForScene(stage, !!scheduledSleep));
      });
    };
    update();
    const observer = new ResizeObserver(update);
    const scene = stage.closest<HTMLElement>('.scene');
    if (scene) observer.observe(scene);
    else observer.observe(stage);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [pet?.id, displayScale, scheduledSleep]);

  useEffect(() => {
    if (!pet) return;
    engineRef.current?.setPet({
      breed: pet.breed,
      stage: pet.stage,
      phase: pet.progression?.phase || 1,
      sound: pet.sound,
      outfit: pet.outfit,
    });
  }, [pet?.breed, pet?.stage, pet?.progression?.phase, pet?.sound, pet?.outfit]);

  useEffect(() => { if (pet) engineRef.current?.setCleanliness(pet.stats.clean); }, [pet?.stats.clean, pet?.id, displayScale]);

  useEffect(() => {
    engineRef.current?.setMuted(muted);
  }, [muted, pet?.id, displayScale]);

  useEffect(() => {
    engineRef.current?.setScheduledSleep(!!scheduledSleep);
    if (scheduledSleep) engineRef.current?.say(`小主人，${scheduledSleep === 'night' ? '夜晚' : '中午'}了，到了睡觉时间啦，我要去睡觉了。等我睡醒再一起玩哦。`, 7800, 'sleep');
  }, [scheduledSleep, pet?.id, displayScale]);

  useEffect(() => {
    engineRef.current?.setPetClickHandler(() => clickRef.current?.());
  }, [onPetClick]);

  useImperativeHandle(ref, () => ({
    play: (action) => engineRef.current?.play(action),
    scenario: key => engineRef.current?.runScenario(key),
    useMaterial: (item) => engineRef.current?.useMaterial(item),
    say: (text, ms, priority) => engineRef.current?.say(text, ms, priority),
    wanderRandom: () => engineRef.current?.wanderRandom(),
    stageUp: () => engineRef.current?.onStageUp(),
    engine: () => engineRef.current,
  }), []);

  return <div className="pet-stage" ref={hostRef} tabIndex={0} role="group" aria-label={scheduledSleep ? '宠物正在睡觉，点击或按回车听梦话，请让它好好休息' : '宠物互动舞台，回车摸摸，左右方向键走动'} />;
});

export default PetStage;
