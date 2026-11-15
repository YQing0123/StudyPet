/**
 * 艾宾浩斯复习调度
 *
 * 采用经典遗忘曲线的日历阶梯：1 → 2 → 4 → 7 → 15 → 30 → 60 → 120 天。
 * 三个关键取舍（针对小学生）：
 *   1. 不做当天分钟级重复——孩子一天只来一次，分钟级复习没有执行场景。
 *   2. 只有「独立答对」才推进阶梯；有提示的答对不算掌握，只顺延一天。
 *   3. 答错回退两级而不是清零，避免一次失误把积累全抹掉，保护信心。
 */

import { q, now, uid } from './db.mjs';

/** 阶梯天数：索引 = 已连续独立答对的次数 */
export const LADDER_DAYS = [1, 2, 4, 7, 15, 30, 60, 120];

/** 每天的复习题量上限，防止一次涌出几十道把孩子吓退 */
export const DAILY_REVIEW_CAP = 12;

const DAY = 86400_000;

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function toDateKey(d = new Date()) {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

/** 难度校正：简单题间隔拉长，难题间隔压缩（difficulty 1=易, 5=难） */
function difficultyFactor(difficulty = 3) {
  return 1 + (3 - difficulty) * 0.1;      // 1→1.2  3→1.0  5→0.8
}

/** 计算某 level 的下次间隔（天，至少 1） */
export function intervalFor(level, difficulty = 3) {
  const base = LADDER_DAYS[Math.min(level, LADDER_DAYS.length - 1)];
  return Math.max(1, Math.round(base * difficultyFactor(difficulty)));
}

/** 掌握度 0–100，用于家长端展示与宠物成长进度 */
export function masteryOf(level) {
  const table = [0, 20, 35, 50, 65, 78, 88, 95, 100];
  return table[Math.min(level, table.length - 1)];
}

/**
 * 判分后推进一张卡。
 * @param {object} card  现有卡（可为 null 表示新卡）
 * @param {object} result { correct, helped, unrecognized, difficulty }
 * @returns {object} 新的卡字段
 */
export function advance(card, result, at = new Date()) {
  const { correct, helped = false, unrecognized = false, difficulty = 3 } = result;
  const base = card ?? { level: 0, reps: 0, lapses: 0, state: 'new' };

  // 未识别（录音没听清、超时）不计成败，只安排次日再来
  if (unrecognized) {
    return {
      ...base,
      due_at: addDays(at, 1).toISOString(),
      last_review_at: at.toISOString(),
      state: 'reviewing',
    };
  }

  if (!correct) {
    const level = Math.max(0, base.level - 2);
    return {
      ...base,
      level,
      reps: base.reps + 1,
      lapses: base.lapses + 1,
      due_at: addDays(at, 1).toISOString(),
      last_review_at: at.toISOString(),
      state: 'relearning',
    };
  }

  if (helped) {
    // 有提示的答对：不推进阶梯，明天再独立验证一次
    return {
      ...base,
      reps: base.reps + 1,
      due_at: addDays(at, 1).toISOString(),
      last_review_at: at.toISOString(),
      state: 'reviewing',
    };
  }

  const level = Math.min(base.level + 1, LADDER_DAYS.length);
  const days = intervalFor(level, difficulty);
  return {
    ...base,
    level,
    reps: base.reps + 1,
    due_at: addDays(at, days).toISOString(),
    last_review_at: at.toISOString(),
    state: days >= 15 ? 'mastered' : 'reviewing',
  };
}

/** 把判分结果写回复习卡（存在则更新，不存在则创建） */
export function upsertCard(childId, questionId, objectiveId, result, at = new Date()) {
  const existing = q.get(
    'SELECT * FROM review_card WHERE child_id = ? AND question_id = ?',
    childId, questionId);

  const next = advance(existing ?? null, result, at);

  if (existing) {
    q.run(`UPDATE review_card SET level=?, due_at=?, last_review_at=?, reps=?, lapses=?, state=?, objective_id=COALESCE(?, objective_id)
           WHERE id=?`,
      next.level, next.due_at, next.last_review_at, next.reps, next.lapses, next.state,
      objectiveId ?? null, existing.id);
    return { ...existing, ...next };
  }
  const id = uid();
  q.run(`INSERT INTO review_card(id, child_id, question_id, objective_id, level, due_at, last_review_at, reps, lapses, state)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
    id, childId, questionId, objectiveId ?? null,
    next.level, next.due_at, next.last_review_at, next.reps, next.lapses, next.state);
  return { id, child_id: childId, question_id: questionId, ...next };
}

/** 今日到期的复习卡，按「逾期越久越优先」排序 */
export function dueCards(childId, limit = DAILY_REVIEW_CAP, at = new Date()) {
  const cutoff = at.toISOString();
  return q.all(
    `SELECT rc.*, qq.prompt, qq.instruction, qq.type, qq.payload, qq.answer, qq.difficulty,
            qq.sentence_id, qq.book_id, qq.audio_path
       FROM review_card rc
       JOIN question qq ON qq.id = rc.question_id
      WHERE rc.child_id = ? AND rc.due_at <= ? AND qq.status = 'published'
      ORDER BY rc.due_at ASC, rc.level ASC
      LIMIT ?`,
    childId, cutoff, limit);
}

/** 未来 7 天的复习量预览，家长端用来判断负担 */
export function forecast(childId, days = 7, at = new Date()) {
  // 按「自然日」分桶，而不是滚动 24 小时窗口——
  // 否则 22:00 生成的卡会被算到前一天的预测里，家长看到的数字对不上。
  const counts = new Map();
  for (const r of q.all('SELECT due_at FROM review_card WHERE child_id = ?', childId)) {
    const key = toDateKey(new Date(r.due_at));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out = [];
  for (let i = 0; i < days; i++) {
    const key = toDateKey(addDays(at, i));
    out.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return out;
}

/** 掌握度分布，家长端观察用 */
export function masterySummary(childId) {
  const rows = q.all('SELECT level FROM review_card WHERE child_id = ?', childId);
  const buckets = { new: 0, learning: 0, reviewing: 0, mastered: 0 };
  let sum = 0;
  for (const r of rows) {
    const m = masteryOf(r.level);
    sum += m;
    if (r.level === 0) buckets.new++;
    else if (r.level <= 2) buckets.learning++;
    else if (r.level <= 4) buckets.reviewing++;
    else buckets.mastered++;
  }
  return {
    total: rows.length,
    avgMastery: rows.length ? Math.round(sum / rows.length) : 0,
    buckets,
  };
}
