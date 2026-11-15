/**
 * 宠物养成引擎
 *
 * 代入感来自三件事：
 *   1. 状态会自己变——离开一天再回来，它确实饿了、脏了、想你了。
 *   2. 它会表达需求——不是摆着看的图，而是会「蹭碗」「趴着不动」「躲进窝」。
 *   3. 会记住——里程碑、亲密度、上次互动，构成它和这个孩子之间的关系。
 */

import { q, now, uid, tx } from './db.mjs';

const HOUR = 3600_000;

/** 五维衰减速率（每小时） */
const DECAY = {
  satiety: 1.4,
  clean: 0.9,
  mood: 0.6,
  energy: 0.8,
};

export const STAGES = [
  { key: 'baby', name: '幼年', minLevel: 1, scale: 0.82 },
  { key: 'child', name: '少年', minLevel: 6, scale: 0.92 },
  { key: 'teen', name: '青春', minLevel: 13, scale: 1.0 },
  { key: 'adult', name: '成年', minLevel: 21, scale: 1.08 },
];

export const SCENES = [
  { key: 'home', name: '小屋', emoji: '🏠', unlockLevel: 1, desc: '它最喜欢的地方' },
  { key: 'yard', name: '院子', emoji: '🌳', unlockLevel: 3, desc: '阳光很好，可以奔跑' },
  { key: 'park', name: '公园', emoji: '🎠', unlockLevel: 6, desc: '有草地和小伙伴' },
  { key: 'hospital', name: '医院', emoji: '🏥', unlockLevel: 8, desc: '不舒服的时候来这里' },
  { key: 'beach', name: '海边', emoji: '🏖️', unlockLevel: 15, desc: '远处的海，风很软' },
];

export const ACTIONS = {
  feed: { label: '喂食', emoji: '🍖', cost: { item: 'food', qty: 1 }, gain: { satiety: 18, mood: 5 }, exp: 2, bond: 1,
          text: '吃得可香了，尾巴一直在摇。' },
  water: { label: '喝水', emoji: '💧', cost: { item: 'water', qty: 1 }, gain: { satiety: 6, health: 3 }, exp: 1, bond: 1,
          text: '咕嘟咕嘟，喝得很满足。' },
  bath: { label: '洗澡', emoji: '🛁', cost: null, gain: { clean: 32, mood: -3 }, exp: 2, bond: 1,
          text: '有点不情愿，但洗完蓬松多了。' },
  play: { label: '玩耍', emoji: '🎾', cost: null, gain: { mood: 16, energy: -12, clean: -6 }, exp: 3, bond: 2,
          text: '追着球跑了好几圈，开心得转圈。' },
  pet:  { label: '摸头', emoji: '🤚', cost: null, gain: { mood: 9, bond: 2 }, exp: 1, bond: 3,
          text: '眯起眼睛，把头往你手心蹭。' },
  sleep:{ label: '睡觉', emoji: '😴', cost: null, gain: { energy: 42, mood: 4 }, exp: 1, bond: 1,
          text: '蜷成一团，呼吸慢下来了。' },
  heal: { label: '治疗', emoji: '💊', cost: { item: 'medicine', qty: 1 }, gain: { health: 34 }, exp: 2, bond: 2,
          text: '乖乖吃完药，精神好了一点。' },
};

const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));

