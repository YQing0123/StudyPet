import { useEffect, useState } from 'react';
import { roomBackdropAssets, roomLighting, type RoomPhase } from '../shared/roomLighting.mjs';

export function useRoomPhase(serverNow?: number): RoomPhase {
  const [phase, setPhase] = useState(() => roomLighting(serverNow).phase);
  useEffect(() => {
    const receivedAt = performance.now();
    const now = () => serverNow && Number.isFinite(serverNow)
      ? serverNow + performance.now() - receivedAt : Date.now();
    let timer = 0;
    const update = () => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      const current = now();
      const light = roomLighting(current);
      setPhase(light.phase);
      // One timer at the next 07:00/19:00 boundary, with no background polling.
      timer = window.setTimeout(update, Math.max(1, light.nextChangeAt - current));
    };
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
    };
  }, [serverNow]);
  return phase;
}

export default function RoomBackdrop({ sceneKey, phase }: { sceneKey?: string; phase: RoomPhase }) {
  const assets = roomBackdropAssets(sceneKey);
  // Both still images are ready before the boundary; only opacity changes, never the pet or furniture tree.
  return <div className="room-backdrop" data-phase={phase} aria-hidden="true">
    <div className="scene-bg scene-bg-day" style={{ backgroundImage: `url("${assets.day}")` }} />
    <div className="scene-bg scene-bg-night" style={{ backgroundImage: `url("${assets.night}")` }} />
    <div className="scene-vignette" /><div className="scene-glow" />
  </div>;
}
