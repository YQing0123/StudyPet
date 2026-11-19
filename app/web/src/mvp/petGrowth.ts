import { isAvailablePetBreed } from '../shared/availablePetBreeds.mjs';

/** Growth clothes are part of each animated character, separate from purchased accessories. */
export const GROWTH_LOOKS = [
  { stage: 1, name: '幼年', look: '软萌幼崽', detail: '圆圆的脑袋、小小的身体，穿着最初的毛茸茸。' },
  { stage: 2, name: '少年', look: '绿领巾', detail: '长大一点，系上第一条鼠尾草绿小领巾。' },
  { stage: 3, name: '青年', look: '探险马甲', detail: '身形舒展，穿上奶油色口袋马甲。' },
  { stage: 4, name: '成年', look: '森林斗篷', detail: '体型饱满，披上森林绿斗篷和橡果胸针。' },
  { stage: 5, name: '中年', look: '星章斗篷', detail: '深绿斗篷添了一枚金色星章，陪伴的日子都有印记。' },
  { stage: 6, name: '老年', look: '暖暖披肩', detail: '换上暖杏色针织披肩，温柔地陪你继续长大。' },
];

export const hasGrowthLooks = (_breed: string) => false;
export const growthLook = (stage: number) => GROWTH_LOOKS[Math.max(0, Math.min(5, stage - 1))];
export const petAvatar = (breed: string, _stage = 1) => breed === 'capybara_toon'
  ? 'pets/breeds/capybara_toon/capybara.svg'
  : isAvailablePetBreed(breed) ? `pets/avatars/${breed}.png` : 'pets/legacy.svg';
