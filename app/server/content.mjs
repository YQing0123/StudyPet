/**
 * 教材导入：PDF 文本提取 + 音频绑定
 *
 * 只支持两种来源：PDF 教材与音频教材。不做点读笔包解析。
 * 设计原则：导入必须「看得见结果」——每页提取到什么文本、切出几句、音频绑到哪，
 * 家长都能在界面上逐页确认，错了能改。
 */

import { q, uid, now, tx, MEDIA_DIR } from './db.mjs';
import { writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';

/** 句子切分：英文按句末标点，中文按句末标点，保留引号内的句子 */
export function splitSentences(text) {
  if (!text) return [];
  const cleaned = text
    .split('\n').map(cleanLine).filter(Boolean).join(' ')
    .replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const parts = cleaned
    .split(/(?<=[.!?。！？…])\s*(?=[^a-z])/)
    .map(s => s.trim())
    .filter(Boolean);
  // 过短的片段并回上一句
  const out = [];
  for (const p of parts) {
    if (out.length && p.length <= 2) out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  return out;
}

/** 从 PDF 提取每页文本（pdfjs-dist，纯 JS，无需系统依赖） */
export async function extractPdfPages(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // 按位置分行，避免把所有词粘成一坨
    const lines = new Map();
    for (const item of content.items) {
      const y = Math.round((item.transform?.[5] ?? 0) / 4) * 4;
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y).push({ x: item.transform?.[4] ?? 0, str: item.str ?? '' });
    }
    const rawLines = [...lines.entries()]
      .sort((a, b) => b[0] - a[0])            // PDF 坐标系 y 向上，行从上到下
      .map(([, items]) => items.sort((a, b) => a.x - b.x).map(i => i.str).join(''))
      .map(cleanLine)
      .filter(Boolean);

    pages.push({ index: i, text: rawLines.join('\n') });
  }
  return pages;
}

/**
 * 清洗 PDF 提取出的一行文本。
 * 真实教材里每页都有页码、页眉、装饰符号，这些不能进入句子切分。
 */
export function cleanLine(line) {
  let t = String(line ?? '');
  // 去掉 emoji、符号、制表符
  t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ');
  // 去掉首尾页码、纯数字片段（页码/题号）
  t = t.replace(/\b\d{1,3}\b/g, ' ');
  // 合并空白
  t = t.replace(/\s+/g, ' ').trim();
  // 只保留含有拉丁字母或中文字符的行
  if (!/[A-Za-z\u4e00-\u9fa5]/.test(t)) return '';
  // 丢掉过短的无意义行（如残留的单字母）
  if (t.replace(/[^A-Za-z\u4e00-\u9fa5]/g, '').length < 2) return '';
  return t;
}

/** 版本指纹：用页数与每页字符数构造，用于检测「同一本书不同版本」 */
export function fingerprint(pages) {
  const sig = pages.map(p => `${p.index}:${(p.text || '').length}`).join('|');
  let h = 0;
  for (let i = 0; i < sig.length; i++) {
    h = (h * 31 + sig.charCodeAt(i)) >>> 0;
  }
  return 'fp_' + h.toString(16).padStart(8, '0');
}

export function ensureSeries(code, name) {
  let s = q.get('SELECT * FROM series WHERE code = ?', code);
  if (s) return s;
  const id = uid();
  q.run('INSERT INTO series(id, name, code, created_at) VALUES(?,?,?,?)', id, name, code, now());
  return q.get('SELECT * FROM series WHERE id = ?', id);
}

/**
 * 保存导入结果
 * @param {object} opts { seriesCode, seriesName, level, title, pages:[{index,text}], audioMap:{pageIndex:path} }
 */
