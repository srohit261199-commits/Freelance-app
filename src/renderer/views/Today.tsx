import { useMemo, useState } from 'react';
import type { AppState, CompanyId, Model, ModelStatus } from '../../shared/types';
import { nextActions, type NextAction } from '../../shared/planner';
import { allEarnings, convert, daysUntil, formatMoney, jobOutputs, localDate, monthlyCost, monthsBetween, rollRenewal, tierFee, type CompanyEarnings } from '../../shared/money';
import { isComplete, statusEvents, statusLabel } from '../../shared/status';
import { hub } from '../hub';
import { ClientTile, Icon, useApp, type ClientKey, type IconName } from '../ui';
import { AddModel } from './Models';
import { Board } from './Board';
import { DashMenu, type MenuItem } from './DashMenu';
import './Dash.css';

type Layout = 'widgets' | 'board';
type Filter = 'all' | CompanyId | 'money';
type Tone = 'bad' | 'warn' | 'neutral';
const LAYOUT_KEY = 'fh-dash-layout';
const DONE_KEY = 'fh-dash-done';
const FILTERS: Filter[] = ['all', 'waveink', 'metaztech', 'skeidar', 'money'];
const STACK: CompanyId[] = ['skeidar', 'metaztech', 'waveink'];
const LETTER_TONES: ClientKey[] = ['metaztech', 'waveink', 'skeidar', 'money'];

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayMonth = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const sameDay = (iso: string, now: Date) => localDate(iso) === localDate(now);
function whenText(date: string, now: Date): string {
  const d = daysUntil(date, now);
  return d < 0 ? 'Overdue' : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : dayMonth(date);
}
function plusDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + n));
}
function readLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'board' ? 'board' : 'widgets';
  } catch {
    return 'widgets';
  }
}
/** Rows ticked off for today that have nothing to record (a meeting, a mail, a reminder). */
export function readDone(today: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(DONE_KEY) ?? 'null') as { date: string; ids: string[] } | null;
    return v?.date === today && Array.isArray(v.ids) ? v.ids : [];
  } catch {
    return [];
  }
}
function saveDone(today: string, ids: string[]) {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify({ date: today, ids }));
  } catch {}
}
/** What ticking a model off means: a rejection is resubmitted, a queued model is started, finished work goes in. */
function checkTo(m: Model): ModelStatus {
  if (m.status === 'revision') return 'review';
  if (m.status === 'todo') return 'in_progress';
  if (m.status === 'in_progress') return m.company === 'waveink' ? 'done' : 'review';
  return 'done';
}

interface Row {
  a: NextAction;
  client: ClientKey;
  icon?: IconName;
  detail: string;
  due: { text: string; tone: Tone };
  value: string;
  kind: 'model' | 'portfolio' | 'open' | 'local';
  models: Model[];
  check: string;
}
interface Checked {
  action: NextAction;
  index: number;
  undo(): Promise<unknown>;
}

