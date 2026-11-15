import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PetParts, { type ActionName } from '../PetParts';
import { api, type PetSnapshot } from '../api';

type Props = {
  boot: any;
  pet: PetSnapshot | null;
  onRefreshPet: () => Promise<PetSnapshot>;
  onStart: (mode: string, bookId?: any, pageFrom?: number, pageTo?: number) => void;
  onParent: () => void;
  onToast: (m: string) => void;
};

type Hotspot = { key: string; emoji: string; x: number; bottom: number; action: string; label: string };

const NEED_LABEL: Record<string, string> = {
  satiety: '饱腹', clean: '清洁', mood: '开心', energy: '精力', health: '健康',
};

/** 每个场景的可交互物件：点它宠物会走过去并使用 */
const SCENE_HOTSPOTS: Record<string, Hotspot[]> = {
  home: [
    { key: 'bowl', emoji: '🥣', x: 13, bottom: 12, action: 'feed', label: '饭盆' },
    { key: 'ball', emoji: '🎾', x: 85, bottom: 20, action: 'play', label: '小球' },
    { key: 'tub', emoji: '🛁', x: 93, bottom: 30, action: 'bath', label: '浴缸' },
    { key: 'bed', emoji: '🛏️', x: 74, bottom: 14, action: 'sleep', label: '小床' },
  ],
  yard: [
    { key: 'tree', emoji: '🌳', x: 11, bottom: 22, action: 'play', label: '大树' },
    { key: 'ball', emoji: '⚽', x: 82, bottom: 11, action: 'play', label: '皮球' },
    { key: 'flower', emoji: '🌷', x: 93, bottom: 26, action: 'pet', label: '小花' },
  ],
  park: [
    { key: 'slide', emoji: '🛝', x: 86, bottom: 14, action: 'play', label: '滑梯' },
    { key: 'balloon', emoji: '🎈', x: 12, bottom: 40, action: 'play', label: '气球' },
    { key: 'bench', emoji: '🪑', x: 73, bottom: 9, action: 'sleep', label: '长椅' },
  ],
  hospital: [
    { key: 'bed', emoji: '🛏️', x: 15, bottom: 14, action: 'heal', label: '病床' },
    { key: 'kit', emoji: '💊', x: 86, bottom: 18, action: 'heal', label: '药箱' },
  ],
  beach: [
    { key: 'shell', emoji: '🐚', x: 84, bottom: 11, action: 'pet', label: '贝壳' },
    { key: 'ball', emoji: '🏐', x: 14, bottom: 17, action: 'play', label: '沙滩球' },
  ],
};

const SCENE_HINT: Record<string, string> = {
  home: '窝在熟悉的角落', yard: '阳光洒在草地上', park: '远处有孩子的笑声',
  hospital: '安静，只有轻轻的脚步声', beach: '风带着咸咸的味道',
};

const SCENE_EMOJI: Record<string, string> = {
  home: '🏠', yard: '🌳', park: '🎠', hospital: '🏥', beach: '🏖️',
};

type Fx = { id: number; kind: 'p' | 't'; x: number; y: number; text?: string; emoji?: string; cls?: string; dx?: number; dy?: number; rot?: number };

