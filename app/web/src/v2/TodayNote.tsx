import { useEffect, useMemo, useRef, useState } from 'react';
import type { StudentState } from './types';

export default function TodayNote({ data, paused, onSay }: {
  data: StudentState; paused: boolean; onSay: (text: string) => void;
}) {
  const { total, approved, submitted, open, rejected } = data.progress;
  const petName = data.pet?.name || '小伙伴';
  const reminder = total === 0 ? `今天还没有计划，和${petName}一起准备明天的小目标吧。`
    : approved === total ? `今天 ${total} 项计划全部通过啦！星贝已经到账，可以给我换喜欢的食物和玩具啦。`
    : `今天已通过 ${approved}/${total} 项${submitted ? `，${submitted} 项等家长审核` : ''}。${open + rejected > 0 ? `再完成一小项，通过后就能赚星贝，给我换食物和玩具啦！` : '辛苦啦，审核通过后星贝就会到账！'}`;
  const notesKey = JSON.stringify(data.dailyNotes || []);
  const slides = useMemo(() => [{ id: 'progress', sender: '', text: reminder, speech: reminder },
    ...(data.dailyNotes || []).map(n => ({ id: n.id, sender: n.senderName, text: n.text, speech: `${n.senderName}提醒你：${n.text}` }))], [notesKey, reminder]);
  const [active, setActive] = useState('progress');
  const [stopped, setStopped] = useState(false);
  const [hovered, setHovered] = useState(false);
  const seenNotes = useRef(new Map<string, string>());
  const announced = useRef('');
  const speakerRef = useRef(onSay);
  speakerRef.current = onSay;
  const index = Math.max(0, slides.findIndex(s => s.id === active));
  const slide = slides[index];
  const signature = `${slide.id}:${slide.speech}`;
  useEffect(() => {
    const notes = data.dailyNotes || [];
    const fresh = notes.find(n => seenNotes.current.has(n.id) ? seenNotes.current.get(n.id) !== n.updatedAt : true);
    notes.forEach(n => seenNotes.current.set(n.id, n.updatedAt));
    if (fresh) setActive(fresh.id);
    else if (!slides.some(s => s.id === active)) setActive('progress');
  }, [notesKey, slides, active]);
  useEffect(() => {
    if (paused || stopped || hovered || slides.length < 2) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setActive(slides[(index + 1) % slides.length].id);
    }, 16000);
    return () => clearInterval(timer);
  }, [index, slides, paused, stopped, hovered]);
  useEffect(() => {
    if (paused || document.hidden || announced.current === signature) return;
    const timer = window.setTimeout(() => { speakerRef.current(slide.speech); announced.current = signature; }, 1200);
    return () => clearTimeout(timer);
  }, [signature, paused]);
  const next = () => setActive(slides[(index + 1) % slides.length].id);
  return <section className="v2-note" aria-label="今日小纸条" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setHovered(true)} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setHovered(false); }}>
    <div className="note-heading"><h2><span aria-hidden="true">💌</span> 今日小纸条</h2>
      <div className="note-heading-actions">
        <button className="note-say" onClick={() => speakerRef.current(slide.speech)} aria-label={`让${petName}说一遍`} title={`让${petName}用气泡说一遍`}>说一遍 ↗</button>
        {slides.length > 1 && <div className="note-controls"><button aria-label={stopped ? '继续轮播' : '暂停轮播'} onClick={() => setStopped(v => !v)}>{stopped ? '▶' : 'Ⅱ'}</button><button className="note-next" aria-label="下一张小纸条" title={`第 ${index + 1} / ${slides.length} 张，点击切换`} onClick={next}>{index + 1}/{slides.length} ›</button></div>}
      </div>
    </div>
    <div className="note-message" aria-live="polite" aria-atomic="true"><p>{slide.sender && <b>{slide.sender}：</b>}{slide.text}</p></div>
  </section>;
}
