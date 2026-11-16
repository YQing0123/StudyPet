import { randomInt } from 'node:crypto';
import { db, q, tx, uid } from './db.mjs';
import { ensureProgression } from './pet-progression.mjs';

export const TRAVEL_UNLOCK_LEVEL = 3;
export const TRAVEL_HOURS = [1, 2, 3, 5];

const destinations = [
  ['beijing', '北京', '华北', '天坛、胡同与长城', 116.4074, 39.9042,
    '城墙和胡同把旧时光收进了风里，我把天坛的蓝色带回来给你。', '冰糖葫芦', '景泰蓝书签', '天坛祈年殿徽章', '胡同宫灯'],
  ['shanghai', '上海', '华东', '外滩、豫园与海派街巷', 121.4737, 31.2304,
    '黄浦江的风吹过外滩，我沿着老街收下了一枚亮闪闪的城市印记。', '生煎包', '海派盘结挂饰', '东方明珠徽章', '外滩夜航灯'],
  ['guangzhou', '广州', '华南', '骑楼、粤剧与珠江夜色', 113.2644, 23.1291,
    '骑楼下飘来早茶香，珠江边的晚风把广州塔照得很温柔。', '双皮奶', '广彩瓷片', '木棉花徽章', '珠江花船灯'],
  ['chengdu', '成都', '西南', '川剧、茶馆与熊猫', 104.0665, 30.5728,
    '茶馆里听了一段川剧，锦江边的竹影把脚步也放慢了。', '担担面', '蜀锦书签', '熊猫徽章', '川剧变脸面具'],
  ['chongqing', '重庆', '西南', '山城步道与两江夜景', 106.5516, 29.5630,
    '我顺着坡道看两江交汇，洪崖洞的灯火像一串挂在山城的星星。', '重庆小面', '荣昌折扇', '洪崖洞徽章', '两江夜航灯'],
  ['xian', '西安', '西北', '城墙、大雁塔与兵马俑', 108.9398, 34.3416,
    '绕着古城墙走了一圈，砖缝里藏着长安的故事。', '肉夹馍', '唐三彩小马', '古城墙徽章', '兵马俑将军俑'],
  ['hangzhou', '杭州', '华东', '西湖、龙井与江南园林', 120.1551, 30.2741,
    '湖面映着山影，龙井香从茶田一路飘到我的明信片上。', '片儿川', '龙井茶罐', '西湖山水徽章', '雷峰塔剪影灯'],
  ['suzhou', '苏州', '华东', '古典园林、平江路与苏绣', 120.5853, 31.2989,
    '园林窗格把春色一格格框好，平江路的水声陪我走了很久。', '苏式汤面', '苏绣团扇', '园林花窗徽章', '昆曲水袖摆件'],
  ['nanjing', '南京', '华东', '明城墙、秦淮河与梧桐', 118.7969, 32.0603,
    '梧桐叶落在明城墙上，秦淮河的灯把夜晚照得很温柔。', '盐水鸭', '南京云锦', '明城墙徽章', '秦淮灯彩'],
  ['wuhan', '武汉', '华中', '黄鹤楼、长江与东湖', 114.3054, 30.5931,
    '我在黄鹤楼上看长江转弯，东湖的风把云朵吹成了小船。', '热干面', '汉绣香囊', '黄鹤楼徽章', '长江灯影船'],
  ['changsha', '长沙', '华中', '湘江、橘子洲与岳麓山', 112.9388, 28.2282,
    '橘子洲头的江风很清爽，岳麓山的枫叶像给旅程盖了个章。', '糖油粑粑', '湘绣花纹挂坠', '橘子洲徽章', '湘江烟花盏'],
  ['harbin', '哈尔滨', '东北', '中央大街与冰雪大世界', 126.5349, 45.8038,
    '松花江边有点冷，冰雪大世界的灯却把夜空照得暖暖的。', '红肠面包', '木刻年画', '天鹅徽章', '冰灯玻璃摆件'],
  ['qingdao', '青岛', '华东', '海岸、红瓦老城与栈桥', 120.3826, 36.0671,
    '栈桥边的海鸥绕着海面飞，红瓦屋顶在阳光里像积木一样可爱。', '鲅鱼水饺', '贝雕挂坠', '海鸥徽章', '海湾大桥潮汐灯'],
  ['xiamen', '厦门', '华东', '鼓浪屿、骑楼与白鹭', 118.0894, 24.4798,
    '海风把鼓浪屿的琴声送到岸边，我也带回了一片蓝色海浪。', '花生汤', '漆线雕花瓶', '白鹭徽章', '鼓浪屿钢琴盒'],
  ['sanya', '三亚', '华南', '海湾、椰林与热带雨林', 109.5083, 18.2479,
    '椰林下的海水是亮亮的蓝色，我把一颗小太阳装进背包。', '椰子糕', '黎锦织片', '海湾海龟徽章', '珊瑚海琉璃球'],
  ['dunhuang', '敦煌', '西北', '莫高窟、鸣沙山与月牙泉', 94.6620, 40.1421,
    '月牙泉安静地躺在沙丘边，壁画里的飞天好像正向我招手。', '杏皮水', '敦煌藻井书签', '飞天徽章', '九色鹿琉璃摆件'],
  ['nanchang', '南昌', '华东', '滕王阁、赣江与八一起义纪念馆', 115.8582, 28.6829,
    '登上滕王阁看赣江向前流，落霞和江水一起映进了明信片。', '南昌拌粉', '赣绣团花', '滕王阁徽章', '海昏侯金色雁鱼灯'],
  ['dali', '大理', '西南', '洱海、苍山与白族街巷', 100.2676, 25.6065,
    '洱海边的云走得很慢，苍山把一路的风景都收进了怀里。', '喜洲粑粑', '白族扎染方巾', '苍山洱海徽章', '风花雪月银铃'],
  ['lijiang', '丽江', '西南', '古城、玉龙雪山与纳西文化', 100.2330, 26.8721,
    '古城流水穿过石桥，远处的玉龙雪山像一封雪白的回信。', '鸡豆凉粉', '东巴文字木牌', '玉龙雪山徽章', '纳西东巴经卷'],
  ['xishuangbanna', '西双版纳', '西南', '热带雨林、傣寨与澜沧江', 100.7979, 22.0017,
    '雨林里听见叶子滴答响，傣家竹楼旁的孔雀开屏啦。', '菠萝饭', '傣锦小挎包', '孔雀徽章', '傣银孔雀项圈'],
  ['urumqi', '乌鲁木齐—天山天池', '新疆', '乌鲁木齐大巴扎、阜康天山天池', 87.6168, 43.8256,
    '天池倒映着雪峰，山风把云推得像一群慢慢走的羊。', '薄皮包子', '艾德莱斯绸书签', '天山雪莲徽章', '天池雪莲琉璃盏'],
  ['turpan', '吐鲁番', '新疆', '火焰山、葡萄沟与交河故城', 89.1895, 42.9513,
    '葡萄沟的藤架投下清凉的影子，远处火焰山染成了橘红色。', '葡萄干馕', '坎儿井小陶壶', '交河故城徽章', '火焰山赤金石'],
  ['kashgar', '喀什古城', '新疆', '老城街巷、艾提尕尔清真寺与巴扎', 75.9898, 39.4704,
    '老城的门窗有漂亮的花纹，巴扎里飘来烤馕的香气。', '缸子肉', '土陶彩绘碗', '喀什古城徽章', '木卡姆乐器摆件'],
  ['yili', '伊犁·那拉提', '新疆', '草原、雪岭与河谷牧场', 84.0000, 43.1000,
    '草原一直铺到雪山脚下，我听见河谷的风在给小花唱歌。', '奶疙瘩', '哈萨克花纹挂坠', '那拉提草原徽章', '天山牧歌银铃'],
].map(([id, name, region, landmark, longitude, latitude, note, food, souvenir, badge, rare], spriteIndex) => {
  const collectible = (type, title, icon, description) => ({
    key: `${id}.${type}`, cityId: id, cityName: name, type, name: title, icon, description, spriteIndex,
  });
  const items = [
    collectible('food', food, ['🍜', '🥮', '🥟', '🍡'][spriteIndex % 4], `${name}的旅行食味，装进一份小小收藏。`),
    collectible('souvenir', souvenir, ['🧵', '🪭', '🍵', '🎐'][spriteIndex % 4], `带有${name}风物纹样的纪念小物。`),
    collectible('badge', badge, ['🏵️', '🪙', '🔖', '🌸'][spriteIndex % 4], `记录到访${name}的城市徽章。`),
    collectible('rare', rare, ['✨', '🏺', '🔮', '🧿'][spriteIndex % 4], `${name}旅途中偶然发现的稀有纪念物。`),
  ];
  return {
    id, name, region, landmark, longitude, latitude, note, spriteIndex,
    collectibles: items.map(item => item.key),
    postcard: { key: `${id}.postcard`, cityId: id, cityName: name, type: 'postcard', name: `${name}·初见明信片`, icon: '💌', description: landmark, note, spriteIndex },
    postcardVariants: [
      { key: `${id}.postcard.2`, cityId: id, cityName: name, type: 'postcard', name: `${name}·漫游明信片`, icon: '💌', description: landmark, note, spriteIndex, artVariant: 2 },
      { key: `${id}.postcard.3`, cityId: id, cityName: name, type: 'postcard', name: `${name}·暮色明信片`, icon: '💌', description: landmark, note, spriteIndex, artVariant: 3 },
    ],
    items,
  };
});

