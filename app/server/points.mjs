import { db, q, uid, tx, now } from './db.mjs';
import { toDateKey } from './daily.mjs';

db.exec(`
CREATE TABLE IF NOT EXISTS penalty_item (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  title TEXT NOT NULL,
  points INTEGER NOT NULL CHECK(points BETWEEN 1 AND 9999),
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_penalty_child ON penalty_item(child_id, created_at);
CREATE INDEX IF NOT EXISTS idx_points_history ON point_ledger(child_id, created_at DESC, id DESC);
`);

const serialize = r => ({ id: r.id, title: r.title, points: r.points, note: r.note, active: !!r.active });
const entry = r => ({ id: r.id, date: r.date, delta: r.delta, reason: r.reason, createdAt: r.created_at,
  kind: r.dedupe_key.startsWith('penalty:') ? 'penalty' : r.delta > 0 ? 'income' : r.delta < 0 ? 'expense' : 'neutral' });
function text(value, max, label, required = false) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw Error(`${label}${required ? `需为 1–${max} 个字` : `不能超过 ${max} 个字`}`);
  return value.trim();
}

export function listPenalties(childId) {
  return q.all('SELECT * FROM penalty_item WHERE child_id=? ORDER BY created_at, id', childId).map(serialize);
}

export function savePenalty(childId, body = {}) {
  const title = text(body.title, 40, '惩罚名称', true);
  const note = text(body.note ?? '', 160, '说明');
  if (!Number.isInteger(body.points) || body.points < 1 || body.points > 9999) throw Error('扣分需为 1–9999 的整数');
  if (body.active !== undefined && typeof body.active !== 'boolean') throw Error('请选择是否启用');
  if (body.id !== undefined) {
    if (!q.get('SELECT id FROM penalty_item WHERE id=? AND child_id=?', body.id, childId)) throw Error('找不到这个惩罚项目');
    q.run('UPDATE penalty_item SET title=?, points=?, note=?, active=? WHERE id=? AND child_id=?', title, body.points, note, body.active === false ? 0 : 1, body.id, childId);
  } else {
    q.run('INSERT INTO penalty_item(id,child_id,title,points,note,active,created_at) VALUES(?,?,?,?,?,?,?)', uid(), childId, title, body.points, note, body.active === false ? 0 : 1, now());
  }
  return listPenalties(childId);
}

export function deletePenalty(childId, id) {
  q.run('DELETE FROM penalty_item WHERE id=? AND child_id=?', id, childId);
  return listPenalties(childId);
}

export function applyPenalty(childId, id, body = {}) {
  if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(body.requestId)) throw Error('缺少有效的扣分请求标识，请刷新后再试');
  return tx(() => {
    const key = `penalty:${childId}:${id}:${body.requestId}`;
    const previous = q.get('SELECT * FROM point_ledger WHERE child_id=? AND dedupe_key=?', childId, key);
    if (previous) return { entry: entry(previous), repeated: true };
    const item = q.get('SELECT * FROM penalty_item WHERE id=? AND child_id=? AND active=1', id, childId);
    if (!item) throw Error('这个惩罚项目已停用或删除');
    const ledgerId = uid();
    // The configured deduction is always recorded in full, including at zero balance.
    // The ledger reason is a snapshot and survives editing/deleting the shortcut.
    q.run('INSERT INTO point_ledger(id,child_id,date,delta,reason,dedupe_key,created_at) VALUES(?,?,?,?,?,?,?)',
      ledgerId, childId, toDateKey(), -item.points, `家长惩罚：${item.title}${item.note ? ` · ${item.note}` : ''}`, key, now());
    return { entry: entry(q.get('SELECT * FROM point_ledger WHERE id=?', ledgerId)), repeated: false };
  });
}

export function pointHistory(childId, { filter = 'all', before = '', limit = 30 } = {}) {
  if (!['all', 'income', 'expense'].includes(filter)) throw Error('无效的积分筛选');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('每页记录数需为 1–100');
  const where = ['child_id=?'], values = [childId];
  if (filter !== 'all') where.push(filter === 'income' ? 'delta>0' : 'delta<0');
  if (before) {
    let cursor;
    try { cursor = JSON.parse(Buffer.from(before, 'base64url').toString()); } catch { throw Error('无效的分页位置'); }
    if (!Array.isArray(cursor) || cursor.length !== 2 || cursor.some(v => typeof v !== 'string' || v.length > 100)) throw Error('无效的分页位置');
    where.push('(created_at < ? OR (created_at = ? AND id < ?))');
    values.push(cursor[0], cursor[0], cursor[1]);
  }
  return tx(() => {
    const summary = q.get(`SELECT COALESCE(SUM(delta),0) balance,
      COALESCE(SUM(CASE WHEN delta>0 THEN delta ELSE 0 END),0) earned,
      COALESCE(SUM(CASE WHEN delta<0 THEN -delta ELSE 0 END),0) spent
      FROM point_ledger WHERE child_id=?`, childId);
    const rows = q.all(`SELECT * FROM point_ledger WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`, ...values, limit + 1);
    const items = rows.slice(0, limit), last = items.at(-1);
    return { items: items.map(entry), summary, next: rows.length > limit ? Buffer.from(JSON.stringify([last.created_at, last.id])).toString('base64url') : null };
  });
}