export default function Home({ boot, pet, onRefreshPet, onStart, onParent, onToast }: Props) {
  const [scene, setScene] = useState('home');
  const [say, setSay] = useState<string | null>(null);
  const [actionFx, setActionFx] = useState<'idle' | 'hop' | 'eat' | 'sleep'>('idle');
  const [today, setToday] = useState<any>(null);
  const [panel, setPanel] = useState<'state' | 'diary' | 'album'>('state');
  const [busy, setBusy] = useState<string | null>(null);

  // ---- 角色移动 ----
  const [pos, setPos] = useState({ x: 50, facing: 1 });
  const [walking, setWalking] = useState(false);
  const posRef = useRef({ x: 50, facing: 1 });
  const targetRef = useRef<number | null>(null);
  const pendingRef = useRef<null | (() => void)>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  // ---- 特效 ----
  const [fx, setFx] = useState<Fx[]>([]);
  const fxId = useRef(0);

  const addFx = useCallback((list: Omit<Fx, 'id'>[]) => {
    const withIds = list.map((f) => ({ ...f, id: ++fxId.current }));
    setFx((prev) => [...prev, ...withIds]);
    window.setTimeout(() => {
      const ids = new Set(withIds.map((w) => w.id));
      setFx((prev) => prev.filter((p) => !ids.has(p.id)));
    }, 1100);
  }, []);

  const burst = useCallback((x: number, y: number, emojis = ['✨', '⭐', '💛']) => {
    addFx(emojis.flatMap((emoji, i) => [0, 1].map((k) => ({
      kind: 'p' as const, x, y, emoji,
      dx: (i - 1) * 34 + (k ? 16 : -16),
      dy: -54 - Math.random() * 34,
      rot: `${Math.random() * 120 - 60}deg`,
    }))));
  }, [addFx]);

  const floatText = useCallback((x: number, y: number, text: string, cls = '') => {
    addFx([{ kind: 't', x, y, text, cls }]);
  }, [addFx]);

  // ---- 行走循环 ----
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const tgt = targetRef.current;
      if (tgt != null) {
        const cur = posRef.current.x;
        const dx = tgt - cur;
        if (Math.abs(dx) < 0.8) {
          targetRef.current = null;
          posRef.current = { x: tgt, facing: posRef.current.facing };
          setPos(posRef.current);
          setWalking(false);
          const fn = pendingRef.current;
          pendingRef.current = null;
          fn?.();
        } else {
          const nx = cur + Math.sign(dx) * Math.min(Math.abs(dx), 30 * dt);
          posRef.current = { x: nx, facing: dx > 0 ? 1 : -1 };
          setPos(posRef.current);
          setWalking(true);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const walkTo = (x: number, then?: () => void) => {
    targetRef.current = Math.max(10, Math.min(90, x));
    pendingRef.current = then ?? null;
  };

  useEffect(() => {
    api.today().then(setToday).catch(() => {});
  }, [boot]);

  const petState = pet?.state;
  const face = pet?.mood?.face ?? 'happy';
  const lowEnergy = (petState?.energy ?? 100) < 35;

  // ---- 行为 ----
  const runAction = async (key: string, at?: { x: number; y: number }) => {
    if (busy) return;
    setBusy(key);
    setActionFx(key === 'feed' || key === 'water' ? 'eat' : key === 'sleep' ? 'sleep' : 'hop');
    try {
      const r = await api.petAction(key);
      if (!r.ok && r.reason === 'NO_ITEM') {
        onToast(r.need === 'food' ? '没有粮食啦，去冒险赢一点吧' : '没有这个物品');
        floatText(at?.x ?? 50, at?.y ?? 40, '没有材料', 'warm');
      } else {
        setSay(r.text);
        if (at) burst(at.x, at.y - 8);
        floatText(at?.x ?? 50, (at?.y ?? 40) - 18, `+${key === 'play' ? '3' : '2'} EXP`);
        await onRefreshPet();
        window.setTimeout(() => setSay(null), 2800);
      }
    } catch (e: any) {
      onToast(e.message ?? '互动失败');
    } finally {
      setBusy(null);
      window.setTimeout(() => setActionFx('idle'), 700);
    }
  };

  const clickHotspot = (h: Hotspot) => {
    // 站在物件旁边而不是压在物件上，否则道具会被身体挡住
    const standAt = h.x > 50 ? h.x - 20 : h.x + 20;
    walkTo(standAt, () => runAction(h.action, { x: h.x, y: 100 - h.bottom }));
  };

  const clickGround = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pct = ((e.clientX - r.left) / r.width) * 100;
    const yPct = ((e.clientY - r.top) / r.height) * 100;
    addFx([{ kind: 'p', x: pct, y: yPct, emoji: '', dx: 0, dy: 0 }]);
    walkTo(pct);
  };

  const changeScene = (key: string) => {
    setScene(key);
    const react: Record<string, string> = {
      home: '还是家里最舒服', yard: '这里的草好软！', park: '有小朋友在玩！',
      hospital: '不太喜欢这里…', beach: '风里有海的味道',
    };
    setSay(react[key] ?? null);
    window.setTimeout(() => setSay(null), 2400);
  };

  const plan = today?.day;
  const book = today?.book;
  const dueCount = today?.dueCount ?? boot?.today?.dueCount ?? 0;
  const canStudy = !!plan && !!book;
  const hotspots = SCENE_HOTSPOTS[scene] ?? [];

  // 状态 → 动作：优先级从「正在发生的行为」到「身体状态」
  const petAction: ActionName = useMemo(() => {
    if (walking) return 'walk';
    if (actionFx === 'eat') return 'eat';
    if (actionFx === 'sleep') return 'sleep';
    if (actionFx === 'hop') return 'happy';
    if ((petState?.health ?? 100) < 45) return 'sick';
    if ((petState?.energy ?? 100) < 25) return 'sleep';
    if ((petState?.mood ?? 100) < 35) return 'sick';
    return 'idle';
  }, [walking, actionFx, petState]);

  const needs = useMemo(() => ([
    { k: 'satiety', v: petState?.satiety ?? 0, cls: 'warm' },
    { k: 'clean', v: petState?.clean ?? 0, cls: 'mint' },
    { k: 'mood', v: petState?.mood ?? 0, cls: 'mint' },
    { k: 'energy', v: petState?.energy ?? 0, cls: 'gold' },
    { k: 'health', v: petState?.health ?? 0, cls: 'rose' },
  ]), [petState]);

  const startAdventure = () => {
    if (!canStudy) { onToast('先去家长端安排今天读哪几页'); onParent(); return; }
    walkTo(50, () => onStart('training', book.id, plan.page_from, plan.page_to));
  };

  return (
    <div className="wrap">
      <div className="home">
        <div>
          {/* ============ 可玩场景 ============ */}
          <div className={`stage scene-${scene}`} ref={stageRef} onClick={clickGround}>
            {/* 场景底景 */}
            <SceneDecor scene={scene} />

            {/* 角色 */}
            <div
              className={`pet-actor ${walking ? 'walking' : ''}`}
              style={{ left: `${pos.x}%`, ['--facing' as any]: pos.facing }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); runAction('pet', { x: pos.x, y: 40 }); }}
            >
              <PetParts
                action={petAction}
                scale={pet?.scale ?? 1}
                onTap={() => runAction('pet')}
              />
            </div>

            {/* 场景热点 */}
            {hotspots.map((h) => (
              <button
                key={h.key}
                className="hotspot"
                style={{ left: `${h.x}%`, bottom: `${h.bottom}%` }}
                onClick={(e) => { e.stopPropagation(); clickHotspot(h); }}
                title={h.label}
              >
                <span className="h-emoji">{h.emoji}</span>
                <span className="h-label">{h.label}</span>
              </button>
            ))}

            {/* 冒险入口 */}
            <button className="portal" onClick={(e) => { e.stopPropagation(); startAdventure(); }}>
              <span className="p-emoji">{dueCount > 0 ? '📕' : '📖'}</span>
              <span className="p-label">
                {canStudy ? (dueCount > 0 ? `复习 ${dueCount} 个` : '出发冒险') : '去看看书'}
              </span>
            </button>

            {/* 名牌与气泡 */}
            <div className="nameplate">
              <div className="avatar">🐶</div>
              <b>{pet?.name ?? '豆豆'}</b>
              <span className="lv">Lv.{pet?.level ?? 1}</span>
            </div>
            <div className="mood-bubble">{say ?? pet?.mood?.text ?? '看到你就很开心'}</div>
            <div className="scene-caption">{SCENE_HINT[scene]}</div>

            {/* 场景切换 */}
            <div className="scene-switch" onClick={(e) => e.stopPropagation()}>
              {(pet?.scenes ?? []).map((s) => (
                <button
                  key={s.key}
                  className="scene-btn"
                  aria-pressed={scene === s.key}
                  disabled={!s.unlocked}
                  onClick={() => changeScene(s.key)}
                  title={s.unlocked ? s.desc : `Lv.${s.unlockLevel} 解锁`}
                >
                  <span>{s.emoji}</span>
                  <span>{s.unlocked ? s.name : `Lv.${s.unlockLevel}`}</span>
                </button>
              ))}
            </div>

            {/* 特效层 */}
            <div className="fx-layer">
              {fx.map((f) => f.kind === 'p' && f.emoji ? (
                <span key={f.id} className="particle"
                      style={{
                        left: `${f.x}%`, top: `${f.y}%`,
                        ['--dx' as any]: `${f.dx}px`, ['--dy' as any]: `${f.dy}px`, ['--rot' as any]: f.rot ?? '0deg',
                      }}>{f.emoji}</span>
              ) : f.kind === 'p' ? (
                <span key={f.id} className="burst-ring" style={{ left: `${f.x}%`, top: `${f.y}%` }} />
              ) : (
                <span key={f.id} className={`float-text ${f.cls ?? ''}`}
                      style={{ left: `${f.x}%`, top: `${f.y}%` }}>{f.text}</span>
              ))}
            </div>
          </div>

          {/* 快捷互动条（次级，主操作在场景里） */}
          <div className="actions">
            {(pet?.actions ?? []).map((a) => (
              <button
                key={a.key}
                className="action-btn"
                disabled={a.disabled || !!busy}
                onClick={() => runAction(a.key, { x: pos.x, y: 40 })}
              >
                <span className="emoji">{a.emoji}</span>
                <span className="label">{a.label}</span>
                {a.cost && <span className="need">×{a.cost.qty}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* ============ 侧栏 ============ */}
        <div className="side">
          <div className="card card-tight">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ flex: 1 }}>{pet?.name} 的记录</h2>
              <div className="seg">
                {([['state', '状态'], ['diary', '日记'], ['album', '回忆']] as const).map(([k, n]) => (
                  <button key={k} aria-pressed={panel === k} onClick={() => setPanel(k)}>{n}</button>
                ))}
              </div>
            </div>

            {panel === 'state' && (
              <>
                <p className="sub">
                  {pet?.stageName} · 亲密度 {pet?.bond ?? 0} · 经验 {pet?.exp ?? 0}/{pet?.need ?? 50}
                </p>
                <div className="needs">
                  {needs.map((n) => (
                    <div className="need-row" key={n.k}>
                      <span>{NEED_LABEL[n.k]}</span>
                      <div className={`bar ${n.cls}`}><i style={{ width: `${n.v}%` }} /></div>
                      <b>{Math.round(n.v)}</b>
                    </div>
                  ))}
                </div>
              </>
            )}

            {panel === 'diary' && (
              <>
                <p className="sub">它最近做的事</p>
                <Timeline
                  items={(pet?.events ?? []).map((e) => ({ text: e.detail ?? e.kind, time: fmtTime(e.created_at) }))}
                  empty="还没有日记"
                />
              </>
            )}

            {panel === 'album' && (
              <>
                <p className="sub">一起走过的里程碑</p>
                <Timeline
                  items={(pet?.milestones ?? []).map((m) => ({ text: m.detail ? `${m.title} · ${m.detail}` : m.title, time: fmtDate(m.created_at) }))}
                  empty="还没有留下回忆"
                />
              </>
            )}
          </div>

          <div className="card card-tight task-card">
            <h2>今天的小约定</h2>
            {canStudy ? (
              <>
                <p className="sub">{book?.title} · 第 {plan.page_from}–{plan.page_to} 页</p>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 10 }}>
                  <span className="big">{dueCount}</span>
                  <span className="sub" style={{ margin: 0 }}>{dueCount > 0 ? '个要复习' : '准备好了'}</span>
                </div>
                <button className="btn block" style={{ marginTop: 16 }}
                        onClick={startAdventure}>
                  {dueCount > 0 ? '先去复习' : '出发冒险'}
                </button>
              </>
            ) : (
              <>
                <p className="sub">还没有安排今天的学习</p>
                <button className="btn block" style={{ marginTop: 16 }} onClick={onParent}>去安排</button>
              </>
            )}
          </div>

          <div className="card card-tight">
            <h2>背包</h2>
            <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
              <Item emoji="🍖" name="粮食" n={pet?.inventory?.food ?? 0} />
              <Item emoji="💧" name="水" n={pet?.inventory?.water ?? 0} />
              <Item emoji="💊" name="药" n={pet?.inventory?.medicine ?? 0} />
            </div>
          </div>

          {lowEnergy && (
            <div className="card card-tight" style={{ borderColor: '#F0CFC6' }}>
              <h2 style={{ color: '#A3492F' }}>它累了</h2>
              <p className="sub">让它睡一会儿，精力会恢复。</p>
            </div>
          )}

          <button className="btn ghost sm block" onClick={onParent}>家长端</button>
        </div>
      </div>
    </div>
  );
}

