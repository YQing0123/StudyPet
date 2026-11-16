import { db, q, tx } from './db.mjs';
import { ROOM_MAP, DEFAULT_ROOM_SCENE } from '../web/src/shared/roomCatalog.mjs';
db.exec(`CREATE TABLE IF NOT EXISTS pet_room_owned (child_id TEXT NOT NULL, item_key TEXT NOT NULL, acquired_at TEXT NOT NULL, PRIMARY KEY(child_id,item_key));
CREATE TABLE IF NOT EXISTS pet_room (child_id TEXT PRIMARY KEY, scene_key TEXT NOT NULL, placements TEXT NOT NULL DEFAULT '[]', revision INTEGER NOT NULL DEFAULT 0);`);
export function roomState(childId) {
  const row = q.get('SELECT * FROM pet_room WHERE child_id=?', childId);
  return { sceneKey: row?.scene_key || DEFAULT_ROOM_SCENE, placements: row ? JSON.parse(row.placements) : [], revision: row?.revision || 0,
    owned: [DEFAULT_ROOM_SCENE, ...q.all('SELECT item_key FROM pet_room_owned WHERE child_id=? ORDER BY acquired_at', childId).map(x => x.item_key)] };
}
export function ownsRoomItem(childId, key) { return key === DEFAULT_ROOM_SCENE || !!q.get('SELECT 1 FROM pet_room_owned WHERE child_id=? AND item_key=?', childId, key); }
export function acquireRoomItem(childId, key) { q.run('INSERT INTO pet_room_owned VALUES(?,?,?)', childId, key, new Date().toISOString()); }
export function roomInventory(childId) { return roomState(childId).owned.map(key => ({ ...ROOM_MAP[key], qty: 1 })); }
export function saveRoom(childId, { sceneKey, placements, revision } = {}) {
  return tx(() => {
    const current = roomState(childId);
    if (!Number.isInteger(revision) || revision !== current.revision) throw new Error('布置已在别处更新，请刷新后再试');
    if (sceneKey === undefined) sceneKey = current.sceneKey;
    if (!Object.hasOwn(ROOM_MAP, sceneKey) || ROOM_MAP[sceneKey].kind !== 'scene' || !ownsRoomItem(childId, sceneKey)) throw new Error('还没有这张场景图');
    if (placements === undefined) placements = current.placements;
    if (!Array.isArray(placements) || placements.length > 24) throw new Error('房间最多摆放24件家具');
    const keys = new Set();
    const clean = placements.map(p => {
      if (!p || !Object.hasOwn(ROOM_MAP, p.key) || ROOM_MAP[p.key].kind !== 'furniture' || !ownsRoomItem(childId, p.key)) throw new Error('只能摆放自己拥有的家具');
      if (keys.has(p.key)) throw new Error('同一件家具只能摆放一次'); keys.add(p.key);
      if (![p.x,p.y,p.rotation,p.scale].every(v => typeof v === 'number' && Number.isFinite(v)) || p.x < 6 || p.x > 94 || p.y < 38 || p.y > 92 || p.scale < .6 || p.scale > 1.5 || Math.abs(p.rotation) > 180 || !['back','front'].includes(p.layer)) throw new Error('家具位置或角度无效');
      return { key: p.key, x: p.x, y: p.y, rotation: p.rotation, scale: p.scale, layer: p.layer };
    });
    q.run(`INSERT INTO pet_room VALUES(?,?,?,1) ON CONFLICT(child_id) DO UPDATE SET scene_key=excluded.scene_key,placements=excluded.placements,revision=pet_room.revision+1`, childId, sceneKey, JSON.stringify(clean));
    return roomState(childId);
  });
}
export function useRoomItem(childId, key, equipped) {
  const current = roomState(childId);
  if (!ownsRoomItem(childId,key)) throw new Error('先去材料铺兑换吧');
  if (ROOM_MAP[key].kind === 'scene') return saveRoom(childId, { sceneKey: key, revision: current.revision });
  const placements = current.placements.filter(p => p.key !== key);
  if (equipped) placements.push(current.placements.find(p => p.key === key) || { key, x: 60, y: 70, rotation: 0, scale: 1, layer: 'back' });
  return saveRoom(childId, { placements, revision: current.revision });
}
