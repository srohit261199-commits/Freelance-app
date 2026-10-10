import { useMemo, useState } from 'react';
import type { AppState, CompanyId, Currency, Payment } from '../../shared/types';
import { addMonths, allEarnings, convert, formatMoney, localDate, monthLabel, monthsBetween, ordinal, tierFee, type CompanyEarnings } from '../../shared/money';
import { COMPLEXITY_LABELS, isComplete } from '../../shared/status';
import { hub } from '../hub';
import { CLIENT_ICON, ConfirmButton, Field, Icon, Modal, fmtDate, useApp, type IconName } from '../ui';
import './Payments.css';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Bottom to top in each month's bar. */
const STACK: CompanyId[] = ['skeidar', 'metaztech', 'waveink'];
const LEGEND: CompanyId[] = ['waveink', 'metaztech', 'skeidar'];
const CUR_LABEL: Record<Currency, string> = { INR: '₹ INR', AED: 'AED', USD: 'US$' };
const CUR_SHORT: Record<Currency, string> = { INR: '₹', AED: 'AED', USD: 'US$' };
const WORK: Record<CompanyId, string> = { waveink: 'retainer', metaztech: 'approvals', skeidar: 'work' };

/** Pay rule in full (tooltip) and short (the By client row). */
function payTerms(state: AppState, id: CompanyId, next?: string): [string, string] {
  const c = state.companies.find(x => x.id === id)!;
  if (c.pay.kind === 'retainer') {
    const amount = formatMoney(c.pay.amount, c.currency);
    return [`${amount} a month since ${fmtDate(c.pay.startDate)}, paid around the ${ordinal(c.pay.payday)}`, `Retainer ${amount} / mo${next ? ` · next ${next}` : ''}`];
  }
  if (c.pay.kind === 'tiered') {
    const range = `₹${c.pay.tiers.simple.toLocaleString('en-IN')}–₹${c.pay.tiers.super2.toLocaleString('en-IN')}`;
    return [`Per approved model, ${range}, ${c.pay.tdsPercent}% TDS, paid ${ordinal(c.pay.payoutFrom)}–${ordinal(c.pay.payoutTo)} of next month`, `${range} a model · ${c.pay.tdsPercent}% TDS`];
  }
  const rate = `${formatMoney(c.pay.rate, c.currency)} per ${c.pay.unit}`;
  return [`${rate}; no fixed pay day, so record payments as they arrive`, `${rate} · no fixed pay day`];
}

/** Each month's state from what the recorded payments cover (money.ts allocates them by month). */
function monthStatus(e: CompanyEarnings, nowMonth: string, today: string) {
  return e.months.map(l => {
    const paid = e.paidByMonth[l.month] ?? 0;
    let state: 'paid' | 'part' | 'due' | 'overdue' | 'accruing';
    if (paid >= l.net - 0.5) state = 'paid';
    else if (l.month === nowMonth && e.company === 'waveink') state = 'accruing';
    else if (paid > 0) state = 'part';
    else state = l.due && l.due < today ? 'overdue' : 'due';
    return { ...l, paid, state };
  });
}

