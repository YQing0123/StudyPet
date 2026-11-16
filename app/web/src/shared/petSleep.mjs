// Shared by browser and service: fixed Asia/Shanghai (UTC+8), independent of device timezone.
export const DEFAULT_SLEEP_SCHEDULE = Object.freeze({
  nightEnabled: false, nightStart: '21:30', nightEnd: '07:00',
  napEnabled: false, napStart: '13:00', napEnd: '14:00',
});
const DAY = 86400000, MINUTE = 60000, OFFSET = 8 * 3600000;
const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
export function validateSleepSchedule(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('作息设置格式不正确');
  const result = {};
  for (const key of Object.keys(DEFAULT_SLEEP_SCHEDULE)) {
    const value = input[key];
    if (key.endsWith('Enabled')) {
      if (typeof value !== 'boolean') throw Error('请选择是否开启夜间睡眠和午休');
    } else if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw Error('请选择有效的睡觉和起床时间');
    result[key] = value;
  }
  if (result.nightStart <= result.nightEnd) throw Error('夜间睡眠应从晚上持续到次日早上，起床时间不能与睡觉时间相同');
  if (result.napStart >= result.napEnd) throw Error('午休结束时间需要晚于开始时间');
  if (result.nightEnabled && result.napEnabled &&
    (result.napStart < result.nightEnd || result.napEnd > result.nightStart)) throw Error('午休不能与夜间睡眠重叠');
  return result;
}
export function sleepWindows(schedule, now = Date.now()) {
  const day = Math.floor((now + OFFSET) / DAY) * DAY - OFFSET;
  const windows = [];
  for (let offset = -1; offset <= 2; offset++) {
    for (const kind of ['night', 'nap']) {
      if (!schedule[`${kind}Enabled`]) continue;
      const start = day + offset * DAY + minutes(schedule[`${kind}Start`]) * MINUTE;
      const end = day + (offset + Number(kind === 'night')) * DAY + minutes(schedule[`${kind}End`]) * MINUTE;
      windows.push({ id: `${kind}:${start}`, kind, startsAt: start, endsAt: end });
    }
  }
  return windows.sort((a, b) => a.startsAt - b.startsAt);
}
export function sleepWindow(schedule, now = Date.now()) {
  return sleepWindows(schedule, now).find(w => w.startsAt <= now && now < w.endsAt) || null;
}
export function sleptMilliseconds(schedule, from, to) {
  // Needs settlement is capped at 12 hours by the caller.
  return sleepWindows(schedule, to).reduce((total, w) => total + Math.max(0, Math.min(to, w.endsAt) - Math.max(from, w.startsAt)), 0);
}
