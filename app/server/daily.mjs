/**
 * 伴学小岛 · MVP 业务层
 * ------------------------------------------------------------
 * 计划 → 打卡 → 积分 → 材料 → 养成，一条闭环。
 * 养成数值与动作规则取自 MengChong 逆向研究：
 *   · 四项需求按时间衰减（饱食/精力/心情/清洁）
 *   · 投喂、抚摸、陪玩、抱抱提供成长值；每 50 成长值掉一次百宝箱
 *   · 六龄十二阶：自然时间与每日有效成长共同积累，达标后手动确认
 */
import { q, now, uid, tx } from './db.mjs';
import { ensureProgression, progressionFor, dailyGrowth, grantGrowth, levelEvents, chinaDate, CURVE_VERSION } from './pet-progression.mjs';

export const STAGE_NAMES = ['蛋', '幼年', '少年', '青年', '成年', '中年', '老年'];
export const STAGE_SCALE = [0.5, 0.62, 0.80, 0.92, 1.0, 1.0, 0.94];
export const STAGE_RATE = [1, 1.12, 1.12, 1, 1, 1, 0.85];

export const SHOP = [
  {
    key: 'kibble', name: '香脆小饼干', icon: '🍪', kind: 'food', cost: 22,
    desc: '日常口粮，先垫垫肚子', effect: { hunger: 24, growth: 1 },
  },
  {
    key: 'fish', name: '小鱼干', icon: '🐟', kind: 'food', cost: 44,
    desc: '香得尾巴都翘起来', effect: { hunger: 36, mood: 6, growth: 2 },
  },
  {
    key: 'milk', name: '温热羊奶', icon: '🥛', kind: 'food', cost: 30,
    desc: '喝完精神满满', effect: { hunger: 20, energy: 14, growth: 1 },
  },
  {
    key: 'ball', name: '毛线球', icon: '🧶', kind: 'toy', cost: 40,
    desc: '滚来滚去玩一下午', effect: { mood: 16, energy: -4, growth: 1 },
  },
  {
    key: 'feather', name: '羽毛逗趣棒', icon: '🪶', kind: 'toy', cost: 70,
    desc: '扑上去！根本停不下来', effect: { mood: 24, energy: -6, growth: 2 },
  },
  {
    key: 'brush', name: '软毛小梳子', icon: '🪮', kind: 'clean', cost: 32,
    desc: '梳梳毛，蓬松又清爽', effect: { clean: 18, mood: 4, growth: 1 },
  },
  {
    key: 'bath', name: '泡泡香香浴', icon: '🫧', kind: 'clean', cost: 62,
    desc: '香喷喷的一身泡泡', effect: { clean: 36, mood: 8, growth: 1 },
  },
  {
    key: 'bow', name: '草莓蝴蝶结', icon: '🎀', kind: 'deco', cost: 110,
    desc: '系在颈前，可反复穿戴；首次戴上心情 +12', effect: { mood: 12, outfit: 'bow' },
  },
  {
    key: 'crown', name: '迷你小皇冠', icon: '👑', kind: 'deco', cost: 260,
    desc: '戴在头顶，可反复穿戴；首次戴上心情 +16', effect: { mood: 16, outfit: 'crown' },
  },
];

export const SHOP_MAP = Object.fromEntries(SHOP.map((x) => [x.key, x]));

/** 材料铺：内置 9 件 + 家长覆盖价 */
export function shopFor(childId) {
  const rows = q.all('SELECT item_key, cost FROM material_price WHERE child_id=?', childId);
  const override = Object.fromEntries(rows.map((r) => [r.item_key, r.cost]));
  return SHOP.map((item) => ({ ...item, cost: override[item.key] ?? item.cost }));
}

function priceOf(childId, key) {
  const row = q.get('SELECT cost FROM material_price WHERE child_id=? AND item_key=?', childId, key);
  return row?.cost ?? SHOP_MAP[key]?.cost ?? 0;
}

