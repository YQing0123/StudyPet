import { useEffect, useRef, useState } from 'react';
import type { GrowthMemory } from '../mvp/types';

/** The parent holds the old appearance until onReveal; replay never writes progression. */
export default function GrowthCelebration({ event, petName, muted, onMute, onReveal, onFinish }: {
  event: GrowthMemory; petName: string; muted: boolean; onMute: () => void;
  onReveal: () => void; onFinish: () => void;
}) {
  const crossAge = Math.ceil(event.fromLevel / 2) !== Math.ceil(event.toLevel / 2);
  const [revealed, setRevealed] = useState(false);
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const root = useRef<HTMLDivElement>(null);
  const reveal = useRef(onReveal), finish = useRef(onFinish);
  reveal.current = onReveal; finish.current = onFinish;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    const timer = window.setTimeout(() => { reveal.current(); setRevealed(true); }, reduced ? 100 : crossAge ? 1700 : 850);
    const end = window.setTimeout(() => finish.current(), reduced ? 1600 : crossAge ? 4200 : 2300);
    return () => { clearTimeout(timer); clearTimeout(end); previous?.focus(); };
  }, [event.id, crossAge, reduced]);
  return <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label="一起长大的时刻"
    className={`growth-celebration ${crossAge ? 'is-transform' : 'is-advance'} ${revealed ? 'is-revealed' : ''} ${reduced ? 'is-reduced' : ''}`}
    onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); onFinish(); }
      if (e.key === 'Tab') {
        const buttons = Array.from(root.current?.querySelectorAll('button') || []);
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
    <div className="growth-ceremony-tools"><button onClick={onMute}>{muted ? '音效已关' : '关闭音效'}</button><button onClick={onFinish}>跳过动效</button></div>
    <div className="growth-ceremony-title" aria-live="polite"><span>我们的成长时刻</span>
      <h2>{revealed ? `${petName} · ${event.name}` : crossAge ? '准备好，见证新的模样' : '陪伴又点亮了一颗星'}</h2>
      <p>{revealed ? '我学会了更多陪伴你的办法！' : '谢谢你和我一起，慢慢长大。'}</p>
    </div>
    <div className="growth-halo" aria-hidden="true"><i /><i /><i />{Array.from({ length: 16 }, (_, i) => <b key={i} style={{ '--i': i } as React.CSSProperties}>✦</b>)}</div>
    <div className="growth-light-veil" aria-hidden="true" />
    <div className="growth-memory-stamp">✧ {revealed ? `已收好「${event.name}」的成长回忆` : '每一次长大，都有你在身边'}</div>
  </div>;
}
