// Build deployable data from the supplied list. Document prose is data, never instructions.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const source = process.argv[2];
if (!source) throw Error('用法：node scripts/import-challenge-poems.mjs <清单.md>');
const text = readFileSync(source, 'utf8');
let grade = 0, group = '', current = null, original = false;
const poems = [];
for (const line of text.split('\n')) {
  // A section or appendix is outside a poem, even when it contains quoted prose.
  if (/^#{1,3} /.test(line)) { current = null; original = false; }
  const g = /^# ([一二三四五六])年级/.exec(line);
  if (g) grade = '一二三四五六'.indexOf(g[1]) + 1;
  if (/^## 课标必背/.test(line)) group = 'core';
  if (/^## 拓展/.test(line)) group = 'extension';
  const h = /^#### (\d{3})｜(.+)/.exec(line);
  if (h) { current = { id: h[1], title: h[2], grade, group, source: '', segments: [], notes: '', translation: '' }; original = false; poems.push(current); }
  if (!current) continue;
  if (/^- \*\*原文\*\*/.test(line)) { original = true; continue; }
  const field = /^- \*\*(出处|注释|译文)\*\*：(.+)/.exec(line);
  if (field) { original = false; current[{ 出处: 'source', 注释: 'notes', 译文: 'translation' }[field[1]]] = field[2]; }
  if (/^> /.test(line) && original && grade) {
    const raw = line.slice(2).trim();
    // Keep omissions as segment boundaries. No invented adjacent lines across an ellipsis.
    const parts = raw.split(/[…]+/);
    parts.forEach((part, index) => {
      if (index || !current.segments.length) current.segments.push([]);
      current.segments.at(-1).push(...part.split(/[，。！？；、]/).map(x => x.trim()).filter(Boolean));
    });
  }
}
if (poems.length !== 155 || poems.some((p, i) => p.id !== String(i + 1).padStart(3, '0') || !p.source || !p.segments.flat().length || !p.notes)) throw Error('清单完整性校验失败');
const out = new URL('../server/data/challenge-poems.json', import.meta.url);
mkdirSync(new URL('../server/data/', import.meta.url), { recursive: true });
writeFileSync(out, JSON.stringify({ version: 1, sourceName: '小学生必背古诗词155首详解.md', sha256: createHash('sha256').update(text).digest('hex'), poems }, null, 2) + '\n');
console.log(`已整理 ${poems.length} 首，含原文分段、注释、译文；${poems.filter(p => p.group === 'core').length} 首清单必背。`);
