/** Versioned, cumulative progression. Reads never confirm a level. All clocks are server clocks. */
import { db, q, tx, uid } from './db.mjs';

export const CURVE_VERSION = 1;
export const LEVEL_DAYS = [0, 4, 10, 18, 28, 40, 54, 70, 88, 108, 132, 160];
export const AGE_NAMES = ['幼年', '少年', '青年', '成年', '中年', '老年'];
export const SOURCE_CAPS = { task: 12, pet: 2, play: 2, hug: 2, food: 2, toy: 2, clean: 2 };
export const chinaDate = (at = Date.now()) => new Date(new Date(at).getTime() + 8 * 3600000).toISOString().slice(0, 10);
export const levelName = level => `${AGE_NAMES[Math.ceil(level / 2) - 1]}·${level % 2 ? '初阶' : '进阶'}`;
// Dev API and preview may start together against the same file. Serialize schema upgrades.
db.exec('BEGIN IMMEDIATE');
try {
const columns = new Set(q.all('PRAGMA table_info(pet_life)').map(c => c.name));
for (const [name, type] of Object.entries({
  confirmed_level: 'INTEGER', progression_version: 'INTEGER', progression_seed: 'REAL NOT NULL DEFAULT 0',
  natural_anchor_at: 'TEXT', eligible_growth: 'INTEGER NOT NULL DEFAULT 0', adoption_anniversary: 'TEXT',
})) if (!columns.has(name)) db.exec(`ALTER TABLE pet_life ADD COLUMN ${name} ${type}`);
db.exec(`CREATE TABLE IF NOT EXISTS pet_growth_ledger (
 id TEXT PRIMARY KEY, child_id TEXT NOT NULL, pet_id TEXT, source TEXT NOT NULL,
 event_key TEXT NOT NULL, date TEXT NOT NULL, amount INTEGER NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(child_id,event_key));
 CREATE INDEX IF NOT EXISTS idx_growth_quota ON pet_growth_ledger(child_id,date,source);
 CREATE TABLE IF NOT EXISTS pet_levelup_event (
 id TEXT PRIMARY KEY, child_id TEXT NOT NULL, pet_id TEXT NOT NULL, request_id TEXT NOT NULL,
 from_level INTEGER NOT NULL, to_level INTEGER NOT NULL, created_at TEXT NOT NULL, seen_at TEXT,
 UNIQUE(child_id,request_id));
 CREATE INDEX IF NOT EXISTS idx_levelup_pet ON pet_levelup_event(child_id,pet_id,created_at);
 CREATE TABLE IF NOT EXISTS pet_levelup_receipt (
 child_id TEXT NOT NULL, request_id TEXT NOT NULL, event_id TEXT NOT NULL,
 PRIMARY KEY(child_id,request_id));
 CREATE TABLE IF NOT EXISTS pet_chest_claim (
 pet_id TEXT NOT NULL, chest_no INTEGER NOT NULL, PRIMARY KEY(pet_id,chest_no));`);
db.exec('COMMIT');
} catch (error) { db.exec('ROLLBACK'); throw error; }

/** Also used for old snapshots, evaluated at their saved time, before archive freezing. */
export function migratedFields(pet, at = Date.now()) {
  if (pet.progression_version === CURVE_VERSION && pet.confirmed_level) return {};
  if (pet.progression_version != null && pet.progression_version !== CURVE_VERSION) throw Error('这份宠物成长记录需要更新版本后读取');
  const rates = { bird: 1.15, turtle: .55, dog: ['dog_golden', 'dog_german'].includes(pet.breed) ? .72 : .88, capybara: .88, alpaca: .88, cat: 1 };
  const days = Math.max(0, (at - Date.parse(pet.adopted_at)) / 86400000) * (rates[pet.species] || 1);
  const legacyAge = 1 + [1, 3, 7, 14, 30].filter(d => days >= d).length;
  const stage = Math.max(1, Math.min(6, Math.max(pet.stage || 1, legacyAge)));
  const level = stage * 2 - 1;
  return { stage, confirmed_level: level, progression_version: CURVE_VERSION,
    progression_seed: LEVEL_DAYS[level - 1] * 24, natural_anchor_at: new Date(at).toISOString(),
    eligible_growth: 0, adoption_anniversary: pet.adoption_anniversary || pet.adopted_at };
}

export function ensureProgression(pet) {
  if (!pet || pet.progression_version === CURVE_VERSION) return pet;
  return tx(() => {
    const fresh = q.get('SELECT * FROM pet_life WHERE pet_id=?', pet.pet_id);
    if (fresh.progression_version === CURVE_VERSION) return fresh;
    const fields = migratedFields(fresh);
    q.run(`UPDATE pet_life SET ${Object.keys(fields).map(k => `${k}=?`).join(',')} WHERE pet_id=?`, ...Object.values(fields), pet.pet_id);
    // Existing lifetime chest rewards were already granted under the old mechanism.
    for (let n = 1; n <= Math.floor(fresh.growth / 50); n++) q.run('INSERT OR IGNORE INTO pet_chest_claim VALUES(?,?)', pet.pet_id, n);
    return { ...fresh, ...fields };
  });
}

