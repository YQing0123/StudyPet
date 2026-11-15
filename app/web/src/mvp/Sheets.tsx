import { useEffect, useMemo, useRef, useState } from 'react';
import type { InvItem, Pet, ShopItem, TodayData } from './types';

/* ---------------- 通用弹层 ---------------- */
export function Sheet({
  open, onClose, title, sub, children, wide = false, footer,
}: {
  open: boolean; onClose: () => void; title: string; sub?: string;
  children: React.ReactNode; wide?: boolean; footer?: React.ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(sheetRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]') || []).filter((el) => el.getClientRects().length);
    const frame = requestAnimationFrame(() => (focusables()[0] || sheetRef.current)?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      if (e.key === 'Tab') {
        const list = focusables(), first = list[0], last = list[list.length - 1];
        if (!list.length) { e.preventDefault(); sheetRef.current?.focus(); }
        else if (e.shiftKey && (document.activeElement === first || !sheetRef.current?.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !sheetRef.current?.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [open]);

  if (!open) return null;
  return (
    <div className="sheet-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={sheetRef} tabIndex={-1} className={`sheet ${wide ? 'is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <div>
            <h3>{title}</h3>
            {sub && <p>{sub}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------- 材料铺 ---------------- */
const KIND_LABEL: Record<string, string> = { food: '食物', toy: '玩具', clean: '清洁', deco: '装扮' };
const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'food', label: '食物' },
  { key: 'toy', label: '玩具' },
  { key: 'clean', label: '清洁' },
  { key: 'deco', label: '装扮' },
];

export function ShopSheet({
  open, onClose, data, onBuy, busy,
}: {
  open: boolean; onClose: () => void; data: TodayData; onBuy: (key: string) => void; busy: boolean;
}) {
  const [filter, setFilter] = useState('all');
  const list = filter === 'all' ? data.shop : data.shop.filter((x) => x.kind === filter);

  return (
    <Sheet
      open={open} onClose={onClose} wide
      title="小岛材料铺"
      sub={`完成任务赚星贝，换材料照顾 ${data.pet?.name || '它'}`}
      footer={<div className="wallet-line"><span>我的星贝</span><b>★ {data.wallet.balance}</b><span className="muted">今日赚 {data.wallet.todayEarned}</span></div>}
    >
      <div className="filter-row">
        {FILTERS.map((f) => (
          <button key={f.key} className={`chip ${filter === f.key ? 'is-on' : ''}`} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="shop-grid">
        {list.map((item) => (
          <article key={item.key} className={`shop-card kind-${item.kind}`}>
            <div className="shop-icon">{item.icon}</div>
            <div className="shop-main">
              <h4>{item.name}<span>{KIND_LABEL[item.kind]}</span></h4>
              <p>{item.desc}</p>
              <EffectChips item={item} />
            </div>
            <button
              className="buy-btn"
              disabled={busy || data.wallet.balance < item.cost}
              onClick={() => onBuy(item.key)}
            >
              <span>★ {item.cost}</span>
              {data.wallet.balance < item.cost ? `还差 ${item.cost - data.wallet.balance}` : '兑换'}
            </button>
          </article>
        ))}
      </div>
    </Sheet>
  );
}

function EffectChips({ item }: { item: ShopItem | InvItem }) {
  const labels: Record<string, string> = { hunger: '饱食', energy: '精力', mood: '心情', clean: '清洁', growth: '成长' };
  const chips = Object.entries(item.effect || {})
    .filter(([k]) => k !== 'outfit')
    .map(([k, v]) => (
      <span key={k} className={`eff ${Number(v) < 0 ? 'is-down' : ''}`}>
        {labels[k] || k} {Number(v) > 0 ? '+' : ''}{v}
      </span>
    ));
  if (item.effect?.outfit) chips.push(<span key="outfit" className="eff">换新装扮</span>);
  return <div className="effect-row">{chips}</div>;
}

/* ---------------- 背包 ---------------- */
export function BagSheet({
  open, onClose, data, onUse, busy, tab, setTab,
}: {
  open: boolean; onClose: () => void; data: TodayData; onUse: (key: string) => void; busy: boolean;
  tab: string; setTab: (t: string) => void;
}) {
  const items = data.inventory;
  const filtered = tab === 'all' ? items : items.filter((x) => x.kind === tab);

  return (
    <Sheet
      open={open} onClose={onClose} wide
      title="我的小背包"
      sub="完成任务、开百宝箱都会掉材料"
      footer={<div className="wallet-line"><span>星贝余额</span><b>★ {data.wallet.balance}</b><span className="muted">背包 {items.reduce((s, x) => s + x.qty, 0)} 件</span></div>}
    >
      <div className="filter-row">
        {FILTERS.map((f) => (
          <button key={f.key} className={`chip ${tab === f.key ? 'is-on' : ''}`} onClick={() => setTab(f.key)}>
            {f.label}{f.key !== 'all' && <em>{items.filter((x) => x.kind === f.key).reduce((s, x) => s + x.qty, 0)}</em>}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bag-empty">
          <div className="bag-empty-art">🧺</div>
          <h4>{items.length ? '这个分类还是空的' : '背包空空的'}</h4>
          <p>去材料铺换一点食物或玩具吧。</p>
        </div>
      ) : (
        <div className="bag-grid">
          {filtered.map((item) => (
            <article key={item.key} className={`bag-card kind-${item.kind}`}>
              <div className="bag-icon">{item.icon}<i>×{item.qty}</i></div>
              <div className="bag-main">
                <h4>{item.name}<span>{KIND_LABEL[item.kind]}</span></h4>
                <EffectChips item={item} />
              </div>
              <button className="btn tiny" disabled={busy} onClick={() => onUse(item.key)}>
                {item.kind === 'food' ? '喂给它' : item.kind === 'toy' ? '一起玩' : item.kind === 'clean' ? '用一下' : '戴上'}
              </button>
            </article>
          ))}
        </div>
      )}
    </Sheet>
  );
}

/* ---------------- 添加任务 ---------------- */
const SUBJECTS = ['语文', '数学', '英语', '阅读', '运动', '其他'];
const PRESETS = [
  { title: '晨读 15 分钟', subject: '语文', minutes: 15 },
  { title: '数学口算 20 题', subject: '数学', minutes: 20 },
  { title: '英语单词 10 个', subject: '英语', minutes: 12 },
  { title: '练字一页', subject: '语文', minutes: 15 },
  { title: '自由阅读 20 分钟', subject: '阅读', minutes: 20 },
];

export function TaskSheet({
  open, onClose, onAdd, busy,
}: {
  open: boolean; onClose: () => void; onAdd: (t: { title: string; subject: string; minutes: number; points: number }) => void; busy: boolean;
}) {
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('语文');
  const [minutes, setMinutes] = useState(15);
  const [points, setPoints] = useState(12);
  const [touchedPoints, setTouchedPoints] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 60);
    } else {
      setTitle(''); setSubject('语文'); setMinutes(15); setPoints(12); setTouchedPoints(false);
    }
  }, [open]);

  useEffect(() => {
    if (!touchedPoints) setPoints(Math.max(5, Math.min(60, Math.round(minutes * 0.8))));
  }, [minutes, touchedPoints]);

  const add = () => {
    if (!title.trim()) return;
    onAdd({ title: title.trim(), subject, minutes, points });
  };

  return (
    <Sheet open={open} onClose={onClose} title="加一个今日任务" sub="小步走，也算数"
      footer={<button className="btn primary block" disabled={busy || !title.trim()} onClick={add}>{busy ? '正在添加…' : '放进今日计划'}</button>}
    >
      <label className="field-label">任务名称</label>
      <input
        ref={inputRef}
        className="text-input"
        value={title}
        maxLength={60}
        placeholder="比如：晨读 15 分钟"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
      />

      <div className="preset-row">
        {PRESETS.map((p) => (
          <button key={p.title} className="preset" onClick={() => { setTitle(p.title); setSubject(p.subject); setMinutes(p.minutes); setTouchedPoints(false); }}>
            {p.title}
          </button>
        ))}
      </div>

      <label className="field-label">科目</label>
      <div className="filter-row">
        {SUBJECTS.map((s) => (
          <button key={s} className={`chip ${subject === s ? 'is-on' : ''}`} onClick={() => setSubject(s)}>{s}</button>
        ))}
      </div>

      <div className="dual">
        <div>
          <label className="field-label">预计用时</label>
          <div className="stepper">
            <button onClick={() => setMinutes((m) => Math.max(5, m - 5))}>−</button>
            <b>{minutes}<i>分钟</i></b>
            <button onClick={() => setMinutes((m) => Math.min(180, m + 5))}>＋</button>
          </div>
        </div>
        <div>
          <label className="field-label">完成奖励</label>
          <div className="stepper">
            <button onClick={() => { setTouchedPoints(true); setPoints((p) => Math.max(5, p - 1)); }}>−</button>
            <b>{points}<i>星贝</i></b>
            <button onClick={() => { setTouchedPoints(true); setPoints((p) => Math.min(60, p + 1)); }}>＋</button>
          </div>
        </div>
      </div>
      <p className="form-note">完成全部任务，还会额外获得 {15} 星贝。</p>
    </Sheet>
  );
}

/* ---------------- 设置 / 档案 ---------------- */
export function MenuSheet({
  open, onClose, pet, muted, onToggleMute, onRename, onReset, wallet,
}: {
  open: boolean; onClose: () => void; pet: Pet | null; muted: boolean;
  onToggleMute: () => void; onRename: (name: string) => void; onReset: () => void;
  wallet: TodayData['wallet'];
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(pet?.name || '');
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => { setName(pet?.name || ''); setEditing(false); setConfirmReset(false); }, [open, pet?.name]);

  return (
    <Sheet open={open} onClose={onClose} title="小岛档案" sub="慢慢来，记录都留在这里">
      {pet && (
        <div className="profile">
          <img src={`pets/avatars/${pet.breed}.png`} alt="" />
          <div className="profile-main">
            {editing ? (
              <div className="name-edit">
                <input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} autoFocus />
                <button className="btn tiny" onClick={() => { onRename(name); setEditing(false); }}>保存</button>
              </div>
            ) : (
              <h4>{pet.name} <button className="link-btn" onClick={() => setEditing(true)}>改名</button></h4>
            )}
            <p>{pet.stageInfo.name} · 来到小岛第 {Math.max(1, Math.floor(pet.stageInfo.days) + 1)} 天 · 成长 {pet.growth}</p>
          </div>
          <div className="profile-badge">★ {wallet.balance}</div>
        </div>
      )}

      <div className="menu-list">
        <button className="menu-row" onClick={onToggleMute}>
          <span>宠物音效</span><b>{muted ? '已关闭' : '开启中'}</b>
        </button>
        <div className="menu-row static">
          <span>连续打卡</span><b>{wallet.streak} 天</b>
        </div>
        <div className="menu-row static">
          <span>累计星贝</span><b>★ {wallet.balance}</b>
        </div>
      </div>

      <div className="danger-zone">
        <p>重新领养会清空当前的宠物、积分和任务记录。</p>
        {confirmReset ? (
          <div className="inline-confirm">
            <button className="btn ghost sm" onClick={() => setConfirmReset(false)}>再想想</button>
            <button className="btn danger sm" onClick={onReset}>确认清空</button>
          </div>
        ) : (
          <button className="link-btn danger-text" onClick={() => setConfirmReset(true)}>重新领养</button>
        )}
      </div>
    </Sheet>
  );
}
