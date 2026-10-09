import { useState } from 'react';
import type { AppState, Currency, EmailItem, Suggestion } from '../../shared/types';
import { attentionMail } from '../../shared/planner';
import { hub } from '../hub';
import { CompanyDot, Empty, Field, Icon, fmtDate, relTime, useApp } from '../ui';

type Filter = 'clients' | 'waveink' | 'metaztech' | 'skeidar' | 'teams' | 'receipts' | 'other' | 'attention';

export function Inbox({ state, now, onSync, syncing }: { state: AppState; now: Date; onSync(): void; syncing: boolean }) {
  const { go } = useApp();
  const [filter, setFilter] = useState<Filter>('clients');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const company = (id: string) => state.companies.find(c => c.id === id);
  const attention = new Set(attentionMail(state.emails, now).map(e => e.id));
  const match = (e: EmailItem) => {
    switch (filter) {
      case 'clients':
        return e.company !== 'other';
      case 'teams':
        return e.kind === 'teams';
      case 'receipts':
        return e.kind === 'receipt';
      case 'attention':
        return attention.has(e.id) || (e.company !== 'other' && e.attention.length > 0 && e.unread);
      case 'other':
        return e.company === 'other' && e.kind !== 'receipt';
      default:
        return e.company === filter;
    }
  };
  const emails = state.emails.filter(e => match(e) && (!unreadOnly || e.unread));
  const upcoming = state.meetings.filter(m => new Date(m.end ?? m.start).getTime() >= now.getTime());
  const past = state.meetings.filter(m => new Date(m.end ?? m.start).getTime() < now.getTime()).reverse().slice(0, 8);
  const g = state.settings.google;
  const tabs: [Filter, string][] = [
    ['clients', 'All clients'],
    ['attention', 'Needs action'],
    ['waveink', 'Waveink'],
    ['metaztech', 'MetaZtech'],
    ['skeidar', 'Skeidar'],
    ['teams', 'Teams'],
    ['receipts', 'Receipts'],
    ['other', 'Other'],
  ];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Inbox & meetings</h1>
          <p className="muted">
            {g.connected ? `Gmail ${g.email ?? ''} · ${g.lastSync ? `synced ${relTime(g.lastSync, now)}` : 'not synced yet'}` : 'Google is not connected'}
            {g.lastError && <span className="warn-text"> · {g.lastError}</span>}
          </p>
        </div>
        <div className="actions">
          {!g.connected && (
            <button type="button" className="primary" onClick={() => go({ view: 'settings' })}>
              Connect Google
            </button>
          )}
          <button type="button" onClick={onSync} disabled={syncing}>
            <Icon name="sync" /> {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </header>

      {state.suggestions.length > 0 && (
        <section className="card">
          <h2>Found in your mail: confirm or dismiss</h2>
          <div className="suggestions">
            {state.suggestions.map(s => (
              <SuggestionCard key={s.id} s={s} />
            ))}
          </div>
        </section>
      )}

      <div className="cols">
        <section className="card grow">
          <div className="row between wrap">
            <div className="chips">
              {tabs.map(([k, label]) => (
                <button key={k} type="button" className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
                  {label}
                </button>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} /> Unread only
            </label>
          </div>
          {!emails.length && <Empty title={g.connected ? 'No mail here' : 'Connect Google to see mail'}>{g.connected ? 'Try another tab.' : 'Settings → Google account.'}</Empty>}
          <ul className="mail">
            {emails.map(e => (
              <li key={e.id} className={e.unread ? 'unread' : ''}>
                <button type="button" onClick={() => hub.openUrl(e.url)} title="Open in Gmail">
                  <span className="row-top">
                    <CompanyDot color={company(e.company)?.color ?? '#9ca3af'} />
                    <strong>{e.fromName}</strong>
                    {e.kind === 'teams' && <span className="tag">Teams</span>}
                    {e.kind === 'invite' && <span className="tag">invite</span>}
                    {e.kind === 'payment' && <span className="tag ok">payment</span>}
                    {attention.has(e.id) && <span className="tag warn">needs action</span>}
                    <span className="muted small push">{relTime(e.date, now)}</span>
                  </span>
                  <span className="subject">{e.subject}</span>
                  <span className="muted small clamp">{e.snippet}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <aside className="side-col">
          <section className="card">
            <h2>Upcoming meetings</h2>
            {!upcoming.length && <p className="muted small">None in the next 30 days.</p>}
            <ul className="list">
              {upcoming.map(m => (
                <li key={m.id}>
                  <div>
                    <strong>{m.title}</strong>
                    <div className="muted small">
                      {fmtDate(m.start, true)}
                      {m.company !== 'other' && ` · ${company(m.company)?.name}`}
                      {m.source === 'email' && ' · from an invite mail'}
                    </div>
                  </div>
                  <div className="row gap">
                    {m.joinUrl && (
                      <button type="button" className="mini primary" onClick={() => hub.openUrl(m.joinUrl!)}>
                        Join
                      </button>
                    )}
                    {m.link && (
                      <button type="button" className="mini" onClick={() => hub.openUrl(m.link!)} title="Open">
                        <Icon name="external" size={12} />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
          {past.length > 0 && (
            <section className="card">
              <h2>Recent meetings</h2>
              <ul className="list">
                {past.map(m => (
                  <li key={m.id}>
                    <div>
                      <span>{m.title}</span>
                      <div className="muted small">{fmtDate(m.start, true)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function SuggestionCard({ s }: { s: Suggestion }) {
  const { toast } = useApp();
  const [amount, setAmount] = useState(String(s.payment?.amount ?? s.subscription?.amount ?? ''));
  const [currency, setCurrency] = useState<Currency>((s.payment?.currency ?? s.subscription?.currency ?? 'INR') as Currency);
  const [date, setDate] = useState(s.payment?.date ?? '');
  const [period, setPeriod] = useState(s.payment?.period ?? '');
  const [name, setName] = useState(s.subscription?.name ?? '');
  const [cycle, setCycle] = useState(s.subscription?.cycle ?? 'monthly');
  const accept = async () => {
    if (s.kind === 'payment') {
      if (!Number(amount)) return toast('Enter the amount you received.', 'error');
      await hub.acceptSuggestion(s.id, { payment: { amount: Number(amount), currency, date, period: period || undefined } });
      toast('Payment recorded');
    } else {
      await hub.acceptSuggestion(s.id, { subscription: { name, amount: amount ? Number(amount) : null, currency, cycle: cycle as 'monthly' | 'yearly' } });
      toast('Subscription added');
    }
  };
  return (
    <div className="suggestion">
      <div className="row between">
        <strong>{s.title}</strong>
        <button type="button" className="mini ghost" onClick={() => hub.openUrl(s.emailUrl)}>
          Open mail <Icon name="external" size={12} />
        </button>
      </div>
      <p className="muted small">{s.detail}</p>
      <div className="row gap wrap">
        {s.kind === 'subscription' && (
          <Field label="Name">
            <input value={name} onChange={e => setName(e.target.value)} />
          </Field>
        )}
        <Field label="Amount">
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: 110 }} />
        </Field>
        <Field label="Currency">
          <select value={currency} onChange={e => setCurrency(e.target.value as Currency)}>
            <option>INR</option>
            <option>AED</option>
            <option>USD</option>
          </select>
        </Field>
        {s.kind === 'payment' ? (
          <>
            <Field label="Date">
              <input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </Field>
            <Field label="For month">
              <input type="month" value={period} onChange={e => setPeriod(e.target.value)} />
            </Field>
          </>
        ) : (
          <Field label="Cycle">
            <select value={cycle} onChange={e => setCycle(e.target.value as 'monthly' | 'yearly')}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="one-off">One-off</option>
            </select>
          </Field>
        )}
      </div>
      <div className="row gap">
        <button type="button" className="mini primary" onClick={accept}>
          {s.kind === 'payment' ? 'Record payment' : 'Add subscription'}
        </button>
        <button type="button" className="mini ghost" onClick={() => hub.dismissSuggestion(s.id)}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