const CITY_BY_ID = new Map(destinations.map(city => [city.id, city]));
const COLLECTION = destinations.flatMap(city => [city.postcard, ...city.postcardVariants, ...city.items]);
const COLLECTION_BY_KEY = new Map(COLLECTION.map(item => [item.key, item]));
const COLLECTION_WEIGHTS = { food: .45, souvenir: .35, badge: .20 };
const COLLECTIBLE_CHANCE = .20;
const RARE_BASE_CHANCE = .10;
const RARE_GUARANTEE_EVERY = 5;
const FOOD_ITEMS = ['kibble', 'fish', 'milk'];
const MATERIAL_ITEMS = ['ball', 'feather', 'brush', 'bath'];
const ALL_TRAVEL_MATERIALS = [...FOOD_ITEMS, ...MATERIAL_ITEMS];

db.exec(`
CREATE TABLE IF NOT EXISTS pet_travel_trip (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  pet_id TEXT NOT NULL,
  start_city_id TEXT NOT NULL,
  itinerary_json TEXT NOT NULL,
  duration_hours INTEGER NOT NULL,
  reward_seed INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  returns_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'traveling',
  returned_at TEXT,
  claimed_at TEXT,
  early_return INTEGER NOT NULL DEFAULT 0,
  outcome_json TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_travel_per_child
  ON pet_travel_trip(child_id) WHERE status='traveling';
CREATE INDEX IF NOT EXISTS idx_travel_history ON pet_travel_trip(child_id, returned_at DESC);
CREATE TABLE IF NOT EXISTS pet_travel_collection (
  child_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  first_trip_id TEXT NOT NULL,
  first_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  PRIMARY KEY(child_id, item_key)
);
`);
// Earlier releases delivered rewards on return. Only awaiting_claim trips can
// deliver rewards now, so old trips remain safe when the schema is upgraded.
if (!q.all('PRAGMA table_info(pet_travel_trip)').some(column => column.name === 'claimed_at')) {
  db.exec('ALTER TABLE pet_travel_trip ADD COLUMN claimed_at TEXT');
}
q.run("UPDATE pet_travel_trip SET claimed_at=returned_at WHERE status='returned' AND claimed_at IS NULL");

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const iso = ms => new Date(ms).toISOString();
const chinaDate = ms => new Date(ms + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
const oneActive = childId => q.get("SELECT * FROM pet_travel_trip WHERE child_id=? AND status='traveling'", childId);

function routeFrom(start, count) {
  const route = [start];
  const pool = destinations.filter(city => city.id !== start.id);
  while (route.length < count && pool.length) {
    const from = route.at(-1);
    let nearestIndex = 0, nearestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pool.length; i++) {
      const city = pool[i];
      const dx = (city.longitude - from.longitude) * Math.cos((city.latitude + from.latitude) * Math.PI / 360);
      const dy = city.latitude - from.latitude;
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) { nearestIndex = i; nearestDistance = distance; }
    }
    route.push(pool.splice(nearestIndex, 1)[0]);
  }
  return route;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addCollection(childId, tripId, itemKey, qty, at) {
  if (!COLLECTION_BY_KEY.has(itemKey) || qty < 1) return;
  q.run(`INSERT INTO pet_travel_collection(child_id,item_key,qty,first_trip_id,first_at,last_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(child_id,item_key) DO UPDATE SET
    qty=qty+excluded.qty,last_at=excluded.last_at`, childId, itemKey, qty, tripId, at, at);
}

