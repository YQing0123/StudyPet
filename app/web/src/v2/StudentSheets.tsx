import { TravelCollection } from './Travel';
import { ItemArt } from './RoomDecor';
import { useEffect, useRef, useState } from 'react';
import { Sheet } from '../mvp/Sheets';
import { v2 } from './api';
import type { InvItem, Pet, ShopItem, Wallet, GrowthMemory } from '../mvp/types';
import type { RewardV2, StudentState, TaskV2 } from './types';
import { STAT_HELP } from './lines';
import { GROWTH_LOOKS, hasGrowthLooks, petAvatar } from '../mvp/petGrowth';
import { growthHint } from './petProgress';

const KIND_LABEL: Record<string, string> = { food: '食物', toy: '玩具', clean: '清洁', deco: '装扮', scene: '场景', furniture: '家具' };
const EFFECT_LABEL: Record<string, string> = { hunger: '饱食', energy: '精力', mood: '心情', clean: '清洁', growth: '成长', cleanTo: '清洁补满至' };

function EffectChips({ effect }: { effect: Record<string, number | string> }) {
  const chips = Object.entries(effect || {})
    .filter(([k, v]) => k !== 'outfit' && Number(v) !== 0)
    .map(([k, v]) => (
      <span key={k} className={`eff ${Number(v) < 0 ? 'is-down' : ''}`}>
        {EFFECT_LABEL[k] || k} {k === 'cleanTo' ? '' : Number(v) > 0 ? '+' : ''}{v}
      </span>
    ));
  if (effect?.outfit) chips.push(<span key="outfit" className="eff">永久装扮 · {effect.outfit === 'crown' ? '头部' : '颈部'}</span>);
  return <div className="effect-row">{chips}</div>;
}

export function taskStatusText(t: TaskV2) {
  if (t.status === 'approved') return `已通过 +${t.awardedPoints ?? t.basePoints}`;
  if (t.status === 'submitted') return '等家长审核';
  if (t.status === 'rejected') return '被退回';
  return '去完成';
}

export function taskPhotoSrc(task: Pick<TaskV2, 'photo' | 'photoUrl'>) {
  return task.photoUrl || task.photo || '';
}

