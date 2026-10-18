import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { AppState, Currency, SoftwareAccount, Subscription } from '../../shared/types';
import { convert, daysUntil, formatMoney, monthlyCost, rollRenewal } from '../../shared/money';
import { hub } from '../hub';
import { ConfirmButton, Empty, Field, Icon, Modal, type IconName, useApp } from '../ui';
import { AccountsPanel, LICENCE_LABEL } from './Accounts';
import './Subscriptions.css';

type Status = Subscription['status'];
const STATUS: Record<Status, { label: string; pick: string; cls: string }> = {
  active: { label: 'Active', pick: 'Active', cls: 'st-ok' },
  trial: { label: 'Trial', pick: 'Free trial', cls: 'st-bad' },
  cancelling: { label: 'Cancelling', pick: 'Cancelling', cls: 'st-warn' },
  cancelled: { label: 'Cancelled', pick: 'Cancelled', cls: 'st-neutral' },
};
const CYCLE: Record<Subscription['cycle'], string> = { monthly: 'Monthly', yearly: 'Yearly', 'one-off': 'One-off' };
const PER: Record<Subscription['cycle'], string> = { monthly: 'a month', yearly: 'a year', 'one-off': 'once' };
const SYMBOL: Record<Currency, string> = { INR: '₹', USD: 'US$', AED: 'AED' };
/** Letter-tile colours, picked from the app's name so each app keeps its colour. */
const TILES = ['c-skeidar c-soft', 'c-waveink c-soft', 'c-money c-soft', 'st-info', 'st-bad', 'c-metaztech c-soft', 'st-warn', 'st-neutral'];

const tileOf = (name: string) => TILES[[...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % TILES.length];
const money = (n: number, c: Currency) => formatMoney(n, c, n % 1 ? 2 : 0).replace(/^\$/, 'US$');
const ends = (s: Subscription) => s.status === 'cancelling' || s.status === 'cancelled';
const nextOf = (s: Subscription, now: Date) => (ends(s) ? s.endsOn : rollRenewal(s, now));
const inDays = (d: number) => (d === 0 ? 'today' : d === 1 ? 'tomorrow' : d < 0 ? `${-d} days ago` : `in ${d} days`);
const vendorLine = (s: Subscription) => {
  const v = s.vendor.replace(/\s*\(([^)]+)\)/, ' · $1');
  return s.paymentMethod && !v.includes('·') ? `${v} · ${s.paymentMethod}` : v;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso: string) => new Date(iso.slice(0, 10) + 'T00:00:00');