function addMaterial(childId, key, qty) {
  if (!ALL_TRAVEL_MATERIALS.includes(key) || qty < 1) return;
  q.run(`INSERT INTO material_inv(child_id,item_key,qty) VALUES(?,?,?)
    ON CONFLICT(child_id,item_key) DO UPDATE SET qty=qty+excluded.qty`, childId, key, qty);
}

// Outcomes are the durable record of a completed draw. Deriving the streak from
// both pending and claimed trips also upgrades old histories without redrawing
// their rewards or counting a repeated read/claim as another trip.
function rarePity(childId) {
  const history = q.all(`SELECT early_return,outcome_json FROM pet_travel_trip
    WHERE child_id=? AND status IN ('awaiting_claim','returned')
    ORDER BY COALESCE(returned_at,returns_at) DESC,rowid DESC`, childId);
  let completedWithoutRare = 0;
  for (const trip of history) {
    let outcome;
    try { outcome = trip.outcome_json ? JSON.parse(trip.outcome_json) : null; } catch {}
    if (trip.early_return || outcome?.early) continue;
    const drops = Array.isArray(outcome?.collectionDrops) ? outcome.collectionDrops : [];
    if (drops.some(drop => Number(drop.qty) > 0 && COLLECTION_BY_KEY.get(drop.key)?.type === 'rare')) break;
    completedWithoutRare++;
  }
  return {
    baseChance: RARE_BASE_CHANCE,
    guaranteeEvery: RARE_GUARANTEE_EVERY,
    completedWithoutRare,
    tripsUntilGuaranteed: Math.max(1, RARE_GUARANTEE_EVERY - completedWithoutRare),
  };
}

