/** Successful interaction time only: reading plans and being idle never add play load. */
import { db, q } from './db.mjs';
import { PET_SCENARIOS } from '../web/src/shared/petScenarios.mjs';

export const PLAY_IDLE_RESET_MS = 5 * 60 * 1000;
export const PLAY_RAMP_SECONDS = 120;
export const MAX_PLAY_MULTIPLIER = 3;

db.exec(`CREATE TABLE IF NOT EXISTS pet_play_session (
 child_id TEXT PRIMARY KEY REFERENCES child(id) ON DELETE CASCADE,
 active_seconds REAL NOT NULL DEFAULT 0,
 last_action_at TEXT NOT NULL
);`);

const multiplier = seconds => Math.min(MAX_PLAY_MULTIPLIER, 1 + seconds / PLAY_RAMP_SECONDS);
const BASE_DURATION_SECONDS = { pet: 6, play: 9, hug: 8, toy: 9 };
export function playSession(childId, at = Date.now()) {
  const saved = q.get('SELECT * FROM pet_play_session WHERE child_id=?', childId);
  const elapsed = saved ? at - Date.parse(saved.last_action_at) : Infinity;
  const activeSeconds = elapsed >= 0 && elapsed < PLAY_IDLE_RESET_MS ? saved.active_seconds : 0;
  return {
    activeSeconds: Math.round(activeSeconds),
    energyMultiplier: Math.round(multiplier(activeSeconds) * 100) / 100,
    restRecommended: activeSeconds >= PLAY_RAMP_SECONDS,
  };
}

/** Called inside the same transaction as consumption/stats; the client cannot supply duration. */
export function recordPlay(childId, key, delta, at = Date.now()) {
  if (!['pet', 'play', 'hug', 'toy'].includes(key)) return delta;
  const duration = PET_SCENARIOS[key].duration / 1000;
  const previous = playSession(childId, at).activeSeconds;
  const seconds = previous + duration;
  // Integrate the coefficient over this action, so a longer action costs its time proportion.
  const coefficient = (multiplier(previous) + multiplier(seconds)) / 2;
  const durationRatio = duration / BASE_DURATION_SECONDS[key];
  const energy = Math.round(Math.abs(delta.energy || 0) * durationRatio * coefficient * 100) / 100;
  q.run(`INSERT INTO pet_play_session(child_id,active_seconds,last_action_at) VALUES(?,?,?)
    ON CONFLICT(child_id) DO UPDATE SET active_seconds=excluded.active_seconds,last_action_at=excluded.last_action_at`,
  childId, seconds, new Date(at).toISOString());
  return { ...delta, energy: -energy, clean: (delta.clean || 0) * durationRatio };
}
