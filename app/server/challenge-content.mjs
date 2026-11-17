import { readFileSync } from 'node:fs';
import { createHash, randomInt } from 'node:crypto';
export const library = JSON.parse(readFileSync(new URL('./data/challenge-poems.json', import.meta.url), 'utf8'));
export const shuffle = list => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const hash = text => createHash('sha256').update(text).digest('hex').slice(0, 20);
export const topics = [ { id: 'add', name: '百以内加减法' }, { id: 'multiply', name: '乘法口诀（1–9）' }, { id: 'length', name: '厘米与米' } ];
const allLines = library.poems.flatMap(p => p.segments.flat());
const notePairs = p => p.notes.split(/[①②③④⑤⑥⑦⑧⑨⑩]/).map(s => /^([^：]{1,12})：(.+?)[。；]?$/.exec(s.trim())).filter(Boolean).map(m => ({ term: m[1], meaning: m[2].replace(/[。；]$/, '') }));
// Only publish annotation choices with reviewed, semantically distinct distractors.
// The remaining source annotations stay available as explanations, not unchecked quiz answers.
const noteDistractors = {
 '002:曲项':['伸开翅膀','低头喝水','张开嘴巴'], '004:晓':['天黑','正午','傍晚'],
 '005:疑':['十分确定','忽然听见','抬头远望'], '006:呼作':['飞向','拿走','追赶'],
 '007:不及':['超过','一样多','来不及赶路'], '008:小艇':['大山','池塘','竹桥'],
 '010:当午':['清晨日出时','太阳落山时','半夜睡觉时'], '013:惊':['安静停留','张开翅膀','低头啄食'],
 '015:采撷':['播种','浇水','赠送'], '016:向晚':['清晨','正午','深夜'],
 '018:凌寒':['躲避寒冷','等到春暖','迎着暑热'], '018:暗香':['浓浓的烟雾','明亮的月光','清脆的声音'],
 '021:穹庐':['高高的山峰','茂密的树林','弯弯的小河'],
 '023:穷':['贫穷、缺少钱财','弯腰、低下头','离开、走远'],
 '024:九天':['九个白天','九种天气','九座高山'],
 '027:蓑笠':['棉袄和布鞋','长剑和盔甲','渔网和船桨'],
 '028:稚子':['年长的老人','路过的客人','钓鱼的工具'],
 '030:纸鸢':['纸做的小船','纸做的灯笼','写字的纸张'],
 '031:危楼':['破旧倒塌的楼','低矮的小屋','远处的桥梁'],
};
const scoreLine = (a, b) => (a.length === b.length ? 20 : -Math.abs(a.length - b.length)) + [...a].filter(c => b.includes(c)).length * 2 + (a.at(-1) === b.at(-1) ? 4 : 0);
export const poemQuestions = library.poems.flatMap(p => {
  const common = { subject: 'poetry', grade: p.grade, group: p.group, topic: 'poem', poemId: p.id, title: p.title, source: p.source, notes: p.notes, translation: p.translation };
  const questions = [];
  p.segments.forEach((segment, s) => {
    for (let i = 0; i < segment.length - 1; i++) for (const direction of ['next', 'previous']) {
      const cue = segment[i + (direction === 'previous' ? 1 : 0)], answer = segment[i + (direction === 'next' ? 1 : 0)];
      if (cue.length < 4 || answer.length < 4) continue;
      const answersForCue = new Set(p.segments.flatMap(lines => lines.flatMap((line,j) => line===cue && lines[j+(direction==='next'?1:-1)] ? [lines[j+(direction==='next'?1:-1)]] : [])));
      // Repeated refrains can have different next/previous lines (蒹葭、木兰诗).
      // A bare adjacent-line prompt is ambiguous there, so do not publish it.
      if (answersForCue.size !== 1) continue;
      const distractors = [...new Set([...segment, ...allLines])].filter(l => l !== cue && l !== answer && l.length >= 4 && l.length <= 12).sort((a,b) => scoreLine(answer,b) - scoreLine(answer,a)).slice(0, 16);
      questions.push({ ...common, id: `poem-v1-${p.id}-${s}-${i}-${direction}`, type: 'choice', prompt: `“${cue}”的${direction === 'next' ? '下一句' : '上一句'}是？`, cue, answer, distractors, explanation: `${segment[i]}，${segment[i + 1]}。\n${p.notes}`, level: 1 });
    }
  });
  notePairs(p).forEach((n, i) => {
    if (!p.segments.flat().some(l => l.includes(n.term))) return;
    const distractors = noteDistractors[`${p.id}:${n.term}`];
    if (!distractors) return;
    questions.push({ ...common, id: `poem-v1-${p.id}-note-${i}`, type: 'choice', prompt: `《${p.title}》中，“${n.term}”是什么意思？`, cue: p.segments.flat().find(l => l.includes(n.term)), answer: n.meaning, distractors, explanation: `清单注释：${n.term}：${n.meaning}。\n${p.translation}`, level: 2 });
  });
  return questions;
});