function settle(trip, options = {}) {
  if (!trip || trip.status !== 'traveling') return trip;
  return tx(() => {
    const fresh = q.get('SELECT * FROM pet_travel_trip WHERE id=? AND child_id=?', trip.id, trip.child_id);
    return settleLocked(fresh, options);
  });
}

function settleLocked(trip, { early = false, at = Date.now() } = {}) {
  if (!trip || trip.status !== 'traveling') return trip;
  const returnsAt = Date.parse(trip.returns_at);
  if (!early && at < returnsAt) return trip;
  const beganAt = Date.parse(trip.started_at);
  const plannedMs = Math.max(1, returnsAt - beganAt);
  const elapsedRatio = early ? clamp((at - beganAt) / plannedMs, 0, 1) : 1;
  const itinerary = JSON.parse(trip.itinerary_json).map(cityId => CITY_BY_ID.get(cityId)).filter(Boolean);
  const completeStops = early ? Math.min(itinerary.length, Math.floor(elapsedRatio * itinerary.length)) : itinerary.length;
  const visited = itinerary.slice(0, completeStops);
  const postcardStops = visited.length ? visited : itinerary.slice(0, 1);
  const random = seededRandom(trip.reward_seed);
  const collectionDrops = [];
  const collect = (key, qty = 1) => {
    const found = collectionDrops.find(row => row.key === key);
    if (found) found.qty += qty;
    else collectionDrops.push({ key, qty });
  };
  for (const city of postcardStops) {
    const cards = [city.postcard, ...city.postcardVariants];
    const unseen = cards.filter(card => !q.get('SELECT 1 FROM pet_travel_collection WHERE child_id=? AND item_key=?', trip.child_id, card.key));
    const choices = unseen.length ? unseen : cards;
    collect(choices[Math.floor(random() * choices.length)].key);
  }

  const durationHours = trip.duration_hours;
  // 立即反复出发/回家不能凭空刷补给，未满十五分钟只带回明信片。
  const eligible = !early || at - beganAt >= 15 * 60 * 1000;
  const rewardScale = early ? elapsedRatio : 1;
  const coins = eligible ? Math.max(1, Math.floor(durationHours * 8 * rewardScale)) : 0;
  const foodQty = eligible ? Math.max(1, Math.floor(durationHours * .8 * rewardScale)) : 0;
  const materialQty = eligible ? Math.max(1, Math.floor(durationHours * 1.2 * rewardScale)) : 0;
  const premiumChance = Math.min(.78, .14 + durationHours * .11);
  const foodDrops = Array.from({ length: foodQty }, () => random() < premiumChance ? (random() < .6 ? 'fish' : 'milk') : 'kibble');
  const materialDrops = Array.from({ length: materialQty }, () => random() < premiumChance ? (random() < .5 ? 'feather' : 'bath') : (random() < .5 ? 'ball' : 'brush'));
  const collectibleChance = early ? 0 : COLLECTIBLE_CHANCE;
  const dropRates = { collectible: collectibleChance, ...COLLECTION_WEIGHTS, rare: early ? 0 : RARE_BASE_CHANCE };

  for (const city of visited) {
    if (random() >= collectibleChance) continue;
    const draw = random();
    let edge = 0;
    const type = Object.entries(COLLECTION_WEIGHTS).find(([, weight]) => {
      edge += weight;
      return draw < edge;
    })?.[0] || 'food';
    const item = city.items.find(entry => entry.type === type);
    if (item) collect(item.key);
  }

  const rareReward = {
    baseChance: RARE_BASE_CHANCE,
    guaranteed: !early && rarePity(trip.child_id).completedWithoutRare >= RARE_GUARANTEE_EVERY - 1,
    received: false,
  };
  if (!early) {
    // A separate seeded stream keeps the one rare draw independent of duration,
    // route length and the number of food/material draws earlier in the outcome.
    const rareRandom = seededRandom(trip.reward_seed ^ 0x72617265);
    const chanceHit = rareRandom() < RARE_BASE_CHANCE;
    if (rareReward.guaranteed || chanceHit) {
      const localRares = visited.flatMap(city => city.items.filter(item => item.type === 'rare'));
      const unseen = localRares.filter(item => !q.get('SELECT 1 FROM pet_travel_collection WHERE child_id=? AND item_key=? AND qty>0', trip.child_id, item.key));
      const choices = unseen.length ? unseen : localRares;
      if (choices.length) {
        collect(choices[Math.floor(rareRandom() * choices.length)].key);
        rareReward.received = true;
      }
    }
  }

  const returnedAt = iso(at);
  const outcome = {
    early,
    progress: Math.round(elapsedRatio * 100),
    destinations: postcardStops.map(city => city.id),
    collectionDrops,
    foodDrops: Object.entries(foodDrops.reduce((counts, key) => ({ ...counts, [key]: (counts[key] || 0) + 1 }), {})).map(([key, qty]) => ({ key, qty })),
    materialDrops: Object.entries(materialDrops.reduce((counts, key) => ({ ...counts, [key]: (counts[key] || 0) + 1 }), {})).map(([key, qty]) => ({ key, qty })),
    coins,
    dropRates,
    rareReward,
  };

  q.run(`UPDATE pet_travel_trip SET status='awaiting_claim',returned_at=?,early_return=?,outcome_json=? WHERE id=? AND status='traveling'`,
    returnedAt, Number(early), JSON.stringify(outcome), trip.id);
  return q.get('SELECT * FROM pet_travel_trip WHERE id=?', trip.id);
}

