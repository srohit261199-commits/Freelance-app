import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { CompanyId, ModelStatus } from '../shared/types';
import { COMPANY_STATUSES, statusLabel } from '../shared/status';
import type { ActionTarget } from '../shared/planner';

export type Route =
  | { view: 'today' }
  | { view: 'company'; company: 'waveink' | 'metaztech'; modelId?: string }
  | { view: 'skeidar'; jobId?: string }
  | { view: 'inbox'; emailId?: string }
  | { view: 'earnings' }
  | { view: 'subscriptions' }
  | { view: 'portfolio' }
  | { view: 'settings' };

interface Ctx {
  go(route: Route | ActionTarget): void;
  toast(text: string, kind?: 'ok' | 'error'): void;
}

export const AppCtx = createContext<Ctx>({ go: () => {}, toast: () => {} });
export const useApp = () => useContext(AppCtx);

const PATHS: Record<string, string> = {
  dashboard: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  cube: 'M12 2 3 7v10l9 5 9-5V7l-9-5zm0 2.3 6.5 3.6L12 11.5 5.5 7.9 12 4.3zM5 9.6l6 3.3v6.6l-6-3.3V9.6zm8 9.9v-6.6l6-3.3v6.6l-6 3.3z',
  image: 'M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z',
  mail: 'M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z',
  money: 'M11.8 10.9c-2.3-.6-3-1.2-3-2.1 0-1.1 1-1.9 2.7-1.9 1.8 0 2.4.8 2.5 2.1h2.2c-.1-1.7-1.1-3.3-3.2-3.8V3h-3v2.2C7.9 5.6 6.5 6.9 6.5 8.8c0 2.3 1.9 3.4 4.6 4.1 2.5.6 3 1.5 3 2.4 0 .7-.5 1.7-2.7 1.7-2.1 0-2.9-.9-3-2.1H6.2c.1 2.2 1.8 3.5 3.8 3.9V21h3v-2.2c1.9-.4 3.5-1.5 3.5-3.6 0-2.8-2.5-3.8-4.7-4.3z',
  repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
  star: 'M12 17.3 18.2 21l-1.6-7 5.4-4.7-7.1-.6L12 2 9.1 8.7 2 9.3l5.4 4.7-1.6 7z',
  gear: 'M19.1 12.9a7 7 0 0 0 0-1.8l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.6-.9L14.8 3h-4l-.4 2.6c-.6.2-1.1.5-1.6.9l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 1.8l-2 1.6 2 3.4 2.4-1c.5.4 1 .7 1.6.9l.4 2.6h4l.4-2.6c.6-.2 1.1-.5 1.6-.9l2.4 1 2-3.4-2-1.6zM12.8 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
  sync: 'M12 4V1L8 5l4 4V6a6 6 0 0 1 6 6 6 6 0 0 1-.7 2.8l1.5 1.5A8 8 0 0 0 20 12a8 8 0 0 0-8-8zm0 14a6 6 0 0 1-6-6c0-1 .3-2 .7-2.8L5.2 7.7A8 8 0 0 0 4 12a8 8 0 0 0 8 8v3l4-4-4-4v3z',
  external: 'M14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3h-7zm5 16H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  play: 'M8 5v14l11-7z',
  close: 'M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  download: 'M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-3a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.4 1.1-2.8 1.9-4zM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4H4.3zm.8 2h3a15.7 15.7 0 0 0 1.4 3.6A8 8 0 0 1 5.1 16zm3-8h-3a8 8 0 0 1 4.3-3.6C8.1 5.5 7.7 6.7 8.1 8zM12 20c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.4-1.1 2.8-1.9 4zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4zm.3 5.6c.6-1.1 1.1-2.3 1.4-3.6h3a8 8 0 0 1-4.4 3.6zm1.8-5.6a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4h-3.4z',
  calendar: 'M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14v11z',
  folder: 'M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z',
  trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
};

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="icon">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** A button that asks for a second click instead of a pop-up before doing something destructive. */
export function ConfirmButton({ label, confirmLabel, onConfirm, className = 'danger ghost', icon }: { label: string; confirmLabel: string; onConfirm(): void | Promise<void>; className?: string; icon?: ReactNode }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`${className} ${armed ? 'armed' : ''}`}
      onClick={async () => {
        if (!armed) return setArmed(true);
        setArmed(false);
        await onConfirm();
      }}
    >
      {icon}
      {armed ? confirmLabel : label}
    </button>
  );
}

export function StatusPill({ status, company }: { status: ModelStatus; company?: CompanyId }) {
  return <span className={`pill st-${status}`}>{statusLabel(status, company)}</span>;
}

