import { useEffect, useRef, useState } from 'react';
import PetStage, { type PetStageHandle } from '../mvp/PetStage';
import { PET_BREEDS } from '../mvp/petBreeds';
import { Sheet } from '../mvp/Sheets';
import type { Pet } from '../mvp/types';
import { GROWTH_LOOKS, growthLook, hasGrowthLooks } from '../mvp/petGrowth';
import type { PetAction } from '../mvp/petEngine';

export default function PetPicker({ open, onClose, pet, busy, onChoose }: {
  open: boolean; onClose: () => void; pet: Pet; busy: boolean; onChoose: (breed: string) => void;
}) {
  const [selected, setSelected] = useState(pet.breed);
  const [filter, setFilter] = useState('all');
  const [age, setAge] = useState(pet.stage);
  const stageRef = useRef<PetStageHandle | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (open) {
      const preview = new URLSearchParams(location.search).get('petPreview');
      setSelected(PET_BREEDS.some(b => b.id === preview) ? preview! : pet.breed);
      setFilter('all');
      setAge(pet.stage);
    }
  }, [open, pet.breed]);
  const chosen = PET_BREEDS.find(b => b.id === selected) || PET_BREEDS[0];
  const list = PET_BREEDS.filter(b => filter === 'all' || b.speciesKey === filter);
  const previewPet: Pet = { ...pet, id: `preview-${chosen.id}`, breed: chosen.id, name: chosen.defaultName,
    species: chosen.speciesKey, sound: chosen.speciesKey, stage: hasGrowthLooks(chosen.id) ? age : 2, outfit: {} };
  const play = (action: PetAction) => stageRef.current?.play(action);
  const choose = (breed: string) => {
    setSelected(breed);
    if (window.matchMedia('(max-width: 720px)').matches) {
      previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  return (
    <Sheet open={open} onClose={onClose} wide title="选择小伙伴" sub="先试试动作，也看看小伙伴长大后的模样"
      footer={<div className="pet-picker-footer"><p>保留名字、成长、星贝和全部计划。</p>
        <button className="btn primary" disabled={busy || chosen.id === pet.breed} onClick={() => onChoose(chosen.id)}>
          {busy ? '正在更换…' : chosen.id === pet.breed ? '正在陪伴你' : `选${chosen.name}`}
        </button></div>}
    >
      <div className="pet-picker-layout">
        <div className="pet-picker-options">
          <div className="filter-row" aria-label="宠物种类">
            {([['all', '全部'], ['capybara', '卡皮巴拉'], ['alpaca', '羊驼'], ['cat', '猫'], ['dog', '狗'], ['bird', '鸟'], ['turtle', '龟']] as const).map(([key, label]) =>
              <button key={key} className={`chip ${filter === key ? 'is-on' : ''}`} onClick={() => setFilter(key)}>{label}</button>)}
          </div>
          <div className="pet-picker-grid">
            {list.map(b => <button key={b.id} className={`pet-choice ${selected === b.id ? 'is-selected' : ''}`}
              aria-pressed={selected === b.id} onClick={() => choose(b.id)}>
              <img src={b.avatar} alt="" /><span>{b.name}</span>
              {(b.id === 'capybara_toon' || b.id === 'alpaca_toon') && <small>新伙伴</small>}
              {b.id === 'dog_corgi_toon' && <small>成长新装</small>}
              {b.id === pet.breed && <small>当前</small>}
            </button>)}
          </div>
        </div>
        <div className="pet-picker-preview" ref={previewRef}>
          <div className="scene tone-day"><div className="scene-bg" /><div className="scene-vignette" />
            {open && <PetStage ref={stageRef} pet={previewPet} muted displayScale={0.68} movementRange={[42, 58]} />}
          </div>
          <h4>{chosen.name}<span>{chosen.defaultName}</span></h4>
          <p>{chosen.trait}</p>
          {hasGrowthLooks(chosen.id) && <div className="pet-growth-preview">
            <div className="pet-age-options" role="group" aria-label="预览成长年龄">
              {GROWTH_LOOKS.map(look => <button key={look.stage} aria-pressed={age === look.stage}
                className={age === look.stage ? 'is-on' : ''} onClick={() => setAge(look.stage)}>{look.name}</button>)}
            </div>
            <p><strong>{growthLook(age).look}</strong> · {growthLook(age).detail}</p>
            <small>年龄仅供预览，实际成长由陪伴时间和成长值积累，达标后点击升级。</small>
          </div>}
          <div className="pet-preview-actions" aria-label="试试宠物动作">
            <button onClick={() => play('greet')}>坐好</button>
            <button onClick={() => stageRef.current?.wanderRandom()}>走走</button>
            <button onClick={() => play('feed')}>吃饭</button><button onClick={() => play('pet')}>摸摸</button>
            <button onClick={() => play('play')}>陪玩</button><button onClick={() => play('sleep')}>睡觉</button>
            <button onClick={() => play('wake')}>醒来</button>
            <button onClick={() => play('hug')}>抱抱</button><button onClick={() => play('stretch')}>伸懒腰</button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
