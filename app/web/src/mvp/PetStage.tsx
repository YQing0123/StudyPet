import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { PetEngine, type PetAction } from './petEngine';
import type { Pet, ShopItem } from './types';

export interface PetStageHandle {
  play: (action: PetAction) => void;
  useMaterial: (item: Pick<ShopItem, 'key' | 'kind'>) => void;
  say: (text: string, ms?: number, priority?: 'reminder' | 'interaction') => void;
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
}

const PetStage = forwardRef<PetStageHandle, Props>(function PetStage({ pet, muted, onPetClick, movementRange, displayScale = 1 }, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<PetEngine | null>(null);
  const clickRef = useRef(onPetClick);
  clickRef.current = onPetClick;

  useEffect(() => {
    if (!hostRef.current || !pet) return;
    const engine = new PetEngine(hostRef.current, { onPetClick: () => clickRef.current?.(), movementRange, displayScale });
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
    if (!pet) return;
    engineRef.current?.setPet({
      breed: pet.breed,
      stage: pet.stage,
      phase: pet.progression?.phase || 1,
      sound: pet.sound,
      outfit: pet.outfit,
    });
  }, [pet?.breed, pet?.stage, pet?.progression?.phase, pet?.sound, pet?.outfit]);

  useEffect(() => {
    engineRef.current?.setMuted(muted);
  }, [muted, pet?.id, displayScale]);

  useEffect(() => {
    engineRef.current?.setPetClickHandler(() => clickRef.current?.());
  }, [onPetClick]);

  useImperativeHandle(ref, () => ({
    play: (action) => engineRef.current?.play(action),
    useMaterial: (item) => engineRef.current?.useMaterial(item),
    say: (text, ms, priority) => engineRef.current?.say(text, ms, priority),
    wanderRandom: () => engineRef.current?.wanderRandom(),
    stageUp: () => engineRef.current?.onStageUp(),
    engine: () => engineRef.current,
  }), []);

  return <div className="pet-stage" ref={hostRef} tabIndex={0} role="group" aria-label="宠物互动舞台，回车摸摸，左右方向键走动" />;
});

export default PetStage;
