import assert from 'node:assert/strict';
import { roomLighting, roomBackdropAssets } from '../web/src/shared/roomLighting.mjs';
import { ROOM_CATALOG } from '../web/src/shared/roomCatalog.mjs';

const at = text => Date.parse(text + '+08:00');
for (const [time, phase, next] of [
  ['2026-11-17T00:00:00', 'night', '2026-11-17T07:00:00'],
  ['2026-11-17T06:59:59.999', 'night', '2026-11-17T07:00:00'],
  ['2026-11-17T07:00:00', 'day', '2026-11-17T19:00:00'],
  ['2026-11-17T18:59:59.999', 'day', '2026-11-17T19:00:00'],
  ['2026-11-17T19:00:00', 'night', '2026-11-18T07:00:00'],
  ['2026-12-31T23:59:59.999', 'night', '2027-01-01T07:00:00'],
  ['2028-02-29T19:00:00', 'night', '2028-03-01T07:00:00'],
]) {
  assert.deepEqual(roomLighting(at(time)), { phase, nextChangeAt: at(next) });
}
const expected = roomLighting(at('2026-11-17T19:00:00'));
for (const tz of ['Asia/Shanghai', 'UTC', 'America/Los_Angeles', 'Europe/London']) {
  process.env.TZ = tz;
  assert.deepEqual(roomLighting(at('2026-11-17T19:00:00')), expected, tz);
}
for (const item of ROOM_CATALOG.filter(item => item.kind === 'scene')) {
  const pair = roomBackdropAssets(item.key);
  assert.ok(pair.day && pair.night && pair.day !== pair.night, item.key);
}
assert.deepEqual(roomBackdropAssets('unknown'), roomBackdropAssets());
assert.deepEqual(roomBackdropAssets('f_sofa'), roomBackdropAssets());
console.log('Room lighting: 07:00/19:00 boundaries, calendar rollover, 4 timezones, all scene pairs and safe fallback passed.');
