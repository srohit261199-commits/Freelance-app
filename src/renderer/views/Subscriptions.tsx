import { useId, useState } from 'react';
import type { AppState, Currency, SoftwareAccount, Subscription } from '../../shared/types';
import { convert, daysUntil, formatMoney, monthlyCost, rollRenewal } from '../../shared/money';
import { hub } from '../hub';
import { ConfirmButton, Empty, Field, Icon, Modal, PageHead, Stat, type IconName, useApp } from '../ui';
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
const TYPES: [Subscription['category'], string][] = [
  ['work', 'Work'],
  ['personal', 'Personal'],
];
/** Which rows the table shows: the ones still running, what renews or ends in the next 30 days, or all with the ended ones. */
type View = 'current' | 'soon' | 'all';

const money = (n: number, c: Currency) => formatMoney(n, c, n % 1 ? 2 : 0).replace(/^\$/, 'US$');
const plans = (n: number) => `${n} plan${n === 1 ? '' : 's'}`;
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

/** Where the subscription came from: a receipt mail an older version read, a software account, by hand, or at setup (shown only as a tooltip). */
function foundIn(s: Subscription, state: AppState): { icon: IconName; text: string; setup?: boolean } {
  if (s.emailId || s.source === 'email') return { icon: 'receipt', text: 'From a receipt mail' };
  if (s.source === 'account') return { icon: 'user', text: `${state.accounts.find(a => a.id === s.accountId)?.label ?? 'Software'} account` };
  return s.source === 'manual' ? { icon: 'hand', text: 'Added by hand' } : { icon: 'hand', text: 'Added at setup', setup: true };
}