const BREEDS = {
  cat_orange: { name: '小橘', species: 'cat' },
  cat_ragdoll: { name: '布偶', species: 'cat' },
  cat_black: { name: '煤球', species: 'cat' },
  cat_blue: { name: '蓝蓝', species: 'cat' },
  dog_dairy: { name: '奶糖', species: 'dog' },
  dog_golden: { name: '金豆', species: 'dog' },
  dog_corgi: { name: '豆包', species: 'dog' },
  dog_corgi_toon: { name: '布丁', species: 'dog' },
  capybara_toon: { name: '卡卡', species: 'capybara' },
  alpaca_toon: { name: '阿驼', species: 'alpaca' },
  dog_german: { name: '阿牧', species: 'dog' },
  bird_parakeet: { name: '啾啾', species: 'bird' },
  bird_cockatiel: { name: '小玄', species: 'bird' },
  bird_peachface: { name: '桃桃', species: 'bird' },
  bird_pigeon: { name: '咕咕', species: 'bird' },
  turtle_redear: { name: '慢慢', species: 'turtle' },
  turtle_grass: { name: '小草', species: 'turtle' },
  turtle_flower: { name: '花花', species: 'turtle' },
  turtle_map: { name: '地图', species: 'turtle' },
};

const SOUND_SPECIES = { cat: 'cat', dog: 'dog', bird: 'bird', turtle: 'turtle', capybara: 'capybara', alpaca: 'alpaca' };

const DAILY_BONUS = 15;
const DECAY_PER_HOUR = { hunger: 2.8, energy: 2.2, mood: 1.8, clean: 1.3 };
const MAX_DECAY_HOURS = 12;
const COOLDOWN_MS = { pet: 6000, play: 12000, hug: 12000 };

export function cooldownLeft(pet, action, duration = COOLDOWN_MS[action]) {
  const saved = q.get('SELECT used_at FROM pet_cooldown WHERE pet_id=? AND action=?', pet.pet_id, action)?.used_at;
  // 兼容升级前最后一次照顾记录。
  const usedAt = saved || (pet.last_care_kind === action ? pet.last_care_at : null);
  return Math.max(0, Math.ceil((duration - (Date.now() - (Date.parse(usedAt || '') || 0))) / 1000));
}
export function markCare(pet, action) {
  q.run(`INSERT INTO pet_cooldown(pet_id, action, used_at) VALUES(?,?,?)
    ON CONFLICT(pet_id, action) DO UPDATE SET used_at=excluded.used_at`, pet.pet_id, action, new Date().toISOString());
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;
export const toDateKey = (d = new Date()) => {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
};

function addDaysKey(key, delta) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return toDateKey(dt);
}

function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/* ---------------- 宠物 ---------------- */
function breedInfo(breed) {
  return BREEDS[breed] || BREEDS.cat_orange;
}

function stageInfoFor(pet) {
  if (!pet) return null;
  const progression = progressionFor(pet);
  const stage = Math.ceil(progression.level / 2);
  const realDays = Math.max(0, (Date.now() - Date.parse(pet.adopted_at)) / 86400000);
  return {
    stage, name: STAGE_NAMES[stage], days: round1(realDays),
    effectiveDays: progression.effectiveHours / 24,
    nextDays: progression.targetHours == null ? null : progression.targetHours / 24,
    nextInDays: progression.waitHours == null ? null : Math.ceil(progression.waitHours / 24),
    progress: progression.progress, rate: 1, scale: STAGE_SCALE[stage], videoRate: STAGE_RATE[stage],
  };
}

function serializePet(row) {
  if (!row) return null;
  let outfit = {};
  try { outfit = JSON.parse(row.outfit || '{}'); } catch {}
  const stage = stageInfoFor(row);
  return {
    id: row.pet_id,
    name: row.name,
    breed: row.breed,
    species: row.species,
    gender: row.gender,
    personality: row.personality,
    stage: stage?.stage ?? row.stage,
    stageInfo: stage,
    progression: { ...progressionFor(row), daily: dailyGrowth(row.child_id) },
    growthMemories: levelEvents(row.child_id, row.pet_id),
    adoptionAnniversary: row.adoption_anniversary || row.adopted_at,
    adoptedAt: row.adopted_at,
    stats: {
      hunger: round1(row.hunger),
      energy: round1(row.energy),
      mood: round1(row.mood),
      clean: round1(row.clean),
    },
    growth: Math.round(row.growth),
    careCount: row.care_count,
    chestsOpened: Math.floor(row.growth / 50),
    nextChest: 50 - (Math.round(row.growth) % 50 || 0),
    outfit,
    sound: SOUND_SPECIES[row.species] || 'cat',
  };
}