export function TaskDetail({
  open, task, onClose, onSubmit, busy,
}: {
  open: boolean; task: TaskV2 | null; onClose: () => void;
  onSubmit: (id: string, body: { note?: string; photo?: string | null }) => void; busy: boolean;
}) {
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState('');
  const [photoLoading, setPhotoLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNote(task?.note || '');
    setPhoto(task ? taskPhotoSrc(task) || null : null);
  }, [task?.id, open, task?.note, task?.photo, task?.photoUrl]);

  if (!task) return null;

  const canSubmit = task.status === 'open' || task.status === 'rejected';
  const pickPhoto = async (file?: File) => {
    if (!file) return;
    setPhotoError(''); setPhotoLoading(true);
    try {
      const url = await compressImage(file);
      setPhoto(url);
    } catch { setPhotoError('这张照片没能读出来，请换一张再试。'); }
    finally { setPhotoLoading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return (
    <Sheet
      open={open} onClose={onClose} wide
      title={task.title}
      sub={`${task.subject} · ${task.minutes} 分钟 · ${task.timeLabel}`}
      footer={canSubmit ? (
        <button className="btn primary block" disabled={busy || photoLoading || (task.photoRequired && !photo)} onClick={() => onSubmit(task.id, { note, photo })}>
          {photoLoading ? '正在准备照片…' : busy ? '正在提交…' : task.photoRequired && !photo ? '先拍一张照片' : task.reviewRequired ? '提交给家长审核' : '完成，直接领星贝'}
        </button>
      ) : (
        <div className={`status-foot status-${task.status}`}>
          {task.status === 'submitted' && `预计 +${task.awardedPoints ?? task.basePoints} 星贝，等家长审核后到账。`}
          {task.status === 'approved' && `完成于 ${task.approvedAt ? new Date(task.approvedAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}，已入账 ${task.awardedPoints} 星贝。`}
          {task.status === 'rejected' && `退回原因：${task.rejectReason || '再检查一下'}`}
        </div>
      )}
    >
      <div className="task-detail-top">
        <div className="task-detail-icon">{task.icon}</div>
        <div>
          <div className={`status-chip status-${task.status}`}>{taskStatusText(task)}</div>
          <p className="task-detail-sub">{task.timingLabel ? `${task.timingLabel} · ` : ''}完成时段 {task.timeLabel}</p>
        </div>
      </div>

      <div className="rule-list">
        {task.rulesText.map((r) => <span key={r} className="rule-pill">{r}</span>)}
      </div>

      {task.rejectReason && (
        <div className="reject-note"><b>家长的退回说明</b><p>{task.rejectReason}</p></div>
      )}

      <label className="field-label">给家长留一句话（可选）</label>
      <textarea
        className="text-area"
        value={note}
        maxLength={300}
        placeholder="比如：今天读了 2 遍，生词都标出来了"
        onChange={(e) => setNote(e.target.value)}
        disabled={!canSubmit}
      />

      <label className="field-label">
        {task.photoRequired ? '拍照上传（必填）' : '拍照上传（可选）'}
      </label>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
      {photoError && <p role="alert" className="reject-note">{photoError}</p>}
      {photo ? (
        <div className="photo-preview">
          <img src={photo} alt="任务照片" />
          {canSubmit && <button className="photo-remove" onClick={() => setPhoto(null)}>重拍</button>}
        </div>
      ) : (
        <button className="photo-add" onClick={() => fileRef.current?.click()} disabled={!canSubmit}>
          <span>📷</span>
          {task.photoRequired ? '点这里拍照，交给家长看' : '拍一张给家长看（可选）'}
        </button>
      )}

      <div className="detail-note">
        {task.reviewRequired
          ? '这项任务需要家长审核，审核通过后星贝才会到账。'
          : '这项任务不需要审核，提交后星贝立即到账。'}
      </div>
    </Sheet>
  );
}

async function compressImage(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = dataUrl;
  });
  const max = 720;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.72);
}

export function MaterialShop({
  open, onClose, data, onBuy, busy, feeding = false, onBag,
}: {
  open: boolean; onClose: () => void; data: StudentState; onBuy: (key: string) => void; busy: boolean; feeding?: boolean; onBag: () => void;
}) {
  const [filter, setFilter] = useState('all');
  useEffect(() => { if (open) setFilter(feeding ? 'food' : 'all'); }, [open, feeding]);
  const list = filter === 'all' ? data.shop : data.shop.filter((x) => x.kind === filter);
  return (
    <Sheet open={open} onClose={onClose} wide title="材料铺"
      headerAction={<button type="button" className="shop-bag-entry" onClick={onBag}><span aria-hidden="true">🧺</span> 进入背包</button>}
      sub={feeding ? '先换一份食物，接着去背包喂给它' : '装扮、场景和家具永久拥有，慢慢收集自己的小家'}
      footer={<div className="wallet-line"><span>我的星贝</span><b>★ {data.wallet.balance}</b><span className="muted">今日赚 {data.wallet.todayEarned}</span></div>}
    >
      <div className="filter-row">
        {[['all', '全部'], ['food', '食物'], ['toy', '玩具'], ['clean', '清洁'], ['deco', '装扮'], ['scene', '场景'], ['furniture', '家具']].map(([k, v]) => (
          <button key={k} className={`chip ${filter === k ? 'is-on' : ''}`} onClick={() => setFilter(k)}>{v}</button>
        ))}
      </div>
      {(filter === 'scene' || filter === 'furniture') && <p className="room-progress">已收藏 {data.room.owned.length} / {data.shop.filter(x => x.kind === 'scene' || x.kind === 'furniture').length} 件场景与家具 · 兑换后到背包使用</p>}
      <div className="shop-grid">
        {list.map((item) => (
          <article key={item.key} className={`shop-card kind-${item.kind}`}>
            <div className={item.asset ? "room-shop-art" : "shop-icon"}><ItemArt item={item} /></div>
            <div className="shop-main">
              <h4>{item.name}<span>{KIND_LABEL[item.kind]}</span></h4>
              <p>{item.desc}</p>
              <EffectChips effect={item.effect as any} />
            </div>
            <button className="buy-btn" disabled={busy || data.wallet.balance < item.cost || (['deco', 'scene', 'furniture'].includes(item.kind) && data.inventory.some(x => x.key === item.key))} onClick={() => onBuy(item.key)}>
              <span>★ {item.cost}</span>
              {['deco', 'scene', 'furniture'].includes(item.kind) && data.inventory.some(x => x.key === item.key) ? '已拥有' : data.wallet.balance < item.cost ? `还差 ${item.cost - data.wallet.balance}` : '兑换'}
            </button>
          </article>
        ))}
      </div>
    </Sheet>
  );
}