function settleDue(childId, at = Date.now()) {
  const trip = oneActive(childId);
  if (trip && Date.parse(trip.returns_at) <= at) settle(trip, { at });
}

function tripView(row, now = Date.now()) {
  if (!row) return null;
  const itinerary = JSON.parse(row.itinerary_json).map(cityId => CITY_BY_ID.get(cityId)).filter(Boolean);
  const start = Date.parse(row.started_at), end = Date.parse(row.returns_at);
  const active = row.status === 'traveling';
  const outcome = row.outcome_json ? JSON.parse(row.outcome_json) : null;
  return {
    id: row.id,
    cityId: row.start_city_id,
    cityName: CITY_BY_ID.get(row.start_city_id)?.name || '',
    itinerary: itinerary.map(city => ({ id: city.id, name: city.name, region: city.region, landmark: city.landmark, note: city.note, spriteIndex: city.spriteIndex })),
    durationHours: row.duration_hours,
    startedAt: row.started_at,
    returnsAt: row.returns_at,
    returnedAt: row.returned_at,
    claimedAt: row.claimed_at || null,
    awaitingClaim: row.status === 'awaiting_claim',
    active,
    earlyReturn: !!row.early_return,
    progress: active ? clamp((now - start) / Math.max(1, end - start), 0, 1) : outcome?.progress != null ? outcome.progress / 100 : 1,
    remainingMs: active ? Math.max(0, end - now) : 0,
    outcome,
  };
}

