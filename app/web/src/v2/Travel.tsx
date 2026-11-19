import { useEffect, useMemo, useRef, useState } from 'react';
import { Sheet } from '../mvp/Sheets';
import type { Pet } from '../mvp/types';
import { petAvatar } from '../mvp/petGrowth';
import type { TravelCity, TravelCollectible, TravelCollectibleType, TravelState, TravelTrip } from './types';

const TYPES: { key: TravelCollectibleType | 'all'; label: string }[] = [
  { key: 'all', label: '全部' }, { key: 'postcard', label: '明信片' }, { key: 'food', label: '美食' },
  { key: 'souvenir', label: '伴手礼' }, { key: 'badge', label: '徽章' }, { key: 'rare', label: '稀有' },
];
const ASSET: Record<TravelCollectibleType, string> = {
  postcard: 'postcards.webp', food: 'foods.webp', souvenir: 'souvenirs.webp', badge: 'badges.webp', rare: 'rare.webp',
};
const MATERIAL_NAME: Record<string, string> = {
  kibble: '香脆小饼干', fish: '小鱼干', milk: '温热羊奶', ball: '毛线球', feather: '羽毛逗趣棒', brush: '软毛小梳子', bath: '泡泡香香浴',
};
const HOURS = [1, 2, 3, 5];

function spriteStyle(item: Pick<TravelCollectible, 'type' | 'spriteIndex' | 'artVariant'>) {
  const col = item.spriteIndex % 5;
  const row = Math.floor(item.spriteIndex / 5);
  return {
    backgroundImage: `url('/travel/${item.type === 'postcard' && item.artVariant ? `postcards-${item.artVariant}.webp` : ASSET[item.type]}')`,
    backgroundPosition: `${col * 25}% ${row * 25}%`,
  };
}

function dateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function countdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
}

export function TravelScene({
  trip, pet, onReturn, onArrived, busy,
}: {
  trip: TravelTrip; pet: Pet; onReturn: () => void; onArrived: () => void; busy: boolean;
}) {
  const [confirmEarly, setConfirmEarly] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [backdropIndex, setBackdropIndex] = useState(0);
  const arrived = useRef(false);
  useEffect(() => {
    const tick = () => { if (!document.hidden) setNow(Date.now()); };
    const timer = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);
  useEffect(() => {
    setBackdropIndex(0);
    arrived.current = false;
    for (const stop of trip.itinerary) { const img = new Image(); img.src = '/travel/scenes/' + stop.id + '.webp'; }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => { if (!document.hidden) setBackdropIndex(index => index + 1); }, 14000);
    return () => window.clearInterval(timer);
  }, [trip.id]);
  const progress = Math.max(0, Math.min(1, (now - Date.parse(trip.startedAt)) / (Date.parse(trip.returnsAt) - Date.parse(trip.startedAt))));
  const city = trip.itinerary[backdropIndex % trip.itinerary.length];
  const remaining = Math.max(0, Date.parse(trip.returnsAt) - now);
  useEffect(() => {
    if (!remaining && !arrived.current && !busy) { arrived.current = true; onArrived(); }
  }, [remaining, busy, onArrived]);

  return <>
    <section className="scene travel-scene" aria-label={pet.name + '正在旅行'}>
      <div className="travel-scenery" aria-hidden="true">
        <img key={backdropIndex} className="travel-scenery-moving" src={'/travel/scenes/' + (city?.id || trip.cityId) + '.webp'} alt="" />
      </div>
      <div className="travel-shade" />
      <header className="travel-scene-head">
        <span className="travel-live"><i />旅途中</span>
        <div><span>沿途风景 · {trip.durationHours} 小时 · 途经 {trip.itinerary.length} 城</span><h2>{city?.name}</h2><p>{city?.landmark}</p></div>
      </header>
      <div className="travel-journey" aria-hidden="true">
        <div className="travel-earth"><img src="/travel/scenes/earth.webp" alt="" /></div>
        <img className="travel-traveler travel-pet-animated" src={pet.breed === 'alpaca_toon' ? '/travel/pets/alpaca_toon.gif' : `/${petAvatar(pet.breed)}`} alt="" />
        <img className="travel-traveler travel-pet-still" src={pet.breed === 'alpaca_toon' ? '/travel/pets/alpaca_toon.webp' : `/${petAvatar(pet.breed)}`} alt="" />
      </div>
      <div className="travel-route-line" aria-label={'旅行路线，共' + trip.itinerary.length + '个目的地'}>
        {trip.itinerary.map(stop => <div key={stop.id} className={stop.id === city?.id ? 'is-current' : ''}><i /><span>{stop.name}</span></div>)}
      </div>
      <div className="travel-countdown">
        <div><span>{remaining ? '距离回家还有' : '正在整理旅行行囊'}</span><strong>{countdown(remaining)}</strong></div>
        <div className="travel-progress"><i style={{ width: progress * 100 + '%' }} /></div>
        <span>出发 {dateTime(trip.startedAt)} · 计划 {trip.durationHours} 小时</span>
        <div className="travel-arrival"><span>回家 {dateTime(trip.returnsAt)}</span><button type="button" onClick={() => setConfirmEarly(true)} disabled={busy || !remaining}>立即回家</button></div>
      </div>
    </section>
    <Sheet open={confirmEarly} onClose={() => setConfirmEarly(false)} title="现在就回家吗？" sub="提前结束会减少收获，明信片仍会寄回。"
      footer={<div className="travel-return-actions"><button type="button" className="btn ghost" onClick={() => setConfirmEarly(false)}>继续旅行</button><button type="button" className="btn primary" disabled={busy} onClick={() => { setConfirmEarly(false); onReturn(); }}>{busy ? '正在返程…' : '确认回家'}</button></div>}>
      <p className="travel-return-hint">星贝和材料会按实际旅行进度减少，提前回家不会获得当地收藏。出发未满 15 分钟时只带回明信片。</p>
    </Sheet>
  </>;
}