export function Subscriptions({ state, now }: { state: AppState; now: Date }) {
  const [editing, setEditing] = useState<Partial<Subscription> | null>(null);
  const [view, setView] = useState<View>('current');
  const base = state.settings.baseCurrency;
  const rates = state.settings.rates;
  const inBase = (s: Subscription) => convert(monthlyCost(s), s.currency, base, rates);
  const live = state.subscriptions.filter(s => s.status !== 'cancelled');
  const renewing = live.filter(s => s.status === 'active' || s.status === 'trial');
  const monthly = renewing.reduce((t, s) => t + inBase(s), 0);
  const work = renewing.filter(s => s.category === 'work').reduce((t, s) => t + inBase(s), 0);
  const ended = state.subscriptions.length - live.length;

  const soon = live
    .map(s => ({ s, next: nextOf(s, now) }))
    .filter((r): r is { s: Subscription; next: string } => !!r.next && daysUntil(r.next, now) >= 0 && daysUntil(r.next, now) <= 30);
  const trials = live
    .filter(s => s.status === 'trial')
    .map(s => ({ s, next: nextOf(s, now) }))
    .filter((r): r is { s: Subscription; next: string } => !!r.next && daysUntil(r.next, now) >= 0)
    .sort((a, b) => a.next.localeCompare(b.next));
  const renewingSoon = soon.filter(r => r.s.status === 'active');
  const nextRenewal = renewing
    .map(s => ({ s, next: nextOf(s, now) }))
    .filter((r): r is { s: Subscription; next: string } => !!r.next && daysUntil(r.next, now) >= 0)
    .sort((a, b) => a.next.localeCompare(b.next))[0];
  const cancelling = live.filter(s => s.status === 'cancelling').length;
  const trial = trials[0];

  const views: [View, string, number][] = [['current', 'Current', live.length], ['soon', 'Next 30 days', soon.length]];
  if (ended) views.push(['all', 'All', state.subscriptions.length]);
  const shown = views.some(([v]) => v === view) ? view : 'current';
  const soonIds = new Set(soon.map(r => r.s.id));
  const rows = state.subscriptions
    .filter(s => (shown === 'all' ? true : shown === 'soon' ? soonIds.has(s.id) : s.status !== 'cancelled'))
    .map(s => ({ s, next: nextOf(s, now) }))
    .sort((a, b) => (a.s.status === 'cancelled' ? 1 : 0) - (b.s.status === 'cancelled' ? 1 : 0) || (a.next ?? '9').localeCompare(b.next ?? '9'));

  return (
    <div className="page subs-page">
      <PageHead
        title="Subscriptions"
        meta={
          live.length ? (
            <>
              <span>{plans(live.length)}</span>
              {nextRenewal && (
                <span>
                  Next: {nextRenewal.s.name} {nextRenewal.s.status === 'trial' ? 'trial ends' : 'renews'} {shortDate(nextRenewal.next, now)}
                </span>
              )}
            </>
          ) : (
            <span>Nothing tracked yet</span>
          )
        }
      >
        <button type="button" className="primary" onClick={() => setEditing({ currency: 'INR', cycle: 'monthly', status: 'active', category: 'work' })}>
          <Icon name="plus" /> Add subscription
        </button>
      </PageHead>

      <section className="kpis money-stats" aria-label="Totals">
        <Stat label="Per month" value={formatMoney(monthly, base)} sub={work > 0 && work < monthly ? `${formatMoney(work, base)} for work` : undefined} />
        <Stat label="Per year" value={formatMoney(monthly * 12, base)} sub={`${renewing.length} renewing`} />
        {trial ? (
          <Stat label="Trial ending" tone="bad-text" value={inDays(daysUntil(trial.next, now))} sub={trials.length > 1 ? `${trials.length} trials, first ${trial.s.name}` : trial.s.name} />
        ) : (
          <Stat
            label="Renewing in 30 days"
            value={renewingSoon.length ? formatMoney(renewingSoon.reduce((t, r) => t + convert(r.s.amount ?? 0, r.s.currency, base, rates), 0), base) : 'None'}
            sub={renewingSoon.length ? plans(renewingSoon.length) : undefined}
          />
        )}
        <Stat label="Cancelling" value={cancelling ? plans(cancelling) : 'None'} />
      </section>

      {trial && (
        <p className="banner small subs-alert" role="note">
          <Icon name="bell" />
          <span>
            <strong>{trial.s.name}</strong>{' '}
            {trial.s.amount != null
              ? `turns into ${money(trial.s.amount, trial.s.currency)} ${PER[trial.s.cycle]} on ${shortDate(trial.next, now)}.`
              : `trial ends on ${shortDate(trial.next, now)}.`}{' '}
            {state.settings.notifications ? 'You’ll get a desktop reminder the day before.' : 'Desktop reminders are off in Settings & import.'}
          </span>
        </p>
      )}

      <section className="panel subs-table" aria-labelledby="subs-plans-h">
        <div className="panel-head">
          <h2 id="subs-plans-h">Plans</h2>
          <div className="seg end" role="group" aria-label="Show">
            {views.map(([v, text, n]) => (
              <button key={v} type="button" className={shown === v ? 'on' : ''} aria-pressed={shown === v} onClick={() => setView(v)}>
                {text} <span className="n">{n}</span>
              </button>
            ))}
          </div>
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="c-sw">Software</th>
                  <th className="c-st">Status</th>
                  <th className="c-amt">Amount</th>
                  <th className="c-mo">{SYMBOL[base]} / month</th>
                  <th className="c-nx">Next</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ s, next }) => {
                  const note = nextNote(s, next, now);
                  const tone = note.tone ? `${note.tone}-text` : 'muted';
                  const src = foundIn(s, state);
                  const pays = s.status === 'active' || s.status === 'trial';
                  const amount = s.amount != null ? money(s.amount, s.currency) : '—';
                  return (
                    <tr key={s.id} className={s.status === 'cancelled' ? 'ended' : ''} onClick={e => !(e.target as HTMLElement).closest('button') && setEditing(s)}>
                      <td className="c-sw">
                        <div className="subs-app">
                          <span className="subs-tile" aria-hidden="true">
                            {(s.name.trim()[0] ?? '?').toUpperCase()}
                          </span>
                          <div className="subs-app-t">
                            <button type="button" className="link-btn subs-name" title={s.notes || `Edit ${s.name}`} onClick={() => setEditing(s)}>
                              {s.name}
                            </button>
                            <span className="subs-sub" title={src.text}>
                              {vendorLine(s)}
                              {s.licence && s.licence !== 'subscription' && <span className="subs-lic">{LICENCE_LABEL[s.licence]}</span>}
                              {s.seats && s.seats > 1 ? <span className="subs-lic">{s.seats} seats</span> : null}
                              {!src.setup && (
                                <span className="subs-src">
                                  <Icon name={src.icon} size={13} />
                                  {src.text}
                                </span>
                              )}
                            </span>
                            <div className="subs-mob">
                              <span className={`pill ${STATUS[s.status].cls}`}>{STATUS[s.status].label}</span>
                              <span>
                                <b>{amount}</b> {s.amount != null && PER[s.cycle]}
                              </span>
                              {next && (
                                <span className={tone}>
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
                      <td className="c-amt">
                        <div className="subs-two">
                          <b className="tabular">{amount}</b>
                          <small className="muted">{CYCLE[s.cycle]}</small>
                        </div>
                      </td>
                      <td className="c-mo tabular">
                        {pays && s.cycle !== 'one-off' && s.amount != null ? (
                          <div className="subs-two">
                            {formatMoney(inBase(s), base)}
                            {s.status === 'trial' && <small className="muted">after trial</small>}
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="c-nx">
                        {next ? (
                          <div className="subs-two">
                            <span>{shortDate(next, now)}</span>
                            <small className={tone}>{note.text}</small>
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : shown === 'soon' ? (
          <p className="muted small">Nothing renews or ends in the next 30 days.</p>
        ) : (
          <Empty title="No subscriptions yet">Add one by hand, or read the plans from a software account below.</Empty>
        )}
      </section>
      <AccountsPanel state={state} now={now} />
      {editing && <SubEditor sub={editing} accounts={state.accounts} notifications={state.settings.notifications} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SubEditor({ sub, accounts, notifications, onClose }: { sub: Partial<Subscription>; accounts: SoftwareAccount[]; notifications: boolean; onClose(): void }) {
  const { toast } = useApp();
  const [s, setS] = useState<Partial<Subscription>>(sub);
  const typeId = useId();
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
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={save}>
            {sub.id ? 'Save' : 'Add subscription'}
          </button>
        </>
      }
    >
      <Field label="Name">
        <input autoFocus value={s.name ?? ''} onChange={e => set({ name: e.target.value })} placeholder="e.g. Substance 3D Painter" />
      </Field>
      <div className="subs-row three">
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
        <Field label="Billed">
          <select value={s.cycle} onChange={e => set({ cycle: e.target.value as Subscription['cycle'] })}>
            {(Object.keys(CYCLE) as Subscription['cycle'][]).map(k => (
              <option key={k} value={k}>
                {CYCLE[k]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="subs-row">
        <Field label="Status">
          <select
            value={s.status}
            // Access usually runs until the date it would have renewed.
            onChange={e => {
              const status = e.target.value as Status;
              set({ status, endsOn: status === 'cancelling' && !s.endsOn ? rollRenewal(s as Subscription, new Date()) : s.endsOn });
            }}
          >
            {(Object.keys(STATUS) as Status[]).map(k => (
              <option key={k} value={k}>
                {STATUS[k].pick}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={ending ? 'Access ends' : s.status === 'trial' ? 'Trial ends' : 'Next renewal'}
          hint={!notifications ? 'Reminders are off in Settings & import' : s.status === 'cancelled' ? 'No reminder' : 'Desktop reminder the day before'}
        >
          <input type="date" value={(ending ? s.endsOn : s.nextRenewal) ?? ''} onChange={e => set(ending ? { endsOn: e.target.value || undefined } : { nextRenewal: e.target.value || undefined })} />
        </Field>
      </div>
      <details className="subs-more" open={!!sub.id}>
        <summary>
          <Icon name="caretRight" size={12} weight="bold" /> Billed by, payment, licence and notes
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
          <div className="subs-row">
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
            <div className="field">
              <span id={typeId}>Type</span>
              <div className="seg" role="group" aria-labelledby={typeId}>
                {TYPES.map(([v, text]) => (
                  <button key={v} type="button" className={s.category === v ? 'on' : ''} aria-pressed={s.category === v} onClick={() => set({ category: v })}>
                    {text}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <Field label="Notes">
            <textarea rows={2} value={s.notes ?? ''} onChange={e => set({ notes: e.target.value })} />
          </Field>
        </div>
      </details>
    </Modal>
  );
}
