import type { Pet, PetProgression } from '../mvp/types';

export function timeLeft(hours: number) {
  const minutes = Math.max(1, Math.ceil(hours * 60));
  if (minutes < 60) return `${minutes}分钟`;
  const h = Math.ceil(hours);
  return h >= 24 ? `${Math.floor(h / 24)}天${h % 24 ? `${h % 24}小时` : ''}` : `${h}小时`;
}

export function growthHint(p: PetProgression) {
  if (p.terminal) return '一起走过所有年龄，继续收集陪伴回忆。';
  if (p.ready) return '可以长大啦！准备好时点一下，等待不会丢失进度。';
  if ((p.minimumWaitHours || 0) > 0) return `最早还需陪伴${timeLeft(p.minimumWaitHours!)}，成长会帮你加速。`;
  return `还差${p.growthNeeded}成长；先休息，约${timeLeft(p.waitHours || 0)}后也能长大。`;
}

export function atLevel(pet: Pet, level: number): Pet {
  const stage = Math.ceil(level / 2);
  return { ...pet, stage, stageInfo: { ...pet.stageInfo, stage },
    progression: { ...pet.progression, level, phase: level % 2 ? 1 : 2 } };
}