export function TravelSheet({
  open, onClose, travel, pet, busy, onStart, onViewRewards,
}: {
  open: boolean; onClose: () => void; travel: TravelState; pet: Pet; busy: boolean;
  onStart: (cityId: string, hours: number) => void; onViewRewards: () => void;
}) {
  const [tab, setTab] = useState<'map' | 'collection'>('map');
  const [cityId, setCityId] = useState(travel.lastTrip?.cityId || 'beijing');
  const [duration, setDuration] = useState(1);
  const selected = travel.cities.find(city => city.id === cityId) || travel.cities[0];
  const grouped = useMemo(() => travel.cities.reduce<Record<string, TravelCity[]>>((all, city) => {
    (all[city.region] ||= []).push(city);
    return all;
  }, {}), [travel.cities]);

  const randomCity = () => {
    const choices = travel.cities.filter(city => city.id !== cityId);
    setCityId((choices.length ? choices : travel.cities)[Math.floor(Math.random() * (choices.length || travel.cities.length))]?.id || 'beijing');
  };
  const position = (city: TravelCity) => ({
    left: `${Math.max(3, Math.min(96, ((city.longitude - 73) / 64) * 100))}%`,
    top: `${Math.max(5, Math.min(94, ((54 - city.latitude) / 36) * 100))}%`,
  });

  return (
    <Sheet open={open} onClose={onClose} wide title="全国旅行地图" sub="少年阶段开放 · 每一趟都会寄回一张旅行明信片"
      footer={tab === 'map' && !travel.activeTrip ? <div className="travel-plan-footer">
        <div className="travel-duration-row"><div><b>旅行时长</b><span>预计到访 {duration + 1} 城</span></div><div className="travel-duration" role="group" aria-label="选择旅行时长">{HOURS.map(hours => <button key={hours} type="button" className={duration === hours ? 'is-on' : ''} aria-pressed={duration === hours} onClick={() => setDuration(hours)}>{hours} 小时</button>)}</div></div>
        <button type="button" className="btn primary block" disabled={!travel.unlocked || busy || !selected} onClick={() => travel.pendingTrip ? onViewRewards() : selected && onStart(selected.id, duration)}>{travel.pendingTrip ? '查看收获，查收行囊' : busy ? '正在整理行囊…' : !travel.unlocked ? '达到少年阶段后开启' : `出发去${selected?.name}`}</button>
      </div> : undefined}>
      <div className="travel-tabs" role="tablist" aria-label="旅行内容">
        <button role="tab" aria-selected={tab === 'map'} className={tab === 'map' ? 'is-on' : ''} onClick={() => setTab('map')}>规划旅行</button>
        <button role="tab" aria-selected={tab === 'collection'} className={tab === 'collection' ? 'is-on' : ''} onClick={() => setTab('collection')}>旅行收藏 <span>{travel.collection.length}/{travel.catalog.length}</span></button>
      </div>

      {tab === 'map' ? <>
        {!travel.unlocked && <div className="travel-lock" role="status"><span>🔒</span><div><b>少年阶段解锁旅行</b><p>{pet.progression.name} · 成长到少年后，就能带上背包出发啦。</p></div></div>}
        {travel.pendingTrip && <div className="travel-pending-banner"><div><b>旅行行囊等你查收</b><p>明信片和旅行收获已经带回来了。</p></div><button type="button" className="btn primary" onClick={onViewRewards}>查看收获</button></div>}
        {travel.activeTrip ? <div className="travel-sheet-active"><span className="travel-live"><i />旅途中</span><h3>{pet.name}正在{travel.activeTrip.cityName}</h3>
          <p>预计 {dateTime(travel.activeTrip.returnsAt)} 回家。宠物照料暂不可用，今日学习计划仍可继续。</p>
          <button className="btn primary" onClick={onClose}>回到小岛</button></div> : <>
          <div className="travel-map-layout">
            <div className="travel-map" role="group" aria-label="全国旅行目的地地图">
              <div className="travel-map-land" />
              <span className="travel-map-label label-northwest">西北</span><span className="travel-map-label label-northeast">东北</span>
              <span className="travel-map-label label-southwest">西南</span><span className="travel-map-label label-east">华东</span>
              {travel.cities.map(city => <button key={city.id} type="button" className={`travel-pin ${city.id === cityId ? 'is-selected' : ''}`} style={position(city)} title={`${city.name} · ${city.landmark}`} aria-label={`选择${city.name}`} aria-pressed={city.id === cityId} onClick={() => setCityId(city.id)}><i /><span>{city.name}</span></button>)}
            </div>
            <div className="travel-destination-detail">
              <div className="travel-destination-art" style={selected ? spriteStyle({ type: 'postcard', spriteIndex: selected.spriteIndex }) : undefined} />
              <div><span>{selected?.region} · {selected?.landmark}</span><h3>{selected?.name}</h3><p>{selected?.note}</p></div>
              <button type="button" onClick={randomCity} aria-label="随机选择旅行城市" title="随机选一个城市"><span aria-hidden="true">↻</span><small>随机</small></button>
            </div>
          </div>
          <div className="travel-city-groups">
            {Object.entries(grouped).map(([region, cities]) => <div key={region}><h4>{region}</h4><div>{cities.map(city => <button key={city.id} className={city.id === cityId ? 'is-on' : ''} type="button" onClick={() => setCityId(city.id)}>{city.name}</button>)}</div></div>)}
          </div>
          {travel.lastTrip?.outcome && <TripOutcome trip={travel.lastTrip} travel={travel} />}
        </>}
      </> : <TravelCollection travel={travel} pet={pet} onPlan={() => setTab('map')} />}
    </Sheet>
  );
}

