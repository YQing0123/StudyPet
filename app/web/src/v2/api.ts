import {scopeHeaders} from './accounts';
import type { GrowthMemory } from '../mvp/types';
import type { RoomState, RoomPlacement, DailyNote, ParentState, RewardV2, RuleV2, StudentState, TaskV2, NotifyProvider, NotifyResult, NotifyLog, PetBackup, RecordPage, TravelState, PenaltyItem, PointHistory, PointEntry } from './types';

export async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  let text: string;
  try {
    res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...scopeHeaders(), ...init?.headers } });
    text = await res.text();
  } catch {
    throw new Error('暂时连不上小岛，请检查连接后再试。');
  }
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { error: text }; }
  if (!res.ok) {
    if (res.status === 402) window.dispatchEvent(new Event('island-subscription-expired'));
    if (res.status === 401) window.dispatchEvent(new Event('island-session-expired'));
    if (res.status === 403) window.dispatchEvent(new Event('island-parent-expired'));
    throw new Error(body?.error || `请求失败（${res.status}）`);
  }
  return body as T;
}

const post = <T,>(path: string, body?: unknown) =>
  req<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const del = <T,>(path: string) => req<T>(path, { method: 'DELETE' });

export const v2 = {
  sendNote(text: string) { return post<DailyNote[]>('/api/v2/notes', { text }); },
  deleteNote(id: string) { return del<DailyNote[]>(`/api/v2/notes/${id}`); },
  session() { return req<{ ok: boolean }>('/api/v2/auth/session'); },
  logout() { return post('/api/v2/auth/logout'); },
  student(date?: string) { return req<StudentState>(`/api/v2/student${date ? `?date=${date}` : ''}`); },
  parent(date?: string, month?: string) {
    const qs = new URLSearchParams();
    if (date) qs.set('date', date);
    if (month) qs.set('month', month);
    return req<ParentState>(`/api/v2/parent${qs.toString() ? `?${qs}` : ''}`);
  },
  saveRule(body: Partial<RuleV2> & { weekdays: number[] }) { return post<RuleV2[]>('/api/v2/rules', body); },
  deleteRule(id: string) { return del<RuleV2[]>(`/api/v2/rules/${id}`); },
  submitTask(id: string, body: { note?: string; photo?: string | null }) {
    return post<TaskV2>(`/api/v2/tasks/${id}/submit`, body);
  },
  reviewDetail(id: string) { return req<TaskV2>(`/api/v2/tasks/${encodeURIComponent(id)}`); },
  reviewTask(id: string, body: { approve: boolean; reason?: string; points?: number; expectedSubmittedAt?: string | null }) {
    return post<TaskV2>(`/api/v2/tasks/${id}/review`, body);
  },
  approveAll() { return post<ParentState>('/api/v2/review/all'); },
  gift(amount: number, reason: string) { return post<StudentState>('/api/v2/points/gift', { amount, reason }); },
  pointHistory(filter = 'all', before = '') { return req<PointHistory>(`/api/v2/ledger?${new URLSearchParams({ filter, before })}`); },
  penalties() { return req<PenaltyItem[]>('/api/v2/penalties'); },
  savePenalty(body: Partial<PenaltyItem>) { return post<PenaltyItem[]>('/api/v2/penalties', body); },
  deletePenalty(id: string) { return del<PenaltyItem[]>(`/api/v2/penalties/${encodeURIComponent(id)}`); },
  applyPenalty(id: string, requestId: string) { return post<{ entry: PointEntry; repeated: boolean }>(`/api/v2/penalties/${encodeURIComponent(id)}/apply`, { requestId }); },
  saveReward(body: Partial<RewardV2>) { return post<RewardV2[]>('/api/v2/rewards', body); },
  deleteReward(id: string) { return del<RewardV2[]>(`/api/v2/rewards/${id}`); },
  redeem(id: string) { return post<StudentState>(`/api/v2/rewards/${id}/redeem`); },
  handleRedemption(id: string, status: 'fulfilled' | 'rejected') {
    return post<any>(`/api/v2/redemptions/${id}/handle`, { status });
  },
  saveSettings(body: Record<string, unknown>) { return post<ParentState>('/api/v2/settings', body); },
  adopt(payload: { breed: string; name: string }) { return post<StudentState>('/api/v2/adopt', payload); },
  changeBreed(breed: string, expectedPetId: string) { return post<StudentState>('/api/v2/pet/breed', { breed, expectedPetId }); },
  restPet() { return post<StudentState>('/api/v2/pet/rest'); },
  disturbSleep() { return post<StudentState>('/api/v2/pet/sleep-touch'); },
  levelUp(expectedPetId: string, expectedLevel: number, requestId: string) { return post<StudentState & { levelupEvent: GrowthMemory }>('/api/v2/pet/level-up', { expectedPetId, expectedLevel, requestId }); },
  seenLevel(id: string) { return post(`/api/v2/pet/level-up/${encodeURIComponent(id)}/seen`); },
  testNotify(provider?: NotifyProvider) { return post<NotifyResult>('/api/v2/notify/test', { provider }); },
  notifyLogs(status = '', before = '') { return req<RecordPage<NotifyLog>>(`/api/v2/notify/logs?${new URLSearchParams({ status, before })}`); },
  petBackups(before = '') { return req<RecordPage<PetBackup>>(`/api/v2/pet/backups?${new URLSearchParams({ before })}`); },
  startTravel(cityId: string | null, durationHours: number) { return post<TravelState>('/api/v2/travel/start', { cityId, durationHours }); },
  returnTravel(tripId: string) { return post<TravelState>(`/api/v2/travel/${encodeURIComponent(tripId)}/return`); },
  claimTravel(tripId: string) { return post<TravelState>(`/api/v2/travel/${encodeURIComponent(tripId)}/claim`); },
  backupPet(expectedPetId: string | null) { return post<{ id: string }>('/api/v2/pet/backups', { expectedPetId }); },
  restartPet(expectedPetId: string) { return post('/api/v2/pet/restart', { expectedPetId }); },
  restorePet(id: string, expectedPetId: string | null) { return post(`/api/v2/pet/backups/${encodeURIComponent(id)}/restore`, { expectedPetId }); },
  saveRoom(body: { sceneKey?: string; placements?: RoomPlacement[]; revision: number }) { return post<RoomState>('/api/v2/room', body); },
  playScenario(scenario: string) { return post<any>('/api/v2/pet/scenario', { scenario }); },
  shower() { return post<any>('/api/v2/pet/scenario', { scenario: 'shower' }); },
  interact(action: 'pet' | 'play' | 'hug') { return post<any>('/api/pet/interact', { action }); },
  useItem(key: string, equipped = true) { return post<any>('/api/pet/use', { key, equipped }); },
  buyMaterial(key: string) { return post<any>('/api/shop/buy', { key, qty: 1 }); },
  rename(name: string) { return post<any>('/api/pet/rename', { name }); },
};
