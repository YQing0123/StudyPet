import { db, q, tx } from './db.mjs';
import { changePetState } from './pet-state.mjs';
import { SLEEP_LINES } from '../web/src/shared/petScenarios.mjs';
import { DEFAULT_SLEEP_SCHEDULE, validateSleepSchedule, sleepWindow, sleepWindows, sleptMilliseconds } from '../web/src/shared/petSleep.mjs';

db.exec(`
CREATE TABLE IF NOT EXISTS pet_sleep_schedule (
 child_id TEXT PRIMARY KEY, schedule TEXT NOT NULL, effective_from INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pet_sleep_disturbance (
 child_id TEXT PRIMARY KEY, window_id TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
 last_touch INTEGER NOT NULL DEFAULT 0, warned_at INTEGER NOT NULL DEFAULT 0,
 last_penalty INTEGER NOT NULL DEFAULT 0, total_penalty INTEGER NOT NULL DEFAULT 0
);`);

export function sleepSchedule(childId) {
  const row = q.get('SELECT schedule FROM pet_sleep_schedule WHERE child_id=?', childId);
  if (row) { try { return validateSleepSchedule(JSON.parse(row.schedule)); } catch {} }
  return { ...DEFAULT_SLEEP_SCHEDULE };
}
export function saveSleepSchedule(childId, input) {
  const schedule = validateSleepSchedule(input);
  if (JSON.stringify(schedule) === JSON.stringify(sleepSchedule(childId))) return schedule;
  q.run(`INSERT INTO pet_sleep_schedule VALUES(?,?,?) ON CONFLICT(child_id) DO UPDATE SET
    schedule=excluded.schedule,effective_from=excluded.effective_from`, childId, JSON.stringify(schedule), Date.now());
  return schedule;
}
export function sleepState(childId, now = Date.now()) {
  const schedule = sleepSchedule(childId);
  const active = sleepWindow(schedule, now);
  const nextTransitionAt = Math.min(...sleepWindows(schedule, now).flatMap(w => [w.startsAt, w.endsAt]).filter(time => time > now));
  return { schedule, timezone: 'Asia/Shanghai', serverNow: now, active, nextTransitionAt: Number.isFinite(nextTransitionAt) ? nextTransitionAt : null };
}
export function sleepHoursBetween(childId, from, to) {
  const row = q.get('SELECT effective_from FROM pet_sleep_schedule WHERE child_id=?', childId);
  if (!row) return 0;
  return sleptMilliseconds(sleepSchedule(childId), Math.max(from, row.effective_from), to) / 3600000;
}

const dreams = SLEEP_LINES;
// Called only after the regular needs settlement. No GET, background tick or offline period counts as a disturbance.
export function disturbSleep(childId, pet, now = Date.now()) {
  const active = sleepWindow(sleepSchedule(childId), now);
  if (!active) return null;
  return tx(() => {
    let row = q.get('SELECT * FROM pet_sleep_disturbance WHERE child_id=?', childId);
    if (!row || row.window_id !== active.id) row = { count: 0, last_touch: 0, warned_at: 0, last_penalty: 0, total_penalty: 0 };
    const ignored = now - row.last_touch < 2000;
    if (!ignored) {
      if (now - row.last_touch >= 5 * 60000) { row.count = 0; row.warned_at = 0; }
      row.count++;
      row.last_touch = now;
    }
    let penalty = 0;
    const warning = row.count >= 3;
    if (warning && !row.warned_at) row.warned_at = now;
    // A separate, clearly displayed warning must precede a penalty, with time to read it.
    if (!ignored && row.count >= 5 && now - row.warned_at >= 10000 && now - row.last_penalty >= 60000 && row.total_penalty < 6) {
      const before = q.get('SELECT mood FROM pet_life WHERE pet_id=? AND child_id=?', pet.pet_id, childId)?.mood ?? 0;
      // Match the one-decimal state shown to children, including a nearly empty mood bar.
      penalty = Math.round(Math.min(2, Math.round(before * 10) / 10, 6 - row.total_penalty) * 10) / 10;
      if (penalty > 0) {
        changePetState(childId, pet.pet_id, { delta: { mood: -penalty }, reason: 'sleep-disturbance' });
        row.total_penalty = Math.round((row.total_penalty + penalty) * 10) / 10; row.last_penalty = now;
      }
    }
    q.run(`INSERT INTO pet_sleep_disturbance VALUES(?,?,?,?,?,?,?) ON CONFLICT(child_id) DO UPDATE SET
      window_id=excluded.window_id,count=excluded.count,last_touch=excluded.last_touch,warned_at=excluded.warned_at,
      last_penalty=excluded.last_penalty,total_penalty=excluded.total_penalty`,
      childId, active.id, row.count, row.last_touch, row.warned_at, row.last_penalty, row.total_penalty);
    const message = penalty > 0
      ? `唔……刚刚说过要休息啦，一直被叫醒有点不开心。心情 -${penalty}，让我安静睡一会儿吧。`
      : warning ? row.total_penalty >= 6
        ? '我真的困啦，这次不再扣心情了。我们约好，睡醒后再一起玩，好吗？'
        : '唔……再叫我就要生气啦！继续打扰会让心情减 2 点，先让我睡吧，睡醒再陪你。'
        : dreams[(Math.max(1, row.count) - 1) % dreams.length];
    return { count: row.count, warning, penalty, totalPenalty: row.total_penalty, ignored,
      motion: (Math.max(1, row.count) - 1) % 4, message };
  });
}