const money = (n: number, c: Currency) => formatMoney(n, c, n % 1 ? 2 : 0).replace(' ', '\u00a0');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const monthName = (mk: string, withYear: boolean) =>
  new Date(Date.UTC(+mk.slice(0, 4), +mk.slice(5, 7) - 1, 1)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' }) + (withYear ? ` ${mk.slice(0, 4)}` : '');

function shortDate(iso: string, now: Date): string {
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const s = `${d.getDate()} ${MON[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? s : `${s} ${d.getFullYear()}`;
}

/** ₹96k, AED 4.2k: the figure printed above each bar. */
function compact(n: number, c: Currency): string {
  const v = n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n));
  return c === 'INR' ? `₹${v}` : c === 'USD' ? `$${v}` : `AED ${v}`;
}

type TxStatus = 'paid' | 'part' | 'late' | 'pending';
const TX_PILL: Record<TxStatus, [string, string]> = { paid: ['st-ok', 'Paid'], part: ['st-warn', 'Part'], late: ['st-bad', 'Late'], pending: ['st-info', 'Pending'] };

interface Tx {
  key: string;
  when: string;
  company: CompanyId;
  what: string;
  sub?: string;
  amount: number;
  currency: Currency;
  status: TxStatus;
  source: { icon: IconName; text: string };
  payment?: Payment;
  record?: Partial<Payment>;
}

export function Earnings({ state, now }: { state: AppState; now: Date }) {
  const { toast } = useApp();
  const earnings = useMemo(() => allEarnings(state, now), [state, now]);
  const [editing, setEditing] = useState<Partial<Payment> | null>(null);
  const base = state.settings.baseCurrency;
  const rates = state.settings.rates;
  const toBase = (n: number, c: Currency) => convert(n, c, base, rates);
  const sum = (k: keyof Pick<CompanyEarnings, 'earned' | 'received' | 'outstanding' | 'pipeline' | 'thisMonth'>) =>
    earnings.reduce((s, e) => s + toBase(e[k], e.currency), 0);
  const today = localDate(now);
  const nowMonth = today.slice(0, 7);
  const thisYear = now.getFullYear();
  const cfg = (id: CompanyId) => state.companies.find(c => c.id === id)!;
  const mzCfg = state.companies.find(c => c.id === 'metaztech');
  const mzDone = state.models.filter(m => m.company === 'metaztech' && isComplete(m.status));

  // Financial year from 1 April; the chart shows at least six months.
  const fyStart = `${now.getMonth() >= 3 ? thisYear : thisYear - 1}-04`;
  const firstMonth = monthsBetween(fyStart, nowMonth).length >= 6 ? fyStart : addMonths(nowMonth, -5);
  const fyPayments = state.payments.filter(p => p.date >= `${fyStart}-01`);
  const receivedFY = fyPayments.reduce((s, p) => s + toBase(p.amount, p.currency), 0);

  const companies = earnings.map(e => {
    const months = monthStatus(e, nowMonth, today);
    const lateLines = months.filter(l => l.state !== 'paid' && l.state !== 'accruing' && l.due && l.due < today);
    const late = lateLines.reduce((s, l) => s + l.net - l.paid, 0);
    return { e, months, late, lateMonths: lateLines.length };
  });
  const late = companies.reduce((s, c) => s + toBase(c.late, c.e.currency), 0);
  const lateMonths = companies.reduce((s, c) => s + c.lateMonths, 0);
  // Piece work done this month is already in "earned"; only a retainer month still running is on top of it.
  const accruing = earnings.reduce((s, e) => s + (cfg(e.company).pay.kind === 'retainer' ? toBase(e.thisMonth, e.currency) : 0), 0);

  const bars = monthsBetween(firstMonth, nowMonth).map(mk => {
    const segs = STACK.flatMap(cid => {
      const e = earnings.find(x => x.company === cid);
      const line = e?.months.find(l => l.month === mk);
      if (!e || !line || line.net <= 0) return [];
      const paid = Math.min(line.net, e.paidByMonth[mk] ?? 0);
      return [{ cid, paid: toBase(paid, e.currency), owed: toBase(line.net - paid, e.currency) }];
    });
    const owed = segs.reduce((s, x) => s + x.owed, 0);
    return { month: mk, segs, owed, total: segs.reduce((s, x) => s + x.paid + x.owed, 0) };
  });
  const maxBar = Math.max(1, ...bars.map(b => b.total));
  const label = (mk: string) => MON[+mk.slice(5, 7) - 1] + (+mk.slice(0, 4) === thisYear ? '' : ` ${mk.slice(2, 4)}`);

  const byMonth = new Map<string, number>();
  for (const e of earnings) for (const l of e.months) if (l.month < nowMonth) byMonth.set(l.month, (byMonth.get(l.month) ?? 0) + toBase(l.net, e.currency));
  const best = [...byMonth].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0];

  const txs: Tx[] = [];
  for (const { e, months } of companies) {
    const c = cfg(e.company);
    for (const l of months) {
      const left = l.net - l.paid;
      if (l.state === 'paid' || left < 0.5) continue;
      const late = l.state !== 'accruing' && !!l.due && l.due < today;
      const window = c.pay.kind === 'tiered' && l.due ? `${c.pay.payoutFrom}–${shortDate(l.due, now)}` : l.due ? shortDate(l.due, now) : '';
      const name = monthName(l.month, +l.month.slice(0, 4) !== thisYear);
      txs.push({
        key: `${e.company}:${l.month}`,
        when: window ? `Due ${window}` : 'No fixed day',
        company: e.company,
        what: e.company === 'waveink' ? `${name} retainer` : e.company === 'metaztech' ? `${name} approvals (${l.units})` : `${name} · ${plural(l.units, 'image')}`,
        sub: l.paid > 0 ? `${money(l.paid, e.currency)} of ${money(l.net, e.currency)} recorded` : l.state === 'accruing' ? 'this month, paid next month' : undefined,
        amount: left,
        currency: e.currency,
        status: late ? 'late' : l.state === 'part' ? 'part' : 'pending',
        source: e.company === 'waveink' ? { icon: 'repeat', text: 'Retainer rule' } : e.company === 'metaztech' ? { icon: 'hourglass', text: 'Waiting for payment advice' } : { icon: 'brush', text: 'Job tracker' },
        record: { date: localDate(new Date()), company: e.company, currency: e.currency, period: l.month, amount: Math.round(left * 100) / 100 },
      });
    }
  }
  txs.sort((a, b) => (a.record!.period ?? '').localeCompare(b.record!.period ?? '') || STACK.indexOf(b.company) - STACK.indexOf(a.company));
  for (const p of [...state.payments].sort((a, b) => b.date.localeCompare(a.date))) {
    const mail = p.emailId ? state.emails.find(m => m.id === p.emailId) : undefined;
    const what = [p.period && `${monthName(p.period, +p.period.slice(0, 4) !== thisYear)} ${WORK[p.company] ?? ''}`.trim(), p.reference && `ref ${p.reference}`].filter(Boolean).join(' · ');
    txs.push({
      key: p.id,
      when: shortDate(p.date, now),
      company: p.company,
      what: what || p.note || 'Payment',
      sub: what ? p.note : undefined,
      amount: p.amount,
      currency: p.currency,
      status: 'paid',
      source:
        p.source === 'manual'
          ? { icon: 'hand', text: 'Added by hand' }
          : p.source === 'email' || p.emailId
            ? { icon: 'mail', text: mail ? `Mail from ${mail.fromName.split(/\s+/)[0] || mail.from}` : 'From mail' }
            : { icon: 'fileUp', text: 'Imported' },
      payment: p,
    });
  }

  const range = `${monthName(firstMonth, firstMonth.slice(0, 4) !== nowMonth.slice(0, 4))} – ${monthName(nowMonth, true)}`;
  const rateNote = base === 'INR' ? ` at AED ${rates.AED} and US$ ${rates.USD}` : ` · AED 1 = ₹${rates.AED}, US$ 1 = ₹${rates.USD}`;

  return (
    <div className="page pay">
      <header className="page-head">
        <div>
          <h1>Payments</h1>
          <p>
            {range} · shown in {CUR_SHORT[base]}
            {rateNote}
          </p>
        </div>
        <div className="actions">
          <div className="seg" role="group" aria-label="Show totals in">
            {(['INR', 'AED', 'USD'] as Currency[]).map(c => (
              <button key={c} type="button" className={c === base ? 'on' : ''} aria-pressed={c === base} onClick={() => c !== base && hub.patchSettings({ baseCurrency: c })}>
                {CUR_LABEL[c]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="lg"
            onClick={async () => {
              const r = await hub.exportExcel('all');
              if (r.path) toast(`Saved ${r.path}`);
              else if (r.error) toast(r.error, 'error');
            }}
          >
            <Icon name="download" size={18} /> Export
          </button>
          <button type="button" className="primary lg" onClick={() => setEditing({ date: localDate(new Date()), company: 'waveink', currency: 'AED' })}>
            <Icon name="plus" size={18} /> Record payment
          </button>
        </div>
      </header>

      <section className="kpis pay-tiles" aria-label="Totals">
        <Tile tone="ok" icon="arrowDownLeft" label="Received" value={formatMoney(receivedFY, base)} sub={`since 1 April · ${plural(fyPayments.length, 'payment')} recorded`} />
        <Tile tone="info" icon="hourglass" label="Earned, not paid yet" value={formatMoney(sum('outstanding'), base)} sub={accruing > 0.5 ? `+ ${formatMoney(accruing, base)} accruing this month` : 'finished months and approved work'} />
        <Tile
          tone={late > 0.5 ? 'bad' : 'neutral'}
          icon="warning"
          label="Late"
          value={formatMoney(late, base)}
          sub={late > 0.5 ? `${plural(lateMonths, 'month')} past ${lateMonths === 1 ? 'its' : 'their'} pay day` : 'nothing past its pay day'}
        />
        <Tile
          tone="warn"
          icon="trophy"
          label="Best month"
          value={best ? `${label(best[0])} · ${formatMoney(best[1], base)}` : '—'}
          sub={`${formatMoney(sum('earned'), base)} earned to date, after TDS`}
        />
      </section>

      <div className="pay-mid">
        <section className="panel pay-chart-panel" aria-labelledby="pay-chart-h">
          <div className="pay-chart-head">
            <h2 id="pay-chart-h">Earned per month</h2>
            <ul className="pay-legend">
              {LEGEND.map(id => (
                <li key={id}>
                  <i className={`c-${id}`} />
                  {cfg(id)?.name}
                </li>
              ))}
              <li>
                <i className="owed" />
                Not paid yet
              </li>
            </ul>
          </div>
          <div className="pay-chart-scroll">
            <div
              className="pay-chart"
              role="img"
              aria-label={bars.map(b => `${label(b.month)}: ${formatMoney(b.total, base)} earned${b.owed > 0.5 ? `, ${formatMoney(b.owed, base)} not paid yet` : ''}`).join('; ')}
              style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(var(--pay-col-min), 1fr))` }}
            >
              {bars.map(b => (
                <div key={b.month} className={`pay-bar ${b.month === nowMonth ? 'now' : ''}`}>
                  <div className="pay-bar-area">
                    {b.total > 0.5 && <span className="pay-bar-val">{compact(b.total, base)}</span>}
                    {b.total > 0.5 ? (
                      <div
                        className="pay-stack"
                        style={{ height: `calc((100% - 26px) * ${(b.total / maxBar).toFixed(4)})` }}
                        title={`${label(b.month)}: ${formatMoney(b.total, base)} earned${b.owed > 0.5 ? `, ${formatMoney(b.owed, base)} not paid yet` : ''}${b.month === nowMonth ? ' (this month, paid next month)' : ''}`}
                      >
                        {b.segs.flatMap(s => [
                          s.paid > 0.5 && <i key={`${s.cid}p`} className={`c-${s.cid}`} style={{ flexGrow: s.paid }} />,
                          s.owed > 0.5 && <i key={`${s.cid}o`} className={`c-${s.cid} owed`} style={{ flexGrow: s.owed }} />,
                        ])}
                      </div>
                    ) : (
                      <div className="pay-stack none" />
                    )}
                  </div>
                  <span className="pay-bar-month">{label(b.month)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="panel pay-clients" aria-labelledby="pay-clients-h">
          <h2 id="pay-clients-h">By client</h2>
          <ul>
            {companies.map(({ e, months, late: lateAmt }) => {
              const c = cfg(e.company);
              const next = months.filter(l => l.state !== 'paid' && l.due >= today).sort((a, b) => a.due.localeCompare(b.due))[0]?.due;
              const [terms, short] = payTerms(state, e.company, next && shortDate(next, now));
              const none = e.earned === 0 && e.received === 0;
              const parts = none ? [] : [`Earned ${money(e.earned, e.currency)}`, `received ${money(e.received, e.currency)}`];
              if (e.company !== 'waveink' && e.pipeline > 0) parts.push(`${money(e.pipeline, e.currency)} in open work`);
              const [fig, word, tone] =
                lateAmt > 0.5
                  ? [money(e.outstanding || lateAmt, e.currency), lateAmt >= e.outstanding - 0.5 ? 'late' : `${money(lateAmt, e.currency)} late`, 'bad-text']
                  : e.outstanding > 0.5
                    ? [money(e.outstanding, e.currency), 'owed', 'warn-text']
                    : !none
                      ? [money(e.received, e.currency), 'all paid', 'ok-text']
                      : ['—', 'nothing earned yet', 'muted'];
              return (
                <li key={e.company} className={`pay-client c-${e.company}`}>
                  <div className="pay-client-row">
                    <span className="pay-client-tile c-fill" aria-hidden="true">
                      <Icon name={CLIENT_ICON[e.company]} size={20} weight="fill" />
                    </span>
                    <div className="pay-client-text">
                      <b>{c.name}</b>
                      <span title={terms}>{short}</span>
                      {parts.length > 0 && <span>{parts.join(' · ')}</span>}
                    </div>
                    <div className="pay-client-fig">
                      <b>{fig}</b>
                      <span className={tone}>{word}</span>
                    </div>
                  </div>
                  {e.overdue && (
                    <div className="banner bad small">
                      {monthLabel(e.overdue.month)} was due {fmtDate(e.overdue.due)}
                      {e.overdue.paid > 0
                        ? ` and is only partly recorded: ${formatMoney(e.overdue.paid, e.currency)} of ${formatMoney(e.overdue.net, e.currency)}. Record the rest below once it arrives.`
                        : ' and is not recorded. Record it below once it arrives.'}
                    </div>
                  )}
                  {e.unpriced > 0 && <div className="banner small">{e.unpriced} approved model{e.unpriced > 1 ? 's have' : ' has'} no complexity set; counted at the lowest tier.</div>}
                  {e.approxMonth > 0 && (
                    <p className="pay-note">
                      {e.approxMonth} model{e.approxMonth > 1 ? 's' : ''} imported already approved {e.approxMonth > 1 ? 'are' : 'is'} counted in the month{' '}
                      {e.approxMonth > 1 ? 'they were' : 'it was'} imported.
                    </p>
                  )}
                  {e.company === 'metaztech' && mzDone.length > 0 && mzCfg?.pay.kind === 'tiered' && (
                    <details className="pay-tiers">
                      <summary>Approved work by complexity · {plural(mzDone.length, 'model')}</summary>
                      <table>
                        <tbody>
                          {(Object.keys(COMPLEXITY_LABELS) as (keyof typeof COMPLEXITY_LABELS)[]).map(k => {
                            const n = mzDone.filter(m => (m.complexity ?? 'simple') === k).length;
                            if (!n) return null;
                            return (
                              <tr key={k}>
                                <td>{COMPLEXITY_LABELS[k]}</td>
                                <td className="num">
                                  {n} × {formatMoney(tierFee(mzCfg, k), 'INR')}
                                </td>
                                <td className="num">{formatMoney(n * tierFee(mzCfg, k), 'INR')}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section className="panel pay-tx" aria-label="Payments and money due">
        {txs.length === 0 ? (
          <p className="muted small">No payments yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="pay-c-date">Date</th>
                  <th className="pay-c-client">Client</th>
                  <th>For</th>
                  <th className="pay-c-amt">Amount</th>
                  <th className="pay-c-base">In {CUR_SHORT[base]}</th>
                  <th className="pay-c-status">Status</th>
                  <th className="pay-c-src">Source</th>
                  <th className="pay-c-act">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {txs.map(t => {
                  const [pill, text] = TX_PILL[t.status];
                  const name = cfg(t.company)?.name ?? t.company;
                  return (
                    <tr key={t.key}>
                      <td className="pay-when">{t.when}</td>
                      <td className="pay-who-td">
                        <span className="pay-who">
                          <span className={`cdot big c-${t.company}`} />
                          {name}
                        </span>
                      </td>
                      <td className="pay-what">
                        <div className="ellipsis" title={t.what}>
                          {t.what}
                        </div>
                        {t.sub && (
                          <small className="ellipsis" title={t.sub}>
                            {t.sub}
                          </small>
                        )}
                      </td>
                      <td className="pay-amt tabular">{money(t.amount, t.currency)}</td>
                      <td className="pay-base tabular">{formatMoney(toBase(t.amount, t.currency), base)}</td>
                      <td className="pay-status">
                        <span className={`pill ${pill}`}>{text}</span>
                      </td>
                      <td className="pay-src-td">
                        <span className="pay-src">
                          <Icon name={t.source.icon} size={16} />
                          {t.source.text}
                        </span>
                      </td>
                      <td className="row-actions pay-act">
                        {t.payment ? (
                          <button type="button" className="mini" onClick={() => setEditing(t.payment!)} aria-label={`Edit ${name} payment of ${money(t.amount, t.currency)} on ${t.when}`}>
                            Edit
                          </button>
                        ) : (
                          <button type="button" className="mini" onClick={() => setEditing(t.record!)} aria-label={`Record ${name} payment for ${t.what}`}>
                            Record
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editing && <PaymentEditor state={state} payment={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Tile({ tone, icon, label, value, sub }: { tone: 'ok' | 'info' | 'bad' | 'warn' | 'neutral'; icon: IconName; label: string; value: string; sub: string }) {
  return (
    <div className={`pay-tile ${tone}`}>
      <div className="pay-tile-top">
        {label}
        <span className="pay-tile-ic" aria-hidden="true">
          <Icon name={icon} size={17} weight="fill" />
        </span>
      </div>
      <div className="pay-tile-num">{value}</div>
      <div className="pay-tile-sub">{sub}</div>
    </div>
  );
}

function PaymentEditor({ state, payment, onClose }: { state: AppState; payment: Partial<Payment>; onClose(): void }) {
  const { toast } = useApp();
  const [p, setP] = useState<Partial<Payment>>(payment);
  const set = (patch: Partial<Payment>) => setP({ ...p, ...patch });
  const save = async () => {
    const amount = Number(p.amount);
    if (!(amount > 0)) return toast('Enter the amount received (more than 0).', 'error');
    if (!p.company || !p.date) return toast('Enter the date the payment arrived.', 'error');
    const currency = p.currency ?? 'INR';
    const own = state.companies.find(c => c.id === p.company)!.currency;
    // Fix the value in the company's currency now, so a later rate change doesn't rewrite this payment.
    const changed = !payment.id || amount !== payment.amount || currency !== payment.currency || p.company !== payment.company;
    const settledAmount = currency === own ? undefined : changed ? convert(amount, currency, own, state.settings.rates) : p.settledAmount;
    await hub.upsert('payments', { ...p, amount, currency, settledAmount, source: p.source ?? 'manual' });
    onClose();
  };
  const defaults: Record<CompanyId, Currency> = { waveink: 'AED', metaztech: 'INR', skeidar: 'AED' };
  return (
    <Modal
      title={payment.id ? 'Edit payment' : 'Record payment'}
      onClose={onClose}
      footer={
        <>
          {payment.id && (
            <ConfirmButton
              label="Delete"
              confirmLabel="Click again to delete"
              onConfirm={async () => {
                await hub.remove('payments', payment.id!);
                onClose();
              }}
            />
          )}
          <span className="grow" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="grid2">
        <Field label="Company">
          <select value={p.company} onChange={e => set({ company: e.target.value as CompanyId, currency: defaults[e.target.value as CompanyId] })}>
            {state.companies.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date received">
          <input type="date" value={p.date ?? ''} onChange={e => set({ date: e.target.value })} />
        </Field>
        <Field label="Amount received">
          <input type="number" min="0" step="0.01" value={p.amount ?? ''} onChange={e => set({ amount: e.target.value as unknown as number })} />
        </Field>
        <Field label="Currency">
          <select value={p.currency} onChange={e => set({ currency: e.target.value as Currency })}>
            <option>INR</option>
            <option>AED</option>
            <option>USD</option>
          </select>
        </Field>
        <Field label="For month (optional)">
          <input type="month" value={p.period ?? ''} onChange={e => set({ period: e.target.value || undefined })} />
        </Field>
        <Field label="Reference">
          <input value={p.reference ?? ''} onChange={e => set({ reference: e.target.value })} />
        </Field>
      </div>
      <Field label="Note">
        <input value={p.note ?? ''} onChange={e => set({ note: e.target.value })} />
      </Field>
    </Modal>
  );
}
