import type { InvItem, Pet, ShopItem, Wallet } from '../mvp/types';

export type TaskStatus = 'open' | 'submitted' | 'approved' | 'rejected';
export type Timing = 'early' | 'ontime' | 'late' | null;

export interface TaskV2 {
  id: string;
  ruleId: string | null;
  date: string;
  title: string;
  subject: string;
  icon: string;
  minutes: number;
  windowStart: string | null;
  windowEnd: string | null;
  timeLabel: string;
  basePoints: number;
  earlyBonus: number;
  latePenalty: number;
  reviewRequired: boolean;
  photoRequired: boolean;
  status: TaskStatus;
  timing: Timing;
  timingLabel: string;
  awardedPoints: number | null;
  note: string | null;
  photo: string | null;
  rejectReason: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  rulesText: string[];
}

export interface ProgressV2 {
  total: number;
  approved: number;
  submitted: number;
  rejected: number;
  open: number;
  early: number;
  percent: number;
}

export interface RuleV2 {
  id: string;
  title: string;
  subject: string;
  icon: string;
  minutes: number;
  weekdays: number[];
  weekdaysLabel: string;
  startTime: string | null;
  endTime: string | null;
  timeLabel: string;
  basePoints: number;
  earlyBonus: number;
  latePenalty: number;
  reviewRequired: boolean;
  photoRequired: boolean;
  active: boolean;
  sort: number;
}

export interface RewardV2 {
  id: string;
  title: string;
  icon: string;
  cost: number;
  kind: 'experience' | 'item' | 'privilege';
  stock: number;
  note: string;
  active: boolean;
}

export interface RedemptionV2 {
  id: string;
  reward_id: string;
  title: string;
  icon: string;
  cost: number;
  status: 'pending' | 'fulfilled' | 'rejected';
  created_at: string;
  handled_at: string | null;
}

export interface DailyNote {
  id: string;
  date: string;
  text: string;
  senderId: string;
  senderName: string;
  senderRelation: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudentState {
  dailyNotes: DailyNote[];
  date: string;
  today: string;
  pet: Pet | null;
  wallet: Wallet;
  tasks: TaskV2[];
  progress: ProgressV2;
  rules: RuleV2[];
  shop: ShopItem[];
  inventory: InvItem[];
  rewards: RewardV2[];
  pendingApprovals: number;
  redemptions: RedemptionV2[];
  recent: { id: string; date: string; delta: number; reason: string; created_at: string }[];
  cooldowns: Record<string, number>;
  notifyEnabled: boolean;
  parentPinDefault: boolean;
}

export interface CalendarDay {
  date: string;
  day: number;
  weekday: number;
  total: number;
  approved: number;
  submitted: number;
  rejected: number;
  open: number;
  early: number;
  percent: number;
}

export interface ParentState {
  dailyNotes: DailyNote[];
  date: string;
  today: string;
  month: string;
  pet: Pet | null;
  wallet: Wallet;
  childId: string;
  approvals: TaskV2[];
  todayTasks: TaskV2[];
  progress: ProgressV2;
  rules: RuleV2[];
  calendar: CalendarDay[];
  week: { start: string; end: string; total: number; approved: number; early: number; pending: number };
  monthSummary: { total: number; approved: number; early: number; pending: number };
  rewards: RewardV2[];
  redemptions: RedemptionV2[];
  materialPrices: { item_key: string; cost: number }[];
  settings: { notifyEnabled: boolean; notifyChannels: NotifyChannel[]; notifyEvents: NotifyEvents; notifySummaryTime: string; notifyPublicUrl: string; pinSet: boolean };
  shop: ShopItem[];
}

export type NotifyProvider = 'wecom' | 'dingtalk' | 'pushplus';
export type NotifyEvent = 'submission' | 'completed' | 'approved' | 'batch_approved' | 'rejected' | 'resubmission' | 'daily_summary';
export type NotifyEvents = Record<NotifyEvent, boolean>;
export interface NotifyChannel {
  provider: NotifyProvider; enabled: boolean; targetConfigured: boolean; secretConfigured: boolean; maskedTarget: string;
}
export interface NotifyResult { ok: boolean; skipped?: boolean; error?: string; results: { provider: NotifyProvider; ok: boolean; error?: string }[] }
export interface NotifyLog {
  id: string; provider: NotifyProvider; event: string; content: string; status: 'sending' | 'success' | 'failed';
  httpStatus: number | null; providerCode: string | null; error: string; createdAt: string; completedAt: string | null;
}
export interface PetBackup {
  id: string; reason: 'manual' | 'before_switch' | 'before_restart' | 'before_restore'; createdAt: string;
  available: boolean; error?: string;
  pet: { name: string; breed: string; growth: number; stage: number; phaseName: string; stats: { hunger: number; energy: number; mood: number; clean: number } } | null;
}
export interface RecordPage<T> { items: T[]; next: string | null }
