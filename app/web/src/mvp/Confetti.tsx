import { memo, useMemo, type CSSProperties } from 'react';

export const CONFETTI_DURATION = 2200;

/** Stable particles: a parent render must not restart or reposition a celebration. */
const Confetti = memo(function Confetti() {
  const particles = useMemo(() => Array.from({ length: 26 }, (_, i) => ({
    '--x': `${Math.random() * 100}%`,
    '--c': ['#F2B36B', '#E88C7D', '#8FC3A6', '#E7C566', '#B9D8F0'][i % 5],
    '--d': `${0.9 + Math.random() * 0.9}s`,
    '--r': `${Math.random() * 360}deg`,
  } as CSSProperties)), []);
  return <div className="confetti" aria-hidden="true">{particles.map((style, i) => <i key={i} style={style} />)}</div>;
});
export default Confetti;
