import { useState } from 'react';
import type { AppState, Currency, FoundPlan, SoftwareAccount, Subscription, VendorId } from '../../shared/types';
import { formatMoney } from '../../shared/money';
import { uid } from '../../shared/ops';
import { matchVendorSub, planToSubscription, VENDORS, vendorById } from '../../shared/vendors';
import { hub } from '../hub';
import { ConfirmButton, Field, Icon, MenuButton, Modal, relTime, useApp } from '../ui';
import './Accounts.css';

const STATUS: Record<Subscription['status'], string> = { active: 'Active', trial: 'Free trial', cancelling: 'Auto-renew off', cancelled: 'Ended' };
const LICENCE: [NonNullable<Subscription['licence']>, string][] = [
  ['subscription', 'Subscription'],
  ['perpetual', 'Perpetual'],
  ['education', 'Education'],
  ['free', 'Free'],
  ['trial', 'Trial'],
];
export const LICENCE_LABEL = Object.fromEntries(LICENCE) as Record<NonNullable<Subscription['licence']>, string>;

const vendorName = (a: SoftwareAccount) => vendorById(a.vendor)?.name ?? a.label;
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

/** Software accounts: each signs in once in its own window, and "Read plans" pulls the plans page into Subscriptions. */
export function AccountsPanel({ state, now }: { state: AppState; now: Date }) {
  const { toast } = useApp();
  const [editing, setEditing] = useState<Partial<SoftwareAccount> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [review, setReview] = useState<{ account: SoftwareAccount; plans: FoundPlan[]; url: string } | null>(null);
  const linked = (a: SoftwareAccount) => state.subscriptions.filter(s => s.accountId === a.id && s.status !== 'cancelled');

  const read = async (a: SoftwareAccount) => {
    setBusy(a.id);
    const r = await hub.accountRead(a.id);
    setBusy(null);
    if ('error' in r) return toast(r.error, 'error');
    setReview({ account: a, ...r });
  };

  return (
    <section className="panel ac" aria-labelledby="ac-h">
      <div className="panel-head">
        <h2 id="ac-h">Software accounts</h2>
        {state.accounts.length > 0 && (
          <button type="button" className="mini end" onClick={() => setEditing({})}>
            <Icon name="plus" size={14} /> Add account
          </button>
        )}
      </div>
      <p className="small muted">
        {state.accounts.length
          ? 'Read plans copies renewal dates and prices from each account page; it opens a sign-in window the first time.'
          : 'Add an account to copy renewal dates and prices from its plans page.'}
      </p>

      {state.accounts.length ? (
        <ul className="ac-list">
          {state.accounts.map(a => {
            const plans = linked(a);
            const names = plans.length ? plans.map(s => s.name).join(', ') : 'No plans read yet';
            return (
              <li key={a.id}>
                <span className="ac-tile" aria-hidden="true">
                  {initials(vendorName(a))}
                </span>
                <div className="ac-txt">
                  <b className="ellipsis">{a.label}</b>
                  <small className="ellipsis muted">{a.email || hostOf(a.plansUrl)}</small>
                </div>
                <div className="ac-txt ac-plans">
                  <span className="ellipsis" title={names}>
                    {names}
                  </span>
                  <small className={a.lastError ? 'warn-text' : 'muted'}>{a.lastError || (a.lastRead ? `Read ${relTime(a.lastRead, now)}` : 'Not read yet')}</small>
                </div>
                <button type="button" className="mini" disabled={busy === a.id} onClick={() => read(a)}>
                  <Icon name="sync" size={14} /> {busy === a.id ? 'Reading…' : 'Read plans'}
                </button>
                <MenuButton label={`More for ${a.label}`} icon="dots" className="ghost mini">
                  {close => (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          close();
                          hub.accountOpen(a.id);
                        }}
                      >
                        <Icon name="external" /> Open sign-in window
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          close();
                          setEditing(a);
                        }}
                      >
                        <Icon name="pencil" /> Edit account
                      </button>
                    </>
                  )}
                </MenuButton>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="ac-start" role="group" aria-label="Add a software account">
          {VENDORS.map(v => (
            <button key={v.id} type="button" className="mini" title={v.examples} onClick={() => setEditing({ vendor: v.id, label: v.name, plansUrl: v.plansUrl })}>
              <Icon name="plus" size={14} /> {v.name}
            </button>
          ))}
          <button type="button" className="mini" title="Any site with a plans page" onClick={() => setEditing({ vendor: 'other', label: '', plansUrl: '' })}>
            <Icon name="plus" size={14} /> Other software
          </button>
        </div>
      )}
      {editing && <AccountEditor account={editing} onClose={() => setEditing(null)} />}
      {review && <PlansReview state={state} {...review} onClose={() => setReview(null)} />}
    </section>
  );
}

