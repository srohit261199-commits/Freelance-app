import { useMemo, useState } from 'react';
import type { AppState, CompanyId, Currency, Payment } from '../../shared/types';
import { allEarnings, convert, formatMoney, monthKey, monthLabel, ordinal, tierFee, type CompanyEarnings } from '../../shared/money';
import { COMPLEXITY_LABELS, isComplete } from '../../shared/status';
import { hub } from '../hub';
import { CompanyDot, Field, Icon, Modal, fmtDate, useApp } from '../ui';

function payTerms(state: AppState, id: CompanyId): string {
  const c = state.companies.find(x => x.id === id)!;
  if (c.pay.kind === 'retainer') return `${formatMoney(c.pay.amount, c.currency)} a month since ${fmtDate(c.pay.startDate)}, paid around the ${ordinal(c.pay.payday)}`;
  if (c.pay.kind === 'tiered') return `Per approved model, ₹${c.pay.tiers.simple}–₹${c.pay.tiers.super2}, ${c.pay.tdsPercent}% TDS, paid ${ordinal(c.pay.payoutFrom)}–${ordinal(c.pay.payoutTo)} of next month`;
  return `${formatMoney(c.pay.rate, c.currency)} per ${c.pay.unit}; no fixed pay day, so record payments as they arrive`;
}

