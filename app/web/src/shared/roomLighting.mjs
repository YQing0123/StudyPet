import { DEFAULT_ROOM_SCENE, ROOM_MAP } from './roomCatalog.mjs';

const HOUR = 3600000, DAY = 24 * HOUR, OFFSET = 8 * HOUR;

// The room follows Beijing time, independently of device timezone and pet sleep settings.
export function roomLighting(now = Date.now()) {
  const dayStart = Math.floor((now + OFFSET) / DAY) * DAY - OFFSET;
  const sunrise = dayStart + 7 * HOUR;
  const sunset = dayStart + 19 * HOUR;
  return {
    phase: now >= sunrise && now < sunset ? 'day' : 'night',
    nextChangeAt: now < sunrise ? sunrise : now < sunset ? sunset : sunrise + DAY,
  };
}

export function roomBackdropAssets(sceneKey = DEFAULT_ROOM_SCENE) {
  const item = ROOM_MAP[sceneKey];
  const scene = item?.kind === 'scene' ? item : ROOM_MAP[DEFAULT_ROOM_SCENE];
  return { day: scene.asset, night: scene.nightAsset || scene.asset };
}
