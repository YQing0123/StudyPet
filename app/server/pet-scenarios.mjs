import { db, q, tx } from './db.mjs';
import { chinaDate } from './pet-progression.mjs';
import { changePetState } from './pet-state.mjs';
import { PET_SCENARIOS } from '../web/src/shared/petScenarios.mjs';
db.exec(`CREATE TABLE IF NOT EXISTS pet_daily_scenario (child_id TEXT NOT NULL, scenario TEXT NOT NULL, date TEXT NOT NULL, PRIMARY KEY(child_id,scenario,date));`);
/** Declarative stat conditions and per-child once-a-day limits; presentation uses the same registry. */
export function scenarioAvailability(childId, pet, key, at = Date.now()) {
  const scenario = PET_SCENARIOS[key];
  if (!scenario) throw Error('还没有这个互动场景');
  const date = chinaDate(at);
  const used = !!q.get('SELECT 1 FROM pet_daily_scenario WHERE child_id=? AND scenario=? AND date=?', childId, key, date);
  let reason = !pet ? '先领养一个小伙伴吧' : '';
  if (pet) for (const condition of scenario.conditions || []) {
    const value = Math.round(pet[condition.stat] * 10) / 10;
    if ((condition.min != null && value < condition.min) || (condition.below != null && value >= condition.below)) { reason = condition.message; break; }
  }
  if (scenario.oncePerDay && used) reason = scenario.limitMessage || `${scenario.label || '这个互动'}今天用过啦，明天再来。`;
  return { allowed: !reason, reason, used, date };
}
export function applyPetScenario(childId, pet, key) {
  return tx(() => {
    const scenario = PET_SCENARIOS[key], availability = scenarioAvailability(childId, pet, key);
    if (!availability.allowed) throw Error(availability.reason);
    if (scenario.oncePerDay) q.run('INSERT INTO pet_daily_scenario VALUES(?,?,?)', childId, key, availability.date);
    return changePetState(childId, pet.pet_id, { delta: scenario.delta, set: scenario.set, caps: scenario.caps, reason: `scenario:${key}`,
      eventKey: scenario.oncePerDay ? `${key}:${availability.date}` : undefined });
  });
}