export function BagPanel({
  open, onClose, data, onUse, onShower, busy, tab, setTab,
}: {
  open: boolean; onClose: () => void; data: StudentState; onUse: (key: string, equipped?: boolean) => void; busy: boolean;
  onShower: () => void;
  tab: string; setTab: (t: string) => void;
}) {
  const items = data.inventory;
  const list = tab === 'all' ? items : items.filter((x) => x.kind === tab);
  return (
    <Sheet open={open} onClose={onClose} wide title="小背包"
      sub="物品在这里使用；场景与家具永久收藏，家具放好后长按可编辑"
      footer={<div className="wallet-line"><span>星贝余额</span><b>★ {data.wallet.balance}</b><span className="muted">背包 {items.reduce((s, x) => s + x.qty, 0)} 件</span></div>}
    >
      <div className="filter-row">
        {[['all', '全部'], ['food', '食物'], ['toy', '玩具'], ['clean', '清洁'], ['deco', '装扮'], ['scene', '场景'], ['furniture', '家具'], ['travel', '旅行收藏']].map(([k, v]) => (
          <button key={k} className={`chip ${tab === k ? 'is-on' : ''}`} onClick={() => setTab(k)}>
            {v}{k !== 'all' && <em>{k === 'travel' ? data.travel.collection.length : items.filter((x) => x.kind === k).reduce((s, x) => s + x.qty, 0)}</em>}
          </button>
        ))}
      </div>
      {(tab === 'all' || tab === 'clean') && data.pet && <div className="hygiene-card">
        <div><b>🚿 每日免费简单淋浴</b><p>清洁 {data.pet.stats.clean.toFixed(1)} / 100 · 每天一次，增加{data.hygiene.showerIncrease}，最高{data.hygiene.showerCap}。<br />低于{data.hygiene.showerMinClean}需用🛀泡泡浴，洗后补满100。</p>
          <p>{data.hygiene.showerUsed ? '今天的免费淋浴已使用，明天再来。' : data.pet.stats.clean < data.hygiene.showerMinClean ? '现在需要认真泡澡，简单冲洗还不够哦。' : data.pet.stats.clean >= data.hygiene.showerCap ? '现在已经很清爽啦。' : '今天还可以免费淋浴一次。'}</p></div>
        <button className="btn tiny" disabled={busy || !data.hygiene.showerAvailable || !!data.sleep.active} onClick={onShower}>{data.sleep.active ? '睡醒再洗' : data.hygiene.showerUsed ? '今日已洗' : '免费淋浴'}</button>
      </div>}
      {(tab === 'scene' || tab === 'furniture') && <p className="room-collection-note">场景可随时切换。家具放进房间后，长按或按回车进入编辑，拖动摆放、旋转、调整前后层；点空白处保存。每件家具可摆放一次。</p>}
      {tab === 'travel' && data.pet ? <TravelCollection travel={data.travel} pet={data.pet} initialOwnedOnly /> : list.length === 0 ? (
        <div className="bag-empty"><div className="bag-empty-art">🧺</div><h4>这里还是空的</h4><p>去材料铺换一点它喜欢的东西吧。</p></div>
      ) : (
        <div className="bag-grid">
          {list.map((item) => (
            <article key={item.key} className={`bag-card kind-${item.kind}`}>
              <div className="bag-icon"><ItemArt item={item} /><i>{['deco', 'scene', 'furniture'].includes(item.kind) ? '永久' : `×${item.qty}`}</i></div>
              <div className="bag-main"><h4>{item.name}<span>{KIND_LABEL[item.kind]}</span></h4><EffectChips effect={{ ...item.effect, growth: Math.min(Number(item.effect.growth) || 0, data.pet?.progression.daily.sources[item.kind] || 0) }} />
                {item.kind === 'deco' && <small className="material-growth-note">{data.pet?.outfit[item.key] || Object.values(data.pet?.outfit || {}).includes(item.key) ? '已穿戴 · ' : ''}{item.key === 'crown' ? '戴在头顶' : '系在颈前'}，可与{item.key === 'crown' ? '蝴蝶结' : '皇冠'}一起穿戴{Number(item.effect.mood) > 0 ? `；首次戴上心情 +${item.effect.mood}` : ''}</small>}
                {!['deco', 'scene', 'furniture'].includes(item.kind) && data.pet && <small className="material-growth-note">本次成长 +{Math.min(Number(item.effect.growth) || 0, data.pet.progression.daily.sources[item.kind] || 0)} · 今天此类还可获{data.pet.progression.daily.sources[item.kind] || 0}点
                  {Object.entries(item.effect).filter(([k, v]) => ['hunger', 'energy', 'mood', 'clean', 'cleanTo'].includes(k) && Number(v) > 0).every(([k]) => data.pet!.stats[(k === 'cleanTo' ? 'clean' : k) as keyof Pet['stats']] >= 99.5) ? '；当前可恢复的状态已满，使用仍会消耗材料。' : ''}</small>}
              </div>
              <button className="btn tiny" disabled={busy || (!data.pet && !['scene','furniture'].includes(item.kind)) || (item.kind === 'clean' && (!!data.sleep.active || (item.key !== 'bath' && (data.pet?.stats.clean ?? 100) < data.hygiene.showerMinClean)))} onClick={() => onUse(item.key, item.kind === 'furniture' ? !data.room.placements.some(p => p.key === item.key) : item.kind !== 'deco' || !(data.pet?.outfit[item.key] || Object.values(data.pet?.outfit || {}).includes(item.key)))}>
                {item.kind === 'scene' ? data.room.sceneKey === item.key ? '使用中' : '换场景' : item.kind === 'furniture' ? data.room.placements.some(p => p.key === item.key) ? '收回' : '放进房间' : !data.pet ? '先领养' : item.kind === 'food' ? '喂给它' : item.kind === 'toy' ? '一起玩' : item.kind === 'clean' ? data.sleep.active ? '睡醒再用' : item.key !== 'bath' && data.pet.stats.clean < data.hygiene.showerMinClean ? '需要泡泡浴' : item.key === 'bath' ? '泡个澡' : '梳梳毛' : data.pet.outfit[item.key] || Object.values(data.pet.outfit).includes(item.key) ? '取下' : '戴上'}
              </button>
            </article>
          ))}
        </div>
      )}
      {tab === 'all' && data.travel.collection.length > 0 && <button className="travel-bag-link" onClick={() => setTab('travel')}><span>💌 旅行收藏</span><b>{data.travel.collection.length} 种纪念物 · 查看 →</b></button>}
    </Sheet>
  );
}

