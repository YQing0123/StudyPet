import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { FamilySession } from './accounts';

type Child = NonNullable<FamilySession['children']>[number];

export default function ChildSwitcher({ children, value, disabled, onChange }: {
  children: Child[]; value: string; disabled: boolean; onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = children.findIndex(child => child.id === value);
  const child = children[selected];
  const expanded = open && !disabled;
  const show = () => { setHighlighted(Math.max(0, selected)); setOpen(true); };
  const choose = (index: number) => {
    const next = children[index];
    if (!next) return;
    setOpen(false);
    if (next.id !== value) onChange(next.id);
  };

  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: Event) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
    };
  }, [expanded]);
  useEffect(() => { setOpen(false); }, [value, disabled]);
  useEffect(() => {
    if (expanded) host.current?.querySelector('[data-highlighted="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [expanded, highlighted]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Tab') { setOpen(false); return; }
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!expanded) show();
      else setHighlighted(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + children.length) % children.length);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); setOpen(true); setHighlighted(event.key === 'Home' ? 0 : children.length - 1);
    } else if ((event.key === 'Enter' || event.key === ' ') && expanded) {
      event.preventDefault(); choose(highlighted);
    }
  };

  return <div className="child-switcher" ref={host}>
    <button id="active-child" className="child-switch-trigger" type="button" role="combobox" aria-label="当前孩子"
      aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
      aria-activedescendant={expanded ? `${listId}-${highlighted}` : undefined}
      disabled={disabled || children.length === 0} title={disabled ? '家长解锁后可以切换陪伴的孩子' : '切换陪伴的孩子'}
      onClick={() => expanded ? setOpen(false) : show()} onKeyDown={onKeyDown}>
      <span className="child-switch-avatar" aria-hidden="true">{child?.avatar || '🌱'}</span>
      <span className="child-switch-name">{child?.name || '还没有孩子'}</span>
      <svg className="child-switch-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {expanded && <div className="child-switch-menu" id={listId} role="listbox" aria-label="选择陪伴的孩子">
      {children.map((item, index) => <div className="child-switch-option" id={`${listId}-${index}`} role="option"
        aria-selected={item.id === value} data-highlighted={highlighted === index} key={item.id}
        onPointerMove={() => setHighlighted(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
        <span className="child-switch-avatar" aria-hidden="true">{item.avatar || '🌱'}</span>
        <span className="child-switch-option-info"><b>{item.name}</b><small>{item.grade ? `${item.grade} 年级` : '学龄前'}</small></span>
        {item.id === value && <span className="child-switch-check" aria-hidden="true">✓</span>}
      </div>)}
    </div>}
  </div>;
}