function applyDecay(row) {
  if (!row) return false;
  const last = Date.parse(row.last_tick) || Date.now();
  const hours = clamp((Date.now() - last) / 3600000, 0, MAX_DECAY_HOURS);
  if (hours <= 0.0005) return false;
  row.hunger = clamp(row.hunger - DECAY_PER_HOUR.hunger * hours, 0, 100);
  row.energy = clamp(row.energy - DECAY_PER_HOUR.energy * hours, 0, 100);
  row.mood = clamp(row.mood - DECAY_PER_HOUR.mood * hours, 0, 100);
  row.clean = clamp(row.clean - DECAY_PER_HOUR.clean * hours, 0, 100);
  // 需求过低会拖累心情：饿、脏、累都会让它没那么开心
  if (row.hunger < 25) row.mood = clamp(row.mood - 1.1 * hours, 0, 100);
  if (row.clean < 25) row.mood = clamp(row.mood - 0.6 * hours, 0, 100);
  if (row.energy < 15) row.mood = clamp(row.mood - 0.5 * hours, 0, 100);
  row.last_tick = new Date().toISOString();
  return true;
}

export function getPetRow(childId) {
  const row = ensureProgression(q.get('SELECT * FROM pet_life WHERE child_id = ? ORDER BY created_at LIMIT 1', childId));
  if (!row) return null;
  const changed = applyDecay(row);
  if (changed) {
    q.run(
      'UPDATE pet_life SET hunger=?, energy=?, mood=?, clean=?, stage=?, last_tick=? WHERE pet_id=?',
      row.hunger, row.energy, row.mood, row.clean, row.stage, row.last_tick, row.pet_id,
    );
  }
  return row;
}

/* ---------------- 钱包 ---------------- */
function walletOf(childId, date) {
  const balance = q.get('SELECT COALESCE(SUM(delta),0) AS n FROM point_ledger WHERE child_id=?', childId)?.n ?? 0;
  const earned = q.get(
    'SELECT COALESCE(SUM(delta),0) AS n FROM point_ledger WHERE child_id=? AND date=? AND delta>0',
    childId, date)?.n ?? 0;
  const spent = q.get(
    'SELECT COALESCE(SUM(-delta),0) AS n FROM point_ledger WHERE child_id=? AND date=? AND delta<0',
    childId, date)?.n ?? 0;
  return { balance, todayEarned: earned, todaySpent: spent, streak: streakOf(childId) };
}

function streakOf(childId) {
  const rows = q.all(
    `SELECT DISTINCT date FROM (
       SELECT date FROM daily_task WHERE child_id=? AND status='done'
       UNION
       SELECT date FROM v2_task WHERE child_id=? AND status='approved'
     ) ORDER BY date DESC LIMIT 400`,
    childId, childId);
  if (!rows.length) return 0;
  const set = new Set(rows.map((r) => r.date));
  const today = toDateKey();
  let cursor = set.has(today) ? today : addDaysKey(today, -1);
  let n = 0;
  while (set.has(cursor)) { n++; cursor = addDaysKey(cursor, -1); }
  return n;
}

function migrateWardrobe(childId) {
  // 恢复旧版被当作消耗品使用的装扮，原背包、账本和备份保持原样。
  for (const item of SHOP.filter(x => x.kind === 'deco')) {
    const held = q.get('SELECT qty FROM material_inv WHERE child_id=? AND item_key=? AND qty>0', childId, item.key);
    if (held) q.run('INSERT OR IGNORE INTO material_wardrobe VALUES(?,?,NULL)', childId, item.key);
    const bought = q.get('SELECT created_at FROM point_ledger WHERE child_id=? AND reason LIKE ? ORDER BY created_at LIMIT 1', childId, `兑换材料：${item.name} ×%`);
    const rows = q.all('SELECT outfit FROM pet_life WHERE child_id=?', childId);
    const wearing = rows.some(row => {
      try { const o = JSON.parse(row.outfit); return o?.[item.key] === '1' || Object.values(o || {}).includes(item.key); } catch { return false; }
    });
    if (bought || wearing) q.run('INSERT OR IGNORE INTO material_wardrobe VALUES(?,?,?)', childId, item.key, bought?.created_at || new Date().toISOString());
    if (wearing) q.run('UPDATE material_wardrobe SET first_worn_at=? WHERE child_id=? AND item_key=? AND first_worn_at IS NULL', bought?.created_at || new Date().toISOString(), childId, item.key);
  }
}

