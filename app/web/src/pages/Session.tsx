import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

type Props = {
  sessionId: string;
  mode: string;
  questions: any[];
  onFinish: (payload: any) => void;
  onQuit: () => void;
};

const PRAISE = ['太棒了！', '答对啦！', '你真厉害！', '就是这个！', '漂亮！'];
const ENCOURAGE = ['没关系，我们一起看看', '差一点点', '这个词再读一遍', '别急，慢慢来'];

type Fx = { id: number; x: number; y: number; emoji: string; dx: number; dy: number; rot: string };

export default function Session({ sessionId, mode, questions, onFinish, onQuit }: Props) {
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [state, setState] = useState<'answering' | 'right' | 'wrong'>('answering');
  const [helped, setHelped] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: string; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [fx, setFx] = useState<Fx[]>([]);
  const [justAdvanced, setJustAdvanced] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);

  const startedAt = useRef(Date.now());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fxId = useRef(0);
  const advancing = useRef(false);

  const cur = questions[idx];
  const total = questions.length;
  const isLast = idx + 1 >= total;

  const burst = useCallback((n = 8) => {
    const items: Fx[] = Array.from({ length: n }, (_, i) => ({
      id: ++fxId.current,
      x: 35 + Math.random() * 30,
      y: 42 + Math.random() * 14,
      emoji: ['✨', '⭐', '💛', '🌟'][i % 4],
      dx: (Math.random() - 0.5) * 220,
      dy: -60 - Math.random() * 90,
      rot: `${Math.random() * 160 - 80}deg`,
    }));
    setFx((p) => [...p, ...items]);
    window.setTimeout(() => {
      const ids = new Set(items.map((i) => i.id));
      setFx((p) => p.filter((x) => !ids.has(x.id)));
    }, 950);
  }, []);

  const playAudio = useCallback(() => {
    const src = cur?.payload?.audio;
    if (!src) return;
    try {
      audioRef.current?.pause();
      const a = new Audio(src);
      audioRef.current = a;
      setPlaying(true);
      a.onended = () => setPlaying(false);
      a.onerror = () => setPlaying(false);
      a.play().catch(() => setPlaying(false));
    } catch { setPlaying(false); }
  }, [cur]);

  useEffect(() => {
    startedAt.current = Date.now();
    setPicked(null);
    setState('answering');
    setHelped(false);
    setFeedback(null);
    setPlaying(false);
    advancing.current = false;

    const src = questions[idx]?.payload?.audio;
    if (src) {
      const t = window.setTimeout(playAudio, 420);
      return () => window.clearTimeout(t);
    }
  }, [idx, questions, playAudio]);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const submit = async (index: number) => {
    if (state !== 'answering' || submitting) return;
    setPicked(index);
    setSubmitting(true);
    try {
      const r = await api.answer(sessionId, {
        questionId: cur.id, response: { index }, helped, elapsedMs: Date.now() - startedAt.current,
      });
      if (r.correct) {
        setState('right');
        setCorrectCount((c) => c + 1);
        setStreak((s) => {
          const ns = s + 1;
          setBestStreak((b) => Math.max(b, ns));
          return ns;
        });
        burst(helped ? 5 : 9);
        setFeedback({ kind: 'ok', text: helped ? '答对了！下次自己想出来会更棒' : PRAISE[Math.floor(Math.random() * PRAISE.length)] });
        chime(true);
        setJustAdvanced(idx);
        // 答对自动前进，节奏更连贯，像闯关而不是填表
        window.setTimeout(() => { setJustAdvanced(null); }, 420);
        window.setTimeout(() => { if (!advancing.current) next(); }, helped ? 1100 : 820);
      } else {
        setState('wrong');
        setStreak(0);
        setFeedback({ kind: 'no', text: ENCOURAGE[Math.floor(Math.random() * ENCOURAGE.length)] });
        chime(false);
      }
    } catch (e: any) {
      setFeedback({ kind: 'no', text: e.message ?? '提交失败' });
      setState('answering');
      setPicked(null);
    } finally {
      setSubmitting(false);
    }
  };

  const next = async () => {
    if (advancing.current) return;
    advancing.current = true;
    if (idx + 1 < total) { setIdx(idx + 1); return; }
    try {
      const res = await api.finish(sessionId);
      onFinish({
        ...res,
        game: {
          correct: correctCount + (state === 'right' ? 0 : 0),
          total, bestStreak,
        },
      });
    } catch (e: any) {
      onFinish({ error: e.message, stats: { total, correct: correctCount }, game: { total, bestStreak } });
    }
  };

  if (!cur) {
    return (
      <div className="result">
        <div className="result-card card">
          <p>没有题目</p>
          <button className="btn" onClick={onQuit}>回到小家</button>
        </div>
      </div>
    );
  }

  const options = cur.payload?.options ?? [];
  const longOptions = options.some((o: any) => (o.text ?? '').length > 14);

  return (
    <div className="quiz">
      {/* 关卡头部：进度轨道 */}
      <div className="quest">
        <div className="quest-head">
          <button className="chip" onClick={onQuit}>← 退出</button>
          <div style={{ flex: 1 }}>
            <div className="quest-title">{mode === 'review' ? '复习之路' : '阅读探险'}</div>
            <div className="quest-sub">
              {mode === 'review' ? `今天要把 ${total} 个老朋友叫醒` : `闯过 ${total} 关就能拿到宝箱`}
            </div>
          </div>
          {streak >= 2 && <span className="combo-badge">🔥 {streak} 连击</span>}
          <span className="quiz-count">{idx + 1} / {total}</span>
        </div>

        <div className="trail">
          {questions.map((_, i) => (
            <div
              key={i}
              className={`step ${i < idx ? 'done' : ''} ${i === idx ? 'current' : ''} ${justAdvanced === i ? 'just' : ''}`}
            >
              {i < idx ? '✓' : i + 1}
            </div>
          ))}
          <span
            className={`runner ${justAdvanced !== null ? 'hop' : ''}`}
            style={{ left: `${6 + (idx / Math.max(1, total - 1)) * 88}%` }}
          >
            🐶
          </span>
        </div>
      </div>

      {/* 题目卡 */}
      <div className={`quiz-card ${state === 'right' ? 'correct' : ''}`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="quiz-instruction">{cur.instruction || '选出正确的答案'}</span>
          <div className="stars" style={{ marginLeft: 'auto' }}>
            <i className={streak >= 1 ? 'on' : ''}>★</i>
            <i className={streak >= 2 ? 'on' : ''}>★</i>
            <i className={streak >= 3 ? 'on' : ''}>★</i>
          </div>
          {cur.payload?.audio && !cur.payload?.promptHidden && (
            <button className="chip" onClick={playAudio}>🔊 再听一次</button>
          )}
        </div>

        <div className={`quiz-prompt ${cur.prompt.length > 26 ? 'small' : ''}`}>{cur.prompt}</div>

        {cur.payload?.audio && cur.payload?.promptHidden && (
          <button className={`listen-btn ${playing ? 'playing' : ''}`} onClick={playAudio}>
            <span className="ico">{playing ? '🔊' : '▶'}</span>
            <span>{playing ? '正在播放…' : '点这里再听一次'}</span>
          </button>
        )}

        {options.length > 0 ? (
          <div className={`options ${options.length <= 4 ? 'cols-2' : ''} ${longOptions ? 'single' : ''}`}>
            {options.map((o: any, i: number) => {
              let st: string | undefined;
              if (state === 'answering') st = picked === i ? 'picked' : undefined;
              else if (picked === i) st = state === 'right' ? 'right' : 'wrong';
              return (
                <button
                  key={i}
                  className="option"
                  data-state={st}
                  disabled={state !== 'answering' || submitting}
                  onClick={() => submit(i)}
                >
                  {o.asset ? <img src={o.asset} alt="" style={{ maxHeight: 66, borderRadius: 10 }} /> : o.text}
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ color: 'var(--ink-soft)' }}>这道题暂时还不会做，先跳过吧</div>
        )}

        {feedback && (
          <div className={`feedback ${feedback.kind}`}>
            <span style={{ fontSize: 24 }}>{feedback.kind === 'ok' ? '🎉' : '💛'}</span>
            <span>{feedback.text}</span>
            {feedback.kind === 'ok' && streak >= 2 && (
              <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, opacity: .8 }}>连击 {streak}</span>
            )}
          </div>
        )}

        <div className="quiz-footer">
          {state === 'answering' && (
            <button
              className="chip"
              onClick={() => {
                setHelped(true);
                setFeedback({ kind: 'info', text: '小声提示：先听一遍，再看看哪个词最像。' });
              }}
            >
              💡 给我一点提示
            </button>
          )}
          <div className="grow" />
          {state !== 'answering' && (
            <button className="btn primary" onClick={next}>
              {isLast ? '打开宝箱 🎁' : '继续 →'}
            </button>
          )}
        </div>
      </div>

      {/* 粒子层 */}
      <div className="fx-layer">
        {fx.map((f) => (
          <span
            key={f.id}
            className="particle"
            style={{
              left: `${f.x}%`, top: `${f.y}%`,
              ['--dx' as any]: `${f.dx}px`, ['--dy' as any]: `${f.dy}px`, ['--rot' as any]: f.rot,
            }}
          >{f.emoji}</span>
        ))}
      </div>
    </div>
  );
}

/** 轻量音效：WebAudio 合成，不依赖素材 */
function chime(ok: boolean) {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const notes = ok ? [523.25, 783.99, 1046.5] : [392, 329.63];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = ok ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.085;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.11, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      o.start(t); o.stop(t + 0.3);
    });
    setTimeout(() => ctx.close?.(), 1000);
  } catch {}
}