export function TravelCollection({ travel, pet, initialOwnedOnly = false, onPlan }: { travel: TravelState; pet: Pick<Pet, 'name'>; initialOwnedOnly?: boolean; onPlan?: () => void }) {
  const [filter, setFilter] = useState<TravelCollectibleType | 'all'>('all');
  const [ownedOnly, setOwnedOnly] = useState(initialOwnedOnly);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);
  const owned = useMemo(() => new Map(travel.collection.map(item => [item.key, item])), [travel.collection]);
  const items = travel.catalog.filter(item => (filter === 'all' || item.type === filter) && (!ownedOnly || owned.has(item.key)));
  const detail = detailKey ? owned.get(detailKey) : null;
  useEffect(() => {
    if (detailKey) detailRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [detailKey]);

  return <>
        <div className="travel-ownership" role="group" aria-label="收藏拥有状态"><button type="button" aria-pressed={!ownedOnly} className={!ownedOnly ? 'is-on' : ''} onClick={() => setOwnedOnly(false)}>全部显示</button><button type="button" aria-pressed={ownedOnly} className={ownedOnly ? 'is-on' : ''} onClick={() => setOwnedOnly(true)}>显示已获得</button><span>已收集 {travel.collection.length} / {travel.catalog.length}</span></div>
        <div className="travel-filter" role="tablist" aria-label="收藏类别">{TYPES.map(type => <button type="button" role="tab" aria-selected={filter === type.key} key={type.key} className={filter === type.key ? 'is-on' : ''} onClick={() => setFilter(type.key)}>{type.label}{type.key !== 'all' && <span>{travel.collection.filter(item => item.type === type.key).length}</span>}</button>)}</div>
        {detail && <section ref={detailRef} className="travel-card-detail" aria-label="收藏详情"><div className="travel-card-picture" style={spriteStyle(detail)} /><div><span>{detail.cityName}</span><h3>{detail.name} {detail.type === 'rare' && <RarityTag />}</h3><p>{detail.description}</p>{detail.note && <blockquote>“{detail.note}”<cite>—— {pet.name}的旅行寄语</cite></blockquote>}<small>已收藏 {detail.qty || 1} 件 · 首次带回 {detail.firstAt ? dateTime(detail.firstAt) : ''}</small><button type="button" className="btn ghost sm" onClick={() => setDetailKey(null)}>收起</button></div></section>}
        {items.length === 0 && <div className="travel-empty"><b>这里还没有旅行收藏</b><p>带上背包出发吧，每趟旅行都会带回明信片。</p>{onPlan && <button className="btn ghost" onClick={onPlan}>去规划旅行</button>}</div>}
        <div className="travel-collection-grid">
          {items.map(item => <CollectibleCard key={item.key} item={item} collected={owned.get(item.key)} onOpen={() => setDetailKey(item.key)} />)}
        </div>

  </>;
}