export function travelState(childId, at = Date.now()) {
  settleDue(childId, at);
  const pet = ensureProgression(q.get('SELECT * FROM pet_life WHERE child_id=? ORDER BY created_at LIMIT 1', childId));
  const active = oneActive(childId);
  const history = q.all("SELECT * FROM pet_travel_trip WHERE child_id=? AND status IN ('returned','awaiting_claim') ORDER BY returned_at DESC LIMIT 12", childId);
  const pending = q.get("SELECT * FROM pet_travel_trip WHERE child_id=? AND status='awaiting_claim' ORDER BY returned_at LIMIT 1", childId);
  const collectionRows = q.all('SELECT item_key,qty,first_trip_id,first_at,last_at FROM pet_travel_collection WHERE child_id=?', childId);
  const collection = collectionRows.map(row => ({ ...COLLECTION_BY_KEY.get(row.item_key), qty: row.qty, firstTripId: row.first_trip_id, firstAt: row.first_at, lastAt: row.last_at })).filter(item => item.key);
  return {
    unlocked: !!pet && pet.confirmed_level >= TRAVEL_UNLOCK_LEVEL,
    unlockLevel: TRAVEL_UNLOCK_LEVEL,
    activeTrip: tripView(active, at),
    pendingTrip: tripView(pending, at),
    lastTrip: history[0] ? tripView(history[0], at) : null,
    history: history.map(row => tripView(row, at)),
    cities: destinations.map(({ id, name, region, landmark, longitude, latitude, note, spriteIndex, collectibles }) => ({ id, name, region, landmark, longitude, latitude, note, spriteIndex, collectibles })),
    catalog: COLLECTION,
    collection,
    rarePity: rarePity(childId),
  };
}

export function isTravelling(childId) {
  settleDue(childId);
  return !!oneActive(childId);
}

export function assertPetAtHome(childId) {
  if (isTravelling(childId)) {
    const error = new Error('小伙伴还在旅行，回家后才能照顾它。');
    error.status = 409;
    throw error;
  }
}

