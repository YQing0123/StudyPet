export type TaskStatus = 'open' | 'done';

export interface Task {
  id: string;
  title: string;
  subject: string;
  minutes: number;
  points: number;
  status: TaskStatus;
  completedAt: string | null;
  createdAt: string;
}

export interface ShopItem {
  key: string;
  name: string;
  icon: string;
  kind: 'food' | 'toy' | 'clean' | 'deco';
  cost: number;
  desc: string;
  effect: Record<string, number | string>;
}

export interface InvItem extends ShopItem {
  qty: number;
}

export interface StageInfo {
  stage: number;
  name: string;
  days: number;
  effectiveDays: number;
  nextDays: number | null;
  nextInDays: number | null;
  progress: number;
  rate: number;
  scale: number;
  videoRate: number;
}

export interface Pet {
  id: string;
  name: string;
  breed: string;
  species: string;
  gender: string;
  personality: string;
  stage: number;
  stageInfo: StageInfo;
  progression: PetProgression;
  growthMemories: GrowthMemory[];
  adoptionAnniversary: string;
  adoptedAt: string;
  stats: { hunger: number; energy: number; mood: number; clean: number };
  growth: number;
  careCount: number;
  chestsOpened: number;
  nextChest: number;
  outfit: Record<string, string>;
  sound: string;
}

export interface GrowthMemory {
  id: string; fromLevel: number; toLevel: number; name: string; createdAt: string; seen: boolean;
}

export interface PetProgression {
  version: number; level: number; phase: number; name: string; nextName: string | null;
  nextLevel: number | null; ready: boolean; terminal: boolean; naturalHours: number;
  eligibleGrowth: number; appliedGrowth: number; storedGrowth: number; effectiveHours: number;
  seedHours: number; targetHours: number | null; waitHours: number | null;
  minimumWaitHours: number | null; growthNeeded: number | null; progress: number;
  daily: { date: string; cap: number; earned: number; remaining: number; sources: Record<string, number> };
}

export interface Wallet {
  balance: number;
  todayEarned: number;
  todaySpent: number;
  streak: number;
}

export interface Progress {
  total: number;
  done: number;
  left: number;
  percent: number;
  minutes: number;
  points: number;
}

export interface Ledger {
  id: string;
  date: string;
  delta: number;
  reason: string;
  created_at: string;
}

export interface TodayData {
  date: string;
  today: string;
  pet: Pet | null;
  isNew: boolean;
  tasks: Task[];
  progress: Progress;
  wallet: Wallet;
  inventory: InvItem[];
  shop: ShopItem[];
  recent: Ledger[];
  cooldowns: Record<string, number>;
  stageNames: string[];
  dailyBonus: number;
}

export interface Loot {
  key: string;
  name: string;
  icon: string;
}

export interface ActionResult extends TodayData {
  msg?: string;
  loot?: Loot[];
  bonus?: { awarded?: boolean; points?: number; removed?: boolean };
  changed?: boolean;
}
