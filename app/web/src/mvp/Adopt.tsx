import { useState } from 'react';
import { api } from './api';
import type { TodayData } from './types';

import { PET_BREEDS as BREEDS } from './petBreeds';

interface Props {
  onDone: (data: TodayData) => void;
  onToast: (msg: string) => void;
  embedded?: boolean;
  onParent?: () => void;
  adoptFn?: (payload: { breed: string; name: string }) => Promise<any>;
}

export default function Adopt({ onDone, onToast, adoptFn, embedded, onParent }: Props) {
  const [breed, setBreed] = useState(BREEDS[0].id);
  const [name, setName] = useState('小橘');
  const [busy, setBusy] = useState(false);
  const [speciesFilter, setSpeciesFilter] = useState('all');
  const [hatching, setHatching] = useState<null | { species: string; name: string; data: TodayData }>(null);

  const chosen = BREEDS.find((b) => b.id === breed)!;

  const pick = (id: string) => {
    setBreed(id);
    const b = BREEDS.find((x) => x.id === id)!;
    setName(b.defaultName);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await (adoptFn || api.adopt)({ breed, name: name.trim() || chosen.name });
      setHatching({ species: data.pet?.species || 'cat', name: data.pet?.name || name, data });
      window.setTimeout(() => onDone(data), 2600);
    } catch (e: any) {
      onToast(e.message || '领养失败');
      setBusy(false);
    }
  };

  if (hatching) {
    const eggSpecies = ['capybara', 'alpaca'].includes(hatching.species) ? 'dog' : hatching.species;
    const egg = `pets/eggs/${eggSpecies}-egg.png`;
    const hatch = `pets/eggs/${eggSpecies}-hatch.png`;
    return (
      <div className={`adopt-overlay hatch-mode${embedded ? " embedded" : ""}`}>
        <div className="hatch-scene">
          <img className="hatch-egg" src={egg} alt="蛋" />
          <img className="hatch-burst" src={hatch} alt="破壳" />
          <div className="hatch-ring" />
          <p className="hatch-caption">欢迎来到小岛，<b>{hatching.name}</b></p>
          <p className="hatch-sub">从今天起，一起完成每天的小计划吧</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`adopt-overlay${embedded ? " embedded" : ""}`}>
      <div className="adopt-card">
        <div className="adopt-hero">
          <img src="pets/banner_task.jpg" alt="" />
          <div className="adopt-hero-copy">
            <span className="eyebrow">和小岛的第一天</span>
            <h1>领养你的学习伙伴</h1>
            <p>它不替你学习，但会记得你每一次认真。</p>
          </div>
        </div>

        <div className="adopt-body">
          <div className="breed-grid">
            <div className="filter-row breed-filters" aria-label="宠物种类">
              {[['all', '全部'], ['capybara', '卡皮巴拉'], ['alpaca', '羊驼'], ['cat', '猫'], ['dog', '狗'], ['bird', '鸟'], ['turtle', '龟']].map(([key, label]) =>
                <button key={key} className={`chip ${speciesFilter === key ? 'is-on' : ''}`} onClick={() => setSpeciesFilter(key)}>{label}</button>)}
            </div>
            {BREEDS.filter(b => speciesFilter === 'all' || b.speciesKey === speciesFilter).map((b) => (
              <button
                key={b.id}
                className={`breed-card ${breed === b.id ? 'is-on' : ''}`}
                onClick={() => pick(b.id)}
                type="button"
              >
                <span className="breed-avatar"><img src={b.avatar} alt={b.name} /></span>
                <span className="breed-name">{b.name}</span>
                <span className="breed-species">{b.species}</span>
                <span className="breed-trait">{b.trait}</span>
                <span className="breed-line">“{b.line}”</span>
                <span className="breed-check">✓</span>
              </button>
            ))}
            <p className="breed-note">卡皮巴拉也来小岛了，选一位喜欢的小伙伴吧。</p>
          </div>

          <div className="adopt-form">
            {onParent && <button className="btn ghost sm adopt-parent" onClick={onParent} disabled={busy}>家长管理</button>}
            <div className="chosen-breed">
              <span>{chosen.trait}</span>
              <b>“{chosen.line}”</b>
            </div>
            <label htmlFor="pet-name">给{chosen.name}取个名字</label>
            <div className="name-row">
              <input
                id="pet-name"
                value={name}
                maxLength={12}
                onChange={(e) => setName(e.target.value)}
                placeholder="比如：小橘"
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              />
              <button className="btn primary" type="button" disabled={busy} onClick={submit}>
                {busy ? '正在孵化…' : '就是它了'}
              </button>
            </div>
            <p className="adopt-note">领养后会先放好 3 个示例计划，可以随时改掉。</p>

            <div className="adopt-perks">
              <h4>从今天开始</h4>
              <ul>
                <li><span>📝</span>写下每天的小计划，完成就打勾</li>
                <li><span>★</span>打卡获得星贝，去材料铺换食物和玩具</li>
                <li><span>🌱</span>喂它、陪它，它会一点点长大</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