function SceneDecor({ scene }: { scene: string }) {
  const e = SCENE_EMOJI[scene];
  if (scene === 'home') return <div className="scene-decor"><span className="decor-prop" style={{ right: '6%', bottom: '44%', fontSize: 34, opacity: .8 }}>🪴</span><span className="decor-prop" style={{ left: '6%', bottom: '45%', fontSize: 30, opacity: .75 }}>🧸</span></div>;
  if (scene === 'yard') return <div className="scene-decor"><div className="decor-floor grass" /><span className="decor-sun">☀️</span><span className="decor-cloud c1">☁️</span><span className="decor-tree t2">🌲</span></div>;
  if (scene === 'park') return <div className="scene-decor"><div className="decor-floor grass" /><span className="decor-sun">🌞</span><span className="decor-cloud c1">☁️</span><span className="decor-cloud c2">☁️</span></div>;
  if (scene === 'hospital') return <div className="scene-decor"><div className="decor-floor tile" /><span className="decor-prop" style={{ left: '10%', bottom: '38%', fontSize: 38 }}>⚕️</span><span className="decor-cloud c1" style={{ opacity: .3 }}>☁️</span></div>;
  if (scene === 'beach') return <div className="scene-decor"><div className="decor-floor sand" /><span className="decor-sun">🌅</span><span className="decor-cloud c1">☁️</span><span className="decor-prop" style={{ right: '12%', fontSize: 56 }}>⛱️</span></div>;
  return <div className="scene-decor">{e}</div>;
}

function Timeline({ items, empty }: { items: { text: string; time: string }[]; empty: string }) {
  if (!items.length) {
    return <div className="empty" style={{ padding: '26px 0' }}><div className="e" style={{ fontSize: 34 }}>🌱</div>{empty}</div>;
  }
  return (
    <div className="timeline">
      {items.slice(0, 10).map((it, i) => (
        <div className="tl-item" key={i}>
          <div className="tl-dot">·</div>
          <div className="tl-body">
            <div className="tl-text">{it.text}</div>
            <div className="tl-time">{it.time}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Item({ emoji, name, n }: { emoji: string; name: string; n: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{ fontSize: 22 }}>{emoji}</span>
      <div style={{ lineHeight: 1.25 }}>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{name}</div>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{n}</div>
      </div>
    </div>
  );
}

function fmtTime(iso: string) {
  try {
    const d = new Date(iso); const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const hh = String(d.getHours()).padStart(2, '0'); const mm = String(d.getMinutes()).padStart(2, '0');
    return sameDay ? `今天 ${hh}:${mm}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
  } catch { return ''; }
}
function fmtDate(iso: string) {
  try { const d = new Date(iso); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; } catch { return ''; }
}