/** Status pill that opens a menu of the company's statuses. */
export function StatusPicker({ status, company, onPick }: { status: ModelStatus; company: CompanyId; onPick(s: ModelStatus): void }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const toggle = () => {
    if (!open && btn.current) {
      // Open upwards when the scroll box around the pill (table, drawer, dialog) has more room above than below.
      const r = btn.current.getBoundingClientRect();
      const box = btn.current.closest('.table-wrap, .drawer-body, .modal-body')?.getBoundingClientRect();
      const below = Math.min(box?.bottom ?? innerHeight, innerHeight) - r.bottom;
      const above = r.top - Math.max(box?.top ?? 0, 0);
      setUp(below < 250 && above > below);
    }
    setOpen(!open);
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    // Capture phase, so the menu closes before the drawer or dialog around it sees the key.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc, true);
    };
  }, [open]);
  return (
    <div className="picker" ref={ref} onClick={e => e.stopPropagation()}>
      <button ref={btn} type="button" className={`pill st-${status} pill-btn`} onClick={toggle} title="Change status" aria-haspopup="menu" aria-expanded={open}>
        {statusLabel(status, company)} <span className="caret">▾</span>
      </button>
      {open && (
        <div className={`menu ${up ? 'up' : ''}`} role="menu">
          {COMPANY_STATUSES[company].map(s => (
            <button
              key={s}
              type="button"
              role="menuitem"
              className={s === status ? 'on' : ''}
              onClick={() => {
                setOpen(false);
                btn.current?.focus();
                if (s !== status) onPick(s);
              }}
            >
              <span className={`dot st-${s}`} />
              {statusLabel(s, company)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const dialogs: HTMLElement[] = [];

/** Moves focus into a dialog, keeps Tab inside it, closes it on Escape and gives focus back on close. Only the top dialog reacts. */
function useDialog<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => {
    const el = ref.current!;
    dialogs.push(el);
    const focusables = (root: Element) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(n => n.getClientRects().length > 0);
    if (!el.contains(document.activeElement)) {
      const body = el.querySelector('.modal-body, .drawer-body');
      (focusables(body ?? el)[0] ?? focusables(el)[0] ?? el).focus();
    }
    const key = (e: KeyboardEvent) => {
      if (dialogs[dialogs.length - 1] !== el) return;
      if (e.key === 'Escape') return close.current();
      if (e.key !== 'Tab') return;
      const list = focusables(el);
      const at = document.activeElement;
      if (!list.length) return e.preventDefault();
      if (e.shiftKey && (at === list[0] || !el.contains(at))) {
        e.preventDefault();
        list[list.length - 1].focus();
      } else if (!e.shiftKey && (at === list[list.length - 1] || !el.contains(at))) {
        e.preventDefault();
        list[0].focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      dialogs.splice(dialogs.indexOf(el), 1);
      if (opener?.isConnected) opener.focus();
    };
  }, [opener]);
  return ref;
}

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose(): void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useDialog<HTMLDivElement>(onClose);
  const id = useId();
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <header>
          <h3 id={id}>{title}</h3>
          <button type="button" className="ghost icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Drawer({ onClose, children, title, subtitle }: { onClose(): void; children: ReactNode; title: ReactNode; subtitle?: ReactNode }) {
  const ref = useDialog<HTMLElement>(onClose);
  const id = useId();
  return (
    <div className="drawer-wrap" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <aside ref={ref} className="drawer" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <header>
          <div>
            <h3 id={id}>{title}</h3>
            {subtitle && <div className="muted small">{subtitle}</div>}
          </div>
          <button type="button" className="ghost icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

export function Progress({ value, total, color }: { value: number; total: number; color?: string }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="progress" title={`${value} of ${total} (${pct}%)`}>
      <div style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function fmtDate(iso?: string, withTime = false): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return withTime
    ? d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function relTime(iso: string, now: Date): string {
  const diff = (now.getTime() - new Date(iso).getTime()) / 60000;
  if (diff < 1) return 'just now';
  if (diff < 60) return `${Math.round(diff)} min ago`;
  if (diff < 60 * 24) return `${Math.round(diff / 60)} h ago`;
  if (diff < 60 * 24 * 7) return `${Math.round(diff / 1440)} d ago`;
  return fmtDate(iso);
}

/** Jasani serves Odoo product images; image_128 is a small thumbnail of the same picture. */
export function thumb(url?: string): string | undefined {
  return url?.replace(/image_(1024|1920)/, 'image_256');
}

/** Product thumbnail that turns into a placeholder when the image can't load (offline, moved). */
export function Thumb({ url, label }: { url?: string; label: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <div className="ph">{label}</div>;
  return <img src={thumb(url)} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

export function CompanyDot({ color }: { color: string }) {
  return <span className="cdot" style={{ background: color }} />;
}
