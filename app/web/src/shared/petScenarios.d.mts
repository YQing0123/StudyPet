export interface PetScenario { publicInteraction?: boolean; action: string; label?: string; delta?: Record<string, number>; set?: Record<string, number>; caps?: Record<string, number>; conditions?: { stat: string; min?: number; below?: number; message: string }[]; growth?: number; minClean?: number; oncePerDay?: boolean; limitMessage?: string; effect?: string; duration?: number; line?: string; finish?: string; }
export const PET_SCENARIOS: Record<string, PetScenario>;
export const SLEEP_LINES: string[];
export function scenarioForItem(item: { key: string; kind: string }): PetScenario;
export function dirtLevel(clean: number): number;
export function needScenario(stats: Record<string, number>): { stat: string; below: number; lines: string[] } | null;

export const EFFECT_ASSETS: Record<string, string | null>;
export const DIRT_BANDS: { below: number; level: number; flies: number; bugs: number }[];
export function dirtState(clean: number): { level: number; flies: number; bugs: number };
