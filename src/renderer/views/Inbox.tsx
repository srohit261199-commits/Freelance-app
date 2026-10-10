import { useEffect, useRef, useState } from 'react';
import type { AppState, CompanyId, Currency, EmailItem, Subscription, Suggestion } from '../../shared/types';
import { mailLine, needsAction } from '../../shared/planner';
import { companyEarnings, formatMoney, localDate } from '../../shared/money';
import { gmailUrl } from '../../shared/mail';
import { hub } from '../hub';
import { Empty, Field, Icon, relTime, useApp, type IconName, type Route } from '../ui';
import { DashMenu } from './DashMenu';
import { clientIcon } from './JobDetails';
import './Inbox.css';

type Filter = 'clients' | 'waveink' | 'metaztech' | 'skeidar' | 'teams' | 'receipts' | 'other' | 'attention';
type Cycle = Subscription['cycle'];

const FILTERS: [Filter, string][] = [
  ['clients', 'All clients'],
  ['attention', 'Needs action'],
  ['waveink', 'Waveink'],
  ['metaztech', 'MetaZtech'],
  ['skeidar', 'Skeidar'],
  ['teams', 'Teams'],
  ['receipts', 'Receipts'],
  ['other', 'Other'],
];

/** The receipt senders the sync asks Gmail for (RECEIPTS in src/main/sync.ts). */
const RECEIPT_SENDERS: [string, string][] = [
  ['Google Play', 'googleplay-noreply@google.com'],
  ['Stripe / Link', 'stripe.com and link.com'],
  ['Paddle', 'paddle.com'],
  ['Teams chats', 'no-reply@teams.mail.microsoft'],
];

const SUB_TONE: Record<Subscription['status'], string> = { active: 'st-ok', trial: 'st-bad', cancelling: 'st-warn', cancelled: 'st-neutral' };
const SUB_WORD: Record<Subscription['status'], string> = { active: 'receipt', trial: 'trial started', cancelling: 'auto-renew off', cancelled: 'cancellation' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PAGE = 25;

const toDate = (iso: string) => new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
const clock = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "8 Oct", "Today 11:40" for a timestamp from today, the year added when it isn't this one. */
function shortDate(iso: string | undefined, now: Date): string {
  if (!iso) return '';
  const d = toDate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (iso.length > 10 && localDate(d) === localDate(now)) return `Today ${clock(d)}`;
  const dm = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? dm : `${dm} ${d.getFullYear()}`;
}

function monthName(period: string, now: Date): string {
  const [y, m] = period.split('-').map(Number);
  const name = new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'long' });
  return y === now.getFullYear() ? name : `${name} ${y}`;
}

const money = (n: number, c: Currency) => formatMoney(n, c, n % 1 ? 2 : 0);
const platform = (url?: string) => (!url ? '' : /teams\./i.test(url) ? 'Teams' : /meet\.google/i.test(url) ? 'Google Meet' : /zoom\./i.test(url) ? 'Zoom' : 'Online');