export function saveBook(opts) {
  const { seriesCode, seriesName, level, title, pages } = opts;
  const audioMap = opts.audioMap ?? {};

  return tx(() => {
    const series = ensureSeries(seriesCode, seriesName);
    const fp = fingerprint(pages);

    let book = q.get('SELECT * FROM book WHERE series_id=? AND level=? AND title=?', series.id, level, title);
    if (book) {
      // 已有则整体替换内容，保留 book id（学习记录不变）
      q.run('DELETE FROM page WHERE book_id = ?', book.id);
      q.run('UPDATE book SET page_count=?, fingerprint=?, status=? WHERE id=?', pages.length, fp, 'ready', book.id);
    } else {
      const id = uid();
      q.run('INSERT INTO book(id, series_id, level, title, page_count, fingerprint, status, created_at) VALUES(?,?,?,?,?,?,?,?)',
        id, series.id, level, title, pages.length, fp, 'ready', now());
      book = q.get('SELECT * FROM book WHERE id = ?', id);
    }

    let sentenceCount = 0;
    for (const p of pages) {
      const pageId = uid();
      q.run('INSERT INTO page(id, book_id, index_no, image_path, raw_text) VALUES(?,?,?,?,?)',
        pageId, book.id, p.index, null, p.text ?? '');
      const sentences = splitSentences(p.text);
      let idx = 0;
      for (const s of sentences) {
        q.run('INSERT INTO sentence(id, page_id, book_id, index_no, text, audio_path) VALUES(?,?,?,?,?,?)',
          uid(), pageId, book.id, idx++, s, audioMap[p.index] ?? null);
        sentenceCount++;
      }
    }
    return { book, sentences: sentenceCount, fingerprint: fp };
  });
}

/** 保存上传的音频文件，返回相对路径 */
export function saveAudio(filename, buffer) {
  const ext = extname(filename).toLowerCase() || '.mp3';
  const safe = `${uid()}${ext}`;
  writeFileSync(join(MEDIA_DIR, 'audio', safe), buffer);
  return `/media/audio/${safe}`;
}

export function savePdf(filename, buffer) {
  const safe = `${uid()}.pdf`;
  writeFileSync(join(MEDIA_DIR, 'pdf', safe), buffer);
  return `/media/pdf/${safe}`;
}

/** 书架列表 */
export function listBooks() {
  return q.all(`
    SELECT b.*, s.name AS series_name, s.code AS series_code,
           (SELECT COUNT(*) FROM page p WHERE p.book_id = b.id) AS pages,
           (SELECT COUNT(*) FROM sentence se WHERE se.book_id = b.id) AS sentences,
           (SELECT COUNT(*) FROM question qq WHERE qq.book_id = b.id AND qq.status='published') AS questions
      FROM book b LEFT JOIN series s ON s.id = b.series_id
     ORDER BY s.name, b.level, b.title`);
}

export function bookDetail(bookId) {
  const book = q.get(`SELECT b.*, s.name AS series_name, s.code AS series_code
                        FROM book b LEFT JOIN series s ON s.id=b.series_id WHERE b.id=?`, bookId);
  if (!book) return null;
  const pages = q.all('SELECT * FROM page WHERE book_id=? ORDER BY index_no', bookId).map(p => ({
    ...p,
    sentences: q.all('SELECT * FROM sentence WHERE page_id=? ORDER BY index_no', p.id),
  }));
  return { book, pages };
}

/**
 * 由教材句子直接生成基础题（无需外部 AI 也能跑通闭环）
 * 题型：单词听辨 / 看图选词 / 句子填空
 */
