export interface SleepSchedule {
  nightEnabled: boolean; nightStart: string; nightEnd: string;
  napEnabled: boolean; napStart: string; napEnd: string;
}
export interface SleepWindow { id: string; kind: 'night' | 'nap'; startsAt: number; endsAt: number }
export const DEFAULT_SLEEP_SCHEDULE: Readonly<SleepSchedule>;
export function validateSleepSchedule(input: unknown): SleepSchedule;
export function sleepWindows(schedule: SleepSchedule, now?: number): SleepWindow[];
export function sleepWindow(schedule: SleepSchedule, now?: number): SleepWindow | null;
export function sleptMilliseconds(schedule: SleepSchedule, from: number, to: number): number;
