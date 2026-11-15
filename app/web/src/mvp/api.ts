import type { ActionResult, Task, TodayData } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { error: text }; }
  if (!res.ok) throw new Error(body?.error || `请求失败（${res.status}）`);
  return body as T;
}

export const api = {
  today(date?: string) {
    return request<TodayData>(`/api/today${date ? `?date=${date}` : ''}`);
  },
  adopt(payload: { breed: string; name: string; gender?: string }) {
    return request<TodayData>('/api/pet/adopt', { method: 'POST', body: JSON.stringify(payload) });
  },
  rename(name: string) {
    return request<TodayData>('/api/pet/rename', { method: 'POST', body: JSON.stringify({ name }) });
  },
  addTask(payload: { title: string; subject?: string; minutes: number; points: number; date?: string }) {
    return request<TodayData>('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
  },
  toggleTask(id: string, done: boolean) {
    return request<ActionResult>(`/api/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ done }),
    });
  },
  deleteTask(id: string) {
    return request<TodayData>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  buy(key: string, qty = 1) {
    return request<TodayData>('/api/shop/buy', { method: 'POST', body: JSON.stringify({ key, qty }) });
  },
  use(key: string) {
    return request<ActionResult>('/api/pet/use', { method: 'POST', body: JSON.stringify({ key }) });
  },
  interact(action: 'pet' | 'play' | 'hug') {
    return request<ActionResult>('/api/pet/interact', { method: 'POST', body: JSON.stringify({ action }) });
  },
};

export type { Task };
