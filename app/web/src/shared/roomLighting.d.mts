export type RoomPhase = 'day' | 'night';
export function roomLighting(now?: number): { phase: RoomPhase; nextChangeAt: number };
export function roomBackdropAssets(sceneKey?: string): { day: string; night: string };