function CollectibleCard({ item, collected, onOpen }: { item: TravelCollectible; collected?: TravelCollectible; onOpen: () => void }) {
  return <button type="button" disabled={!collected} onClick={onOpen} className={`travel-collectible ${collected ? 'is-collected' : 'is-unknown'}${item.type === 'rare' ? ' is-rare' : ''}`} aria-label={collected ? `查看${item.name}` : `${item.cityName}尚未发现的${TYPES.find(type => type.key === item.type)?.label}`}>
    <div className="travel-collectible-art" style={spriteStyle(item)}>{collected && collected.qty != null && collected.qty > 1 && <i>×{collected.qty}</i>}</div>
    <div><span>{item.cityName} · {TYPES.find(type => type.key === item.type)?.label}</span><h4>{item.type === 'rare' && <RarityTag />} {collected ? item.name : '尚未发现'}</h4><p>{collected ? item.description : '旅行中有机会遇见'}</p></div>
    {!collected && <b className="travel-unknown-mark">?</b>}
  </button>;
}

function RarityTag() { return <em className="travel-rarity-tag">稀有</em>; }

export function TravelRewardsSheet({ open, onClose, trip, travel, pet, busy, onClaim }: {
  open: boolean; onClose: () => void; trip: TravelTrip | null; travel: TravelState; pet: Pet;
  busy: boolean; onClaim: (tripId: string) => void;
}) {
  if (!trip?.outcome) return null;
  const outcome = trip.outcome;
  const drops = outcome.collectionDrops.flatMap(drop => {
    const item = travel.catalog.find(item => item.key === drop.key);
    return item ? [{ ...item, qty: drop.qty }] : [];
  });
  const postcards = drops.filter(item => item.type === 'postcard');
  const treasures = drops.filter(item => item.type !== 'postcard');
  return <Sheet open={open} onClose={onClose} wide title={trip.earlyReturn ? '小伙伴提前回家啦' : '旅行圆满结束啦'}
    sub={`${pet.name}带回了 ${postcards.length} 张明信片，来打开这趟旅行的行囊。`}
    footer={<div className="travel-claim-footer"><span>{trip.awaitingClaim ? '查收后，收藏与补给收入背包，星贝存入钱包' : '这份旅行收获已经查收'}</span><button type="button" className="btn primary" disabled={busy} onClick={() => trip.awaitingClaim ? onClaim(trip.id) : onClose()}>{busy ? '正在收入行囊…' : trip.awaitingClaim ? '立即查收' : '收好了'}</button></div>}>
    <div className="travel-receipt-heading"><div><span>来自远方的问候</span><h3>把一路风景，带回给你</h3><p>{trip.itinerary.filter(stop => outcome.destinations.includes(stop.id)).map(stop => stop.name).join(' → ')}</p></div><span className="travel-receipt-seal">{trip.earlyReturn ? '提前返程' : '旅途完成'}<small>{outcome.progress}% 行程</small></span></div>
    {trip.earlyReturn && <p className="travel-early-note">本次提前回家，收获按实际进度减少；不足 15 分钟只带回明信片。</p>}
    <section className="travel-reward-supplies" aria-label="本次旅行获得的物品"><h4>行囊里的收获 <span>{trip.awaitingClaim ? '待查收' : '已收入背包'}</span></h4>
      <div className="travel-reward-items">
        {treasures.map(item => <div className={`travel-reward-item${item.type === 'rare' ? ' is-rare' : ''}`} key={item.key}><i className="travel-item-art" style={spriteStyle(item)} /><div><b>{item.name} {item.type === 'rare' && <RarityTag />}</b><span>{TYPES.find(type => type.key === item.type)?.label} · × {item.qty}</span></div></div>)}
        {outcome.coins > 0 && <div className="travel-reward-item"><i className="travel-coin">★</i><div><b>星贝</b><span>× {outcome.coins}</span></div></div>}
        {[...outcome.foodDrops, ...outcome.materialDrops].map(drop => <div className="travel-reward-item" key={drop.key}><i className="travel-material-icon">{{ kibble: '🍪', fish: '🐟', milk: '🥛', ball: '🧶', feather: '🪶', brush: '🪮', bath: '🫧' }[drop.key] || '🎒'}</i><div><b>{MATERIAL_NAME[drop.key] || drop.key}</b><span>× {drop.qty}</span></div></div>)}
      </div>
      {!outcome.foodDrops.length && !outcome.materialDrops.length && !treasures.length && <p className="travel-supplies-note">这次带回了珍贵的城市问候。下次走远一点，还会发现更多收获。</p>}
    </section>
    <div className="travel-postcards">
      {postcards.map(item => <article className="travel-reward-postcard" key={item.key}>
        <div className="travel-postcard-image" style={spriteStyle(item)} role="img" aria-label={item.name} />
        <div><span>{item.cityName} · {item.name.split('·').at(-1)}</span><blockquote>“{item.note}”</blockquote><cite>—— {pet.name}的旅行寄语</cite></div>
      </article>)}
    </div>
  </Sheet>;
}

