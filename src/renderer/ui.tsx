import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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
      <Icon name={icon ?? CLIENT_ICON[client] ?? 'cube'} size={size === 'sm' ? 17 : 19} weight="fill" />
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

type Align = 'start' | 'end';

/**
 * Open state, placement and keys for a button with a menu. The menu is fixed to the window, so tables, drawers and
 * dialogs never clip it: it opens under the button, or above it when there is more room there, and scrolls when
 * long. Arrow keys, Home and End move between items; Escape closes it and gives focus back to the button.
 */
function useMenu(align: Align) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    btn.current?.focus();
  }, []);

  useLayoutEffect(() => {
    const b = btn.current?.getBoundingClientRect();
    const m = menu.current;
    if (!open || !b || !m) return;
    m.style.minWidth = `${b.width}px`;
    const below = innerHeight - b.bottom - 8;
    const above = b.top - 8;
    const up = m.offsetHeight > below && above > below;
    const left = Math.min(Math.max(8, align === 'end' ? b.right - m.offsetWidth : b.left), innerWidth - 8 - m.offsetWidth);
    Object.assign(m.style, {
      left: `${left}px`,
      top: up ? 'auto' : `${b.bottom + 4}px`,
      bottom: up ? `${innerHeight - b.top + 4}px` : 'auto',
      maxHeight: `${Math.max(120, (up ? above : below) - 4)}px`,
    });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
    (menu.current?.querySelector<HTMLElement>('[aria-checked="true"]:not([role="menuitemcheckbox"])') ?? items()[0])?.focus();
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    // Capture phase, so a drawer or dialog around the menu doesn't also close on the same Escape.
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      } else if (e.key === 'Tab') close();
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) && menu.current?.contains(document.activeElement)) {
        e.preventDefault();
        const list = items();
        const i = list.indexOf(document.activeElement as HTMLElement);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
        list[next]?.focus();
      }
    };
    const away = (e: Event) => !menu.current?.contains(e.target as Node) && setOpen(false);
    const resize = () => setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    document.addEventListener('scroll', away, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', resize);
    };
  }, [open, close]);

  return { open, toggle: () => setOpen(o => !o), close, btn, menu };
}

