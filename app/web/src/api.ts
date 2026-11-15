export type PetState = {
  satiety: number; clean: number; mood: number; energy: number; health: number;
};
export type Scene = { key: string; name: string; emoji: string; desc: string; unlockLevel: number; unlocked: boolean };
export type PetSnapshot = {
  id: string; name: string; species: string;
  level: number; exp: number; need: number; bond: number;
  stage: { key: string; name: string; minLevel: number; scale: number };
  stageName: string; scale: number;
  state: PetState;
  mood: { text: string; face: string; urgent: string | null };
  scenes: Scene[];
  inventory: Record<string, number>;
  wardrobe: { item_key: string; equipped: number }[];
  events: { kind: string; detail: string; created_at: string }[];
  milestones: { title: string; detail: string; created_at: string }[];
  actions: { key: string; label: string; emoji: string; cost: { item: string; qty: number } | null; disabled: boolean }[];
};

export type Question = {
  id: string; type: string; prompt: string; instruction: string;
  payload: { options?: { text?: string; asset?: string }[]; audio?: string | null };
  difficulty: number; bookId?: string; sentenceId?: string;
};

const JSON_HEADERS = { 'content-type': 'application/json' };

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let msg = `请求失败 ${res.status}`;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  bootstrap: () => req<any>('/api/bootstrap'),
  pet: () => req<PetSnapshot>('/api/pet'),
  petAction: (action: string) =>
    req<any>('/api/pet/action', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ action }) }),

  today: () => req<any>('/api/today'),
  startSession: (body: { mode: string; bookId?: string; pageFrom?: number; pageTo?: number }) =>
    req<{ sessionId: string; mode: string; questions: Question[] }>('/api/session', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body),
    }),
  answer: (sessionId: string, body: any) =>
    req<any>(`/api/session/${sessionId}/answer`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }),
  finish: (sessionId: string) =>
    req<any>(`/api/session/${sessionId}/finish`, { method: 'POST', headers: JSON_HEADERS, body: '{}' }),

  books: () => req<any[]>('/api/books'),
  book: (id: string) => req<any>(`/api/books/${id}`),
  generate: (id: string, body: any = {}) =>
    req<any>(`/api/books/${id}/generate`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }),

  importPdf: async (file: File) => {
    const buf = await file.arrayBuffer();
    return req<any>(`/api/import/pdf?name=${encodeURIComponent(file.name)}`, {
      method: 'POST', headers: { 'content-type': 'application/pdf' }, body: buf,
    });
  },
  importAudio: async (file: File) => {
    const buf = await file.arrayBuffer();
    return req<{ path: string }>(`/api/import/audio?name=${encodeURIComponent(file.name)}`, {
      method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: buf,
    });
  },
  commitBook: (body: any) =>
    req<any>('/api/import/commit', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }),

  audioStatus: (bookId: string) => req<any>(`/api/audio/status?bookId=${encodeURIComponent(bookId)}`),
  audioAnalyze: async (file: File, bookId: string, pageFrom: number, pageTo: number) => {
    const buf = await file.arrayBuffer();
    return req<any>(
      `/api/audio/analyze?name=${encodeURIComponent(file.name)}&bookId=${encodeURIComponent(bookId)}&pageFrom=${pageFrom}&pageTo=${pageTo}`,
      { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: buf },
    );
  },
  audioBind: (body: any) =>
    req<any>('/api/audio/bind', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }),

  plan: () => req<any>('/api/plan'),
  savePlan: (body: any) =>
    req<any>('/api/plan', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }),

  parentOverview: () => req<any>('/api/parent/overview'),
  parentQuestions: (bookId?: string) =>
    req<any[]>(`/api/parent/questions${bookId ? `?bookId=${bookId}` : ''}`),
};
