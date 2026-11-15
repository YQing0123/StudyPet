import { useState } from 'react';
import PetParts, { type ActionName } from '../PetParts';

const ACTIONS: { key: ActionName; label: string }[] = [
  { key: 'idle', label: '待机' },
  { key: 'walk', label: '走路' },
  { key: 'eat', label: '吃饭' },
  { key: 'happy', label: '开心' },
  { key: 'sleep', label: '睡觉' },
  { key: 'sick', label: '生病' },
];

export default function PartsLab() {
  const [picked, setPicked] = useState<ActionName>('idle');

  return (
    <div style={{ padding: 24, minHeight: '100%' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <h1 style={{ fontSize: 20, color: 'var(--green)', marginBottom: 4 }}>
          部件动画实验室
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 18 }}>
          同一张 PNG，六个动作。关键帧只是参数，中间帧由插值生成。
        </p>

        {/* 六宫格：同时演示全部动作 */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14,
          marginBottom: 20,
        }}>
          {ACTIONS.map((a) => (
            <div key={a.key} style={{
              position: 'relative', height: 300, borderRadius: 20,
              background: 'linear-gradient(180deg,#FFFCF2,#F4E9D4)',
              border: '1px solid var(--line)', overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', left: 14, top: 10, zIndex: 2, fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>
                {a.label}
              </div>
              <PetParts action={a.key} scale={1.02} />
            </div>
          ))}
        </div>

        {/* 单只放大，可切换 */}
        <div style={{
          position: 'relative', height: 460, borderRadius: 26, overflow: 'hidden',
          background: 'linear-gradient(180deg,#FFFCF2,#F4E9D4)',
          border: '1px solid var(--line)',
        }}>
          <PetParts action={picked} scale={1.5} />
          <div style={{ position: 'absolute', left: '50%', bottom: 14, transform: 'translateX(-50%)', display: 'flex', gap: 8 }}>
            {ACTIONS.map((a) => (
              <button
                key={a.key}
                className="chip"
                aria-pressed={picked === a.key}
                onClick={() => setPicked(a.key)}
              >{a.label}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