export function generateBasicQuestions(bookId, pageFrom = 1, pageTo = 9999) {
  const sentences = q.all(
    `SELECT se.*, p.index_no AS page_no FROM sentence se
       JOIN page p ON p.id = se.page_id
      WHERE se.book_id = ? AND p.index_no BETWEEN ? AND ?
      ORDER BY p.index_no, se.index_no`,
    bookId, pageFrom, pageTo);

  const created = [];
  const stopWords = new Set(['the','a','an','is','are','am','this','that','it','my','your','his','her','i','you','we','they','and','to','of','in','on','at','is','are']);

  for (const s of sentences) {
    const words = s.text.replace(/[^A-Za-z' ]/g, ' ').split(/\s+/).filter(Boolean);
    const content = words.filter(w => !stopWords.has(w.toLowerCase()) && w.length >= 2);

    // 题型 1：句子理解——给句子，选出关键词
    if (content.length >= 2) {
      const target = content[Math.floor(content.length / 2)];
      const distractors = pickDistractors(target, content, sentences);
      const options = shuffle([target, ...distractors]).map(w => ({ text: w }));
      const answerIdx = options.findIndex(o => o.text === target);
      created.push(insertQuestion({
        bookId, type: 'word_choice', sentenceId: s.id, pageNo: s.page_no,
        prompt: s.text,
        instruction: '这句话里出现了哪个词？',
        payload: { options, audio: s.audio_path },
        answer: { index: answerIdx, text: target },
        difficulty: Math.min(5, 1 + Math.floor(words.length / 6)),
        dedupe: `basic:${s.id}:word_choice`,
        source: 'builtin',
      }));
    }

    // 题型 2：句子填空——挖掉一个词，给选项
    if (content.length >= 3) {
      const target = content[content.length - 1];
      const blanked = s.text.replace(new RegExp(`\\b${escapeRe(target)}\\b`), '____');
      const distractors = pickDistractors(target, content, sentences);
      const options = shuffle([target, ...distractors]).map(w => ({ text: w }));
      const answerIdx = options.findIndex(o => o.text === target);
      created.push(insertQuestion({
        bookId, type: 'cloze_choice', sentenceId: s.id, pageNo: s.page_no,
        prompt: blanked,
        instruction: '选出合适的词补全句子。',
        payload: { options, audio: s.audio_path },
        answer: { index: answerIdx, text: target },
        difficulty: Math.min(5, 2 + Math.floor(words.length / 8)),
        dedupe: `basic:${s.id}:cloze`,
        source: 'builtin',
      }));
    }
  }
  return { created: created.filter(Boolean).length, total: created.length };
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function pickDistractors(target, content, allSentences) {
  const pool = new Set();
  for (const w of content) if (w.toLowerCase() !== target.toLowerCase() && w.length >= 2) pool.add(w);
  for (const s of allSentences) {
    for (const w of s.text.replace(/[^A-Za-z' ]/g, ' ').split(/\s+/)) {
      if (w.length >= 2 && w.toLowerCase() !== target.toLowerCase()) pool.add(w);
      if (pool.size > 40) break;
    }
  }
  const arr = shuffle([...pool]);
  return arr.slice(0, 2);
}

function shuffle(a) {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}

function insertQuestion({ bookId, type, sentenceId, prompt, instruction, payload, answer, difficulty, dedupe, source }) {
  if (!dedupe) dedupe = null;
  const exists = dedupe ? q.get('SELECT id FROM question WHERE dedupe_key = ?', dedupe) : null;
  if (exists) return null;
  const id = uid();
  q.run(`INSERT INTO question(id, book_id, type, sentence_id, prompt, instruction, payload, answer,
                              difficulty, status, source, dedupe_key, created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, bookId, type, sentenceId ?? null, prompt, instruction ?? '',
    JSON.stringify(payload), JSON.stringify(answer),
    difficulty ?? 1, 'published', source ?? 'builtin', dedupe, now());
  return id;
}

/** 听力题：播放句子音频，从三个句子里选出听到的那句 */
export function generateListeningQuestions(bookId, pageFrom = 1, pageTo = 9999) {
  const rows = q.all(
    `SELECT se.*, p.index_no AS page_no FROM sentence se
       JOIN page p ON p.id = se.page_id
      WHERE se.book_id = ? AND p.index_no BETWEEN ? AND ?
        AND se.audio_path IS NOT NULL AND length(se.text) >= 6
      ORDER BY p.index_no, se.index_no`,
    bookId, pageFrom, pageTo);

  const allTexts = q.all(
    'SELECT text FROM sentence WHERE book_id = ? AND length(text) >= 6', bookId).map(r => r.text);

  let created = 0;
  for (const s0 of rows) {
    const others = allTexts.filter(t => t !== s0.text);
    const distractors = shuffle(others).slice(0, 2);
    if (distractors.length < 2) continue;

    const options = shuffle([s0.text, ...distractors]).map(t => ({ text: t }));
    const answerIdx = options.findIndex(o => o.text === s0.text);

    const id = insertQuestion({
      bookId, type: 'listening_choice', sentenceId: s0.id, pageNo: s0.page_no,
      prompt: '🔊 听一听，选出你听到的句子',
      instruction: '先点播放，听清楚再选。',
      payload: { options, audio: s0.audio_path, promptHidden: true },
      answer: { index: answerIdx, text: s0.text },
      difficulty: 3,
      dedupe: `listen:${s0.id}`,
      source: 'builtin',
    });
    if (id) created++;
  }
  return { created, total: rows.length };
}

/** 组卷：按范围取题，优先复习卡到期题，再补新题 */
export function buildQuestionSet({ childId, bookId, pageFrom, pageTo, count = 6, mode = 'training', types = null }) {
  if (!bookId) return [];
  pageFrom = Number(pageFrom ?? 1);
  pageTo = Number(pageTo ?? 9999);
  const due = q.all(
    `SELECT qq.id FROM review_card rc JOIN question qq ON qq.id = rc.question_id
      WHERE rc.child_id=? AND rc.due_at <= ? AND qq.status='published'
      ORDER BY rc.due_at ASC LIMIT ?`,
    childId, new Date().toISOString(), count);

  const typeFilter = Array.isArray(types) && types.length
    ? `AND qq2.type IN (${types.map(() => '?').join(',')})` : '';
  const typeArgs = Array.isArray(types) && types.length ? types : [];

  const picked = due.map(r => r.id);

  // 第二层：范围内还没接触过的新题
  if (picked.length < count) {
    const fresh = q.all(
      `SELECT qq2.id FROM question qq2 WHERE qq2.book_id=? AND qq2.status='published'
         AND COALESCE((SELECT index_no FROM page WHERE id=(SELECT page_id FROM sentence WHERE id=qq2.sentence_id)), 1) BETWEEN ? AND ?
         AND qq2.id NOT IN (SELECT question_id FROM review_card WHERE child_id=?)
         ${typeFilter}
       ORDER BY RANDOM() LIMIT ?`,
      bookId, pageFrom, pageTo, childId, ...typeArgs, Math.max(0, count - picked.length));
    picked.push(...fresh.map(r => r.id));
  }

  // 第三层：今天既没有到期的也没有新题时，允许「提前练」尚未稳固的题。
  // 没有这一层，孩子点开始会看到「没有题目」，体验直接断掉。
  if (picked.length < count && mode !== 'review') {
    // 注意：picked 为空时不能拼 `NOT IN (NULL)`——SQL 里恒为 NULL，会把所有行排除掉
    const exclude = picked.length ? `AND qq.id NOT IN (${picked.map(() => '?').join(',')})` : '';
    const practice = q.all(
      `SELECT qq.id
         FROM question qq
         LEFT JOIN review_card rc ON rc.question_id = qq.id AND rc.child_id = ?
        WHERE qq.book_id = ? AND qq.status = 'published'
          AND COALESCE(rc.level, 0) < 4
          ${exclude.replace(/qq\.id/g, 'qq.id')}
          ${typeFilter.replace(/qq2\.type/g, 'qq.type')}
        ORDER BY COALESCE(rc.level, 0) ASC, RANDOM()
        LIMIT ?`,
      childId, bookId, ...picked, ...typeArgs, Math.max(0, count - picked.length));
    picked.push(...practice.map(r => r.id));
  }

  // 听力题排在前面：先听懂再读，符合语言学习顺序，也避免孩子一开始就畏难
  return picked
    .map(id => publicQuestion(id))
    .filter(Boolean)
    .sort((a, b) => {
      const rank = (t) => (t === 'listening_choice' ? 0 : 1);
      return rank(a.type) - rank(b.type);
    });
}

/** 公开题面：绝不包含答案 */
export function publicQuestion(id) {
  const row = q.get('SELECT * FROM question WHERE id = ?', id);
  if (!row) return null;
  const payload = JSON.parse(row.payload);
  return {
    id: row.id, type: row.type, prompt: row.prompt,
    instruction: row.instruction, payload,
    difficulty: row.difficulty,
    bookId: row.book_id, sentenceId: row.sentence_id,
  };
}
