import { useState } from 'react';
import type { AppState, Currency, Subscription } from '../../shared/types';
import { convert, daysUntil, formatMoney, monthlyCost, rollRenewal } from '../../shared/money';
import { hub } from '../hub';
import { ConfirmButton, Field, Icon, Modal, fmtDate, useApp } from '../ui';

const STATUS_LABEL: Record<Subscription['status'], string> = { active: 'Active', trial: 'Trial', cancelling: 'Cancelled, still active', cancelled: 'Ended' };

export function Subscriptions({ state, now }: { state: AppState; now: Date }) {
  const { go } = useApp();
  const [editing, setEditing] = useState<Partial<Subscription> | null>(null);
  const [showEnded, setShowEnded] = useState(false);
  const base = state.settings.baseCurrency;
  const rates = state.settings.rates;
  const live = state.subscriptions.filter(s => s.status !== 'cancelled');
  const renewing = live.filter(s => s.status === 'active' || s.status === 'trial');
  const monthly = renewing.reduce((t, s) => t + convert(monthlyCost(s), s.currency, base, rates), 0);
  const work = renewing.filter(s => s.category === 'work').reduce((t, s) => t + convert(monthlyCost(s), s.currency, base, rates), 0);
  const subSuggestions = state.suggestions.filter(s => s.kind === 'subscription').length;

  const rows = state.subscriptions
    .filter(s => showEnded || s.status !== 'cancelled')
    .map(s => ({ s, next: s.status === 'cancelling' || s.status === 'cancelled' ? s.endsOn : rollRenewal(s, now) }))
    .sort((a, b) => (a.s.status === 'cancelled' ? 1 : 0) - (b.s.status === 'cancelled' ? 1 : 0) || (a.next ?? '9').localeCompare(b.next ?? '9'));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Subscriptions</h1>
          <p className="muted">Found in Gmail receipts (Google Play, Stripe / Link, Chaos) and kept up to date on every sync. Add anything that bills elsewhere by hand.</p>
        </div>
        <div className="actions">
          {subSuggestions > 0 && (
            <button type="button" onClick={() => go({ view: 'inbox' })}>
              {subSuggestions} found in mail to review
            </button>
          )}
          <button type="button" className="primary" onClick={() => setEditing({ currency: 'INR', cycle: 'monthly', status: 'active', category: 'work' })}>
            <Icon name="plus" /> Add subscription
          </button>
        </div>
      </header>

      <section className="kpis three">
        <div className="kpi">
          <div className="kpi-top">Per month</div>
          <div className="kpi-num">{formatMoney(monthly, base)}</div>
          <div className="muted small">yearly plans spread over 12 months</div>
        </div>
        <div className="kpi">
          <div className="kpi-top">Per year</div>
          <div className="kpi-num">{formatMoney(monthly * 12, base)}</div>
          <div className="muted small">{renewing.length} renewing</div>
        </div>
        <div className="kpi">
          <div className="kpi-top">Work tools</div>
          <div className="kpi-num">{formatMoney(work, base)}</div>
          <div className="muted small">per month</div>
        </div>
      </section>

      <section className="card">
        <div className="table-wrap">
          <table className="subs">
            <thead>
              <tr>
                <th>Name</th>
                <th>Billed by</th>
                <th className="num">Amount</th>
                <th className="num">≈ per month ({base})</th>
                <th>Next</th>
                <th>Status</th>
                <th>Type</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ s, next }) => {
                const d = next ? daysUntil(next, now) : null;
                return (
                  <tr key={s.id} className={s.status === 'cancelled' ? 'dim' : ''}>
                    <td>
                      <strong>{s.name}</strong>
                      {s.notes && <div className="muted small clamp">{s.notes}</div>}
                    </td>
                    <td className="small">
                      {s.vendor}
                      {s.paymentMethod && <div className="muted">{s.paymentMethod}</div>}
                    </td>
                    <td className="num">{s.amount != null ? `${formatMoney(s.amount, s.currency, s.amount % 1 ? 2 : 0)}/${s.cycle === 'yearly' ? 'yr' : s.cycle === 'monthly' ? 'mo' : 'once'}` : '—'}</td>
                    <td className="num">{s.status === 'active' || s.status === 'trial' ? formatMoney(convert(monthlyCost(s), s.currency, base, rates), base) : '—'}</td>
                    <td className="small">
                      {next ? (
                        <>
                          {s.status === 'cancelling' || s.status === 'cancelled' ? 'ends ' : s.status === 'trial' ? 'trial ends ' : 'renews '}
                          {fmtDate(next)}
                          {d !== null && d >= 0 && <span className={`tag ${d <= 3 ? 'warn' : ''}`}>{d === 0 ? 'today' : `${d} d`}</span>}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`tag ${s.status === 'active' ? 'ok' : s.status === 'cancelling' ? 'warn' : ''}`}>{STATUS_LABEL[s.status]}</span>
                    </td>
                    <td className="small">{s.category}</td>
                    <td className="row-actions">
                      {s.emailId && (
                        <button type="button" className="mini ghost" title="Open the mail" onClick={() => hub.openUrl(`https://mail.google.com/mail/u/0/#all/${s.emailId}`)}>
                          <Icon name="mail" size={13} />
                        </button>
                      )}
                      <button type="button" className="mini" onClick={() => setEditing(s)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <label className="check">
          <input type="checkbox" checked={showEnded} onChange={e => setShowEnded(e.target.checked)} /> Show ended subscriptions
        </label>
      </section>
      {editing && <SubEditor sub={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SubEditor({ sub, onClose }: { sub: Partial<Subscription>; onClose(): void }) {
  const [s, setS] = useState<Partial<Subscription>>(sub);
  const set = (patch: Partial<Subscription>) => setS({ ...s, ...patch });
  const save = async () => {
    if (!s.name?.trim()) return;
    await hub.upsert('subscriptions', {
      ...s,
      name: s.name.trim(),
      vendor: s.vendor?.trim() || s.name.trim(),
      amount: s.amount === null || (s.amount as unknown) === '' || s.amount === undefined ? null : Number(s.amount),
      source: s.source ?? 'manual',
    });
    onClose();
  };
  return (
    <Modal
      title={sub.id ? 'Edit subscription' : 'Add subscription'}
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
        <Field label="Name">
          <input autoFocus value={s.name ?? ''} onChange={e => set({ name: e.target.value })} placeholder="e.g. Substance 3D Painter" />
        </Field>
        <Field label="Billed by">
          <input value={s.vendor ?? ''} onChange={e => set({ vendor: e.target.value })} placeholder="e.g. Adobe, Google Play" />
        </Field>
        <Field label="Amount">
          <input type="number" step="0.01" value={s.amount ?? ''} onChange={e => set({ amount: e.target.value === '' ? null : (e.target.value as unknown as number) })} />
        </Field>
        <Field label="Currency">
          <select value={s.currency} onChange={e => set({ currency: e.target.value as Currency })}>
            <option>INR</option>
            <option>AED</option>
            <option>USD</option>
          </select>
        </Field>
        <Field label="Billing cycle">
          <select value={s.cycle} onChange={e => set({ cycle: e.target.value as Subscription['cycle'] })}>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
            <option value="one-off">One-off</option>
          </select>
        </Field>
        <Field label="Status">
          <select
            value={s.status}
            onChange={e => {
              const status = e.target.value as Subscription['status'];
              // Access usually runs until the date it would have renewed.
              set({ status, endsOn: status === 'cancelling' && !s.endsOn ? rollRenewal(s as Subscription, new Date()) : s.endsOn });
            }}
          >
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        {s.status === 'cancelling' || s.status === 'cancelled' ? (
          <Field label="Access ends">
            <input type="date" value={s.endsOn ?? ''} onChange={e => set({ endsOn: e.target.value || undefined })} />
          </Field>
        ) : (
          <Field label={s.status === 'trial' ? 'Trial ends' : 'Next renewal'}>
            <input type="date" value={s.nextRenewal ?? ''} onChange={e => set({ nextRenewal: e.target.value || undefined })} />
          </Field>
        )}
        <Field label="Type">
          <select value={s.category} onChange={e => set({ category: e.target.value as Subscription['category'] })}>
            <option value="work">Work</option>
            <option value="personal">Personal</option>
          </select>
        </Field>
        <Field label="Payment method">
          <input value={s.paymentMethod ?? ''} onChange={e => set({ paymentMethod: e.target.value })} />
        </Field>
      </div>
      <Field label="Notes">
        <input value={s.notes ?? ''} onChange={e => set({ notes: e.target.value })} />
      </Field>
    </Modal>
  );
}