/** Status pill that opens a menu of the company's statuses. Add "status-dd" to className for the 34px dropdown in a model's detail. */
export function StatusPicker({ status, company, onPick, className = '' }: { status: ModelStatus; company: CompanyId; onPick(s: ModelStatus): void; className?: string }) {
  const m = useMenu('start');
  return (
    <div className="picker" onClick={e => e.stopPropagation()}>
      <button ref={m.btn} type="button" className={`pill st-${status} pill-btn ${className}`} onClick={m.toggle} title="Change status" aria-haspopup="menu" aria-expanded={m.open}>
        {statusLabel(status, company)}
      </button>
      {m.open && (
        <div ref={m.menu} className="menu float" role="menu" aria-label="Status">
          {statusesFor(company).map(s => (
            <button
              key={s}
              type="button"
              role="menuitemradio"
              aria-checked={s === status}
              onClick={() => {
                m.close();
                if (s !== status) onPick(s);
              }}
            >
              <span className={`dot st-${s}`} />
              <span className="grow">{statusLabel(s, company)}</span>
              <span className="mk">{s === status && <Icon name="check" size={14} />}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface Choice<T extends string = string> {
  value: T;
  label: string;
  /** Shorter text for the button, e.g. "INR" when the menu says "₹ Indian rupee". */
  short?: string;
  icon?: IconName;
  /** A client's dot before the label. */
  client?: ClientKey;
  /** A status colour's dot before the label, as a class: "st-done", "st-warn". */
  tone?: string;
  count?: number;
}

/**
 * Pick one of many: a compact select (optional prefix, the current choice, a caret) that opens a menu of the choices.
 * Use it instead of a row of three or more buttons or chips that choose one value. Add "mini" to className for 28px.
 */
export function Dropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  prefix,
  className = '',
  align = 'start',
  disabled,
}: {
  /** What is being chosen ("Group", "Period"); the button's accessible name and tooltip. */
  label: string;
  value: T;
  options: Choice<T>[];
  onChange(value: T): void;
  /** Muted text before the value on the button, e.g. "Sort". */
  prefix?: ReactNode;
  className?: string;
  align?: Align;
  disabled?: boolean;
}) {
  const m = useMenu(align);
  const cur = options.find(o => o.value === value);
  return (
    <span className="menu-wrap" onClick={e => e.stopPropagation()}>
      <button
        ref={m.btn}
        type="button"
        className={`select-btn ${className}`}
        aria-haspopup="menu"
        aria-expanded={m.open}
        aria-label={`${label}: ${cur?.label ?? 'none'}`}
        title={label}
        disabled={disabled}
        onClick={m.toggle}
      >
        {prefix && <span className="select-prefix">{prefix}</span>}
        {cur && <ChoiceMark choice={cur} />}
        <span className="select-value">{cur ? (cur.short ?? cur.label) : '—'}</span>
      </button>
      {m.open && (
        <div ref={m.menu} className="menu float" role="menu" aria-label={label}>
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              onClick={() => {
                m.close();
                if (o.value !== value) onChange(o.value);
              }}
            >
              <ChoiceMark choice={o} />
              <span className="grow">{o.label}</span>
              {o.count !== undefined && <span className="n">{o.count}</span>}
              <span className="mk">{o.value === value && <Icon name="check" size={14} />}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function ChoiceMark({ choice }: { choice: Pick<Choice, 'client' | 'tone' | 'icon'> }) {
  if (choice.client) return <CompanyDot company={choice.client} />;
  if (choice.tone) return <span className={`dot ${choice.tone}`} />;
  return choice.icon ? <Icon name={choice.icon} /> : null;
}

/**
 * A button with a menu of anything: actions (buttons with role="menuitem"), ticks for filters (MenuCheck), headings
 * (<h4 className="menu-sec">) and dividers (<hr />). With text, add "select-btn" to className for a caret; without
 * text it is an icon button named by label. badge shows a count, e.g. how many filters are on.
 */
export function MenuButton({
  label,
  text,
  icon,
  badge,
  className = '',
  align = 'end',
  children,
}: {
  label: string;
  text?: ReactNode;
  icon?: IconName;
  badge?: number;
  className?: string;
  align?: Align;
  children(close: () => void): ReactNode;
}) {
  const m = useMenu(align);
  return (
    <span className="menu-wrap" onClick={e => e.stopPropagation()}>
      <button
        ref={m.btn}
        type="button"
        className={text ? className : `icon-btn ${className}`}
        aria-haspopup="menu"
        aria-expanded={m.open}
        aria-label={text ? undefined : label}
        title={label}
        onClick={m.toggle}
      >
        {icon && <Icon name={icon} />}
        {text}
        {!!badge && <span className="count">{badge}</span>}
      </button>
      {m.open && (
        <div ref={m.menu} className="menu float" role="menu" aria-label={label}>
          {children(m.close)}
        </div>
      )}
    </span>
  );
}

/** A tick box row in a MenuButton menu. The menu stays open, so several can be ticked in a row. */
export function MenuCheck({ label, checked, onChange, client, tone, count }: { label: string; checked: boolean; onChange(checked: boolean): void; client?: ClientKey; tone?: string; count?: number }) {
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span className="box">{checked && <Icon name="check" size={12} weight="bold" />}</span>
      <ChoiceMark choice={{ client, tone }} />
      <span className="grow">{label}</span>
      {count !== undefined && <span className="n">{count}</span>}
    </button>
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
          <button type="button" className="ghost icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Drawer({ onClose, children, title, subtitle, className = '' }: { onClose(): void; children: ReactNode; title: ReactNode; subtitle?: ReactNode; className?: string }) {
  const ref = useDialog<HTMLElement>(onClose);
  const id = useId();
  return (
    <div className="drawer-wrap" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <aside ref={ref} className={`drawer ${className}`} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <header>
          <div className="grow">
            <h2 id={id}>{title}</h2>
            {subtitle && <div className="muted small">{subtitle}</div>}
          </div>
          <button type="button" className="ghost icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

/**
 * A screen's header: an optional client tile (the page sets the client's colour with c-<id>), the title over one muted
 * line of facts, and the actions at the end: at most one primary, the rest in a ⋯ "More actions" menu. Each fact in
 * meta is its own element, so the line can put a dot between them. On a phone the actions get their own row.
 */
export function PageHead({ title, icon, meta, children }: { title: ReactNode; icon?: IconName; meta?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      {icon && (
        <span className="client-tile c-soft" aria-hidden="true">
          <Icon name={icon} size={22} weight="fill" />
        </span>
      )}
      <div className="page-title">
        <h1>{title}</h1>
        {meta && <div className="meta-line">{meta}</div>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}

/** One figure in a strip of totals (.kpis.money-stats), as on Payments and Subscriptions. */
export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-top">{label}</div>
      <div className={`kpi-num ${tone ?? ''}`}>{value}</div>
      {sub && <p className="small muted">{sub}</p>}
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
