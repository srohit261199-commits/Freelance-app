import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import * as P from '@phosphor-icons/react';
import type { CompanyId, ModelStatus } from '../shared/types';
import { statusesFor, statusLabel } from '../shared/status';
import type { ActionTarget } from '../shared/planner';

export type Route =
  | { view: 'today' }
  | { view: 'company'; company: CompanyId; modelId?: string }
  | { view: 'skeidar'; company?: CompanyId; jobId?: string }
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

const ICONS = {
  dashboard: P.SquaresFour,
  kanban: P.Kanban,
  cube: P.Cube,
  cubeFocus: P.CubeFocus,
  brush: P.PaintBrush,
  wallet: P.Wallet,
  image: P.Image,
  mail: P.EnvelopeSimple,
  money: P.CurrencyInr,
  repeat: P.Repeat,
  star: P.Star,
  gear: P.GearSix,
  sync: P.ArrowsClockwise,
  external: P.ArrowSquareOut,
  check: P.Check,
  checkCircle: P.CheckCircle,
  play: P.Play,
  close: P.X,
  plus: P.Plus,
  minus: P.Minus,
  download: P.DownloadSimple,
  globe: P.Globe,
  calendar: P.CalendarBlank,
  folder: P.Folder,
  folderOpen: P.FolderOpen,
  folderDashed: P.FolderSimpleDashed,
  trash: P.Trash,
  search: P.MagnifyingGlass,
  funnel: P.Funnel,
  caretUpDown: P.CaretUpDown,
  caretDown: P.CaretDown,
  caretLeft: P.CaretLeft,
  caretRight: P.CaretRight,
  arrowUpRight: P.ArrowUpRight,
  arrowRight: P.ArrowRight,
  arrowDownLeft: P.ArrowDownLeft,
  flag: P.Flag,
  sparkle: P.Sparkle,
  fileUp: P.FileArrowUp,
  filePdf: P.FilePdf,
  excel: P.MicrosoftExcelLogo,
  teams: P.MicrosoftTeamsLogo,
  cloudDown: P.CloudArrowDown,
  clipboard: P.ClipboardText,
  table: P.Table,
  dots: P.DotsThree,
  dotsV: P.DotsThreeVertical,
  hourglass: P.HourglassMedium,
  warning: P.Warning,
  info: P.Info,
  trophy: P.Trophy,
  trendUp: P.TrendUp,
  receipt: P.Receipt,
  send: P.PaperPlaneTilt,
  bell: P.BellRinging,
  hand: P.HandPointing,
  clock: P.Clock,
  link: P.LinkSimple,
  user: P.User,
  sun: P.Sun,
  moon: P.Moon,
  pencil: P.PencilSimple,
} satisfies Record<string, P.Icon>;

export type IconName = keyof typeof ICONS;

/** Phosphor icon: Regular for UI, Fill for icon tiles and badges. */
export function Icon({ name, size = 16, weight = 'regular' }: { name: IconName; size?: number; weight?: P.IconWeight }) {
  const C = ICONS[name];
  return <C size={size} weight={weight} aria-hidden="true" className="icon" />;
}

export type ClientKey = CompanyId | 'money' | 'portfolio';
export const CLIENT_ICON: Record<ClientKey, IconName> = { waveink: 'cube', metaztech: 'cubeFocus', skeidar: 'brush', money: 'wallet', portfolio: 'globe' };

/** Rounded square in a client's tint with its icon in the deep colour. */
export function ClientTile({ client, size = 'md', icon }: { client: ClientKey; size?: 'sm' | 'md'; icon?: IconName }) {
  return (
    <span className={`ic-tile ${size === 'sm' ? 'sm' : ''} c-${client} c-soft`} aria-hidden="true">
      <Icon name={icon ?? CLIENT_ICON[client]} size={size === 'sm' ? 17 : 19} weight="fill" />
    </span>
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
          {statusesFor(company).map(s => (
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
          <h2 id={id} className="grow">
            {title}
          </h2>
          <button type="button" className="soft icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
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
          <div className="grow">
            <h2 id={id}>{title}</h2>
            {subtitle && <div className="muted small">{subtitle}</div>}
          </div>
          <button type="button" className="soft icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
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

export function CompanyDot({ company }: { company: ClientKey }) {
  return <span className={`cdot c-${company}`} />;
}
