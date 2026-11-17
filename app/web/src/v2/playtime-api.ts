import { req } from './api';
export type PlaytimeState = {
  enabled: boolean; dailyMinutes: number; idleMinutes: number; pinSet: boolean; unlockMinutes: number;
  date: string; serverNow: number; resetsAt: number; usedSeconds: number; bonusSeconds: number;
  remainingSeconds: number | null; locked: boolean; idle?: boolean;
};
export type PlaytimeDraft = Pick<PlaytimeState, 'enabled'|'dailyMinutes'|'idleMinutes'> & { pin?: string };
const post = (path: string, body: unknown) => req<PlaytimeState>('/api/v2/playtime/' + path, { method: 'POST', body: JSON.stringify(body) });
export const playtimeApi = {
  state: () => req<PlaytimeState>('/api/v2/playtime'),
  settings: () => req<PlaytimeState>('/api/v2/playtime/settings'),
  save: (body: PlaytimeDraft) => post('settings', body),
  heartbeat: (clientId: string, active: boolean, interacted: boolean, keepalive = false) => req<PlaytimeState>('/api/v2/playtime/heartbeat', { method:'POST', body: JSON.stringify({ clientId, active, interacted }), keepalive }),
  unlock: (pin: string, requestId: string) => post('unlock', { pin, requestId }),
};
export const durationLabel = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, '0')}`;