export function ensurePet(childId, name = '豆豆') {
  let pet = q.get('SELECT * FROM pet WHERE child_id = ?', childId);
  if (pet) return pet;
  const id = uid();
  q.run('INSERT INTO pet(id, child_id, name, species, stage, level, exp, bond, created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    id, childId, name, 'poodle', 'baby', 1, 0, 10, now());
  q.run('INSERT INTO pet_state(pet_id, satiety, clean, mood, energy, health, updated_at) VALUES(?,?,?,?,?,?,?)',
    id, 70, 80, 78, 85, 100, now());
  q.run('INSERT INTO scene_unlock(child_id, scene_key, unlocked_at) VALUES(?,?,?)', childId, 'home', now());
  pushEvent(id, 'born', `${name} 来到了小岛`);
  return q.get('SELECT * FROM pet WHERE id = ?', id);
}

export function pushEvent(petId, kind, detail) {
  q.run('INSERT INTO pet_event(id, pet_id, kind, detail, created_at) VALUES(?,?,?,?,?)',
    uid(), petId, kind, detail ?? null, now());
}

/** 按真实流逝时间推进状态，返回是否发生了显著变化 */
export function decayToNow(petId, at = Date.now()) {
  const st = q.get('SELECT * FROM pet_state WHERE pet_id = ?', petId);
  if (!st) return st;
  const hours = Math.max(0, (at - new Date(st.updated_at).getTime()) / HOUR);
  if (hours < 0.02) return st;

  const satiety = clamp(st.satiety - DECAY.satiety * hours);
  const clean = clamp(st.clean - DECAY.clean * hours);
  const energy = clamp(st.energy - DECAY.energy * hours);
  let mood = clamp(st.mood - DECAY.mood * hours);
  let health = st.health;

  // 饿太久、太脏会掉健康
  if (satiety < 20) health = clamp(health - 1.2 * hours);
  if (clean < 20) health = clamp(health - 0.8 * hours);
  // 健康低会拖累心情
  if (health < 40) mood = clamp(mood - 0.5 * hours);

  q.run('UPDATE pet_state SET satiety=?, clean=?, mood=?, energy=?, health=?, updated_at=? WHERE pet_id=?',
    satiety, clean, mood, energy, health, new Date(at).toISOString(), petId);

  if (satiety < 15 && st.satiety >= 15) pushEvent(petId, 'hungry', '肚子饿了，一直在碗边转');
  if (health < 45 && st.health >= 45) pushEvent(petId, 'sick', '看起来不太舒服');
  return q.get('SELECT * FROM pet_state WHERE pet_id = ?', petId);
}

function stageFor(level) {
  let s = STAGES[0];
  for (const x of STAGES) if (level >= x.minLevel) s = x;
  return s;
}

function grantItem(childId, item, qty) {
  q.run(`INSERT INTO inventory(child_id, item_key, qty) VALUES(?,?,?)
         ON CONFLICT(child_id,item_key) DO UPDATE SET qty = qty + excluded.qty`,
    childId, item, qty);
}

function takeItem(childId, item, qty) {
  const row = q.get('SELECT qty FROM inventory WHERE child_id=? AND item_key=?', childId, item);
  if (!row || row.qty < qty) return false;
  q.run('UPDATE inventory SET qty = qty - ? WHERE child_id=? AND item_key=?', qty, childId, item);
  return true;
}

/** 升级：返回升级信息，供前端播放庆祝动画 */
function addExp(pet, exp) {
  let { level, exp: e } = pet;
  e += exp;
  const need = (lv) => 30 + lv * 20;
  let ups = 0;
  while (e >= need(level) && level < 60) { e -= need(level); level++; ups++; }
  q.run('UPDATE pet SET level=?, exp=? WHERE id=?', level, e, pet.id);
  for (const mark of [3, 6, 10, 15, 21]) {
    if (pet.level < mark && level >= mark) {
      addMilestone(pet.child_id, 'level', `一起到 Lv.${mark}`, '每一天都算数');
    }
  }
  const stage = stageFor(level);
  if (stage.key !== pet.stage) {
    q.run('UPDATE pet SET stage=? WHERE id=?', stage.key, pet.id);
    pushEvent(pet.id, 'stage', `长大了，现在是${stage.name}`);
    addMilestone(pet.child_id, 'stage', `它长成${stage.name}了`, '从第一次见面到现在');
  }
  return { level, exp: e, need: need(level), ups, leveledUp: ups > 0 };
}

export function applyAction(childId, actionKey) {
  const act = ACTIONS[actionKey];
  if (!act) throw new Error('未知互动: ' + actionKey);

  return tx(() => {
    const pet = ensurePet(childId);
    decayToNow(pet.id);

    if (act.cost && !takeItem(childId, act.cost.item, act.cost.qty)) {
      return { ok: false, reason: 'NO_ITEM', need: act.cost.item, action: actionKey };
    }

    const st = q.get('SELECT * FROM pet_state WHERE pet_id = ?', pet.id);
    const next = {
      satiety: clamp(st.satiety + (act.gain.satiety ?? 0)),
      clean: clamp(st.clean + (act.gain.clean ?? 0)),
      mood: clamp(st.mood + (act.gain.mood ?? 0)),
      energy: clamp(st.energy + (act.gain.energy ?? 0)),
      health: clamp(st.health + (act.gain.health ?? 0)),
    };
    q.run('UPDATE pet_state SET satiety=?, clean=?, mood=?, energy=?, health=?, updated_at=? WHERE pet_id=?',
      next.satiety, next.clean, next.mood, next.energy, next.health, now(), pet.id);

    const bond = Math.min(200, pet.bond + (act.bond ?? 0));
    q.run('UPDATE pet SET bond = ? WHERE id = ?', bond, pet.id);

    const fresh = q.get('SELECT * FROM pet WHERE id = ?', pet.id);
    const lvl = addExp(fresh, act.exp ?? 1);

    pushEvent(pet.id, 'action', `${act.label}：${act.text}`);
    maybeUnlockScenes(childId, lvl.level);

    return {
      ok: true, action: actionKey, text: act.text, emoji: act.emoji,
      state: next, bond, ...lvl, stage: stageFor(lvl.level),
    };
  });
}

export function maybeUnlockScenes(childId, level) {
  const owned = new Set(q.all('SELECT scene_key FROM scene_unlock WHERE child_id=?', childId).map(r => r.scene_key));
  const unlocked = [];
  for (const s of SCENES) {
    if (!owned.has(s.key) && level >= s.unlockLevel) {
      q.run('INSERT OR IGNORE INTO scene_unlock(child_id, scene_key, unlocked_at) VALUES(?,?,?)',
        childId, s.key, now());
      unlocked.push(s);
      if (s.key !== 'home') {
        addMilestone(childId, 'scene', `解锁了${s.name}`, s.desc);
      }
    }
  }
  return unlocked;
}

/** 学习完成奖励：粮食 + 经验，是「学习 → 宠物」的唯一桥梁 */
export function rewardStudy(childId, { slot, mode, correct }) {
  return tx(() => {
    const pet = ensurePet(childId);
    const dedupe = `${childId}:${now().slice(0, 10)}:${slot}`;
    const exists = q.get('SELECT 1 AS x FROM reward_log WHERE dedupe_key = ?', dedupe);
    const gifts = [];
    if (!exists) {
      const food = mode === 'verification' ? 2 : 1;
      q.run('INSERT INTO reward_log(id, child_id, date, slot, item_key, qty, dedupe_key, created_at) VALUES(?,?,?,?,?,?,?,?)',
        uid(), childId, now().slice(0, 10), slot, 'food', food, dedupe, now());
      grantItem(childId, 'food', food);
      if (correct >= 3) grantItem(childId, 'water', 1);
      gifts.push({ item: 'food', qty: food });
      if (correct >= 3) gifts.push({ item: 'water', qty: 1 });
      pushEvent(pet.id, 'learn', `陪你学完了，得到 ${food} 份粮食`);
    }
    const gained = mode === 'verification' ? 12 : 6;
    const fresh = q.get('SELECT * FROM pet WHERE id = ?', pet.id);
    const lvl = addExp(fresh, gained);
    maybeUnlockScenes(childId, lvl.level);
    return { gifts, exp: gained, ...lvl, alreadyRewarded: !!exists };
  });
}

/** 情绪语句：按最紧急的需求说一句话 */
export function moodOf(state) {
  const items = [
    { key: 'health', v: state.health, low: 45, text: '有点不舒服，想休息', face: 'sick' },
    { key: 'satiety', v: state.satiety, low: 30, text: '肚子咕咕叫…想吃东西', face: 'hungry' },
    { key: 'energy', v: state.energy, low: 30, text: '好困，眼皮在打架', face: 'sleepy' },
    { key: 'clean', v: state.clean, low: 35, text: '身上脏脏的，想洗澡', face: 'dirty' },
    { key: 'mood', v: state.mood, low: 40, text: '有点无聊，想和你玩', face: 'bored' },
  ];
  const urgent = items.find(i => i.v < i.low);
  if (urgent) return { text: urgent.text, face: urgent.face, urgent: urgent.key };
  return { text: '看到你就很开心', face: 'happy', urgent: null };
}

export function petSnapshot(childId) {
  const pet = ensurePet(childId);
  const st = decayToNow(pet.id);
  const stage = stageFor(pet.level);
  const need = 30 + pet.level * 20;
  const mood = moodOf(st);
  const scenes = q.all('SELECT scene_key FROM scene_unlock WHERE child_id=?', childId).map(r => r.scene_key);
  const inv = {};
  for (const r of q.all('SELECT item_key, qty FROM inventory WHERE child_id=?', childId)) inv[r.item_key] = r.qty;
  const wardrobe = q.all('SELECT item_key, equipped FROM wardrobe WHERE child_id=?', childId);
  const events = q.all('SELECT kind, detail, created_at FROM pet_event WHERE pet_id=? ORDER BY created_at DESC LIMIT 8', pet.id);
  const milestones = q.all('SELECT title, detail, created_at FROM milestone WHERE child_id=? ORDER BY created_at DESC LIMIT 12', childId);

  return {
    id: pet.id, name: pet.name, species: pet.species,
    level: pet.level, exp: pet.exp, need, bond: pet.bond,
    stage, stageName: stage.name, scale: stage.scale,
    state: {
      satiety: st.satiety, clean: st.clean, mood: st.mood,
      energy: st.energy, health: st.health,
    },
    mood,
    scenes: SCENES.map(s => ({ ...s, unlocked: scenes.includes(s.key) })),
    inventory: { food: inv.food ?? 0, water: inv.water ?? 0, medicine: inv.medicine ?? 0 },
    wardrobe,
    events, milestones,
    actions: Object.entries(ACTIONS).map(([k, a]) => ({
      key: k, label: a.label, emoji: a.emoji,
      cost: a.cost, disabled: a.cost ? (inv[a.cost.item] ?? 0) < a.cost.qty : false,
    })),
  };
}

export function addMilestone(childId, kind, title, detail) {
  q.run('INSERT INTO milestone(id, child_id, kind, title, detail, created_at) VALUES(?,?,?,?,?,?)',
    uid(), childId, kind, title, detail ?? null, now());
}
