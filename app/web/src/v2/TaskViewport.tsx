import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

// 列表始终用满容器；溢出时微调行高露出半行，不再截短列表制造留白。
export default function TaskViewport({ children, count }: { children: ReactNode; count: number }) {
  const host = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState<number>();
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => {
      const rows = list.current;
      const available = el.clientHeight;
      if (!rows || !available || !count) { setRowHeight(undefined); return; }
      const style = getComputedStyle(rows);
      const base = parseFloat(style.getPropertyValue('--task-default-row-height')) || 64;
      const gap = parseFloat(style.rowGap) || 0;
      if (count * (base + gap) - gap <= available) { setRowHeight(undefined); return; }
      const full = Math.min(count - 1, Math.max(0, Math.floor((available + gap / 2) / (56 + gap) - .5)));
      const fitted = (available - full * gap) / (full + .5);
      setRowHeight(full > 0 && fitted >= 56 && fitted <= 72 ? fitted : undefined);
    };
    const observer = new ResizeObserver(measure); observer.observe(el);
    measure(); return () => observer.disconnect();
  }, [count]);
  return <div className="task-viewport" ref={host}><div ref={list} className="task-list v2-task-list" style={{ '--task-row-height': rowHeight === undefined ? undefined : `${rowHeight}px` } as CSSProperties} tabIndex={count > 0 ? 0 : undefined} aria-label="今日任务，可上下滚动">{children}</div></div>;
}