function AccountEditor({ account, onClose }: { account: Partial<SoftwareAccount>; onClose(): void }) {
  const { toast } = useApp();
  const [a, setA] = useState<Partial<SoftwareAccount>>({ vendor: 'autodesk', label: 'Autodesk', plansUrl: vendorById('autodesk')!.plansUrl, ...account });
  const preset = vendorById(a.vendor);
  const pick = (vendor: VendorId) => {
    const v = vendorById(vendor);
    const wasDefault = !a.label || VENDORS.some(x => x.name === a.label);
    setA({ ...a, vendor, label: wasDefault ? (v?.name ?? '') : a.label, plansUrl: v?.plansUrl ?? (vendorById(a.vendor) ? '' : a.plansUrl) });
  };
  let urlOk = false;
  try {
    urlOk = new URL(a.plansUrl ?? '').protocol === 'https:';
  } catch {}
  const missing = !a.label?.trim() ? 'Give the account a name' : !urlOk ? 'Enter the plans page address (https://…)' : '';
  const save = async () => {
    if (missing) return;
    const vendor = preset ? a.vendor! : (a.label!.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') as VendorId);
    await hub.upsert('accounts', {
      ...a,
      id: a.id ?? uid('acc'),
      vendor,
      label: a.label!.trim(),
      email: a.email?.trim() || undefined,
      plansUrl: a.plansUrl!.trim(),
      createdAt: a.createdAt ?? new Date().toISOString(),
    });
    toast(a.id ? `${a.label} saved` : `${a.label} added. Click Read plans to sign in and read your plans.`);
    onClose();
  };
  return (
    <Modal
      title={a.id ? `Edit ${account.label}` : 'Add a software account'}
      onClose={onClose}
      footer={
        <>
          {a.id && (
            <ConfirmButton
              label="Remove"
              confirmLabel="Click again to remove"
              onConfirm={async () => {
                await hub.remove('accounts', a.id!);
                onClose();
              }}
            />
          )}
          <span className="grow" />
          {missing && <span className="muted small">{missing}</span>}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={!!missing} onClick={save}>
            {a.id ? 'Save' : 'Add account'}
          </button>
        </>
      }
    >
      <div className="grid2">
        {!a.id && (
          <Field label="Vendor">
            <select value={preset ? a.vendor : 'other'} onChange={e => pick(e.target.value as VendorId)}>
              {VENDORS.map(v => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
              <option value="other">Other</option>
            </select>
          </Field>
        )}
        <Field label="Name">
          <input autoFocus value={a.label ?? ''} onChange={e => setA({ ...a, label: e.target.value })} placeholder="e.g. Foundry" />
        </Field>
        <Field label="Sign-in email (optional)">
          <input type="email" value={a.email ?? ''} onChange={e => setA({ ...a, email: e.target.value })} placeholder="The email you sign in with" />
        </Field>
      </div>
      <Field label="Plans page" hint={preset ? `${preset.name}’s page that lists your plans and renewal dates. Change it if yours is elsewhere.` : 'The page on the vendor’s site that lists your plans and renewal dates.'}>
        <input type="url" value={a.plansUrl ?? ''} onChange={e => setA({ ...a, plansUrl: e.target.value })} placeholder="https://…" />
      </Field>
      <p className="small muted">You sign in on the vendor’s own page, in a window kept apart from everything else; the app never sees your password.</p>
    </Modal>
  );
}

/** Fields the review dialog reads from the page and lets Rohit correct. */
const REVIEWED: (keyof Subscription)[] = ['name', 'amount', 'currency', 'cycle', 'status', 'nextRenewal', 'endsOn', 'licence', 'seats', 'accountId'];

interface Row {
  on: boolean;
  plan: FoundPlan;
  sub: Partial<Subscription>;
  existing?: Subscription;
  open?: boolean;
}

/** What Read plans found, to tick and correct before it goes into Subscriptions. */
function PlansReview({ state, account, plans, url, onClose }: { state: AppState; account: SoftwareAccount; plans: FoundPlan[]; url: string; onClose(): void }) {
  const { toast } = useApp();
  const [rows, setRows] = useState<Row[]>(() => {
    // Each subscription is updated by one plan at most; a second plan that matches it is added as new.
    const used = new Set<string>();
    return plans.map(plan => {
      const hit = matchVendorSub(
        state.subscriptions.filter(x => !used.has(x.id)),
        { product: plan.product, vendor: vendorName(account), accountId: account.id },
      );
      if (hit) used.add(hit.id);
      return { on: true, plan, existing: hit, sub: planToSubscription(plan, account, hit) };
    });
  });
  const set = (i: number, patch: Partial<Subscription>) => setRows(rows.map((r, k) => (k === i ? { ...r, sub: { ...r.sub, ...patch } } : r)));
  const flip = (i: number, patch: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const picked = rows.filter(r => r.on);
  const save = async () => {
    for (const r of picked) {
      const raw = r.sub.amount as unknown;
      const amount = raw === '' || raw == null ? null : Number(raw);
      const fields = { ...r.sub, amount: Number.isFinite(amount) ? amount : null };
      // A saved subscription gets only the fields this dialog shows; the rest stays as saved.
      const patch = r.existing ? Object.fromEntries(REVIEWED.map(k => [k, fields[k]])) : fields;
      await hub.upsert('subscriptions', { ...patch, id: r.existing?.id ?? uid('sub') });
    }
    toast(`${picked.length} plan${picked.length === 1 ? '' : 's'} saved from ${account.label}`);
    onClose();
  };
  return (
    <Modal
      wide
      title={`Plans in ${account.label}`}
      onClose={onClose}
      footer={
        <>
          <span className="grow muted small ellipsis" title={url}>
            Read from {url}
          </span>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={!picked.length} onClick={save}>
            Save {picked.length || ''}
          </button>
        </>
      }
    >
      <p className="small muted">Check each one against the page before saving: dates and prices are read from the page’s text.</p>
      <ul className="ac-review">
        {rows.map((r, i) => {
          const ending = r.sub.status === 'cancelling' || r.sub.status === 'cancelled';
          return (
            <li key={i} className={r.on ? '' : 'off'}>
              <div className="ac-r-top">
                <label className="ac-r-check">
                  <input type="checkbox" checked={r.on} onChange={e => flip(i, { on: e.target.checked })} />
                  <b>{r.plan.product}</b>
                  {r.plan.plan && <span className="muted">{r.plan.plan}</span>}
                </label>
                <span className={`tag ${r.existing ? 'info' : 'ok'}`}>{r.existing ? `Updates ${r.existing.name}` : 'New'}</span>
                <button type="button" className="link-btn" aria-expanded={!!r.open} onClick={() => flip(i, { open: !r.open })}>
                  {r.open ? 'Hide what was read' : 'Show what was read'}
                </button>
              </div>
              {r.on && (
                <div className="ac-r-fields">
                  <Field label="Name">
                    <input value={r.sub.name ?? ''} onChange={e => set(i, { name: e.target.value })} />
                  </Field>
                  <Field label="Amount">
                    <input type="number" min="0" step="0.01" value={r.sub.amount ?? ''} placeholder="Not on the page" onChange={e => set(i, { amount: e.target.value === '' ? null : (e.target.value as unknown as number) })} />
                  </Field>
                  <Field label="Currency">
                    <select value={r.sub.currency} onChange={e => set(i, { currency: e.target.value as Currency })}>
                      <option value="INR">₹ INR</option>
                      <option value="USD">US$</option>
                      <option value="AED">AED</option>
                    </select>
                  </Field>
                  <Field label="Billed">
                    <select value={r.sub.cycle} onChange={e => set(i, { cycle: e.target.value as Subscription['cycle'] })}>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                      <option value="one-off">One-off</option>
                    </select>
                  </Field>
                  <Field label="Status">
                    <select value={r.sub.status} onChange={e => set(i, { status: e.target.value as Subscription['status'] })}>
                      {(Object.keys(STATUS) as Subscription['status'][]).map(k => (
                        <option key={k} value={k}>
                          {STATUS[k]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={ending ? 'Access ends' : r.sub.status === 'trial' ? 'Trial ends' : 'Renews'}>
                    <input
                      type="date"
                      value={(ending ? r.sub.endsOn : r.sub.nextRenewal) ?? ''}
                      onChange={e => set(i, ending ? { endsOn: e.target.value || undefined } : { nextRenewal: e.target.value || undefined })}
                    />
                  </Field>
                  <Field label="Licence">
                    <select value={r.sub.licence ?? 'subscription'} onChange={e => set(i, { licence: e.target.value as Subscription['licence'] })}>
                      {LICENCE.map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}
              {r.on && r.existing && r.existing.amount != null && r.sub.amount != null && Number(r.sub.amount) !== r.existing.amount && (
                <p className="small warn-text">
                  Price changes from {formatMoney(r.existing.amount, r.existing.currency)} to {formatMoney(Number(r.sub.amount), r.sub.currency ?? r.existing.currency)}.
                </p>
              )}
              {r.open && <pre className="ac-raw">{r.plan.raw || '(nothing below the product name)'}</pre>}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
