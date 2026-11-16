/** One authoritative write path for needs. Growth/points keep their independent ledgers. */
import { db, q, tx } from './db.mjs';
export const PET_STATS = ['hunger', 'energy', 'mood', 'clean'];
db.exec(`CREATE TABLE IF NOT EXISTS pet_state_receipt (
 child_id TEXT NOT NULL, event_key TEXT NOT NULL, pet_id TEXT NOT NULL, reason TEXT NOT NULL,
 delta TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(child_id,event_key)
);`);
const clamp = v => Math.min(100, Math.max(0, v));
export function changePetState(childId, petId, { delta = {}, set = {}, caps = {}, reason, eventKey } = {}) {
  if (!reason) throw new Error('状态变化需要注明场景');
  for (const input of [delta, set, caps]) for (const [key, value] of Object.entries(input)) {
    if (!PET_STATS.includes(key) || typeof value !== 'number' || !Number.isFinite(value)) throw new Error('宠物状态参数无效');
  }
  return tx(() => {
    const pet = q.get('SELECT * FROM pet_life WHERE pet_id=? AND child_id=?', petId, childId);
    if (!pet) throw new Error('小伙伴已经变更，请刷新');
    if (eventKey && q.get('SELECT 1 FROM pet_state_receipt WHERE child_id=? AND event_key=?', childId, eventKey)) return { pet, delta: {}, duplicate: true };
    const applied = {};
    const next = Object.fromEntries(PET_STATS.map(key => {
      let value = Object.hasOwn(set, key) ? set[key] : pet[key] + (delta[key] || 0);
      // A recovery cap must never lower a stat already above that cap.
      if (Object.hasOwn(caps, key) && value > pet[key]) value = Math.max(pet[key], Math.min(value, caps[key]));
      value = clamp(value); applied[key] = value - pet[key]; return [key, value];
    }));
    q.run('UPDATE pet_life SET hunger=?,energy=?,mood=?,clean=? WHERE pet_id=? AND child_id=?', ...PET_STATS.map(key => next[key]), petId, childId);
    if (eventKey) q.run('INSERT INTO pet_state_receipt VALUES(?,?,?,?,?,?)', childId, eventKey, petId, reason, JSON.stringify(applied), new Date().toISOString());
    return { pet: { ...pet, ...next }, delta: applied, duplicate: false };
  });
}