function inventoryOf(childId) {
  const rows = q.all('SELECT item_key, qty FROM material_inv WHERE child_id=? AND qty>0', childId);
  const owned = q.all('SELECT item_key, first_worn_at FROM material_wardrobe WHERE child_id=?', childId);
  return [...rows.filter(r => SHOP_MAP[r.item_key]?.kind !== 'deco'), ...owned.map(r => ({ ...r, qty: 1 }))]
    .map((r) => {
      const meta = SHOP_MAP[r.item_key];
      return meta ? { ...meta, qty: r.qty, ...(meta.kind === 'deco' ? { effect: { ...meta.effect, mood: r.first_worn_at ? 0 : meta.effect.mood } } : {}) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.cost - b.cost);
}

function tasksOf(childId, date) {
  return q.all(
    `SELECT * FROM daily_task WHERE child_id=? AND date=? ORDER BY status='done', sort, created_at`,
    childId, date);
}

function taskProgress(tasks) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  return {
    total,
    done,
    left: total - done,
    percent: total ? Math.round((done / total) * 100) : 0,
    minutes: tasks.filter((t) => t.status === 'done').reduce((s, t) => s + (t.minutes || 0), 0),
    points: tasks.filter((t) => t.status === 'done').reduce((s, t) => s + (t.points || 0), 0),
  };
}

function recentLedger(childId, limit = 8) {
  return q.all(
    `SELECT id, date, delta, reason, created_at FROM point_ledger WHERE child_id=? ORDER BY created_at DESC LIMIT ?`,
    childId, limit);
}

export function getToday(childId, date = toDateKey()) {
  migrateWardrobe(childId);
  const pet = getPetRow(childId);
  const tasks = tasksOf(childId, date).map((t) => ({
    id: t.id,
    title: t.title,
    subject: t.subject,
    minutes: t.minutes,
    points: t.points,
    status: t.status,
    completedAt: t.completed_at,
    createdAt: t.created_at,
  }));
  const wallet = walletOf(childId, date);
  const progress = taskProgress(tasks);

  let cooldowns = { pet: 0, play: 0, hug: 0 };
  if (pet) {
    cooldowns = Object.fromEntries(Object.keys(COOLDOWN_MS).map((action) => [action, cooldownLeft(pet, action)]));
    cooldowns.rest = cooldownLeft(pet, 'rest', 30 * 60 * 1000);
  }

  return {
    date,
    today: toDateKey(),
    pet: serializePet(pet),
    isNew: !pet,
    tasks,
    progress,
    wallet,
    inventory: inventoryOf(childId),
    shop: shopFor(childId),
    recent: recentLedger(childId),
    cooldowns,
    stageNames: STAGE_NAMES,
    dailyBonus: DAILY_BONUS,
  };
}

/* ---------------- 领养 ---------------- */
export function changeBreed(childId, breed) {
  if (typeof breed !== 'string' || !Object.hasOwn(BREEDS, breed)) throw new Error('还没有这种小伙伴');
  const pet = getPetRow(childId);
  if (!pet) throw new Error('请先领养小伙伴');
  q.run('UPDATE pet_life SET breed=?, species=? WHERE pet_id=?', breed, BREEDS[breed].species, pet.pet_id);
}

export function adopt(childId, { breed = 'cat_orange', name, gender = 'female' } = {}) {
  if (!BREEDS[breed]) throw new Error('还没有这种小伙伴');
  const exists = getPetRow(childId);
  if (exists) throw new Error('已经领养过小伙伴啦');
  const info = breedInfo(breed);
  const cleanName = String(name || info.name).trim().slice(0, 12) || info.name;
  const petId = uid();
  const ts = new Date().toISOString();
  tx(() => {
    q.run(
      `INSERT INTO pet_life(pet_id, child_id, name, breed, species, gender, personality, stage,
        hunger, energy, mood, clean, growth, care_count, outfit, adopted_at, last_tick, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      petId, childId, cleanName, breed, info.species, gender, '粘人', 1,
      75, 78, 86, 90, 0, 0, '{}', ts, ts, ts);
    q.run('UPDATE pet_life SET confirmed_level=1,progression_version=?,natural_anchor_at=?,adoption_anniversary=? WHERE pet_id=?', CURVE_VERSION, ts, ts, petId);
    seedStarterTasks(childId, toDateKey());
  });
  return getToday(childId);
}

function seedStarterTasks(childId, date) {
  const existing = q.get('SELECT COUNT(*) AS n FROM daily_task WHERE child_id=? AND date=?', childId, date)?.n ?? 0;
  if (existing) return;
  const samples = [
    ['晨读 15 分钟', '语文', 15, 12],
    ['数学口算 20 题', '数学', 20, 15],
    ['英语跟读 10 分钟', '英语', 10, 10],
  ];
  const ts = new Date().toISOString();
  samples.forEach(([title, subject, minutes, points], i) => {
    q.run(
      `INSERT INTO daily_task(id, child_id, date, title, subject, minutes, points, status, sort, created_at)
       VALUES(?,?,?,?,?,?,?,'open',?,?)`,
      uid(), childId, date, title, subject, minutes, points, i, ts);
  });
}

/* ---------------- 计划任务 ---------------- */
export function addTask(childId, body = {}) {
  const title = String(body.title || '').trim();
  if (!title) throw new Error('给任务起个名字吧');
  if (title.length > 60) throw new Error('任务名太长了');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : toDateKey();
  const minutes = clamp(Math.round(Number(body.minutes) || 15), 5, 180);
  const points = clamp(Math.round(Number(body.points) || Math.round(minutes * 0.8)), 5, 60);
  const subject = String(body.subject || '自习').trim().slice(0, 10) || '自习';
  const sort = (q.get('SELECT COALESCE(MAX(sort),-1) AS n FROM daily_task WHERE child_id=? AND date=?', childId, date)?.n ?? -1) + 1;
  q.run(
    `INSERT INTO daily_task(id, child_id, date, title, subject, minutes, points, status, sort, created_at)
     VALUES(?,?,?,?,?,?,?,'open',?,?)`,
    uid(), childId, date, title, subject, minutes, points, sort, new Date().toISOString());
  syncDayBonus(childId, date);
  return getToday(childId, date);
}

export function deleteTask(childId, id) {
  const row = q.get('SELECT * FROM daily_task WHERE id=? AND child_id=?', id, childId);
  if (!row) throw new Error('任务不存在');
  if (row.status === 'done') {
    const balance = q.get('SELECT COALESCE(SUM(delta),0) AS n FROM point_ledger WHERE child_id=?', childId)?.n ?? 0;
    if (balance - row.points < 0) throw new Error('这个任务的积分已经花掉啦，先撤销打卡再删');
  }
  tx(() => {
    q.run('DELETE FROM daily_task WHERE id=?', id);
    q.run('DELETE FROM point_ledger WHERE dedupe_key=?', `task:${id}:done`);
    syncDayBonus(childId, row.date);
  });
  return getToday(childId, row.date);
}

export function toggleTask(childId, id, done) {
  const row = q.get('SELECT * FROM daily_task WHERE id=? AND child_id=?', id, childId);
  if (!row) throw new Error('任务不存在');
  const want = done !== false;
  if (want && row.status === 'done') return { ...getToday(childId, row.date), changed: false };
  if (!want && row.status !== 'done') return { ...getToday(childId, row.date), changed: false };

  let result;
  tx(() => {
    if (want) {
      q.run(`UPDATE daily_task SET status='done', completed_at=? WHERE id=?`, new Date().toISOString(), id);
      const key = `task:${id}:done`;
      const has = q.get('SELECT id FROM point_ledger WHERE dedupe_key=?', key);
      if (!has) {
        q.run(
          `INSERT INTO point_ledger(id, child_id, date, delta, reason, dedupe_key, created_at)
           VALUES(?,?,?,?,?,?,?)`,
          uid(), childId, row.date, row.points, `完成任务：${row.title}`, key, new Date().toISOString());
      }
      awardTaskGrowth(childId, row, 'legacytask');
      const pet = getPetRow(childId);
      if (pet) {
        q.run('UPDATE pet_life SET mood=?, last_tick=? WHERE pet_id=?',
          clamp(pet.mood + 3, 0, 100), new Date().toISOString(), pet.pet_id);
      }
    } else {
      const balance = q.get('SELECT COALESCE(SUM(delta),0) AS n FROM point_ledger WHERE child_id=?', childId)?.n ?? 0;
      if (balance - row.points < 0) throw new Error('这部分积分已经换材料啦，撤销不了');
      q.run('DELETE FROM point_ledger WHERE dedupe_key=?', `task:${id}:done`);
      q.run(`UPDATE daily_task SET status='open', completed_at=NULL WHERE id=?`, id);
    }
    const bonus = syncDayBonus(childId, row.date);
    result = { ...getToday(childId, row.date), changed: true, bonus };
  });
  return result;
}

function syncDayBonus(childId, date) {
  const tasks = tasksOf(childId, date);
  const allDone = tasks.length > 0 && tasks.every((t) => t.status === 'done');
  const key = `day:${date}:bonus`;
  const has = q.get('SELECT id FROM point_ledger WHERE dedupe_key=?', key);
  if (allDone && !has) {
    q.run(
      `INSERT INTO point_ledger(id, child_id, date, delta, reason, dedupe_key, created_at)
       VALUES(?,?,?,?,?,?,?)`,
      uid(), childId, date, DAILY_BONUS, '今日计划全部完成', key, new Date().toISOString());
    return { awarded: true, points: DAILY_BONUS };
  }
  // 奖励一旦发出就不再因计划变更而追回（对应方案里的“改计划不重置已发奖励”）
  return { awarded: false };
}

/* ---------------- 商店 / 背包 ---------------- */
export function buy(childId, { key, qty = 1 } = {}) {
  const item = SHOP_MAP[key];
  if (!item) throw new Error('商店里没有这件材料');
  const n = Number(qty);
  if (!Number.isInteger(n) || n < 1 || n > 9) throw new Error('每次可兑换 1 到 9 件材料');
  if (item.kind === 'deco' && n !== 1) throw new Error('装扮只需兑换一件，就可以反复穿戴');
  const cost = priceOf(childId, key) * n;
  tx(() => {
    migrateWardrobe(childId);
    if (item.kind === 'deco' && q.get('SELECT 1 FROM material_wardrobe WHERE child_id=? AND item_key=?', childId, key)) throw new Error('这件装扮已经拥有啦，去背包穿戴吧');
    const balance = q.get('SELECT COALESCE(SUM(delta),0) AS n FROM point_ledger WHERE child_id=?', childId)?.n ?? 0;
    if (balance < cost) throw new Error(`还差 ${cost - balance} 星贝`);
    q.run(
      `INSERT INTO point_ledger(id, child_id, date, delta, reason, dedupe_key, created_at)
       VALUES(?,?,?,?,?,?,?)`,
      uid(), childId, toDateKey(), -cost, `兑换材料：${item.name} ×${n}`, `buy:${uid()}`, new Date().toISOString());
    q.run(
      `INSERT INTO material_inv(child_id, item_key, qty) VALUES(?,?,?)
       ON CONFLICT(child_id, item_key) DO UPDATE SET qty=qty+excluded.qty`,
      childId, key, n);
    if (item.kind === 'deco') q.run('INSERT INTO material_wardrobe VALUES(?,?,NULL)', childId, key);
  });
  return getToday(childId);
}

export function useMaterial(childId, { key, equipped = true } = {}) {
  const item = SHOP_MAP[key];
  if (!item) throw new Error('背包里没有这件材料');
  if (typeof equipped !== 'boolean') throw new Error('穿戴状态无效');
  if (item.kind !== 'deco' && !equipped) throw new Error('只有装扮可以取下');
  migrateWardrobe(childId);
  const pet = getPetRow(childId);
  if (!pet) throw new Error('先领养一个小伙伴吧');

  if (item.kind === 'deco') {
    let result;
    tx(() => {
      const owned = q.get('SELECT first_worn_at FROM material_wardrobe WHERE child_id=? AND item_key=?', childId, key);
      if (!owned) throw new Error('还没有这件装扮，先去材料铺兑换吧');
      let outfit = {};
      try { outfit = JSON.parse(pet.outfit || '{}'); } catch {}
      // 兼容旧备份中的 {neck:'bow'}，输出继续使用旧版可读的物品键。
      for (const [slot, value] of Object.entries(outfit)) if (['bow', 'crown'].includes(value)) { outfit[value] = '1'; delete outfit[slot]; }
      const changed = !!outfit[key] !== equipped;
      if (equipped) outfit[key] = '1'; else delete outfit[key];
      const bonus = equipped && !owned.first_worn_at ? Number(item.effect.mood) || 0 : 0;
      if (bonus) q.run('UPDATE material_wardrobe SET first_worn_at=? WHERE child_id=? AND item_key=?', new Date().toISOString(), childId, key);
      q.run('UPDATE pet_life SET outfit=?, mood=?, care_count=care_count+?, last_tick=? WHERE pet_id=?', JSON.stringify(outfit), clamp(pet.mood + bonus, 0, 100), Number(changed), new Date().toISOString(), pet.pet_id);
      result = { ...getToday(childId), used: item, equipped, changed, growthGained: 0, loot: [], msg: `${item.name} · ${equipped ? changed ? '戴好啦' : '已经戴好啦' : '已取下'}${bonus ? ` · 心情 +${bonus}` : ''} · 装扮会一直留在背包` };
    });
    return result;
  }

  const row = q.get('SELECT qty FROM material_inv WHERE child_id=? AND item_key=?', childId, key);
  if (!row || row.qty <= 0) throw new Error('这件材料已经用完啦');

  const beforeGrowth = Math.round(pet.growth);
  const eff = item.effect || {};
  const next = {
    hunger: clamp(pet.hunger + (eff.hunger || 0), 0, 100),
    energy: clamp(pet.energy + (eff.energy || 0), 0, 100),
    mood: clamp(pet.mood + (eff.mood || 0), 0, 100),
    clean: clamp(pet.clean + (eff.clean || 0), 0, 100),
  };
  const loot = [];
  let gained = 0;
  let outfit = {};
  try { outfit = JSON.parse(pet.outfit || '{}'); } catch {}
  if (eff.outfit) outfit = { [eff.outfit]: '1' };

  tx(() => {
    gained = grantGrowth(childId, pet, item.kind, eff.growth || 0, `material:${uid()}`);
    const consumed = q.run('UPDATE material_inv SET qty=qty-1 WHERE child_id=? AND item_key=? AND qty>0', childId, key);
    if (!consumed.changes) throw new Error('这件材料已经用完啦');
    q.run(
      `UPDATE pet_life SET hunger=?, energy=?, mood=?, clean=?, outfit=?, care_count=care_count+1, last_tick=?
       WHERE pet_id=?`,
      next.hunger, next.energy, next.mood, next.clean, JSON.stringify(outfit),
      new Date().toISOString(), pet.pet_id);
    q.run('DELETE FROM material_inv WHERE child_id=? AND item_key=? AND qty<=0', childId, key);
    loot.push(...dropChestIfAny(childId, pet.pet_id, beforeGrowth, beforeGrowth + gained, pet.stage));
  });

  const msg = effectMessage(item, { ...eff, growth: gained }) + (eff.growth && !gained ? ' · 它很开心，今天这类成长助力已收集完' : '');
  return { ...getToday(childId), msg, loot, used: item, growthGained: gained };
}

function effectMessage(item, eff) {
  const parts = [];
  if (eff.hunger) parts.push(`饱食 +${eff.hunger}`);
  if (eff.energy) parts.push(`精力 ${eff.energy > 0 ? '+' : ''}${eff.energy}`);
  if (eff.mood) parts.push(`心情 +${eff.mood}`);
  if (eff.clean) parts.push(`清洁 +${eff.clean}`);
  if (eff.growth) parts.push(`成长 +${eff.growth}`);
  if (eff.outfit) parts.push('换上新装扮');
  return `${item.name} · ${parts.join(' · ')}`;
}

function dropChestIfAny(childId, petId, before, after, stage) {
  const owed = Math.floor(after / 50) - Math.floor(before / 50);
  if (owed <= 0) return [];
  migrateWardrobe(childId);
  const owned = new Set(q.all('SELECT item_key FROM material_wardrobe WHERE child_id=?', childId).map(r => r.item_key));
  const pool = SHOP.filter((x) => x.kind !== 'deco' || (stage >= 4 && x.key === 'bow' && !owned.has(x.key)));
  const loot = [];
  for (let i = 0; i < owed; i++) {
    const claim = q.run('INSERT OR IGNORE INTO pet_chest_claim VALUES(?,?)', petId, Math.floor(before / 50) + i + 1);
    if (!claim.changes) continue;
    const item = pool[Math.floor(Math.random() * pool.length)];
    q.run(
      `INSERT INTO material_inv(child_id, item_key, qty) VALUES(?,?,1)
       ON CONFLICT(child_id, item_key) DO UPDATE SET qty=qty+1`,
      childId, item.key);
    if (item.kind === 'deco') {
      q.run('INSERT OR IGNORE INTO material_wardrobe VALUES(?,?,NULL)', childId, item.key);
      pool.splice(pool.indexOf(item), 1);
    }
    loot.push({ key: item.key, name: item.name, icon: item.icon });
  }
  return loot;
}

export function awardTaskGrowth(childId, task, prefix = 'v2task') {
  const pet = getPetRow(childId);
  const before = pet?.growth || 0;
  const gained = grantGrowth(childId, pet, 'task', 4, `${prefix}:${task.id}:growth`, task.date === chinaDate());
  if (pet && gained) dropChestIfAny(childId, pet.pet_id, before, before + gained, pet.stage);
  return gained;
}

/* ---------------- 免费互动 ---------------- */
export function interact(childId, { action } = {}) {
  const map = {
    pet: { mood: 6, clean: 2, growth: 1, label: '摸摸' },
    play: { mood: 11, energy: -5, growth: 1, label: '陪玩' },
    hug: { mood: 8, growth: 1, label: '抱抱' },
  };
  const act = map[action];
  if (!act) throw new Error('不认识这个动作');
  const pet = getPetRow(childId);
  if (!pet) throw new Error('先领养一个小伙伴吧');
  if (action === 'play' && pet.energy < 10) throw new Error('它太累啦，先让它睡一会儿');
  const s = cooldownLeft(pet, action);
  if (s > 0) {
    throw Object.assign(new Error(`它还在回味呢，${s} 秒后再来`), { cooldown: s });
  }
  const before = Math.round(pet.growth);
  let gained = 0;
  let loot = [];
  tx(() => {
    markCare(pet, action);
    gained = grantGrowth(childId, pet, action, act.growth, `care:${uid()}`);
    q.run(
      `UPDATE pet_life SET mood=?, clean=?, energy=?, care_count=care_count+1,
        last_care_at=?, last_care_kind=?, last_tick=? WHERE pet_id=?`,
      clamp(pet.mood + act.mood, 0, 100), clamp(pet.clean + (act.clean || 0), 0, 100),
      clamp(pet.energy + (act.energy || 0), 0, 100),
      new Date().toISOString(), action, new Date().toISOString(), pet.pet_id);
    loot = dropChestIfAny(childId, pet.pet_id, before, before + gained, pet.stage);
  });
  return { ...getToday(childId), msg: `${act.label} · 心情 +${act.mood}${gained ? ` · 成长 +${gained}` : ' · 它很开心，今天这类成长助力已收集完'}`, growthGained: gained, loot };
}

export function rename(childId, name) {
  const pet = getPetRow(childId);
  if (!pet) throw new Error('还没有小伙伴');
  const clean = String(name || '').trim().slice(0, 12);
  if (!clean) throw new Error('名字不能为空');
  q.run('UPDATE pet_life SET name=? WHERE pet_id=?', clean, pet.pet_id);
  return getToday(childId);
}

export function resetPet(childId) {
  q.run('DELETE FROM pet_life WHERE child_id=?', childId);
  q.run('DELETE FROM material_inv WHERE child_id=?', childId);
  q.run('DELETE FROM daily_task WHERE child_id=?', childId);
  q.run('DELETE FROM point_ledger WHERE child_id=?', childId);
  return getToday(childId);
}

export function breedList() {
  return Object.entries(BREEDS).map(([id, b]) => ({ id, ...b }));
}
