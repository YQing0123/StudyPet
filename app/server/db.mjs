import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// 验收服务可使用独立目录，避免 reset 脚本触碰家庭数据。
export const DATA_DIR = process.env.BANXUE_DATA_DIR || join(ROOT, 'data');
export const MEDIA_DIR = join(DATA_DIR, 'media');
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(MEDIA_DIR, { recursive: true });
mkdirSync(join(MEDIA_DIR, 'pdf'), { recursive: true });
mkdirSync(join(MEDIA_DIR, 'audio'), { recursive: true });
mkdirSync(join(MEDIA_DIR, 'image'), { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'banxue.db'));
// 开发 API 与静态预览可共用本地库；短暂写锁等待后重试。
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();

db.exec(`
CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS book (
  id TEXT PRIMARY KEY,
  series_id TEXT REFERENCES series(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  title TEXT NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0,
  fingerprint TEXT,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TEXT NOT NULL,
  UNIQUE(series_id, level, title)
);

CREATE TABLE IF NOT EXISTS page (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES book(id) ON DELETE CASCADE,
  index_no INTEGER NOT NULL,
  image_path TEXT,
  raw_text TEXT,
  UNIQUE(book_id, index_no)
);

CREATE TABLE IF NOT EXISTS sentence (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES page(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL,
  index_no INTEGER NOT NULL,
  text TEXT NOT NULL,
  audio_path TEXT,
  start_ms INTEGER, end_ms INTEGER,
  UNIQUE(page_id, index_no)
);

CREATE TABLE IF NOT EXISTS objective (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES book(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  skill TEXT NOT NULL,
  label TEXT NOT NULL,
  UNIQUE(book_id, key)
);

CREATE TABLE IF NOT EXISTS question (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES book(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  objective_id TEXT REFERENCES objective(id) ON DELETE SET NULL,
  sentence_id TEXT REFERENCES sentence(id) ON DELETE SET NULL,
  prompt TEXT NOT NULL,
  instruction TEXT,
  payload TEXT NOT NULL,
  answer TEXT NOT NULL,
  audio_path TEXT,
  difficulty INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'published',
  source TEXT,
  dedupe_key TEXT UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS child (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT, grade INTEGER, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS setting (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  UNIQUE(child_id, week_start)
);

CREATE TABLE IF NOT EXISTS plan_day (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plan(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  book_id TEXT REFERENCES book(id),
  page_from INTEGER, page_to INTEGER,
  target_minutes INTEGER DEFAULT 15,
  status TEXT NOT NULL DEFAULT 'open',
  UNIQUE(plan_id, date)
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  mode TEXT NOT NULL,
  book_id TEXT,
  page_from INTEGER, page_to INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS attempt (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  response TEXT,
  correct INTEGER NOT NULL DEFAULT 0,
  helped INTEGER NOT NULL DEFAULT 0,
  unrecognized INTEGER NOT NULL DEFAULT 0,
  elapsed_ms INTEGER,
  created_at TEXT NOT NULL
);

-- 艾宾浩斯复习卡
CREATE TABLE IF NOT EXISTS review_card (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  objective_id TEXT,
  level INTEGER NOT NULL DEFAULT 0,
  due_at TEXT NOT NULL,
  last_review_at TEXT,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'new',
  UNIQUE(child_id, question_id)
);

CREATE TABLE IF NOT EXISTS pet (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL UNIQUE REFERENCES child(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  species TEXT NOT NULL DEFAULT 'poodle',
  stage TEXT NOT NULL DEFAULT 'baby',
  level INTEGER NOT NULL DEFAULT 1,
  exp INTEGER NOT NULL DEFAULT 0,
  bond INTEGER NOT NULL DEFAULT 10,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pet_state (
  pet_id TEXT PRIMARY KEY REFERENCES pet(id) ON DELETE CASCADE,
  satiety INTEGER NOT NULL DEFAULT 70,
  clean INTEGER NOT NULL DEFAULT 80,
  mood INTEGER NOT NULL DEFAULT 75,
  energy INTEGER NOT NULL DEFAULT 85,
  health INTEGER NOT NULL DEFAULT 100,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pet_event (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES pet(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory (
  child_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (child_id, item_key)
);

CREATE TABLE IF NOT EXISTS wardrobe (
  child_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  equipped INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (child_id, item_key)
);

CREATE TABLE IF NOT EXISTS scene_unlock (
  child_id TEXT NOT NULL,
  scene_key TEXT NOT NULL,
  unlocked_at TEXT NOT NULL,
  PRIMARY KEY (child_id, scene_key)
);

CREATE TABLE IF NOT EXISTS milestone (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reward_log (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  date TEXT NOT NULL,
  slot TEXT NOT NULL,
  item_key TEXT NOT NULL,
  qty INTEGER NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

-- ===== MVP：每日计划 / 积分 / 材料 / 养成 =====
CREATE TABLE IF NOT EXISTS daily_task (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  date TEXT NOT NULL,
  title TEXT NOT NULL,
  subject TEXT,
  minutes INTEGER NOT NULL DEFAULT 15,
  points INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'open',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_daily_task_day ON daily_task(child_id, date, sort);

-- 积分账本：delta 正=获得，负=消费；dedupe_key 保证重放不重复发奖
CREATE TABLE IF NOT EXISTS point_ledger (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  date TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_point_day ON point_ledger(child_id, date);

CREATE TABLE IF NOT EXISTS material_inv (
  child_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (child_id, item_key)
);

-- 装扮为永久物品，首次穿戴奖励独立记录，脱下/恢复备份不会重领奖励。
CREATE TABLE IF NOT EXISTS material_wardrobe (
  child_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  first_worn_at TEXT,
  PRIMARY KEY (child_id, item_key)
);

-- 宠物生命状态：完全按逆向程序的四项需求 + 成长值重建
CREATE TABLE IF NOT EXISTS pet_life (
  pet_id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  name TEXT NOT NULL,
  breed TEXT NOT NULL,
  species TEXT NOT NULL,
  gender TEXT NOT NULL DEFAULT 'female',
  personality TEXT NOT NULL DEFAULT '粘人',
  stage INTEGER NOT NULL DEFAULT 1,
  hunger REAL NOT NULL DEFAULT 80,
  energy REAL NOT NULL DEFAULT 82,
  mood REAL NOT NULL DEFAULT 86,
  clean REAL NOT NULL DEFAULT 88,
  growth INTEGER NOT NULL DEFAULT 0,
  care_count INTEGER NOT NULL DEFAULT 0,
  outfit TEXT NOT NULL DEFAULT '{}',
  adopted_at TEXT NOT NULL,
  last_tick TEXT NOT NULL,
  last_care_at TEXT,
  last_care_kind TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pet_life_child ON pet_life(child_id);

CREATE TABLE IF NOT EXISTS pet_cooldown (
  pet_id TEXT NOT NULL REFERENCES pet_life(pet_id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  used_at TEXT NOT NULL,
  PRIMARY KEY (pet_id, action)
);

-- 家长可改的材料价格（不填则用内置价）
CREATE TABLE IF NOT EXISTS material_price (
  child_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  cost INTEGER NOT NULL,
  PRIMARY KEY (child_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_page_book ON page(book_id, index_no);CREATE INDEX IF NOT EXISTS idx_sentence_book ON sentence(book_id);
CREATE INDEX IF NOT EXISTS idx_question_book ON question(book_id, status);
CREATE INDEX IF NOT EXISTS idx_review_due ON review_card(child_id, due_at);
CREATE INDEX IF NOT EXISTS idx_attempt_session ON attempt(session_id);
CREATE INDEX IF NOT EXISTS idx_plan_day_plan ON plan_day(plan_id, date);
`);