function TripOutcome({ trip, travel }: { trip: TravelTrip; travel: TravelState }) {
  const drops = trip.outcome?.collectionDrops || [];
  const resolve = (key: string) => travel.catalog.find(item => item.key === key);
  return <section className="travel-outcome" aria-label="最近一次旅行收获">
    <div><b>{trip.earlyReturn ? '提前回家' : '上次旅行收获'}</b><span>{trip.cityName} · +{trip.outcome?.coins || 0} 星贝</span></div>
    <div className="travel-outcome-drops">
      {drops.map(drop => {
        const item = resolve(drop.key);
        return item ? <span key={drop.key}><i style={spriteStyle(item)} />{item.name}{item.type === 'rare' && <RarityTag />}{drop.qty > 1 ? ` ×${drop.qty}` : ''}</span> : null;
      })}
      {(trip.outcome?.foodDrops || []).map(drop => <span key={`food-${drop.key}`}><i>{drop.key === 'fish' ? '🐟' : drop.key === 'milk' ? '🥛' : '🍪'}</i>{MATERIAL_NAME[drop.key]} ×{drop.qty}</span>)}
      {(trip.outcome?.materialDrops || []).map(drop => <span key={`material-${drop.key}`}><i>{drop.key === 'ball' ? '🧶' : drop.key === 'feather' ? '🪶' : drop.key === 'brush' ? '🪮' : '🫧'}</i>{MATERIAL_NAME[drop.key]} ×{drop.qty}</span>)}
    </div>
    {drops.filter(drop => resolve(drop.key)?.type === 'postcard').map(drop => {
      const item = resolve(drop.key);
      return item?.note ? <p className="travel-return-note" key={`note-${drop.key}`}><b>{item.cityName}寄语</b>“{item.note}”</p> : null;
    })}
  </section>;
}