export function RewardShop({
  open, onClose, data, onRedeem, busy,
}: {
  open: boolean; onClose: () => void; data: StudentState; onRedeem: (id: string) => void; busy: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} wide title="心愿奖励"
      sub="除了养宠物，还可以用星贝兑换家长准备的小心愿"
      footer={<div className="wallet-line"><span>我的星贝</span><b>★ {data.wallet.balance}</b><span className="muted">兑换后由家长兑现</span></div>}
    >
      {data.rewards.length === 0 ? (
        <div className="bag-empty"><div className="bag-empty-art">🎁</div><h4>还没有上架奖励</h4><p>让家长在家长端加一些心愿吧。</p></div>
      ) : (
        <div className="reward-grid">
          {data.rewards.map((r) => (
            <article key={r.id} className="reward-card">
              <div className="reward-icon">{r.icon}</div>
              <div className="reward-main">
                <h4>{r.title}</h4>
                <p>{r.note || (r.kind === 'experience' ? '一次特别体验' : r.kind === 'item' ? '一件小礼物' : '一项特权')}</p>
                <span className={`stock ${r.stock === 0 ? 'is-out' : ''}`}>{r.stock < 0 ? '不限量' : r.stock === 0 ? '已兑完' : `剩 ${r.stock} 份`}</span>
              </div>
              <button className="buy-btn reward-buy" disabled={busy || data.wallet.balance < r.cost || r.stock === 0} onClick={() => onRedeem(r.id)}>
                <span>★ {r.cost}</span>
                {data.wallet.balance < r.cost ? `还差 ${r.cost - data.wallet.balance}` : r.stock === 0 ? '已兑完' : '兑换'}
              </button>
            </article>
          ))}
        </div>
      )}
      {data.redemptions.length > 0 && (
        <div className="redeem-pending">
          <h4>等待家长兑现</h4>
          {data.redemptions.map((r) => (
            <div key={r.id} className="redeem-row"><span>{r.icon}</span><b>{r.title}</b><em>★ {r.cost}</em><i>待兑现</i></div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

export function StatSheet({ open, onClose, pet }: { open: boolean; onClose: () => void; pet: Pet | null }) {
  return (
    <Sheet open={open} onClose={onClose} title="它现在怎么样" sub="这些数值会随时间和你的照顾变化">
      <div className="stat-help-list">
        {STAT_HELP.map((s) => {
          const value = pet ? (pet.stats as any)[s.key] : 0;
          return (
            <div key={s.key} className={`stat-help tone-${s.color}`}>
              <div className="stat-help-top"><span>{s.icon}</span><b>{s.name}</b><em>{Math.round(value)}</em></div>
              <div className="stat-bar"><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
              <p>{s.desc}</p>
            </div>
          );
        })}
      </div>
      <div className="stat-help-foot">
        <b>怎么让它更好</b>
        <p>完成任务会让它心情变好；喂食补饱食；陪玩增加心情；清洁用品补清洁；小憩恢复精力。成长值每满50，会掉一件材料。</p>
        <b>怎样一起长大</b><p>六个年龄各有初阶、进阶。离开小岛时，自然时间也会前进；1点成长提供1小时助力，最快把自然等待缩短一半。多出的助力会存起来。达标后由你点击升级，不会自己变身。</p>
        {pet?.progression && <p>今天已获得{pet.progression.daily.earned}成长，还可获得{pet.progression.daily.remaining}成长（每日上限{pet.progression.daily.cap}点）。</p>}
        <p>每天前三项今日任务通过，各得4成长；摸摸、陪玩、抱抱各前两次各得1点；食物、玩具、清洁用品各最多2点。每天合计最多24点，按北京时间零点更新。换宠物、重养、恢复备份都共享当日额度；历史任务补审仍发星贝。</p>
        <p>没有每天必须凑满的要求。先休息也在长大，没打卡不扣成长。</p>
        {pet?.progression && <p>{pet.progression.name} → {pet.progression.nextName || '继续陪伴'}：{growthHint(pet.progression)}</p>}
      </div>
      <div className="social-card">
        <b>它也会这样表达需要</b>
        <p>“我有点饿了，可以给我一点吃的吗？”</p>
        <p>“我现在不想被摸，等我吃完饭好吗？”</p>
        <p>“这件事我还没做好，你可以教教我吗？”</p>
        <span>你也可以这样跟它说：说出感受、说出需要、给对方一个选择。</span>
      </div>
    </Sheet>
  );
}

export function StudentMenu({
  open, onClose, data, muted, onToggleMute, onRename, onStat, onParent, onPets, onReplay,
}: {
  open: boolean; onClose: () => void; data: StudentState; muted: boolean;
  onToggleMute: () => void; onRename: (name: string) => void;
  onStat: () => void; onParent: () => void; onPets: () => void; onReplay: (event: GrowthMemory) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(data.pet?.name || '');
  useEffect(() => { setName(data.pet?.name || ''); setEditing(false); }, [open, data.pet?.name]);

  return (
    <Sheet open={open} onClose={onClose} title="小岛档案" sub="慢慢来，记录都留在这里">
      {data.pet && (
        <div className="profile">
          <img src={petAvatar(data.pet.breed, data.pet.stage)} alt="" />
          <div className="profile-main">
            {editing ? (
              <div className="name-edit">
                <input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} autoFocus />
                <button className="btn tiny" onClick={() => { onRename(name); setEditing(false); }}>保存</button>
              </div>
            ) : (
              <h4>{data.pet.name} <button className="link-btn" onClick={() => setEditing(true)}>改名</button></h4>
            )}
            <p>{data.pet.progression.name} · 第 {Math.max(1, Math.floor(data.pet.stageInfo.days) + 1)} 天 · 成长 {data.pet.growth}</p>
          </div>
          <div className="profile-badge">★ {data.wallet.balance}</div>
        </div>
      )}
      {data.pet && hasGrowthLooks(data.pet.breed) && <div className="pet-growth-album">
        <h4>一起长大的模样</h4>
        <p>{growthHint(data.pet.progression)}</p>
        <div className="pet-growth-looks">{GROWTH_LOOKS.map(look => <div key={look.stage}
          className={`${look.stage === data.pet!.stage ? 'is-current' : ''} ${look.stage > data.pet!.stage ? 'is-future' : ''}`}>
          <img src={petAvatar(data.pet!.breed, look.stage)} alt={`${look.name}，${look.look}`} />
          <b>{look.name}</b><span>{look.look}</span>{look.stage === data.pet!.stage && <small>现在的我</small>}
        </div>)}</div>
        <button className="link-btn" onClick={onPets}>试试各个年龄的动作 →</button>
      </div>}
      {data.pet && <div className="growth-memories"><h4>一起长大的回忆</h4>
        <p>每次点击长大，都会留下一段回忆。每个年龄的进阶还有一枚常驻星章。</p>
        {!hasGrowthLooks(data.pet.breed) && <p>这位伙伴会变换体型并点亮星章。卡通柯基和卡皮巴拉还会换上各年龄的新衣。</p>}
        {data.pet.growthMemories.length ? data.pet.growthMemories.map(event => <button key={event.id} className="growth-memory-row" onClick={() => onReplay(event)}><span>✦ {event.name}<small>{new Date(event.createdAt).toLocaleDateString('zh-CN')}</small></span><b>{event.seen ? '重播' : '补看'} →</b></button>) : <p>第一次长大的回忆，正在路上。</p>}
      </div>}
      <div className="menu-list">
        <button className="menu-row" onClick={onPets}><span>选择宠物</span><b>看看所有小伙伴 →</b></button>
        <button className="menu-row" onClick={onStat}><span>状态说明</span><b>看看它需要什么</b></button>
        <button className="menu-row" onClick={onToggleMute}><span>宠物音效</span><b>{muted ? '已关闭' : '开启中'}</b></button>
        <button className="menu-row" onClick={onParent}><span>家长模式</span><b>安排与审核 →</b></button>
        <div className="menu-row static"><span>连续打卡</span><b>{data.wallet.streak} 天</b></div>
      </div>
      <div className="danger-zone"><p>重新领养与清空记录，请由家长在「设置」中操作。</p><button className="link-btn" onClick={onParent}>进入家长管理</button></div>
    </Sheet>
  );
}