export function Inbox({ state, now, onSync, syncing, emailId }: { state: AppState; now: Date; onSync(): void; syncing: boolean; emailId?: string }) {
  const { go } = useApp();
  const [filter, setFilter] = useState<Filter>('clients');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [all, setAll] = useState(false);
  const [allMatched, setAllMatched] = useState(false);
  const [people, setPeople] = useState<string[]>([]);
  const [flash, setFlash] = useState<string>();
  const [recent, setRecent] = useState<{ s: Suggestion; index: number; text: string }[]>([]);
  const timers = useRef<number[]>([]);
  const g = state.settings.google;
  const name = (id: string) => state.companies.find(c => c.id === id)?.name ?? id;
  const mailById = new Map(state.emails.map(e => [e.id, e]));

  useEffect(() => () => timers.current.forEach(t => clearTimeout(t)), []);

  // A route with a mail id (from search) shows that mail in its list and flashes it once.
  useEffect(() => {
    const e = emailId ? state.emails.find(x => x.id === emailId) : undefined;
    if (!e) return;
    setFilter(e.company !== 'other' ? 'clients' : e.kind === 'receipt' ? 'receipts' : 'other');
    setUnreadOnly(false);
    setAll(true);
    setFlash(e.id);
    const t = window.setTimeout(() => setFlash(undefined), 1800);
    return () => clearTimeout(t);
  }, [emailId]);
  useEffect(() => {
    if (flash) document.getElementById(`mail-${flash}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [flash]);

  const match = (e: EmailItem, f: Filter) => {
    switch (f) {
      case 'clients':
        return e.company !== 'other';
      case 'teams':
        return e.kind === 'teams';
      case 'receipts':
        return e.kind === 'receipt';
      case 'attention':
        return needsAction(e, now);
      case 'other':
        return e.company === 'other' && e.kind !== 'receipt';
      default:
        return e.company === f;
    }
  };
  const pool = state.emails.filter(e => !unreadOnly || e.unread);
  const emails = pool.filter(e => match(e, filter));
  const shownMail = all ? emails : emails.slice(0, PAGE);
  const clientMail = state.emails.filter(e => e.company !== 'other');
  const oldest = clientMail.reduce<string | undefined>((o, e) => (!o || e.date < o ? e.date : o), undefined);
  const unread = clientMail.filter(e => e.unread).length;
  const toAct = clientMail.filter(e => needsAction(e, now)).length;

  const upcoming = state.meetings.filter(m => new Date(m.end ?? m.start).getTime() >= now.getTime());
  const past = state.meetings.filter(m => new Date(m.end ?? m.start).getTime() < now.getTime()).reverse().slice(0, 8);
  const firstJoin = upcoming.find(m => m.joinUrl)?.id;

  // Everything the scan turned into a record: payments and subscriptions that carry the mail they came from.
  const sender = (id: string, fallback: string) => mailById.get(id)?.fromName || fallback;
  const matched = [
    ...state.payments
      .filter(p => p.emailId)
      .map(p => {
        const e = mailById.get(p.emailId!);
        return {
          id: p.id,
          emailId: p.emailId!,
          date: p.date,
          src: e ? `${e.fromName} · ${e.subject.replace(/^\s*(re|fwd?)\s*:\s*/i, '')}` : `${name(p.company)} · ${p.note ?? 'payment mail'}`,
          to: `${name(p.company)} pay`,
          tone: `c-${p.company} c-soft`,
          route: { view: 'earnings' } as Route,
          where: 'Payments',
        };
      }),
    ...state.subscriptions
      .filter(s => s.emailId)
      .map(s => {
        const via = s.vendor.match(/\(([^)]+)\)/)?.[1] ?? s.vendor;
        const e = mailById.get(s.emailId!);
        return {
          id: s.id,
          emailId: s.emailId!,
          date: e ? localDate(e.date) : (s.lastCharged ?? ''),
          src: `${sender(s.emailId!, via)} ${SUB_WORD[s.status]}`,
          to: s.name,
          tone: SUB_TONE[s.status],
          route: { view: 'subscriptions' } as Route,
          where: 'Subscriptions',
        };
      }),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const matchedShown = allMatched ? matched : matched.slice(0, 10);

  // An accepted card stays in place for a moment with its green "Added…" state, then leaves.
  const cards: { s: Suggestion; done?: string }[] = state.suggestions.map(s => ({ s, done: recent.find(r => r.s.id === s.id)?.text }));
  for (const r of [...recent].sort((a, b) => a.index - b.index)) if (!cards.some(c => c.s.id === r.s.id)) cards.splice(Math.min(r.index, cards.length), 0, { s: r.s, done: r.text });
  const accepting = (s: Suggestion, text: string | null) => {
    if (text === null) return setRecent(r => r.filter(x => x.s.id !== s.id));
    const index = cards.findIndex(c => c.s.id === s.id);
    setRecent(r => [...r.filter(x => x.s.id !== s.id), { s, index, text }]);
    timers.current.push(window.setTimeout(() => setRecent(r => r.filter(x => x.s.id !== s.id)), 2600));
  };

  const interval = Math.max(5, state.settings.syncMinutes);
  const since = g.lastSync ? Math.max(0, (now.getTime() - new Date(g.lastSync).getTime()) / 60000) : 0;
  const nextIn = Math.ceil(interval - since);

  return (
    <div className="page mail-page">
      <header className="mail-head">
        <div className="mail-title">
          <h1>Mail scan</h1>
          <p>
            {g.connected ? `Read-only Gmail${g.email ? ` · ${g.email}` : ''}` : 'Gmail is not connected'}
            {g.lastError && <span className="bad-text"> · {g.lastError}</span>}
          </p>
        </div>
        <div className="mail-actions">
          {g.connected ? (
            <button type="button" className={`primary lg mail-scan ${syncing ? 'busy' : ''}`} onClick={onSync} disabled={syncing}>
              <Icon name="sync" size={18} /> {syncing ? 'Scanning…' : 'Scan again'}
            </button>
          ) : (
            <button type="button" className="primary lg" onClick={() => go({ view: 'settings' })}>
              <Icon name="mail" size={18} /> Connect Google
            </button>
          )}
          <DashMenu
            iconOnly
            icon="dots"
            label="More mail actions"
            className="mail-more"
            items={[
              { label: 'Open Gmail', icon: 'external', onSelect: () => hub.openUrl('https://mail.google.com/mail/u/0/#inbox') },
              { label: 'Watched senders', icon: 'gear', onSelect: () => go({ view: 'settings' }) },
            ]}
          />
        </div>
      </header>

      <section className="mail-banner" aria-label="Scan summary">
        <span className="mail-banner-ic" aria-hidden="true">
          <Icon name="mailOpen" size={26} weight="fill" />
        </span>
        <div className="mail-stat">
          <b className="tabular">{clientMail.length.toLocaleString('en-IN')}</b>
          <span>client mails kept{oldest ? ` since ${shortDate(localDate(oldest), now)}` : ''}</span>
        </div>
        <div className="mail-stat">
          <b className="tabular">{matched.length}</b>
          <span>matched to subscriptions & payments</span>
        </div>
        <div className="mail-stat">
          <b className="tabular">{state.suggestions.length}</b>
          <span>waiting for you</span>
        </div>
        <div className="mail-next">
          {!g.connected ? (
            <>
              <div className="mail-next-txt">
                <span>Connect Gmail to start scanning</span>
              </div>
              <button type="button" className="mini primary" onClick={() => go({ view: 'settings' })}>
                Set up
              </button>
            </>
          ) : (
            <>
              <div className="mail-next-txt">
                <span>{syncing ? 'Scanning now…' : g.lastSync ? `Last scan ${relTime(g.lastSync, now)}` : 'Not scanned yet'}</span>
                {!syncing && g.lastSync && <span>{nextIn > 0 ? `Next in ~${nextIn} min` : 'Next scan any minute'}</span>}
              </div>
              <div
                className={`mail-bar ${syncing ? 'busy' : ''}`}
                role="progressbar"
                aria-label="Time until the next scan"
                aria-valuemin={0}
                aria-valuemax={interval}
                aria-valuenow={syncing ? undefined : Math.min(interval, Math.round(since))}
              >
                <div style={{ width: syncing ? undefined : `${Math.max(4, Math.min(100, (since / interval) * 100))}%` }} />
              </div>
            </>
          )}
        </div>
      </section>

      <div className="mail-grid">
        <div className="mail-main">
          <section className="mail-review" aria-labelledby="mail-review-title">
            <h2 id="mail-review-title">To review</h2>
            {!cards.length && (
              <div className="mail-caught">
                <span className="mail-tile st-ok" aria-hidden="true">
                  <Icon name="checkCircle" size={24} weight="fill" />
                </span>
                <div className="grow">
                  <b>Nothing waiting</b>
                  <p>
                    {g.connected
                      ? 'Receipts, renewals and payout mails that need a yes or no show up here after each scan.'
                      : 'Connect Gmail and receipts, renewals and payout mails that need a yes or no show up here.'}
                  </p>
                </div>
              </div>
            )}
            {cards.map(c => (
              <SuggestionCard key={c.s.id} s={c.s} done={c.done} state={state} now={now} mail={mailById.get(c.s.emailId)} onAccepting={accepting} />
            ))}
          </section>

          <section className="panel mail-inbox" aria-labelledby="mail-inbox-title">
            <div className="mail-panel-head">
              <h2 id="mail-inbox-title">Client mail</h2>
              {clientMail.length > 0 && (
                <span className="mail-head-note">
                  {unread} unread · {toAct} need{toAct === 1 ? 's' : ''} action
                </span>
              )}
              <label className="mail-unread-only">
                <input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} /> Unread only
              </label>
            </div>
            <div className="chips mail-filters" role="group" aria-label="Show mail from">
              {FILTERS.map(([k, label]) => {
                const n = pool.filter(e => match(e, k)).length;
                return (
                  <button key={k} type="button" className={`chip ${filter === k ? 'on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                    {label}
                    <span className="n tabular">{n}</span>
                  </button>
                );
              })}
            </div>
            {!emails.length && (
              <Empty title={g.connected ? 'No mail here' : 'Connect Google to see mail'}>{g.connected ? (unreadOnly ? 'Nothing unread here. Untick Unread only or try another filter.' : 'Try another filter.') : 'Settings → Google account.'}</Empty>
            )}
            <ul className="mail-list">
              {shownMail.map(e => {
                const line = mailLine(e);
                const act = needsAction(e, now);
                return (
                  <li key={e.id} id={`mail-${e.id}`} className={`${e.unread ? 'unread' : ''} ${flash === e.id ? 'flash' : ''}`}>
                    <button type="button" className="mail-row" onClick={() => hub.openUrl(e.url)} title="Open in Gmail">
                      <MailTile e={e} />
                      <span className="mail-row-main">
                        <span className="mail-row-top">
                          {e.unread && <span className="mail-dot" aria-hidden="true" />}
                          <b className="ellipsis">{e.fromName}</b>
                          {e.unread && <span className="sr-only">, unread</span>}
                          {e.kind === 'teams' && <span className="tag info">Teams</span>}
                          {e.kind === 'invite' && <span className="tag">Invite</span>}
                          {e.kind === 'payment' && <span className="tag ok">Payment</span>}
                          {e.kind === 'receipt' && <span className="tag">Receipt</span>}
                          {act && <span className="tag bad">Needs action</span>}
                          <span className="mail-row-time">{now.getTime() - new Date(e.date).getTime() < 7 * 86400000 ? relTime(e.date, now) : shortDate(e.date, now)}</span>
                        </span>
                        <span className={`mail-row-line ${line === e.subject ? 'ellipsis' : 'clamp'}`}>{line}</span>
                        {line === e.subject && e.snippet && <span className="mail-row-snip ellipsis">{e.snippet}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {emails.length > PAGE && (
              <button type="button" className="ghost mail-more-list" onClick={() => setAll(!all)}>
                {all ? 'Show fewer' : `Show all ${emails.length}`}
              </button>
            )}
          </section>
        </div>

        <aside className="mail-side">
          <section className="panel mail-matched" aria-labelledby="mail-matched-title">
            <h2 id="mail-matched-title">Already matched</h2>
            {!matched.length && <p className="muted small">Payments and subscriptions found in your mail show up here once you add them.</p>}
            <ul>
              {matchedShown.map(r => (
                <li key={r.id}>
                  <span className="mail-m-date">{shortDate(r.date, now)}</span>
                  <button type="button" className="link-btn mail-m-src" title={`Open the mail in Gmail: ${r.src}`} onClick={() => hub.openUrl(gmailUrl(r.emailId))}>
                    <span className="ellipsis">{r.src}</span>
                  </button>
                  <span className="mail-m-arrow" aria-hidden="true">
                    <Icon name="arrowRight" size={14} />
                  </span>
                  <button type="button" className={`mail-m-to ${r.tone}`} title={`Open ${r.where}`} onClick={() => go(r.route)}>
                    <span className="ellipsis">{r.to}</span>
                  </button>
                </li>
              ))}
            </ul>
            {matched.length > 10 && (
              <button type="button" className="ghost mini mail-m-all" onClick={() => setAllMatched(!allMatched)}>
                {allMatched ? 'Show fewer' : `Show all ${matched.length}`}
              </button>
            )}
          </section>

          <section className="panel mail-senders" aria-labelledby="mail-senders-title">
            <h2 id="mail-senders-title">Senders it watches</h2>
            <div className="mail-chips">
              {RECEIPT_SENDERS.map(([label, from]) => (
                <span key={label} className="mail-chip" title={from}>
                  {label}
                </span>
              ))}
              {state.companies.flatMap(c =>
                c.match.domains.filter(Boolean).map(d => (
                  <span key={`${c.id}-${d}`} className={`mail-chip c-${c.id} c-soft`} title={`${c.name} mail`}>
                    {d}
                  </span>
                )),
              )}
              {state.companies.map(c => {
                const list = (c.match.emails ?? []).filter(Boolean);
                if (!list.length) return null;
                const open = people.includes(c.id);
                return [
                  <button
                    key={c.id}
                    type="button"
                    className={`mail-chip mail-people c-${c.id} c-soft`}
                    aria-expanded={open}
                    title={list.join(', ')}
                    onClick={() => setPeople(open ? people.filter(x => x !== c.id) : [...people, c.id])}
                  >
                    {list.length === 1 && !open ? list[0] : `${list.length} ${c.name} ${list.length === 1 ? 'address' : 'addresses'}`}
                    {list.length > 1 && <Icon name={open ? 'caretLeft' : 'caretRight'} size={12} />}
                  </button>,
                  ...(open && list.length > 1
                    ? list.map(e => (
                        <span key={`${c.id}-${e}`} className={`mail-chip c-${c.id} c-soft`}>
                          {e}
                        </span>
                      ))
                    : []),
                ];
              })}
              <button type="button" className="mail-chip mail-add" onClick={() => go({ view: 'settings' })}>
                <Icon name="plus" size={14} /> Add sender
              </button>
            </div>
            <p className="mail-note">Also any mail with receipt, invoice, renewal or free trial in the subject.</p>
          </section>

          <section className="panel mail-meet" aria-labelledby="mail-meet-title">
            <div className="mail-panel-head">
              <h2 id="mail-meet-title">Meetings</h2>
              {upcoming.length > 0 && <span className="mail-head-note">{upcoming.length} coming up</span>}
            </div>
            {!upcoming.length && <p className="muted small">{g.connected ? 'None in the next 30 days.' : 'Connect Google to see your meetings here.'}</p>}
            <ul className="mail-meets">
              {upcoming.map(m => {
                const d = new Date(m.start);
                const today = localDate(d) === localDate(now);
                return (
                  <li key={m.id}>
                    <span className={`mail-date ${m.company === 'other' ? 'plain' : `c-${m.company} c-soft`}`} aria-hidden="true">
                      <small>{d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase()}</small>
                      <b>{d.getDate()}</b>
                    </span>
                    <span className="mail-meet-t">
                      <b className="ellipsis" title={m.title}>
                        {m.title}
                      </b>
                      <span className="ellipsis">
                        {[`${today ? 'Today' : `${d.getDate()} ${MONTHS[d.getMonth()]}`} ${clock(d)}`, m.company !== 'other' && name(m.company), platform(m.joinUrl ?? m.link), m.source === 'email' && 'from an invite mail']
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    {m.joinUrl && (
                      <button type="button" className={`mini ${m.id === firstJoin ? 'primary' : ''}`} onClick={() => hub.openUrl(m.joinUrl!)} aria-label={`Join ${m.title}`}>
                        Join
                      </button>
                    )}
                    {m.link && (
                      <button type="button" className="mini mail-ib" onClick={() => hub.openUrl(m.link!)} aria-label={`Open ${m.title}`} title="Open">
                        <Icon name="external" size={14} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {past.length > 0 && (
              <>
                <h3 className="mail-sub">Recent</h3>
                <ul className="mail-meets past">
                  {past.map(m => {
                    const d = new Date(m.start);
                    return (
                      <li key={m.id}>
                        <span className="mail-date plain" aria-hidden="true">
                          <small>{d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase()}</small>
                          <b>{d.getDate()}</b>
                        </span>
                        <span className="mail-meet-t">
                          <b className="ellipsis" title={m.title}>
                            {m.title}
                          </b>
                          <span className="ellipsis">
                            {[`${d.getDate()} ${MONTHS[d.getMonth()]} ${clock(d)}`, m.company !== 'other' && name(m.company)].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function MailTile({ e }: { e: EmailItem }) {
  const icon: IconName =
    e.kind === 'teams' ? 'teams' : e.kind === 'invite' ? 'calendar' : e.kind === 'payment' ? 'money' : e.kind === 'receipt' ? 'receipt' : e.company === 'other' ? 'mail' : clientIcon({ id: e.company });
  return (
    <span className={`ic-tile mail-row-ic ${e.company === 'other' ? 'plain' : `c-${e.company} c-soft`}`} aria-hidden="true">
      <Icon name={icon} size={19} weight="fill" />
    </span>
  );
}

function SuggestionCard({ s, done, state, now, mail, onAccepting }: { s: Suggestion; done?: string; state: AppState; now: Date; mail?: EmailItem; onAccepting(s: Suggestion, text: string | null): void }) {
  const { toast } = useApp();
  const [amount, setAmount] = useState(String(s.payment?.amount ?? s.subscription?.amount ?? ''));
  const [currency, setCurrency] = useState<Currency>((s.payment?.currency ?? s.subscription?.currency ?? 'INR') as Currency);
  const [date, setDate] = useState(s.payment?.date ?? '');
  const [period, setPeriod] = useState(s.payment?.period ?? '');
  const [name, setName] = useState(s.subscription?.name ?? '');
  const [cycle, setCycle] = useState<Cycle>(s.subscription?.cycle ?? 'monthly');
  const [open, setOpen] = useState(s.kind === 'payment' && !s.payment?.amount);
  const [busy, setBusy] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const formId = `mail-edit-${s.id}`;
  const value = Number(amount) || 0;
  const pay = s.kind === 'payment';
  const sub = s.subscription;
  const company = (s.payment?.company ?? 'metaztech') as CompanyId;
  const cfg = state.companies.find(c => c.id === company);

  const kind = pay
    ? { label: 'Payment received', tone: 'st-ok', icon: 'money' as IconName, cta: 'Record payment', no: 'Ignore', ok: 'Recorded in Payments' }
    : cycle === 'one-off'
      ? { label: 'One-off purchase', tone: 'st-warn', icon: 'bag' as IconName, cta: 'Track as one-off', no: 'Ignore', ok: 'Tracked as one-off' }
      : sub?.status === 'trial'
        ? { label: 'Free trial', tone: 'st-bad', icon: 'hourglass' as IconName, cta: 'Add subscription', no: 'Not a subscription', ok: 'Added to Subscriptions' }
        : sub?.status === 'cancelling'
          ? { label: 'Auto-renew off', tone: 'st-neutral', icon: 'repeat' as IconName, cta: 'Add subscription', no: 'Not a subscription', ok: 'Added to Subscriptions' }
          : { label: 'New subscription', tone: 'st-live', icon: 'receipt' as IconName, cta: 'Add subscription', no: 'Not a subscription', ok: 'Added to Subscriptions' };

  // What the payment most likely covers, from the work already logged for that client.
  const chips: { t: string; tone?: string }[] = [];
  let title: string;
  if (pay) {
    const earn = cfg ? companyEarnings(state, company, now) : undefined;
    const thisMonth = localDate(now).slice(0, 7);
    const line = earn?.months.find(l => (period ? l.month === period : l.month <= thisMonth && l.net > 0 && (earn.paidByMonth[l.month] ?? 0) < l.net - 0.5));
    title = `${cfg?.name ?? 'Client'} ${value ? `paid ${money(value, currency)}` : 'payment'}${period ? ` for ${monthName(period, now)}` : ''}`;
    if (line && earn) {
      if (!period) chips.push({ t: `Likely for ${monthName(line.month, now)}` });
      if (cfg?.pay.kind === 'tiered') chips.push({ t: plural(line.units, 'model') });
      if (cfg?.pay.kind === 'per-item') chips.push({ t: plural(line.units, 'image') });
      const left = line.net - (earn.paidByMonth[line.month] ?? 0);
      if (left > 0.5) chips.push({ t: `${money(Math.round(left), earn.currency)} still due` });
      if (cfg?.pay.kind === 'tiered' && line.gross > line.net) chips.push({ t: `TDS ${money(Math.round(line.gross - line.net), earn.currency)}` });
      if (earn.overdue?.month === line.month) {
        const got = cfg && currency !== earn.currency ? null : value;
        chips.push(got != null && got >= left - 0.5 ? { t: 'Clears the late payout', tone: 'st-ok' } : { t: 'Payout is late', tone: 'st-bad' });
      }
    }
    if (s.payment?.reference) chips.push({ t: `Ref ${s.payment.reference}` });
  } else {
    const label = name || sub?.vendor || 'Subscription';
    const per = cycle === 'yearly' ? ' / year' : cycle === 'monthly' ? ' / month' : '';
    title = value ? `${label} · ${money(value, currency)}${per}` : label;
    if (cycle === 'one-off') chips.push({ t: 'No renewal' });
    else if (sub?.status === 'trial' && sub.nextRenewal) chips.push({ t: `Trial ends ${shortDate(sub.nextRenewal, now)}`, tone: 'st-bad' });
    else if (sub?.status === 'cancelling' && sub.endsOn) chips.push({ t: `Access ends ${shortDate(sub.endsOn, now)}` });
    else if (sub?.nextRenewal) chips.push({ t: `Renews ${shortDate(sub.nextRenewal, now)}` });
    if (sub?.paymentMethod) chips.push({ t: sub.paymentMethod });
    if (sub?.vendor && sub.vendor !== label) chips.push({ t: sub.vendor });
    chips.push({ t: sub?.category === 'personal' ? 'Personal' : 'Work' });
  }

  const from = mail?.fromName || (pay ? cfg?.name : sub?.vendor) || 'Gmail';
  const subject = mail?.subject ?? (s.detail || s.payment?.note || '');
  const when = shortDate(mail?.date ?? s.payment?.date ?? sub?.lastCharged ?? s.createdAt, now);

  const accept = async () => {
    if (pay) {
      if (!value) {
        setOpen(true);
        requestAnimationFrame(() => amountRef.current?.focus());
        return toast('Enter the amount you received.', 'error');
      }
      if (!date) {
        setOpen(true);
        return toast('Enter the date the money arrived.', 'error');
      }
    }
    setBusy(true);
    onAccepting(s, kind.ok);
    try {
      if (pay) {
        await hub.acceptSuggestion(s.id, { payment: { amount: value, currency, date, period: period || undefined } });
        toast('Payment recorded');
      } else {
        await hub.acceptSuggestion(s.id, { subscription: { name, amount: amount ? Number(amount) : null, currency, cycle } });
        toast(cycle === 'one-off' ? 'One-off purchase tracked' : 'Subscription added');
      }
    } catch (err) {
      onAccepting(s, null);
      toast(err instanceof Error ? err.message : 'Could not save it. Try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`mail-card ${done ? 'done' : ''}`} aria-label={title}>
      <span className={`mail-tile ${kind.tone}`} aria-hidden="true">
        <Icon name={kind.icon} size={24} weight="fill" />
      </span>
      <div className="mail-card-body">
        <div className="mail-card-top">
          <span className={`mail-kind ${kind.tone}`}>{kind.label}</span>
          <span className="mail-card-date">{when}</span>
        </div>
        <h3 className="mail-card-title">{title}</h3>
        <button type="button" className="link-btn mail-card-from" onClick={() => hub.openUrl(s.emailUrl)} title="Open the mail in Gmail">
          <Icon name="mail" size={14} />
          <span className="ellipsis">
            {from}
            {subject && ` · "${subject}"`}
          </span>
          <span className="mail-card-ext" aria-hidden="true">
            <Icon name="external" size={12} />
          </span>
        </button>
        <div className="mail-card-chips">
          {chips.map(c => (
            <span key={c.t} className={`mail-cchip ${c.tone ?? ''}`}>
              {c.t}
            </span>
          ))}
          {!done && (
            <button type="button" className="mail-cchip mail-edit-btn" aria-expanded={open} aria-controls={formId} onClick={() => setOpen(!open)}>
              <Icon name="pencil" size={13} /> {open ? 'Hide details' : 'Edit details'}
            </button>
          )}
        </div>
        {open && !done && (
          <div className="mail-edit" id={formId}>
            {!pay && (
              <Field label="Name">
                <input value={name} onChange={e => setName(e.target.value)} />
              </Field>
            )}
            <Field label="Amount">
              <input ref={amountRef} type="number" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} className="mail-amount" />
            </Field>
            <Field label="Currency">
              <select value={currency} onChange={e => setCurrency(e.target.value as Currency)}>
                <option>INR</option>
                <option>AED</option>
                <option>USD</option>
              </select>
            </Field>
            {pay ? (
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
                <select value={cycle} onChange={e => setCycle(e.target.value as Cycle)}>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                  <option value="one-off">One-off</option>
                </select>
              </Field>
            )}
          </div>
        )}
      </div>
      <div className="mail-card-acts">
        {done ? (
          <span className="mail-done" role="status">
            <Icon name="checkCircle" size={16} weight="fill" />
            {done}
          </span>
        ) : (
          <>
            <button type="button" className="primary" onClick={accept} disabled={busy}>
              {kind.cta}
            </button>
            <button type="button" className="soft" onClick={() => hub.dismissSuggestion(s.id)} disabled={busy}>
              {kind.no}
            </button>
          </>
        )}
      </div>
    </article>
  );
}