export function startTrip(childId, { cityId = null, durationHours } = {}) {
  const duration = Number(durationHours);
  if (!TRAVEL_HOURS.includes(duration)) throw new Error('旅行时长请选择 1、2、3 或 5 小时');
  const pet = ensureProgression(q.get('SELECT * FROM pet_life WHERE child_id=? ORDER BY created_at LIMIT 1', childId));
  if (!pet) throw new Error('先领养一位小伙伴，再一起出发吧');
  if (pet.confirmed_level < TRAVEL_UNLOCK_LEVEL) {
    const error = new Error('小伙伴达到少年阶段后，旅行地图才会开放');
    error.status = 409;
    throw error;
  }
  settleDue(childId);
  if (oneActive(childId)) {
    const error = new Error('小伙伴还在旅行中，等回家后再规划下一趟吧');
    error.status = 409;
    throw error;
  }
  const start = cityId ? CITY_BY_ID.get(String(cityId)) : destinations[randomInt(destinations.length)];
  if (q.get("SELECT 1 FROM pet_travel_trip WHERE child_id=? AND status='awaiting_claim'", childId)) {
    const error = new Error('先查收上趟旅行的明信片和行囊，再出发吧');
    error.status = 409;
    throw error;
  }
  if (!start) throw new Error('请选择旅行地图中的城市');
  const cityCount = Math.min(duration + 1, destinations.length);
  const itinerary = routeFrom(start, cityCount).map(city => city.id);
  const startedAt = Date.now();
  const id = uid();
  tx(() => {
    q.run(`INSERT INTO pet_travel_trip(id,child_id,pet_id,start_city_id,itinerary_json,duration_hours,reward_seed,started_at,returns_at)
      VALUES(?,?,?,?,?,?,?,?,?)`, id, childId, pet.pet_id, start.id, JSON.stringify(itinerary), duration,
      randomInt(1, 0x7fffffff), iso(startedAt), iso(startedAt + duration * 60 * 60 * 1000));
  });
  return travelState(childId);
}

export function returnTrip(childId, tripId, at = Date.now()) {
  const trip = oneActive(childId);
  if (!trip || trip.id !== tripId) throw new Error('这趟旅行已经结束或不属于当前小伙伴');
  settle(trip, { early: Date.parse(trip.returns_at) > at, at });
  return travelState(childId, at);
}

export function claimTrip(childId, tripId, at = Date.now()) {
  settleDue(childId, at);
  tx(() => {
    const trip = q.get('SELECT * FROM pet_travel_trip WHERE id=? AND child_id=?', tripId, childId);
    if (!trip) {
      const error = new Error('找不到这趟旅行的行囊');
      error.status = 404;
      throw error;
    }
    if (trip.status === 'returned') return; // Safe to retry after a lost response.
    if (trip.status !== 'awaiting_claim' || !trip.outcome_json) {
      const error = new Error('小伙伴还在旅途中，回家后才能查收');
      error.status = 409;
      throw error;
    }
    const outcome = JSON.parse(trip.outcome_json);
    const claimedAt = iso(at);
    for (const drop of outcome.collectionDrops) addCollection(childId, tripId, drop.key, drop.qty, claimedAt);
    for (const drop of [...outcome.foodDrops, ...outcome.materialDrops]) addMaterial(childId, drop.key, drop.qty);
    if (outcome.coins > 0) q.run(`INSERT INTO point_ledger(id,child_id,date,delta,reason,dedupe_key,created_at)
      VALUES(?,?,?,?,?,?,?)`, uid(), childId, chinaDate(at), outcome.coins,
      `旅行星贝：${CITY_BY_ID.get(trip.start_city_id)?.name || '全国旅行'}`, `travel:${tripId}:coins`, claimedAt);
    q.run("UPDATE pet_travel_trip SET status='returned',claimed_at=? WHERE id=? AND status='awaiting_claim'", claimedAt, tripId);
  });
  return travelState(childId, at);
}
