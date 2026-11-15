/**
 * 音频教材处理：探测、按静音切分、绑定到句子
 *
 * 真实教材音频通常是一整条朗读，需要切成「一句一条」才能出听力题和跟读。
 * 用 ffmpeg 的 silencedetect 找停顿，再按停顿中点切段。
 * 检测不到足够停顿（语速快、背景音乐）时退回「按句数均分」，不阻塞流程。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { uid, MEDIA_DIR, q } from './db.mjs';

const run = promisify(execFile);
const FF = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FP = process.env.FFPROBE_PATH ?? 'ffprobe';

const AUDIO_DIR = join(MEDIA_DIR, 'audio');

async function ffmpegOk() {
  try { await run(FF, ['-version'], { timeout: 8000 }); return true; } catch { return false; }
}
export async function ffmpegAvailable() { return ffmpegOk(); }

/** 时长（秒） */
export async function durationOf(path) {
  try {
    const { stdout } = await run(FP, [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path,
    ], { timeout: 20000 });
    const v = parseFloat(String(stdout).trim());
    return Number.isFinite(v) ? v : 0;
  } catch { return 0; }
}

/**
 * 静音检测
 * @returns {Promise<{start:number,end:number}[]>}
 */
export async function detectSilences(path, { noiseDb = -32, minSilence = 0.28 } = {}) {
  try {
    const { stderr } = await run(FF, [
      '-hide_banner', '-i', path,
      '-af', `silencedetect=noise=${noiseDb}dB:d=${minSilence}`,
      '-f', 'null', '-',
    ], { timeout: 120000 });
    const text = String(stderr);
    const starts = [...text.matchAll(/silence_start:\s*([0-9.]+)/g)].map((m) => parseFloat(m[1]));
    const ends = [...text.matchAll(/silence_end:\s*([0-9.]+)/g)].map((m) => parseFloat(m[1]));
    const out = [];
    for (let i = 0; i < starts.length; i++) {
      const s = starts[i];
      const e = ends[i] ?? starts[i] + minSilence;
      if (e > s) out.push({ start: s, end: e });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 由静音区间推出语音段
 * 每段从「上一处静音结束」到「下一处静音开始」，用中点切，避免吃掉字头字尾。
 */
export function segmentsFromSilences(duration, silences, { minLen = 0.35, pad = 0.06 } = {}) {
  if (!duration) return [];
  const cuts = [];
  for (const s of silences) {
    const mid = (s.start + s.end) / 2;
    if (mid > 0.15 && mid < duration - 0.15) cuts.push(mid);
  }
  const bounds = [0, ...cuts.sort((a, b) => a - b), duration];
  const segs = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = Math.max(0, bounds[i] - (i === 0 ? 0 : pad));
    const end = Math.min(duration, bounds[i + 1] + (i === bounds.length - 2 ? 0 : pad));
    if (end - start >= minLen) segs.push({ start: +start.toFixed(3), end: +end.toFixed(3) });
  }
  return segs;
}

/** 按句数均分（静音检测失效时的兜底） */
export function evenSegments(duration, n) {
  if (!n || !duration) return [];
  const step = duration / n;
  return Array.from({ length: n }, (_, i) => ({
    start: +(i * step).toFixed(3),
    end: +((i + 1) * step).toFixed(3),
  }));
}

/** 保存上传的原始音频，返回绝对路径与相对 URL */
export async function saveUpload(filename, buffer) {
  const ext = (extname(filename) || '.mp3').toLowerCase();
  const safe = `${uid()}${ext}`;
  const abs = join(AUDIO_DIR, safe);
  writeFileSync(abs, buffer);
  return { abs, url: `/media/audio/${safe}`, size: buffer.length };
}

/**
 * 分析一条音频：给出时长、静音、建议切分
 * @param {string} abs 绝对路径
 * @param {number} expected 期望句数（用于判断是否退回均分）
 */
export async function analyze(abs, expected = 0) {
  const duration = await durationOf(abs);
  const silences = await detectSilences(abs);
  let segments = segmentsFromSilences(duration, silences);
  let method = 'silence';

  // 静音切出来的段数与预期差太多，且预期明确时，退回均分
  if (expected > 0 && Math.abs(segments.length - expected) > Math.max(2, expected * 0.5)) {
    segments = evenSegments(duration, expected);
    method = 'even';
  }
  if (!segments.length) {
    segments = expected > 0 ? evenSegments(duration, expected) : [{ start: 0, end: duration }];
    method = expected > 0 ? 'even' : 'whole';
  }

  return {
    duration: +duration.toFixed(3),
    silenceCount: silences.length,
    method,
    segments: segments.map((s, i) => ({
      index: i,
      start: s.start,
      end: s.end,
      duration: +(s.end - s.start).toFixed(3),
    })),
  };
}

/** 按区间导出单段音频，返回 URL */
export async function slice(abs, start, end, { normalize = true } = {}) {
  const name = `${uid()}.mp3`;
  const outAbs = join(AUDIO_DIR, name);
  const filters = ['highpass=f=90'];
  if (normalize) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  await run(FF, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(start), '-to', String(end), '-i', abs,
    '-af', filters.join(','),
    '-ar', '22050', '-ac', '1', '-b:a', '64k',
    outAbs,
  ], { timeout: 60000 });
  return { abs: outAbs, url: `/media/audio/${name}`, size: statSync(outAbs).size };
}

/**
 * 把音频段绑定到指定页范围的句子
 * @param {object} opts { bookId, pageFrom, pageTo, sourcePath, segments }
 */
export async function bindToSentences({ bookId, pageFrom, pageTo, sourcePath, segments }) {
  const rows = q.all(
    `SELECT se.id, se.index_no, p.index_no AS page_no
       FROM sentence se JOIN page p ON p.id = se.page_id
      WHERE se.book_id = ? AND p.index_no BETWEEN ? AND ?
      ORDER BY p.index_no, se.index_no`,
    bookId, Number(pageFrom), Number(pageTo));

  if (!rows.length) throw new Error('该范围内没有句子');

  const n = Math.min(rows.length, segments.length);
  const bound = [];
  for (let i = 0; i < n; i++) {
    const seg = segments[i];
    const out = await slice(sourcePath, Number(seg.start), Number(seg.end));
    q.run('UPDATE sentence SET audio_path = ?, start_ms = ?, end_ms = ? WHERE id = ?',
      out.url, Math.round(Number(seg.start) * 1000), Math.round(Number(seg.end) * 1000), rows[i].id);
    bound.push({ sentenceId: rows[i].id, page: rows[i].page_no, index: rows[i].index_no, url: out.url });
  }

  return { total: rows.length, bound: bound.length, skipped: rows.length - n, items: bound };
}

/** 该教材已有多少句子带音频 */
export function audioCoverage(bookId) {
  const total = q.get('SELECT COUNT(*) n FROM sentence WHERE book_id = ?', bookId)?.n ?? 0;
  const withAudio = q.get('SELECT COUNT(*) n FROM sentence WHERE book_id = ? AND audio_path IS NOT NULL', bookId)?.n ?? 0;
  return { total, withAudio, ratio: total ? Math.round((withAudio / total) * 100) : 0 };
}