// Finite, reproducible calculation bank. Each exact calculation has a stable identity.
// No division, decimal or next-grade operations are unlocked implicitly.
export const mathQuestions = [];
function additionExplanation(a,b) {
  const tens=Math.floor(b/10)*10, ones=b%10;
  if(tens&&ones)return `把 ${b} 分成 ${tens} 和 ${ones}。先算 ${a} + ${tens} = ${a+tens}，再算 ${a+tens} + ${ones} = ${a+b}。`;
  if(tens)return `${b} 是整十数。${a} + ${tens} = ${a+b}，个位不变。`;
  const unitSum=a%10+b;
  return unitSum>=10 ? `个位 ${a%10} + ${b} = ${unitSum}，满十向十位进 1。所以 ${a} + ${b} = ${a+b}。` : `个位 ${a%10} + ${b} = ${unitSum}${a>=10?'，十位不变':''}。所以 ${a} + ${b} = ${a+b}。`;
}
function math(prompt, answer, topic, level, seconds, explanation, scope = '2upper') {
  const id = `math-v1-${hash(scope + '|' + prompt)}`;
  if (mathQuestions.some(q => q.id === id)) return;
  mathQuestions.push({ id, subject: 'math', type: 'number', grade: scope.startsWith('1') ? 1 : 2, group: 'core', topic, level, scope, title: topics.find(t => t.id === topic)?.name || '计算练习', source: '人教版已学知识范围 · 规则生成', prompt, answer: String(answer), seconds, explanation });
}
for (let a = 1; a <= 9; a++) for (let b = 1; b <= 9; b++) {
  math(`${a} × ${b} = ?`, a*b, 'multiply', 1, 20, `${a} 个 ${b} 相加是 ${a*b}，所以 ${a} × ${b} = ${a*b}。`);
  if (a*b+b <= 100) math(`${a} × ${b} + ${b} = ?`, a*b+b, 'multiply', 2, 35, `先算乘法：${a} × ${b} = ${a*b}；再加 ${b}，得 ${a*b+b}。`);
  if (a*b >= b) math(`${a} × ${b} − ${b} = ?`, a*b-b, 'multiply', 3, 45, `先算 ${a} × ${b} = ${a*b}，再减 ${b}，得 ${a*b-b}。`);
}
for (let a = 12; a <= 88; a += 4) for (let b = 3; b <= 29; b += 3) {
  if (a+b <= 100) math(`${a} + ${b} = ?`, a+b, 'add', a%10+b%10>=10?2:1, 30, additionExplanation(a,b));
  if (a >= b) math(`${a} − ${b} = ?`, a-b, 'add', a%10 >= b%10 ? 1 : 2, 35, `${a} − ${b} = ${a-b}。${a%10 < b%10?'个位不够减时，向十位借 1。':'分别用十位和个位相减。'}`);
  if (a+b <= 100 && a+b >= 9) math(`${a} + ${b} − 9 = ?`, a+b-9, 'add', 3, 45, `从左往右：${a} + ${b} = ${a+b}；${a+b} − 9 = ${a+b-9}。`);
}
for (let a = 1; a <= 9; a++) {
  math(`${a} 米 = ? 厘米`, a*100, 'length', 1, 25, `1 米 = 100 厘米，${a} 米 = ${a*100} 厘米。`);
  math(`${a*100} 厘米 = ? 米`, a, 'length', 1, 25, `${a*100} 厘米里面有 ${a} 个 100 厘米，所以是 ${a} 米。`);
  for (let b = 10; b <= 90; b += 10) {
    math(`${a} 米 ${b} 厘米 = ? 厘米`, a*100+b, 'length', 2, 40, `${a} 米 = ${a*100} 厘米，再加 ${b} 厘米，共 ${a*100+b} 厘米。`);
    math(`${a} 米 − ${b} 厘米 = ? 厘米`, a*100-b, 'length', 3, 50, `先统一单位：${a} 米 = ${a*100} 厘米；再减 ${b} 厘米，得 ${a*100-b} 厘米。`);
  }
}
for (const scope of ['1upper', '1lower']) {
  const max = scope === '1upper' ? 20 : 100;
  for (let a = 1; a < max; a += max === 20 ? 1 : 3) for (let b = 1; b <= Math.min(a, 10); b++) {
    if (a+b <= max) math(`${a} + ${b} = ?`, a+b, 'add', a%10+b%10 >= 10 ? 2 : 1, 35, additionExplanation(a,b), scope);
    math(`${a} − ${b} = ?`, a-b, 'add', 2, 35, `${a} − ${b} = ${a-b}。`, scope);
    if (a+b+2 <= max) math(`${a} + ${b} + 2 = ?`, a+b+2, 'add', 3, 50, `从左往右：${a} + ${b} = ${a+b}；再加 2，得 ${a+b+2}。`, scope);
  }
}
export const catalog = [...poemQuestions, ...mathQuestions];
export const byId = new Map(catalog.map(q => [q.id, q]));
export function initialPoems(grade, term) {
  if (grade === 2 && term === 'upper') return library.poems.filter(p => (p.grade < 2 && p.group === 'core') || ['018','021','023','024','031'].includes(p.id)).map(p => p.id);
  return library.poems.filter(p => p.grade <= grade && p.group === 'core').map(p => p.id);
}
export function eligible(question, policy, difficulty) {
  if (question.subject === 'math') return question.scope === policy.mathScope && policy.topics.includes(question.topic) && question.level <= difficulty;
  if (difficulty === 1) return policy.poemIds.includes(question.poemId) && question.level === 1;
  if (policy.poemIds.includes(question.poemId)) return true;
  return question.grade <= policy.grade + (difficulty === 3 && policy.nextGrade ? 1 : 0) && (question.grade <= policy.grade || question.cue?.length <= 7);
}
export function snapshot(question, difficulty) {
  const { distractors, ...result } = question;
  if (question.type === 'choice') result.options = shuffle([question.answer, ...shuffle(distractors.slice(0,8)).slice(0, difficulty === 1 ? 1 : 3)]);
  result.seconds = question.subject === 'poetry' ? (question.level===2 ? 8 : difficulty === 1 ? 8 : difficulty === 2 ? 7 : 6) : question.seconds;
  return result;
}