export function progressionFor(pet, at = Date.now()) {
  const level = pet.confirmed_level;
  const naturalHours = Math.max(0, (at - Date.parse(pet.natural_anchor_at)) / 3600000);
  const growth = Math.max(0, pet.eligible_growth);
  const seed = pet.progression_seed;
  const effectiveHours = seed + naturalHours + Math.min(growth, naturalHours);
  const target = LEVEL_DAYS[level] == null ? null : LEVEL_DAYS[level] * 24;
  const relativeTarget = target == null ? null : Math.max(0, target - seed);
  const ready = target != null && effectiveHours >= target;
  const waitHours = relativeTarget == null ? null : Math.max(0, Math.max(relativeTarget / 2, relativeTarget - growth) - naturalHours);
  const minimumWaitHours = relativeTarget == null ? null : Math.max(0, relativeTarget / 2 - naturalHours);
  const growthNeeded = relativeTarget == null || minimumWaitHours > 0 ? null : Math.ceil(Math.max(0, relativeTarget - naturalHours - growth));
  return { version: CURVE_VERSION, level, phase: level % 2 ? 1 : 2, name: levelName(level),
    nextName: target == null ? null : levelName(level + 1), nextLevel: target == null ? null : level + 1,
    ready, terminal: target == null, naturalHours, eligibleGrowth: growth, appliedGrowth: Math.min(growth, naturalHours),
    storedGrowth: Math.max(0, growth - naturalHours), effectiveHours, seedHours: seed,
    targetHours: target, waitHours, minimumWaitHours, growthNeeded,
    progress: target == null ? 1 : Math.max(0, Math.min(1, (effectiveHours - LEVEL_DAYS[level - 1] * 24) / (target - LEVEL_DAYS[level - 1] * 24))) };
}

export function dailyGrowth(childId, at = Date.now()) {
  const rows = q.all('SELECT source,SUM(amount) amount FROM pet_growth_ledger WHERE child_id=? AND date=? GROUP BY source', childId, chinaDate(at));
  const used = Object.fromEntries(rows.map(r => [r.source, r.amount]));
  const remaining = Object.fromEntries(Object.entries(SOURCE_CAPS).map(([s, cap]) => [s, Math.max(0, cap - (used[s] || 0))]));
  return { date: chinaDate(at), cap: 24, earned: Object.values(used).reduce((a, b) => a + b, 0),
    remaining: Object.values(remaining).reduce((a, b) => a + b, 0), sources: remaining };
}

/** Caller wraps the source action + this award in one transaction; event keys never live in snapshots. */
export function grantGrowth(childId, pet, source, amount, eventKey, eligible = true, at = Date.now()) {
  if (q.get('SELECT id FROM pet_growth_ledger WHERE child_id=? AND event_key=?', childId, eventKey)) return 0;
  const daily = dailyGrowth(childId, at);
  const award = pet && eligible ? Math.max(0, Math.min(amount, daily.sources[source] || 0, daily.remaining)) : 0;
  q.run('INSERT INTO pet_growth_ledger VALUES(?,?,?,?,?,?,?,?)', uid(), childId, pet?.pet_id || null, source, eventKey, chinaDate(at), award, new Date(at).toISOString());
  if (award) q.run('UPDATE pet_life SET growth=growth+?,eligible_growth=eligible_growth+? WHERE pet_id=?', award, award, pet.pet_id);
  return award;
}

export function levelEvents(childId, petId) {
  return q.all('SELECT * FROM pet_levelup_event WHERE child_id=? AND pet_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30', childId, petId)
    .map(e => ({ id: e.id, fromLevel: e.from_level, toLevel: e.to_level, name: levelName(e.to_level), createdAt: e.created_at, seen: !!e.seen_at }));
}

export function confirmLevel(childId, body = {}) {
  const { expectedPetId, expectedLevel, requestId } = body;
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(requestId) || !Number.isInteger(expectedLevel)) throw Error('升级请求无效，请刷新后重试');
  return tx(() => {
    const pet = ensureProgression(q.get('SELECT * FROM pet_life WHERE child_id=? ORDER BY created_at LIMIT 1', childId));
    if (!pet || pet.pet_id !== expectedPetId) throw Error('当前宠物已经变化，请刷新后再升级');
    const prior = q.get(`SELECT e.* FROM pet_levelup_receipt r JOIN pet_levelup_event e ON e.id=r.event_id WHERE r.child_id=? AND r.request_id=?`, childId, requestId)
      || q.get('SELECT * FROM pet_levelup_event WHERE child_id=? AND request_id=?', childId, requestId);
    if (prior) {
      if (prior.pet_id !== pet.pet_id || prior.from_level !== expectedLevel) throw Error('升级请求已被使用，请刷新');
      return levelEvents(childId, pet.pet_id).find(e => e.id === prior.id) || { id: prior.id, fromLevel: prior.from_level, toLevel: prior.to_level, name: levelName(prior.to_level), createdAt: prior.created_at, seen: !!prior.seen_at };
    }
    if (pet.confirmed_level !== expectedLevel) throw Error('阶段已经变化，请刷新看看小伙伴');
    if (!progressionFor(pet).ready) throw Error('还在慢慢长大，再陪伴一会儿吧');
    const memory = q.get('SELECT id FROM pet_levelup_event WHERE child_id=? AND pet_id=? AND to_level=? ORDER BY created_at LIMIT 1', childId, pet.pet_id, expectedLevel + 1);
    const id = memory?.id || uid();
    q.run('UPDATE pet_life SET confirmed_level=confirmed_level+1,stage=? WHERE pet_id=? AND confirmed_level=?', Math.ceil((expectedLevel + 1) / 2), pet.pet_id, expectedLevel);
    if (!memory) q.run('INSERT INTO pet_levelup_event VALUES(?,?,?,?,?,?,?,NULL)', id, childId, pet.pet_id, requestId, expectedLevel, expectedLevel + 1, new Date().toISOString());
    q.run('INSERT INTO pet_levelup_receipt VALUES(?,?,?)', childId, requestId, id);
    return levelEvents(childId, pet.pet_id).find(e => e.id === id);
  });
}

export function acknowledgeLevel(childId, eventId) {
  q.run('UPDATE pet_levelup_event SET seen_at=COALESCE(seen_at,?) WHERE child_id=? AND id=?', new Date().toISOString(), childId, eventId);
}