/** Spends received money on months oldest first to show which months are paid. */
function monthStatus(e: CompanyEarnings, nowMonth: string, today: string) {
  let left = e.received;
  return e.months.map(l => {
    const accruing = l.month === nowMonth && e.company === 'waveink';
    let state: 'paid' | 'part' | 'due' | 'overdue' | 'accruing';
    if (accruing) state = 'accruing';
    else if (left >= l.net - 0.5) {
      state = 'paid';
      left -= l.net;
    } else if (left > 0) {
      state = 'part';
      left = 0;
    } else state = l.due && l.due < today ? 'overdue' : 'due';
    return { ...l, state };
  });
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
  const today = now.toISOString().slice(0, 10);
  const nowMonth = monthKey(today);
  const mzCfg = state.companies.find(c => c.id === 'metaztech')!;
  const mzDone = state.models.filter(m => m.company === 'metaztech' && isComplete(m.status));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Earnings</h1>
          <p className="muted">
            Totals in {base} at 1 AED = ₹{rates.AED}, 1 USD = ₹{rates.USD} (change in Settings).
          </p>
        </div>
        <div className="actions">
          <button type="button" className="primary" onClick={() => setEditing({ date: today, company: 'waveink', currency: 'AED' })}>
            <Icon name="plus" /> Record payment
          </button>
          <button
            type="button"
            onClick={async () => {
              const r = await hub.exportExcel('all');
              if (r.path) toast(`Saved ${r.path}`);
            }}
          >
            <Icon name="download" /> Export
          </button>
        </div>
      </header>

      <section className="kpis">
        <div className="kpi">
          <div className="kpi-top">Earned to date</div>
          <div className="kpi-num">{formatMoney(sum('earned'), base)}</div>
          <div className="muted small">finished months and approved work, after TDS</div>
        </div>
        <div className="kpi">
          <div className="kpi-top">Received</div>
          <div className="kpi-num">{formatMoney(sum('received'), base)}</div>
          <div className="muted small">{state.payments.length} payments recorded</div>
        </div>
        <div className="kpi">
          <div className="kpi-top">Still owed</div>
          <div className="kpi-num">{formatMoney(sum('outstanding'), base)}</div>
          <div className="muted small">earned but not received yet</div>
        </div>
        <div className="kpi">
          <div className="kpi-top">Expected this month</div>
          <div className="kpi-num">{formatMoney(sum('thisMonth'), base)}</div>
          <div className="muted small">+ {formatMoney(sum('pipeline'), base)} in open work</div>
        </div>
      </section>

      <div className="company-money">
        {earnings.map(e => {
          const c = state.companies.find(x => x.id === e.company)!;
          const months = monthStatus(e, nowMonth, today);
          return (
            <section key={e.company} className="card">
              <h2>
                <CompanyDot color={c.color} /> {c.name}
              </h2>
              <p className="muted small">{payTerms(state, e.company)}</p>
              <div className="money-row">
                <div>
                  <small className="muted">Earned</small>
                  <strong>{formatMoney(e.earned, e.currency)}</strong>
                </div>
                <div>
                  <small className="muted">Received</small>
                  <strong>{formatMoney(e.received, e.currency)}</strong>
                </div>
                <div>
                  <small className="muted">Owed</small>
                  <strong className={e.outstanding > 0 ? 'warn-text' : ''}>{formatMoney(e.outstanding, e.currency)}</strong>
                </div>
                <div>
                  <small className="muted">{e.company === 'waveink' ? 'Accruing now' : 'This month'}</small>
                  <strong>{formatMoney(e.thisMonth, e.currency)}</strong>
                </div>
              </div>
              {e.overdue && (
                <div className="banner warn small">
                  {monthLabel(e.overdue.month)} was due {fmtDate(e.overdue.due)} and is not recorded. Record it below once it arrives.
                </div>
              )}
              {e.unpriced > 0 && <div className="banner small">{e.unpriced} approved model{e.unpriced > 1 ? 's have' : ' has'} no complexity set; counted at the lowest tier.</div>}
              {months.length === 0 ? (
                <p className="muted small">Nothing earned yet.</p>
              ) : (
                <table className="mini-table">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th className="num">{e.company === 'waveink' ? '' : e.company === 'metaztech' ? 'Models' : 'Images'}</th>
                      <th className="num">Net</th>
                      <th>Due</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.map(l => (
                      <tr key={l.month}>
                        <td>{monthLabel(l.month)}</td>
                        <td className="num">{e.company === 'waveink' ? '' : l.units}</td>
                        <td className="num">{formatMoney(l.net, e.currency, l.net % 1 ? 2 : 0)}</td>
                        <td className="small">{l.due ? fmtDate(l.due) : '—'}</td>
                        <td>
                          <span className={`tag ${l.state === 'paid' ? 'ok' : l.state === 'overdue' ? 'bad' : l.state === 'part' ? 'warn' : ''}`}>
                            {l.state === 'accruing' ? 'in progress' : l.state}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {e.company !== 'waveink' && e.pipeline > 0 && <p className="muted small">Open work worth {formatMoney(e.pipeline, e.currency)} when finished.</p>}
            </section>
          );
        })}
      </div>

      {mzDone.length > 0 && mzCfg.pay.kind === 'tiered' && (
        <section className="card">
          <h2>MetaZtech approved work by complexity</h2>
          <table className="mini-table">
            <thead>
              <tr>
                <th>Complexity</th>
                <th className="num">Models</th>
                <th className="num">Fee each</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(COMPLEXITY_LABELS) as (keyof typeof COMPLEXITY_LABELS)[]).map(k => {
                const n = mzDone.filter(m => (m.complexity ?? 'simple') === k).length;
                if (!n) return null;
                return (
                  <tr key={k}>
                    <td>{COMPLEXITY_LABELS[k]}</td>
                    <td className="num">{n}</td>
                    <td className="num">{formatMoney(tierFee(mzCfg, k), 'INR')}</td>
                    <td className="num">{formatMoney(n * tierFee(mzCfg, k), 'INR')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <h2>Payments received</h2>
        {state.payments.length === 0 && <p className="muted small">No payments yet.</p>}
        <table className="mini-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Company</th>
              <th>For</th>
              <th className="num">Amount</th>
              <th>Reference</th>
              <th>Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...state.payments]
              .sort((a, b) => b.date.localeCompare(a.date))
              .map(p => {
                const c = state.companies.find(x => x.id === p.company);
                return (
                  <tr key={p.id}>
                    <td>{fmtDate(p.date)}</td>
                    <td>
                      <CompanyDot color={c?.color ?? '#999'} /> {c?.name}
                    </td>
                    <td>{p.period ? monthLabel(p.period) : ''}</td>
                    <td className="num">{formatMoney(p.amount, p.currency, p.amount % 1 ? 2 : 0)}</td>
                    <td className="small">{p.reference}</td>
                    <td className="small muted clamp">{p.note}</td>
                    <td className="row-actions">
                      <button type="button" className="mini" onClick={() => setEditing(p)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </section>
      {editing && <PaymentEditor state={state} payment={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PaymentEditor({ state, payment, onClose }: { state: AppState; payment: Partial<Payment>; onClose(): void }) {
  const [p, setP] = useState<Partial<Payment>>(payment);
  const set = (patch: Partial<Payment>) => setP({ ...p, ...patch });
  const save = async () => {
    if (!p.company || !p.date || !Number(p.amount)) return;
    await hub.upsert('payments', { ...p, amount: Number(p.amount), source: p.source ?? 'manual' });
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
            <button
              type="button"
              className="danger ghost"
              onClick={async () => {
                if (confirm('Delete this payment?')) {
                  await hub.remove('payments', payment.id!);
                  onClose();
                }
              }}
            >
              Delete
            </button>
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
          <input type="number" step="0.01" value={p.amount ?? ''} onChange={e => set({ amount: e.target.value as unknown as number })} />
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