// ---------- 便捷查询 ----------
export const q = {
  all: (sql, ...args) => db.prepare(sql).all(...args),
  get: (sql, ...args) => db.prepare(sql).get(...args),
  run: (sql, ...args) => db.prepare(sql).run(...args),
  exec: (sql) => db.exec(sql),
};

let txDepth = 0;
export function tx(fn) {
  // 支持嵌套：外层 BEGIN/COMMIT，内层 SAVEPOINT/RELEASE。
  // 没有这一层，finishSession 里再调 rewardStudy 会直接报
  // "cannot start a transaction within a transaction"，整段逻辑无法原子化。
  const outer = txDepth === 0;
  const sp = `sp_${txDepth}`;
  db.exec(outer ? 'BEGIN' : `SAVEPOINT ${sp}`);
  txDepth++;
  try {
    const r = fn();
    db.exec(outer ? 'COMMIT' : `RELEASE ${sp}`);
    return r;
  } catch (e) {
    if (outer) db.exec('ROLLBACK');
    else { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); }
    throw e;
  } finally {
    txDepth--;
  }
}

export function getSetting(key, fallback = null) {
  const row = q.get('SELECT value FROM setting WHERE key = ?', key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(key, value) {
  q.run('INSERT INTO setting(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    key, JSON.stringify(value));
}