export function Today({ state, now, onSync }: { state: AppState; now: Date; onSync(): void }) {
  const { go, toast } = useApp();
  const [layout, setLayoutState] = useState<Layout>(readLayout);
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState<'waveink' | 'metaztech' | null>(null);
  const [checked, setChecked] = useState<Map<string, Checked>>(new Map());
  const today = localDate(now);
  const [localDone, setLocalDone] = useState<{ date: string; ids: string[] }>(() => ({ date: today, ids: readDone(today) }));
  const doneIds = localDone.date === today ? localDone.ids : [];

  const actions = useMemo(() => nextActions(state, now), [state, now]);
  const earnings = useMemo(() => allEarnings(state, now), [state, now]);
  const cfg = (id: CompanyId) => state.companies.find(c => c.id === id)!;
  const base = state.settings.baseCurrency;
  const rates = state.settings.rates;
  const inBase = (v: number, e: CompanyEarnings) => convert(v, e.currency, base, rates);
  const month = today.slice(0, 7);
  const models = useMemo(() => new Map(state.models.map(m => [m.id, m])), [state.models]);
  const clientName = (c: ClientKey) => (c === 'money' ? 'Money' : c === 'portfolio' ? 'Portfolio' : c === 'other' ? '' : cfg(c).name);

  const setLayout = (l: Layout) => {
    setLayoutState(l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {}
  };

  // ----- figures -----
  const wi = state.models.filter(m => m.company === 'waveink' && m.status !== 'skipped');
  const wiTech = wi.filter(m => m.group === 'Tech');
  const wiApparel = wi.filter(m => m.group === 'Apparel');
  const doneCount = (l: Model[]) => l.filter(m => isComplete(m.status)).length;
  const mz = state.models.filter(m => m.company === 'metaztech');
  // Models imported already approved, with no approval date, weren't approved this month.
  const mzApprovedMonth = mz.filter(m => isComplete(m.status) && m.completedAt && !m.completedAtApprox && localDate(m.completedAt).startsWith(month)).length;
  const mzRejected = mz.filter(m => m.status === 'revision').length;
  const mzReview = mz.filter(m => m.status === 'review').length;
  const submittedToday = mz.filter(m => statusEvents(m).some(h => h.to === 'review' && sameDay(h.at, now))).length;
  const sk = cfg('skeidar');
  const skRate = sk.pay.kind === 'per-item' ? sk.pay.rate : 5;
  const skOpen = state.skeidarJobs.filter(j => j.status === 'open');
  const skOut = skOpen.reduce((s, j) => {
    const o = jobOutputs(j);
    return { done: s.done + o.done, total: s.total + o.total };
  }, { done: 0, total: 0 });
  const owed = earnings.reduce((s, e) => s + inBase(e.outstanding, e), 0);
  const received = earnings.reduce((s, e) => s + inBase(e.received, e), 0);
  const earningMonth = earnings.reduce((s, e) => s + inBase(e.thisMonth, e), 0);
  // Earned months whose pay day (plus 3 days' grace) has passed without the full amount recorded.
  const late = earnings.reduce(
    (s, e) => s + e.months.filter(l => l.due && l.month < month && plusDays(l.due, 3) < today).reduce((t, l) => t + Math.max(0, inBase(l.net - (e.paidByMonth[l.month] ?? 0), e)), 0),
    0,
  );
  const onDrive = state.models.filter(m => m.company === 'waveink' && m.driveFileUrl && (m.status === 'todo' || m.status === 'in_progress'));
  const mzCfg = cfg('metaztech');
  const mzDue = (() => {
    const e = earnings.find(x => x.company === 'metaztech');
    return e ? e.months.filter(l => l.month < month).reduce((s, l) => s + l.net - (e.paidByMonth[l.month] ?? 0), 0) : 0;
  })();

  // ----- up next -----
  const describe = (a: NextAction): Row => {
    const m = a.modelId ? models.get(a.modelId) : undefined;
    const id = a.id;
    const client: ClientKey = a.company ?? 'other';
    let icon: IconName | undefined;
    let value = '';
    let date: string | undefined;
    let kind: Row['kind'] = m ? 'model' : 'local';
    let list: Model[] = m ? [m] : [];
    let check = m ? `Mark ${statusLabel(checkTo(m), m.company)}` : 'Done for today';
    if (id.startsWith('meet-')) {
      const t = state.meetings.find(x => id === `meet-${x.id}`);
      icon = 'calendar';
      if (t) date = localDate(t.start);
    } else if (id.startsWith('mail-')) {
      icon = state.emails.find(x => id === `mail-${x.id}`)?.kind === 'teams' ? 'teams' : 'mail';
    } else if (id.startsWith('overdue-')) {
      const e = earnings.find(x => id.startsWith(`overdue-${x.company}-`));
      if (e?.overdue) value = formatMoney(e.overdue.net - e.overdue.paid, e.currency);
      kind = 'open';
      check = 'Record the payment';
    } else if (id.startsWith('mz-payout-')) {
      value = formatMoney(mzDue, 'INR');
      kind = 'open';
      check = 'Record the payment';
    } else if (id.startsWith('mz-target-')) value = `${submittedToday} / 2`;
    else if (id.startsWith('sub-')) {
      const s = state.subscriptions.find(x => id.startsWith(`sub-${x.id}-`));
      icon = 'repeat';
      date = id.slice(-10);
      if (s?.amount != null) value = formatMoney(s.amount, s.currency, s.amount % 1 ? 2 : 0);
    } else if (id.startsWith('sk-')) {
      const j = state.skeidarJobs.find(x => id === `sk-${x.id}`);
      if (j) {
        const o = jobOutputs(j);
        value = formatMoney((o.total - o.done) * skRate, sk.currency);
      }
      kind = 'open';
      check = 'Open the job to tick images';
    } else if (id === 'wi-drive') {
      kind = 'model';
      list = onDrive;
      check = `Mark ${statusLabel('review', 'waveink')}`;
    } else if (id.startsWith('pf-')) {
      kind = 'portfolio';
      check = 'Mark done';
    }
    if (m) {
      if (m.dueDate) date = m.dueDate;
      if (m.company === 'metaztech' && m.complexity) value = formatMoney(tierFee(mzCfg, m.complexity), 'INR');
    }
    const name = clientName(client);
    const detail = !a.detail ? name : !name || a.detail.startsWith(name) ? a.detail : `${name} · ${a.detail}`;
    const text = date ? whenText(date, now) : id.startsWith('wi-next-') && m?.rows?.length ? `Row ${m.rows[0]}` : a.priority === 1 ? 'Today' : a.priority === 2 ? 'This week' : 'Queue';
    return { a, client, icon, detail, due: { text, tone: a.priority === 1 ? 'bad' : a.priority === 2 ? 'warn' : 'neutral' }, value, kind, models: list, check };
  };

  const display = useMemo(() => {
    const out = actions.filter(a => !checked.has(a.id));
    [...checked.values()].sort((p, q) => p.index - q.index).forEach(c => out.splice(Math.min(c.index, out.length), 0, c.action));
    return out;
  }, [actions, checked]);
  const rows = display.filter(a => filter === 'all' || a.company === filter).map(describe);
  const isDone = (id: string) => checked.has(id) || doneIds.includes(id);
  const remaining = actions.filter(a => !doneIds.includes(a.id)).length;
  const urgent = actions.find(a => a.priority === 1 && !doneIds.includes(a.id));

  const setLocal = (ids: string[]) => {
    setLocalDone({ date: today, ids });
    saveDone(today, ids);
    window.dispatchEvent(new Event('fh-dash-done'));
  };
  const remember = (a: NextAction, undo: () => Promise<unknown>) =>
    setChecked(c => new Map(c).set(a.id, { action: a, index: actions.findIndex(x => x.id === a.id), undo }));

  const check = async (r: Row) => {
    const a = r.a;
    if (r.kind === 'open') return a.target && go(a.target);
    if (r.kind === 'local') return setLocal([...doneIds, a.id]);
    if (r.kind === 'portfolio') {
      const t = state.portfolioTasks.find(x => a.id === `pf-${x.id}`);
      if (!t) return;
      await hub.upsert('portfolioTasks', { ...t, done: true, doneAt: new Date().toISOString() });
      return remember(a, () => hub.upsert('portfolioTasks', { ...t, done: false, doneAt: undefined }));
    }
    if (!r.models.length) return;
    const to = a.id === 'wi-drive' ? 'review' : checkTo(r.models[0]);
    const snaps = r.models.map(m => ({ id: m.id, status: m.status, history: m.history, revisions: m.revisions, startedAt: m.startedAt }));
    await hub.setStatus(
      r.models.map(m => m.id),
      to,
    );
    remember(a, async () => {
      for (const s of snaps) {
        await hub.setStatus([s.id], s.status);
        await hub.patchModel(s.id, { history: s.history, revisions: s.revisions, startedAt: s.startedAt });
      }
    });
  };
  const undo = async (a: NextAction) => {
    const c = checked.get(a.id);
    if (c) {
      await c.undo();
      setChecked(m => {
        const n = new Map(m);
        n.delete(a.id);
        return n;
      });
    } else setLocal(doneIds.filter(x => x !== a.id));
  };

  const urgentLabel = (a: NextAction): string => {
    if (a.id.startsWith('fix-')) {
      const n = actions.filter(x => x.id.startsWith('fix-')).length;
      const m = a.modelId ? models.get(a.modelId) : undefined;
      return n > 1 ? `${n} MetaZtech rejections to fix` : `Fix rejection: ${m?.code ?? m?.name ?? ''}`;
    }
    if (a.id.startsWith('overdue-')) return `${state.companies.find(c => a.id.startsWith(`overdue-${c.id}-`))?.name ?? 'A'} payment is late`;
    if (a.id.startsWith('meet-')) return a.title.split(': ')[0];
    if (a.id.startsWith('wi-report-')) return 'Waveink update log due today';
    if (a.id.startsWith('mail-')) return `Reply to ${a.title.split(': ')[0]}`;
    return a.title.length > 44 ? `${a.title.slice(0, 42)}…` : a.title;
  };

  // ----- this week -----
  const fri = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((5 - now.getDay() + 7) % 7));
  const friday = localDate(fri);
  const meetings = state.meetings
    .filter(m => new Date(m.end ?? m.start).getTime() > now.getTime() && daysUntil(localDate(m.start), now) <= 7)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 4);
  const firstJoin = meetings.find(m => m.joinUrl)?.id;
  const week = [
    ...meetings.map(m => ({ date: localDate(m.start), meeting: m })),
    { date: friday, meeting: undefined },
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.meeting ? 0 : 1) - (b.meeting ? 0 : 1));
  const platform = (url?: string) => (!url ? '' : /teams\./i.test(url) ? 'Teams' : /meet\.google/i.test(url) ? 'Google Meet' : /zoom\./i.test(url) ? 'Zoom' : 'Online');

  // ----- earnings -----
  const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyStart = `${fyYear}-04`;
  const receivedFY = state.payments.filter(p => p.date.slice(0, 7) >= fyStart).reduce((s, p) => s + convert(p.amount, p.currency, base, rates), 0);
  const bars = monthsBetween(fyStart, month).map(mk => {
    const segs = STACK.flatMap(cid => {
      const e = earnings.find(x => x.company === cid);
      const line = e?.months.find(l => l.month === mk);
      if (!e || !line || line.net <= 0) return [];
      const paid = Math.min(line.net, e.paidByMonth[mk] ?? 0);
      return [{ cid, paid: inBase(paid, e), owed: inBase(line.net - paid, e) }];
    });
    return { month: mk, segs, total: segs.reduce((s, x) => s + x.paid + x.owed, 0) };
  });
  const maxBar = Math.max(1, ...bars.map(b => b.total));
  const best = bars.filter(b => b.month < month && b.total > 0).sort((a, b) => b.total - a.total)[0];
  const monthShort = (mk: string) => MONTHS[Number(mk.slice(5, 7)) - 1];

  // ----- renewals -----
  const renewing = state.subscriptions.filter(s => s.status === 'active' || s.status === 'trial');
  const monthly = renewing.reduce((t, s) => t + convert(monthlyCost(s), s.currency, base, rates), 0);
  const renewals = state.subscriptions
    .map(s => ({ s, date: s.status === 'cancelling' ? s.endsOn : rollRenewal(s, now) }))
    .filter(x => x.date && x.s.status !== 'cancelled' && daysUntil(x.date, now) >= 0 && daysUntil(x.date, now) <= 30)
    .sort((a, b) => a.date!.localeCompare(b.date!))
    .slice(0, 4);
  const tone = (name: string) => LETTER_TONES[[...name].reduce((s, ch) => s + ch.charCodeAt(0), 0) % LETTER_TONES.length];

  const addItems: MenuItem[] = [
    { label: 'Waveink model', icon: 'cube', onSelect: () => setAdding('waveink') },
    { label: 'MetaZtech model', icon: 'cubeFocus', onSelect: () => setAdding('metaztech') },
    { label: 'Skeidar job', icon: 'brush', onSelect: () => go({ view: 'skeidar' }) },
    { label: 'Record a payment', icon: 'wallet', onSelect: () => go({ view: 'earnings' }) },
  ];
  const exportAll = async () => {
    const r = await hub.exportExcel('all');
    if (r.path) toast(`Saved ${r.path}`);
    else if (r.error) toast(r.error, 'error');
  };
  const exportLog = async () => {
    const r = await hub.exportExcel('waveink');
    if (r.path) toast(`Saved ${r.path}`);
    else if (r.error) toast(r.error, 'error');
  };
  const connected = state.settings.google.connected;

  const tiles: { client: ClientKey; icon: IconName; name: string; big: string; sub: string; pct: number; title: string; open(): void }[] = [
    {
      client: 'waveink',
      icon: 'cube',
      name: cfg('waveink').name,
      big: `${doneCount(wiTech)}/${wiTech.length}`,
      sub: wiApparel.length ? `Tech models done · ${doneCount(wiApparel)} of ${wiApparel.length} apparel` : `${wi.filter(m => m.status === 'in_progress').length} in progress · ${wi.filter(m => m.status === 'review').length} in review`,
      pct: wiTech.length ? doneCount(wiTech) / wiTech.length : 0,
      title: `${doneCount(wiTech)} of ${wiTech.length} tech models done`,
      open: () => go({ view: 'company', company: 'waveink' }),
    },
    {
      client: 'metaztech',
      icon: 'cubeFocus',
      name: mzCfg.name,
      big: !mz.length ? 'No models' : mzRejected ? `${mzRejected} rejected` : `${mzApprovedMonth} approved`,
      sub: !mz.length ? 'Pull them from the portal' : [`${mzReview} in review`, mzRejected ? `${mzApprovedMonth} approved this month` : 'this month', `${submittedToday}/2 today`].join(' · '),
      pct: Math.min(submittedToday, 2) / 2,
      title: `Daily target: 1–2 files submitted (${submittedToday} today)`,
      open: () => go({ view: 'company', company: 'metaztech' }),
    },
    {
      client: 'skeidar',
      icon: 'brush',
      name: sk.name,
      big: skOpen.length ? `${skOut.done}/${skOut.total}` : 'No open jobs',
      sub: `${skOpen.length === 1 ? `${skOpen[0].name} variations` : skOpen.length ? `${skOpen.length} open jobs` : 'New jobs land here'} · ${formatMoney(skRate, sk.currency)} each`,
      pct: skOut.total ? skOut.done / skOut.total : 0,
      title: `${skOut.done} of ${skOut.total} images made across open jobs`,
      open: () => go({ view: 'skeidar' }),
    },
    {
      client: 'money',
      icon: 'wallet',
      name: 'Money',
      big: formatMoney(owed, base),
      sub: `owed to you · ${late > 0.5 ? `${formatMoney(late, base)} late` : 'nothing late'}`,
      pct: received + owed ? received / (received + owed) : 0,
      title: `${Math.round(received + owed ? (received / (received + owed)) * 100 : 0)}% of what you've earned has been paid`,
      open: () => go({ view: 'earnings' }),
    },
  ];

  return (
    <div className={`page dash ${layout}`}>
      <header className="dash-head">
        <div className="dash-hello">
          <h1>Hello, Rohit</h1>
          <div className="dash-sub">
            <span>{`${now.toLocaleDateString('en-GB', { weekday: 'long' })}, ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`}</span>
            <span className="dash-sep" aria-hidden="true" />
            <span>
              <b>
                {remaining} {remaining === 1 ? 'task' : 'tasks'}
              </b>{' '}
              on your plate
            </span>
            {urgent && (
              <button type="button" className="dash-alert" title={urgent.title} onClick={() => urgent.target && go(urgent.target)}>
                {urgentLabel(urgent)}
              </button>
            )}
          </div>
        </div>
        <div className="dash-actions">
          <div className="seg" role="group" aria-label="Dashboard layout">
            <button type="button" className={layout === 'widgets' ? 'on' : ''} aria-pressed={layout === 'widgets'} onClick={() => setLayout('widgets')}>
              <Icon name="dashboard" /> Widgets
            </button>
            <button type="button" className={layout === 'board' ? 'on' : ''} aria-pressed={layout === 'board'} onClick={() => setLayout('board')}>
              <Icon name="kanban" /> Board
            </button>
          </div>
          <button type="button" className="lg" onClick={() => go({ view: 'settings' })}>
            <Icon name="fileUp" size={18} /> Import sheet
          </button>
          <DashMenu label="Add task" icon="plus" className="primary lg" items={addItems} />
          <DashMenu
            iconOnly
            icon="dots"
            label="More actions"
            className="dash-more-btn"
            items={[
              { label: connected ? 'Sync Gmail, Calendar and Drive' : 'Connect Google', icon: 'sync', onSelect: onSync },
              { label: 'Export everything to Excel', icon: 'excel', onSelect: () => void exportAll() },
            ]}
          />
        </div>
      </header>

      {!connected && (
        <div className="banner dash-connect">
          <Icon name="mail" size={18} />
          <span className="grow">Connect Google to bring in meetings, client mail, payouts and receipts without copying anything by hand.</span>
          <button type="button" className="primary" onClick={() => go({ view: 'settings' })}>
            Connect Google
          </button>
        </div>
      )}

      {layout === 'board' ? (
        <Board state={state} now={now} addItems={addItems} />
      ) : (
        <>
          <section className="dash-tiles" aria-label="Clients">
            {tiles.map(t => (
              <button key={t.client} type="button" className={`dash-tile c-${t.client} c-fill`} onClick={t.open} title={t.title}>
                <span className="dash-tile-top">
                  <span className="dash-tile-ic">
                    <Icon name={t.icon} size={18} weight="fill" />
                  </span>
                  <span className="dash-tile-name">{t.name}</span>
                  <span className="dash-tile-go">
                    <Icon name="arrowUpRight" />
                  </span>
                </span>
                <span className="dash-tile-big">{t.big}</span>
                <span className="dash-tile-sub">{t.sub}</span>
                <span className="dash-tile-bar">
                  <span style={{ width: `${Math.round(Math.min(1, t.pct) * 100)}%` }} />
                </span>
              </button>
            ))}
          </section>

          <div className="dash-row2">
            <section className="panel dash-next" aria-label="Up next">
              <div className="dash-next-head">
                <h2>Up next</h2>
                <span className="dash-count">{remaining}</span>
                <div className="chips" role="group" aria-label="Show client">
                  {FILTERS.map(f => (
                    <button key={f} type="button" className={`chip ${f !== 'all' ? `c-${f}` : ''} ${filter === f ? 'on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                      {f !== 'all' && <span className="dot" />}
                      {f === 'all' ? 'All' : clientName(f)}
                    </button>
                  ))}
                </div>
                <span className="dash-smart" title="Sorted by what's due today, then this week, then the queue">
                  <Icon name="sparkle" size={15} /> Smart order
                </span>
              </div>
              <div className="dash-scroll">
                {!rows.length && <p className="muted dash-none">{actions.length ? 'Nothing for this client right now.' : 'Nothing pressing. Pick the next model from a client screen.'}</p>}
                <ul className="dash-list">
                  {rows.map(r => {
                    const done = isDone(r.a.id);
                    return (
                      <li key={r.a.id} className={`dash-row ${done ? 'done' : ''}`} onClick={e => !(e.target as HTMLElement).closest('button') && r.a.target && go(r.a.target)}>
                        <button
                          type="button"
                          className={`dash-chk ${done ? 'on' : ''}`}
                          aria-pressed={done}
                          aria-label={`${done ? 'Done' : r.check}: ${r.a.title}`}
                          title={done ? 'Undo' : r.check}
                          onClick={() => void (done ? undo(r.a) : check(r))}
                        >
                          <Icon name="check" size={13} weight="bold" />
                        </button>
                        <ClientTile client={r.client} icon={r.icon} />
                        <button type="button" className="dash-row-main" onClick={() => r.a.target && go(r.a.target)}>
                          <span className="t">{r.a.title}</span>
                          <span className="d">{r.detail}</span>
                        </button>
                        {done ? (
                          <button type="button" className="mini dash-undo" onClick={() => void undo(r.a)}>
                            Undo
                          </button>
                        ) : (
                          <span className={`pill st-${r.due.tone} dash-due`}>
                            <Icon name="flag" size={11} weight="fill" />
                            {r.due.text}
                          </span>
                        )}
                        <span className="dash-val">{r.value}</span>
                        <span className="dash-go" aria-hidden="true">
                          <Icon name="caretRight" />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>

            <div className="dash-col">
              <Calendar state={state} now={now} friday={friday} />
              <section className="panel dash-week" aria-label="This week">
                <h2>This week</h2>
                {!connected && (
                  <div className="dash-week-note">
                    <span className="muted small grow">Connect Google to see your meetings here.</span>
                    <button type="button" className="mini primary" onClick={() => go({ view: 'settings' })}>
                      Connect
                    </button>
                  </div>
                )}
                {connected && !meetings.length && <p className="muted small">No meetings in the next 7 days.</p>}
                <ul>
                  {week.map(({ date, meeting: m }) => {
                    const d = new Date(`${date}T00:00:00`);
                    const c: ClientKey = m ? (m.company === 'other' ? 'other' : m.company) : 'waveink';
                    return (
                      <li key={m?.id ?? 'report'}>
                        <span className={`dash-date c-${c} ${c === 'other' ? 'plain' : 'c-soft'}`} aria-hidden="true">
                          <small>{d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase()}</small>
                          <b>{d.getDate()}</b>
                        </span>
                        <span className="grow dash-week-t">
                          <b className="ellipsis">{m ? m.title : `${cfg('waveink').name} daily update log`}</b>
                          <span className="ellipsis">
                            {m
                              ? [m.company !== 'other' ? clientName(m.company) : '', platform(m.joinUrl ?? m.link), `${whenText(date, now) === 'Today' ? 'Today ' : ''}${clock(m.start)}`].filter(Boolean).join(' · ')
                              : `${cfg('waveink').name} · ${date === today ? 'today' : dayMonth(date)}, by end of day`}
                          </span>
                        </span>
                        {m?.joinUrl ? (
                          <button type="button" className={`mini ${m.id === firstJoin ? 'primary' : ''}`} onClick={() => hub.openUrl(m.joinUrl!)} aria-label={`Join ${m.title}`}>
                            Join
                          </button>
                        ) : m?.link ? (
                          <button type="button" className="mini" onClick={() => hub.openUrl(m.link!)} aria-label={`Open ${m.title}`}>
                            Open
                          </button>
                        ) : !m ? (
                          <button type="button" className="mini" onClick={() => void exportLog()} title="Builds the Daily Update Log sheet from your status changes">
                            Export
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>

            <div className="dash-col">
              <section className="panel dash-earn" aria-label="Earnings" onClick={e => !(e.target as HTMLElement).closest('button') && go({ view: 'earnings' })}>
                <div className="dash-panel-head">
                  <h2>
                    <button type="button" className="dash-h-link" onClick={() => go({ view: 'earnings' })}>
                      Earnings
                    </button>
                  </h2>
                  {best && (
                    <span className="tag ok dash-best">
                      <Icon name="trendUp" /> {monthShort(best.month)} best month
                    </span>
                  )}
                </div>
                <div className="dash-earn-big">
                  <b>{formatMoney(receivedFY, base)}</b>
                  <span>received since 1 April</span>
                </div>
                <div className="dash-chart" role="img" aria-label={bars.map(b => `${monthShort(b.month)} ${formatMoney(b.total, base)}`).join(', ')}>
                  {bars.map(b => (
                    <div key={b.month} className={`dash-bar ${b.month === month ? 'now' : ''}`}>
                      <div
                        className="dash-stack"
                        title={`${monthShort(b.month)}: ${formatMoney(b.total, base)} earned${b.segs.some(s => s.owed > 0.5) ? `, ${formatMoney(b.segs.reduce((s, x) => s + x.owed, 0), base)} not paid yet` : ''}${b.month === month ? ' (this month, paid next month)' : ''}`}
                      >
                        {b.segs.flatMap(s => [
                          s.paid > 0.5 && <i key={`${s.cid}p`} className={`c-${s.cid}`} style={{ height: Math.max(3, Math.round((s.paid / maxBar) * 124)) }} />,
                          s.owed > 0.5 && <i key={`${s.cid}o`} className={`c-${s.cid} owed`} style={{ height: Math.max(3, Math.round((s.owed / maxBar) * 124)) }} />,
                        ])}
                      </div>
                      <small>{monthShort(b.month)}</small>
                    </div>
                  ))}
                </div>
                <div className="dash-earn-line">
                  <span>Owed to you</span>
                  <b>{formatMoney(owed, base)}</b>
                </div>
                <div className="dash-earn-line">
                  <span>Earning this month, paid next month</span>
                  <b>{formatMoney(earningMonth, base)}</b>
                </div>
              </section>

              <section className="panel dash-renew" aria-label="Renewing soon" onClick={e => !(e.target as HTMLElement).closest('button') && go({ view: 'subscriptions' })}>
                <div className="dash-panel-head">
                  <h2>
                    <button type="button" className="dash-h-link" onClick={() => go({ view: 'subscriptions' })}>
                      Renewing soon
                    </button>
                  </h2>
                  <span className="muted dash-monthly">{formatMoney(monthly, base)} / mo</span>
                </div>
                {!renewals.length && <p className="muted small">Nothing renews in the next 30 days.</p>}
                <ul>
                  {renewals.map(({ s, date }) => {
                    const d = daysUntil(date!, now);
                    const verb = s.status === 'cancelling' ? 'ends' : s.status === 'trial' ? 'trial ends' : '';
                    const rel = d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`;
                    return (
                      <li key={s.id}>
                        <span className={`dash-letter c-${tone(s.name)} c-soft`} aria-hidden="true">
                          {s.name.trim()[0]?.toUpperCase()}
                        </span>
                        <span className="grow dash-week-t">
                          <b className="ellipsis">{s.name}</b>
                          <span className={s.status === 'trial' ? 'bad-text' : ''}>
                            {dayMonth(date!)} · {verb ? `${verb} ${rel}` : rel}
                          </span>
                        </span>
                        <b className="tabular">{s.amount != null ? formatMoney(s.amount, s.currency, s.amount % 1 ? 2 : 0) : '—'}</b>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>
          </div>
        </>
      )}

      {adding && (
        <AddModel
          company={adding}
          groups={[...new Set(state.models.filter(m => m.company === adding).map(m => m.group).filter((g): g is string => !!g))]}
          onClose={() => setAdding(null)}
        />
      )}
    </div>
  );
}

function Calendar({ state, now, friday }: { state: AppState; now: Date; friday: string }) {
  const [offset, setOffset] = useState(0);
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const y = first.getFullYear();
  const key = `${y}-${pad(first.getMonth() + 1)}`;
  const count = new Date(y, first.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const today = localDate(now);
  const marks = new Map<number, { kind: 'trial' | 'meet' | 'pay'; label: string }[]>();
  const add = (date: string | undefined, kind: 'trial' | 'meet' | 'pay', label: string) => {
    if (!date?.startsWith(key)) return;
    const d = Number(date.slice(8, 10));
    marks.set(d, [...(marks.get(d) ?? []), { kind, label }]);
  };
  for (const m of state.meetings) add(localDate(m.start), 'meet', `${m.title}, ${clock(m.start)}`);
  add(friday, 'meet', 'Waveink daily update log, by end of day');
  for (const s of state.subscriptions) if (s.status === 'trial') add(rollRenewal(s, now), 'trial', `${s.name} trial ends`);
  for (const c of state.companies) {
    if (c.pay.kind === 'retainer' && key > c.pay.startDate.slice(0, 7)) add(`${key}-${pad(Math.min(c.pay.payday, count))}`, 'pay', `${c.name} payday`);
  }
  const mzCfg = state.companies.find(c => c.id === 'metaztech');
  const win = mzCfg?.pay.kind === 'tiered' && state.models.some(m => m.company === 'metaztech') ? [mzCfg.pay.payoutFrom, Math.min(mzCfg.pay.payoutTo, count)] : null;
  const events = [...marks.entries()].sort((a, b) => a[0] - b[0]).flatMap(([d, ms]) => ms.map(m => `${d}: ${m.label}`));

  return (
    <section className="panel dash-cal" aria-label="Calendar">
      <div className="dash-cal-head">
        <span className="dash-cal-ic" aria-hidden="true">
          <Icon name="calendar" size={18} />
        </span>
        <h2 aria-live="polite">
          {first.toLocaleDateString('en-GB', { month: 'long' })}
          {y !== now.getFullYear() ? ` ${y}` : ''}
        </h2>
        <span className="dash-cal-nav">
          <button type="button" aria-label="Previous month" onClick={() => setOffset(o => o - 1)}>
            <Icon name="caretLeft" />
          </button>
          <button type="button" aria-label="Next month" onClick={() => setOffset(o => o + 1)}>
            <Icon name="caretRight" />
          </button>
        </span>
      </div>
      <div className="dash-wk" aria-hidden="true">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="dash-days" aria-hidden="true">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`b${i}`} className="dash-day" />
        ))}
        {Array.from({ length: count }, (_, i) => {
          const d = i + 1;
          const dow = (lead + i) % 7;
          const band = !!win && d >= win[0] && d <= win[1];
          const ms = marks.get(d) ?? [];
          const mark = `${key}-${pad(d)}` === today ? 'today' : (['trial', 'meet', 'pay'] as const).find(k => ms.some(m => m.kind === k)) ?? '';
          const labels = [...(band ? ['MetaZtech payout window'] : []), ...ms.map(m => m.label)];
          const cls = ['dash-day', band && 'band', band && (d === win![0] || dow === 0) && 'band-l', band && (d === win![1] || dow === 6) && 'band-r', mark && `is-${mark}`].filter(Boolean).join(' ');
          return (
            <span key={d} className={cls} title={labels.join('\n') || undefined}>
              <span>{d}</span>
            </span>
          );
        })}
      </div>
      <ul className="sr-only">
        {win && <li>MetaZtech payout window: {win[0]} to {win[1]}</li>}
        {events.map(e => (
          <li key={e}>{e}</li>
        ))}
      </ul>
      <div className="dash-legend">
        <span>
          <i className="mz" />
          MetaZtech payout
        </span>
        <span>
          <i className="meet" />
          Meeting / report
        </span>
        <span>
          <i className="trial" />
          Trial ends
        </span>
        <span>
          <i className="pay" />
          Payday
        </span>
      </div>
    </section>
  );
}