/** "6 Nov", with the year only when it isn't this year. */
function shortDate(iso: string, now: Date) {
  const d = day(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

/** The small line under the next date: days left, red while a trial is running out. */
function nextNote(s: Subscription, next: string | undefined, now: Date): { text: string; tone?: 'bad' | 'warn' } {
  if (!next) return { text: s.status === 'cancelled' ? 'ended' : 'no date yet' };
  const d = daysUntil(next, now);
  if (s.status === 'trial') return { text: d < 0 ? 'trial ended' : `trial ends ${inDays(d)}`, tone: 'bad' };
  if (s.status === 'cancelled') return { text: d < 0 ? 'ended' : `ends ${inDays(d)}` };
  if (s.status === 'cancelling') return { text: d < 0 ? 'access ended' : d <= 30 ? `access ends ${inDays(d)}` : 'auto-renew off' };
  if (s.nextRenewal && s.nextRenewal !== next) {
    const ago = -daysUntil(s.nextRenewal, now);
    if (ago >= 1 && ago <= 3) return { text: ago === 1 ? 'renewed yesterday' : `renewed ${ago} days ago` };
  }
  return { text: inDays(d), tone: d >= 0 && d <= 3 ? 'warn' : undefined };
}

/** Where the subscription came from: a receipt mail an older version read, a software account, or added by hand. */
function foundIn(s: Subscription, state: AppState): { icon: IconName; text: string } {
  if (s.emailId || s.source === 'email') return { icon: 'receipt', text: 'From a receipt mail' };
  if (s.source === 'account') return { icon: 'user', text: `${state.accounts.find(a => a.id === s.accountId)?.label ?? 'Software'} account` };
  return { icon: 'hand', text: s.source === 'manual' ? 'Added by hand' : 'Added at setup' };
}

export function Subscriptions({ state, now }: { state: AppState; now: Date }) {
  const [editing, setEditing] = useState<Partial<Subscription> | null>(null);
  const [showEnded, setShowEnded] = useState(false);
  const base = state.settings.baseCurrency;
  const rates = state.settings.rates;
  const inBase = (s: Subscription) => convert(monthlyCost(s), s.currency, base, rates);
  const live = state.subscriptions.filter(s => s.status !== 'cancelled');
  const renewing = live.filter(s => s.status === 'active' || s.status === 'trial');
  const monthly = renewing.reduce((t, s) => t + inBase(s), 0);
  const work = renewing.filter(s => s.category === 'work').reduce((t, s) => t + inBase(s), 0);
  const ended = state.subscriptions.length - live.length;
  const fromMail = live.filter(s => s.emailId || s.source === 'email').length;
  const fromAccounts = live.filter(s => !s.emailId && s.source === 'account').length;
  const atSetup = live.filter(s => !s.emailId && s.source === 'seed').length;
  const byHand = live.length - fromMail - fromAccounts - atSetup;

  const rows = state.subscriptions
    .filter(s => showEnded || s.status !== 'cancelled')
    .map(s => ({ s, next: nextOf(s, now) }))
    .sort((a, b) => (a.s.status === 'cancelled' ? 1 : 0) - (b.s.status === 'cancelled' ? 1 : 0) || (a.next ?? '9').localeCompare(b.next ?? '9'));

  const soon = live
    .map(s => ({ s, next: nextOf(s, now) }))
    .filter((r): r is { s: Subscription; next: string } => !!r.next && daysUntil(r.next, now) >= 0 && daysUntil(r.next, now) <= 30)
    .sort((a, b) => a.next.localeCompare(b.next));
  const trials = live
    .filter(s => s.status === 'trial')
    .map(s => ({ s, next: nextOf(s, now) }))
    .filter((r): r is { s: Subscription; next: string } => !!r.next && daysUntil(r.next, now) >= 0)
    .sort((a, b) => a.next.localeCompare(b.next));
  const renewingSoon = soon.filter(r => r.s.status === 'active');
  const cancelling = live.filter(s => s.status === 'cancelling').length;
  const trial = trials[0];

  return (
    <div className="page subs-page">
      <header className="page-head">
        <div>
          <h1>Subscriptions</h1>
          <p>
            {[fromMail && `${fromMail} from receipt mails`, fromAccounts && `${fromAccounts} read from software accounts`, atSetup && `${atSetup} added at setup`, byHand && `${byHand} added by hand`].filter(Boolean).join(' · ') ||
              'Nothing tracked yet'}
          </p>
        </div>
        <div className="actions">
          <button type="button" className="primary lg" onClick={() => setEditing({ currency: 'INR', cycle: 'monthly', status: 'active', category: 'work' })}>
            <Icon name="plus" size={18} /> Add manually
          </button>
        </div>
      </header>

      <section className="kpis subs-kpis" aria-label="Totals">
        <div className="kpi subs-kpi month">
          <div className="kpi-top">
            Per month
            {work > 0 && work < monthly && <span className="subs-kpi-note">{formatMoney(work, base)} for work</span>}
          </div>
          <div className="kpi-num">{formatMoney(monthly, base)}</div>
        </div>
        <div className="kpi subs-kpi year">
          <div className="kpi-top">
            Per year<span className="subs-kpi-note">{renewing.length} renewing</span>
          </div>
          <div className="kpi-num">{formatMoney(monthly * 12, base)}</div>
        </div>
        {trial ? (
          <div className="kpi subs-kpi trial">
            <div className="kpi-top">Trial ending</div>
            <div className="kpi-num">
              {trials.length} · {inDays(daysUntil(trial.next, now))}
            </div>
          </div>
        ) : (
          <div className="kpi subs-kpi soon">
            <div className="kpi-top">Renewing in 30 days</div>
            <div className="kpi-num">
              {renewingSoon.length
                ? `${renewingSoon.length} · ${formatMoney(
                    renewingSoon.reduce((t, r) => t + convert(r.s.amount ?? 0, r.s.currency, base, rates), 0),
                    base,
                  )}`
                : 'None'}
            </div>
          </div>
        )}
        <div className="kpi subs-kpi cancel">
          <div className="kpi-top">Cancelling</div>
          <div className="kpi-num">{cancelling ? `${cancelling} plan${cancelling === 1 ? '' : 's'}` : 'None'}</div>
        </div>
      </section>

      <div className="subs-main">
        <section className="panel subs-table" aria-label="All subscriptions">
          {rows.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="c-sw">Software</th>
                    <th className="c-st">Status</th>
                    <th className="c-cy">Cycle</th>
                    <th className="c-amt">Amount</th>
                    <th className="c-mo">{SYMBOL[base]} / month</th>
                    <th className="c-nx">Next</th>
                    <th className="c-fd">Found in</th>
                    <th className="c-mn">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ s, next }) => {
                    const note = nextNote(s, next, now);
                    const src = foundIn(s, state);
                    const pays = s.status === 'active' || s.status === 'trial';
                    const amount = s.amount != null ? money(s.amount, s.currency) : '—';
                    return (
                      <tr key={s.id} className={s.status === 'cancelled' ? 'ended' : ''} onClick={e => !(e.target as HTMLElement).closest('button, .menu') && setEditing(s)}>
                        <td className="c-sw">
                          <div className="subs-app">
                            <span className={`subs-tile ${tileOf(s.name)}`} aria-hidden="true">
                              {(s.name.trim()[0] ?? '?').toUpperCase()}
                            </span>
                            <div className="subs-app-t">
                              <button type="button" className="link-btn subs-name" title={s.notes || `Edit ${s.name}`} onClick={() => setEditing(s)}>
                                {s.name}
                              </button>
                              <span className="subs-sub">
                                {vendorLine(s)}
                                {s.licence && s.licence !== 'subscription' && <span className="subs-lic">{LICENCE_LABEL[s.licence]}</span>}
                                {s.seats && s.seats > 1 ? <span className="subs-lic">{s.seats} seats</span> : null}
                              </span>
                              <div className="subs-mob">
                                <span className={`pill ${STATUS[s.status].cls}`}>{STATUS[s.status].label}</span>
                                <span>
                                  <b>{amount}</b> {s.amount != null && PER[s.cycle]}
                                </span>
                                {next && (
                                  <span className={note.tone ? `${note.tone}-text` : 'muted'}>
                                    {shortDate(next, now)} · {note.text}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="c-st">
                          <span className={`pill ${STATUS[s.status].cls}`}>{STATUS[s.status].label}</span>
                        </td>
                        <td className="c-cy">{CYCLE[s.cycle]}</td>
                        <td className="c-amt strong tabular">{amount}</td>
                        <td className="c-mo tabular">
                          {pays && s.cycle !== 'one-off' && s.amount != null ? (
                            <div className="subs-next">
                              {formatMoney(inBase(s), base)}
                              {s.status === 'trial' && <small>after trial</small>}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="c-nx">
                          {next ? (
                            <div className="subs-next">
                              <span>{shortDate(next, now)}</span>
                              <small className={note.tone ? `${note.tone}-text` : ''}>{note.text}</small>
                            </div>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="c-fd">
                          <span className="subs-src">
                            <Icon name={src.icon} size={16} />
                            <span>{src.text}</span>
                          </span>
                        </td>
                        <td className="c-mn">
                          <RowMenu sub={s} onEdit={() => setEditing(s)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No subscriptions yet">Add one by hand, or read the plans from a software account below.</Empty>
          )}
          {ended > 0 && (
            <div className="subs-foot">
              <button type="button" className={`chip ${showEnded ? 'on' : ''}`} aria-pressed={showEnded} onClick={() => setShowEnded(!showEnded)}>
                Show ended <span className="n">{ended}</span>
              </button>
            </div>
          )}
        </section>

        <aside className="panel subs-soon" aria-labelledby="subs-soon-h">
          <h2 id="subs-soon-h">Next 30 days</h2>
          {soon.length ? (
            <ul className="subs-dates">
              {soon.map(({ s, next }) => {
                const d = day(next);
                const price = s.amount != null ? money(s.amount, s.currency) : '';
                const [title, sub] =
                  s.status === 'trial'
                    ? [`${s.name} trial ends`, price ? `${price} ${PER[s.cycle]} after this` : 'No price saved']
                    : s.status === 'cancelling'
                      ? [`${s.name} access ends`, 'Already cancelled']
                      : [`${s.name} renews`, [price, s.paymentMethod].filter(Boolean).join(' · ') || CYCLE[s.cycle]];
                return (
                  <li key={s.id}>
                    <button type="button" className="subs-date-row" onClick={() => setEditing(s)}>
                      <span className={`subs-day ${s.status === 'trial' ? 'st-bad' : s.status === 'cancelling' ? 'st-neutral' : tileOf(s.name)}`}>
                        <small>{MONTHS[d.getMonth()].toUpperCase()}</small>
                        <b>{d.getDate()}</b>
                      </span>
                      <span className="subs-date-t">
                        <b>{title}</b>
                        <span>{sub}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">Nothing renews or ends in the next 30 days.</p>
          )}
          {trial && (
            <div className="subs-alert" role="note">
              <Icon name="bell" size={20} weight="fill" />
              <p>
                <strong>{trial.s.name}</strong>{' '}
                {trial.s.amount != null
                  ? `turns into ${money(trial.s.amount, trial.s.currency)} ${PER[trial.s.cycle]} on ${shortDate(trial.next, now)}.`
                  : `trial ends on ${shortDate(trial.next, now)}.`}{' '}
                {state.settings.notifications ? 'You’ll get a desktop reminder the day before.' : 'Desktop reminders are off in Settings & import.'}
              </p>
            </div>
          )}
        </aside>
      </div>
      <AccountsPanel state={state} now={now} />
      {editing && <SubEditor sub={editing} accounts={state.accounts} notifications={state.settings.notifications} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** The ⋮ menu on each row: edit, delete. Fixed position so the table's scroll box never clips it. */
function RowMenu({ sub, onEdit }: { sub: Subscription; onEdit(): void }) {
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const close = (focus = false) => {
    setPos(null);
    if (focus) btn.current?.focus();
  };
  const toggle = () => {
    if (pos || !btn.current) return close();
    const r = btn.current.getBoundingClientRect();
    const up = innerHeight - r.bottom < 170 && r.top > innerHeight - r.bottom;
    setPos({ position: 'fixed', left: 'auto', right: Math.max(8, innerWidth - r.right), ...(up ? { bottom: innerHeight - r.top + 6 } : { top: r.bottom + 6 }) });
  };
  useEffect(() => {
    if (!pos) return;
    const out = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setPos(null);
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      } else if (e.key === 'Tab') setPos(null);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = [...(ref.current?.querySelectorAll<HTMLButtonElement>('.menu button') ?? [])];
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
      }
    };
    const away = () => setPos(null);
    document.addEventListener('mousedown', out);
    document.addEventListener('keydown', keys, true);
    addEventListener('resize', away);
    addEventListener('scroll', away, true);
    return () => {
      document.removeEventListener('mousedown', out);
      document.removeEventListener('keydown', keys, true);
      removeEventListener('resize', away);
      removeEventListener('scroll', away, true);
    };
  }, [pos]);
  return (
    <div className="subs-menu" ref={ref}>
      <button ref={btn} type="button" className="ghost icon-btn subs-dots" aria-label={`More for ${sub.name}`} aria-haspopup="menu" aria-expanded={!!pos} onClick={toggle}>
        <Icon name="dotsV" size={18} weight="bold" />
      </button>
      {pos && (
        <div className="menu" role="menu" style={pos}>
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={() => {
              close();
              onEdit();
            }}
          >
            <Icon name="pencil" size={15} /> Edit
          </button>
          <ConfirmButton className="danger" icon={<Icon name="trash" size={15} />} label="Delete" confirmLabel="Click again to delete" onConfirm={() => hub.remove('subscriptions', sub.id)} />
        </div>
      )}
    </div>
  );
}

function Pills<T extends string>({ label, value, options, onPick }: { label: string; value?: T; options: [T, string, string?][]; onPick(v: T): void }) {
  const id = useId();
  return (
    <div className="field">
      <span id={id}>{label}</span>
      <div className="subs-pills" role="group" aria-labelledby={id}>
        {options.map(([v, text, cls]) => (
          <button key={v} type="button" className={value === v ? `on ${cls ?? 'ink'}` : ''} aria-pressed={value === v} onClick={() => onPick(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function SubEditor({ sub, accounts, notifications, onClose }: { sub: Partial<Subscription>; accounts: SoftwareAccount[]; notifications: boolean; onClose(): void }) {
  const { toast } = useApp();
  const [s, setS] = useState<Partial<Subscription>>(sub);
  const set = (patch: Partial<Subscription>) => setS({ ...s, ...patch });
  const ending = s.status === 'cancelling' || s.status === 'cancelled';
  const save = async () => {
    const name = s.name?.trim();
    if (!name) return toast('Give the subscription a name.', 'error');
    const raw = s.amount as unknown;
    const amount = raw === null || raw === '' || raw === undefined ? null : Number(raw);
    if (amount !== null && !(amount >= 0)) return toast('Enter the amount as a number, or leave it empty.', 'error');
    const seats = Number(s.seats) > 1 ? Math.round(Number(s.seats)) : undefined;
    await hub.upsert('subscriptions', { ...s, name, vendor: s.vendor?.trim() || name, amount, seats, source: s.source ?? 'manual' });
    toast(sub.id ? `${name} saved` : `${name} added`);
    onClose();
  };
  return (
    <Modal
      title={sub.id ? 'Edit subscription' : 'Add a subscription'}
      onClose={onClose}
      footer={
        <>
          {sub.id && (
            <ConfirmButton
              label="Delete"
              confirmLabel="Click again to delete"
              onConfirm={async () => {
                await hub.remove('subscriptions', sub.id!);
                onClose();
              }}
            />
          )}
          <button type="button" className="soft subs-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary subs-btn" onClick={save}>
            {sub.id ? 'Save' : 'Add subscription'}
          </button>
        </>
      }
    >
      <Field label="Name">
        <input autoFocus value={s.name ?? ''} onChange={e => set({ name: e.target.value })} placeholder="e.g. Substance 3D Painter" />
      </Field>
      <div className="subs-row amt">
        <Field label="Amount">
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={s.amount ?? ''}
            onChange={e => set({ amount: e.target.value === '' ? null : (e.target.value as unknown as number) })}
            placeholder="0.00"
          />
        </Field>
        <Field label="Currency">
          <select value={s.currency} onChange={e => set({ currency: e.target.value as Currency })}>
            <option value="INR">₹ INR</option>
            <option value="USD">US$</option>
            <option value="AED">AED</option>
          </select>
        </Field>
      </div>
      <Pills
        label="Billed"
        value={s.cycle}
        onPick={cycle => set({ cycle })}
        options={[
          ['monthly', 'Monthly'],
          ['yearly', 'Yearly'],
          ['one-off', 'One-off'],
        ]}
      />
      <div className="subs-row">
        <Field label={ending ? 'Access ends' : s.status === 'trial' ? 'Trial ends' : 'Next renewal'}>
          <input type="date" value={(ending ? s.endsOn : s.nextRenewal) ?? ''} onChange={e => set(ending ? { endsOn: e.target.value || undefined } : { nextRenewal: e.target.value || undefined })} />
        </Field>
        <div className="field">
          <span>Remind me</span>
          <div className="subs-static" title="A desktop notice the day before it renews or ends. Turn notices on or off in Settings & import.">
            {!notifications ? 'Off in Settings' : s.status === 'cancelled' ? 'No reminder' : 'The day before'}
            <Icon name="bell" size={16} />
          </div>
        </div>
      </div>
      <Pills
        label="Status"
        value={s.status}
        // Access usually runs until the date it would have renewed.
        onPick={status => set({ status, endsOn: status === 'cancelling' && !s.endsOn ? rollRenewal(s as Subscription, new Date()) : s.endsOn })}
        options={(Object.keys(STATUS) as Status[]).map(k => [k, STATUS[k].pick, STATUS[k].cls])}
      />
      <details className="subs-more" open={!!sub.id}>
        <summary>
          <Icon name="caretRight" size={14} weight="bold" /> Billed by, licence, account, payment method and notes
        </summary>
        <div className="subs-more-body">
          <div className="subs-row">
            <Field label="Billed by">
              <input value={s.vendor ?? ''} onChange={e => set({ vendor: e.target.value })} placeholder="e.g. Adobe, Google Play" />
            </Field>
            <Field label="Payment method">
              <input value={s.paymentMethod ?? ''} onChange={e => set({ paymentMethod: e.target.value })} placeholder="e.g. UPI: GPay" />
            </Field>
          </div>
          <div className="subs-row">
            <Field label="Licence">
              <select value={s.licence ?? 'subscription'} onChange={e => set({ licence: e.target.value === 'subscription' ? undefined : (e.target.value as Subscription['licence']) })}>
                {Object.entries(LICENCE_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Seats">
              <input type="number" min="1" step="1" value={s.seats ?? ''} placeholder="1" onChange={e => set({ seats: e.target.value === '' ? undefined : (e.target.value as unknown as number) })} />
            </Field>
          </div>
          {accounts.length > 0 && (
            <Field label="Software account">
              <select value={s.accountId ?? ''} onChange={e => set({ accountId: e.target.value || undefined })}>
                <option value="">None</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                    {a.email ? ` (${a.email})` : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Pills
            label="Type"
            value={s.category}
            onPick={category => set({ category })}
            options={[
              ['work', 'Work'],
              ['personal', 'Personal'],
            ]}
          />
          <Field label="Notes">
            <textarea rows={2} value={s.notes ?? ''} onChange={e => set({ notes: e.target.value })} />
          </Field>
        </div>
      </details>
    </Modal>
  );
}
