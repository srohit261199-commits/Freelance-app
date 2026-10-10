import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../ui';

export interface MenuItem {
  label: string;
  icon?: IconName;
  /** Client the item is for: its icon takes the client's colour, so two clients with the same icon still look apart. */
  client?: string;
  onSelect(): void;
}

/**
 * Button with a small menu. The menu is fixed to the window so scrolling columns and panels never clip it,
 * and scrolls itself when it has more items (a long client list) than the window has room for.
 */
export function DashMenu({ label, items, icon, iconOnly, className = '' }: { label: string; items: MenuItem[]; icon?: IconName; iconOnly?: boolean; className?: string }) {
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number; max: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const open = pos !== null;

  const toggle = () => {
    if (open || !btn.current) return setPos(null);
    const r = btn.current.getBoundingClientRect();
    const below = innerHeight - r.bottom;
    const up = below < items.length * 36 + 26 && r.top > below;
    setPos({ top: up ? undefined : r.bottom + 6, bottom: up ? innerHeight - r.top + 6 : undefined, right: Math.max(8, innerWidth - r.right), max: Math.max(120, (up ? r.top : below) - 14) });
  };

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !btn.current?.contains(t)) setPos(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setPos(null);
        btn.current?.focus();
      } else if (e.key === 'Tab') setPos(null);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
      }
    };
    const away = (e: Event) => !menu.current?.contains(e.target as Node) && setPos(null);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    document.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`${className} ${iconOnly ? 'icon-btn' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        onClick={toggle}
      >
        {icon && <Icon name={icon} size={18} />}
        {!iconOnly && label}
      </button>
      {pos && (
        <div
          ref={menu}
          className="menu dash-menu"
          role="menu"
          aria-label={label}
          style={{ position: 'fixed', left: 'auto', top: pos.top ?? 'auto', bottom: pos.bottom ?? 'auto', right: pos.right, maxHeight: pos.max }}
        >
          {items.map(it => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setPos(null);
                btn.current?.focus();
                it.onSelect();
              }}
            >
              {it.icon && (it.client ? <span className={`dash-menu-ic c-${it.client}`}><Icon name={it.icon} /></span> : <Icon name={it.icon} />)}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
