import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { AppState, CompanyConfig, Model } from '../../shared/types';
import { isComplete } from '../../shared/status';
import { formatMoney, localDate, tierFee } from '../../shared/money';
import { paceFor, weekProgress, type Target } from '../../shared/pace';
import { mailLine } from '../../shared/planner';
import { hub } from '../hub';
import { Icon, useApp } from '../ui';

/** Ritu's ask on Teams: 1–2 files a day. Used when MetaZtech's job details have no output target. */
export const DAILY_TARGET = 2;
const FALLBACK: Target = { count: DAILY_TARGET, per: 'day', unit: 'files', counts: 'submitted' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** Teams lines that read like a warning from management get a red bubble. */
const WARN = /remov|low perform|zero approval|terminat|warning|last chance|final notice|strict|management/i;

/** "Today 9:12", "Yesterday", "8 Oct" (with the year when it isn't this year). */
export function when(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = localDate(d);
  if (day === localDate(now)) return `Today ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (day === localDate(y)) return 'Yesterday';
  return `${d.getDate()} ${MON[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

/** A button that opens a small menu or dialog under it; Escape or a click outside closes it. */
export function MzPop({
  label,
  icon,
  className = 'mz-ibtn',
  kind = 'menu',
  dot,
  children,
}: {
  label: string;
  icon: ReactNode;
  className?: string;
  kind?: 'menu' | 'dialog';
  dot?: boolean;
  children(close: () => void): ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('button, input, select')?.focus();
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    // Capture phase, so a drawer or dialog around the menu doesn't also close on the same Escape.
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', esc, true);
    };
  }, [open]);
  const arrows = (e: KeyboardEvent<HTMLDivElement>) => {
    if (kind !== 'menu' || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  return (
    <div className="mz-pop" ref={ref}>
      <button ref={btn} type="button" className={className} aria-label={label} title={label} aria-haspopup={kind} aria-expanded={open} onClick={() => setOpen(!open)}>
        {icon}
        {dot && <span className="mz-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div ref={panel} className={`mz-pop-panel ${kind === 'menu' ? 'menu' : 'mz-dialog'}`} role={kind} aria-label={label} onKeyDown={arrows}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

/** Work counted today (or this week) against the output target in MetaZtech's job details, as a ring. */
export function DailyTarget({ state, now }: { state: AppState; now: Date }) {
  const cfg = state.companies.find(c => c.id === 'metaztech')!;
  const p = weekProgress(state, 'metaztech', now) ?? paceFor(state, cfg, FALLBACK, now);
  const rejected = state.models.filter(m => m.company === 'metaztech' && m.status === 'revision').length;
  const day = p.per === 'day';
  const goal = day && p.target === 2 && p.counts === 'submitted' ? `1–2 ${p.unit} a day` : `${p.target} ${p.unit} a ${p.per}`;
  const verb = p.counts === 'submitted' ? 'Submit' : 'Finish';
  const met = p.done >= p.target;
  const fix = rejected === 1 ? 'Fix the rejection first, it counts toward review.' : `Fix the ${NUM[rejected] ?? rejected} rejections first, they count toward review.`;
  const text = met
    ? `Target met ${day ? 'for today' : 'for the week'}.${rejected ? ` ${rejected === 1 ? 'One rejection is' : `${rejected} rejections are`} still waiting.` : ` Anything more is a head start on ${day ? 'tomorrow' : 'next week'}.`}`
    : day && !p.workday
      ? `Not a working day. ${verb} ${goal}; anything sent today is a head start.`
      : `${verb} ${goal}. ${rejected ? fix : p.behind && !day ? `${p.short} behind where the week should be.` : `${p.target - p.done} more to reach ${day ? "today's" : "this week's"} target.`}`;
  // A small nub at zero marks where the ring starts filling.
  const fill = p.done ? Math.min(100, Math.round((p.done / Math.max(1, p.target)) * 100)) : 4;
  const label = `${p.unit[0].toUpperCase()}${p.unit.slice(1)} ${p.counts === 'submitted' ? 'submitted' : p.counts === 'images' ? 'made' : 'finished'} ${day ? 'today' : 'this week'}`;
  return (
    <section className="panel mz-target" aria-label={day ? 'Daily target' : 'Weekly target'}>
      <div className="mz-ring" style={{ '--p': `${fill}%` } as CSSProperties} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={p.target} aria-valuenow={p.done}>
        <div>
          <b className="tabular">
            {p.done}/{p.target}
          </b>
          <span>{day ? 'today' : 'this week'}</span>
        </div>
      </div>
      <div className="mz-target-txt">
        <h2>{day ? 'Daily target' : 'Weekly target'}</h2>
        <p>{text}</p>
      </div>
    </section>
  );
}

/** Teams notification mails for MetaZtech, newest first, as chat bubbles. */
export function FromTeams({ state, cfg, now }: { state: AppState; cfg: CompanyConfig; now: Date }) {
  const { go } = useApp();
  const id = useId();
  const msgs = state.emails
    .filter(e => e.company === 'metaztech' && e.kind === 'teams')
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 20);
  const teams = cfg.links.find(l => /teams/i.test(l.label) || /teams\.microsoft/i.test(l.url));
  return (
    <section className="panel mz-teams" aria-labelledby={id}>
      <div className="panel-head">
        <span className="mz-teams-ic">
          <Icon name="teams" size={22} />
        </span>
        <h2 id={id}>From Teams</h2>
        {teams && (
          <button type="button" className="link-btn end mz-link" onClick={() => hub.openUrl(teams.url)}>
            Open Teams <Icon name="external" size={12} />
          </button>
        )}
      </div>
      {msgs.length ? (
        <ul className="mz-bubbles">
          {msgs.map(e => {
            const line = mailLine(e);
            return (
              <li key={e.id}>
                <button type="button" className={`mz-bubble ${WARN.test(line) ? 'warn' : ''}`} onClick={() => hub.openUrl(e.url)} title="Open the notification mail">
                  <span className="mz-who">
                    <b>{e.fromName}</b>
                    <span>{when(e.date, now)}</span>
                  </span>
                  <span className="mz-msg">{line}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mz-quiet">
          {state.settings.google.connected ? (
            'No Teams messages from MetaZtech yet. Teams notification mails show up here after a sync.'
          ) : (
            <>
              <span>Connect Google to see Teams messages from the MetaZtech team here.</span>
              <button type="button" className="mini" onClick={() => go({ view: 'settings' })}>
                Connect Google
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** The pay rule's tiers, what approved work adds up to, and approved models still missing a complexity. */
export function FeeTiers({ cfg, all, onShowApproved }: { cfg: CompanyConfig; all: Model[]; onShowApproved(): void }) {
  const id = useId();
  if (cfg.pay.kind !== 'tiered') return null;
  const t = cfg.pay.tiers;
  const cur = cfg.currency;
  const n = (v: number) => v.toLocaleString('en-IN');
  const approved = all.filter(m => isComplete(m.status));
  const total = approved.reduce((s, m) => s + tierFee(cfg, m.complexity), 0);
  const unpriced = approved.filter(m => !m.complexity).length;
  return (
    <section className="panel mz-fees" aria-labelledby={id}>
      <h2 id={id}>Fee tiers</h2>
      <dl className="mz-tiers">
        <dt>Simple / medium / retexture</dt>
        <dd>{formatMoney(t.simple, cur)}</dd>
        <dt>Complex</dt>
        <dd>{formatMoney(t.complex, cur)}</dd>
        <dt>Super complex · SC-1 · SC-2+</dt>
        <dd>
          {formatMoney(t.super, cur)} · {n(t.super1)} · {n(t.super2)}
        </dd>
      </dl>
      {approved.length > 0 && (
        <p className="mz-earned">
          <span>
            {approved.length} approved, before {cfg.pay.tdsPercent}% TDS
          </span>
          <b className="tabular">{formatMoney(total, cur)}</b>
        </p>
      )}
      {unpriced > 0 && (
        <p className="mz-note">
          {unpriced} approved model{unpriced > 1 ? 's have' : ' has'} no complexity and {unpriced > 1 ? 'are' : 'is'} counted at the {formatMoney(tierFee(cfg, undefined), cur)} tier.{' '}
          <button type="button" className="link-btn mz-link" onClick={onShowApproved}>
            Set {unpriced > 1 ? 'them' : 'it'}
          </button>
        </p>
      )}
    </section>
  );
}
