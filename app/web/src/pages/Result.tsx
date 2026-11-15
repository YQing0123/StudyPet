import { useEffect, useState } from 'react';

type Props = { payload: any; onHome: () => void };

const GIFT_META: Record<string, { emoji: string; name: string }> = {
  food: { emoji: '🍖', name: '粮食' },
  water: { emoji: '💧', name: '清水' },
  medicine: { emoji: '💊', name: '药品' },
};

export default function Result({ payload, onHome }: Props) {
  const [opened, setOpened] = useState(false);
  const [petted, setPetted] = useState(false);

  const stats = payload?.stats ?? { total: 0, correct: 0, accuracy: 0 };
  const reward = payload?.reward ?? {};
  const pet = payload?.pet;
  const game = payload?.game ?? {};
  const gifts = reward?.gifts ?? [];
  const acc = stats.accuracy ?? 0;
  const stars = acc >= 100 ? 3 : acc >= 70 ? 2 : acc >= 40 ? 1 : 0;

  useEffect(() => { openSound(stars); }, []);

  const open = () => {
    if (opened) return;
    setOpened(true);
    openSound(3);
  };

  const headline = reward?.leveledUp
    ? '它长大了！'
    : stars === 3 ? '完美通关！' : stars === 2 ? '通关成功！' : stars === 1 ? '走完这一程' : '还差一点点';

  return (
    <div className="result">
      <div className="result-card card">
        {!opened ? (
          <div className="chest-wrap">
            <div style={{ fontSize: 15, color: 'var(--green)', fontWeight: 700, letterSpacing: 1 }}>
              第 {game.total ?? stats.total} 关 · 连击最高 {game.bestStreak ?? 0}
            </div>
            <button className="chest" onClick={open} aria-label="打开宝箱">🎁</button>
            <div className="chest-hint">点一下，打开今天的宝箱</div>
          </div>
        ) : (
          <>
            <div className="result-emoji">{stars === 3 ? '🌟' : stars >= 1 ? '🎉' : '💪'}</div>
            <h1>{headline}</h1>

            <div className="stars" style={{ justifyContent: 'center', margin: '6px 0 2px' }}>
              {[0, 1, 2].map((i) => (
                <i key={i} className={i < stars ? 'on' : ''} style={{ fontSize: 26 }}>★</i>
              ))}
            </div>

            <p style={{ color: 'var(--ink-soft)', fontSize: 15 }}>
              答对 {stats.correct} / {stats.total} 题
              {stats.helped > 0 && ` · 用了 ${stats.helped} 次提示`}
              {game.bestStreak >= 2 && ` · 最高连击 ${game.bestStreak}`}
            </p>

            <div className="grid-3" style={{ marginTop: 18 }}>
              <div className="stat"><div className="k">正确率</div><div className="v">{acc}%</div></div>
              <div className="stat"><div className="k">获得经验</div><div className="v">+{reward?.exp ?? 0}</div></div>
              <div className="stat"><div className="k">亲密度</div><div className="v">{pet?.bond ?? 0}</div></div>
            </div>

            {gifts.length > 0 ? (
              <>
                <p style={{ marginTop: 20, fontSize: 14, color: 'var(--ink-soft)' }}>宝箱里掉出了这些</p>
                <div className="chest-loot">
                  {gifts.map((g: any, i: number) => (
                    <div className="loot" key={g.item} style={{ animationDelay: `${i * 110}ms` }}>
                      <span className="e">{GIFT_META[g.item]?.emoji ?? '🎁'}</span>
                      <span className="n">{GIFT_META[g.item]?.name ?? g.item}</span>
                      <span className="q">×{g.qty}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p style={{ marginTop: 18, fontSize: 13.5, color: 'var(--ink-soft)' }}>
                今天的这段奖励已经领过了，明天还有新的宝箱
              </p>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
              <button
                className="btn ghost"
                style={{ flex: 1 }}
                onClick={() => { setPetted(true); barkSound(); }}
              >
                {petted ? '它很开心 🐾' : '摸摸它'}
              </button>
              <button className="btn primary" style={{ flex: 1.5 }} onClick={onHome}>
                带它回小屋
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function openSound(stars: number) {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const base = [523.25, 659.25, 783.99, 1046.5];
    base.slice(0, 3 + Math.min(stars, 1)).forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.1;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.36);
      o.start(t); o.stop(t + 0.4);
    });
    setTimeout(() => ctx.close?.(), 1400);
  } catch {}
}

function barkSound() {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      const t = ctx.currentTime + i * 0.16;
      o.frequency.setValueAtTime(420, t);
      o.frequency.exponentialRampToValueAtTime(240, t + 0.09);
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.08, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.start(t); o.stop(t + 0.14);
    }
    setTimeout(() => ctx.close?.(), 800);
  } catch {}
}
