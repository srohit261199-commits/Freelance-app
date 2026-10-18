import { useMemo, useState, type CSSProperties } from 'react';
import type { AppState, CompanyConfig, CompanyId, Model, ModelStatus, SkeidarJob } from '../../shared/types';
import { clientTarget, nextActions, type NextAction } from '../../shared/planner';
import { allEarnings, convert, daysUntil, formatMoney, jobOutputs, localDate, modelFee, monthlyCost, monthsBetween, rollRenewal, type CompanyEarnings } from '../../shared/money';
import { agenda, deadlinesBetween, paceText, weekProgress, type DeadlineHit, type Pace } from '../../shared/pace';
import { isComplete, statusLabel } from '../../shared/status';
import { hub } from '../hub';
import { ClientTile, Icon, useApp, type ClientKey, type IconName } from '../ui';
import { AddModel } from './Models';
import { Board } from './Board';
import { DashMenu, type MenuItem } from './DashMenu';
import { clientIcon, isBuiltIn } from './JobDetails';
import './Dash.css';

type Layout = 'widgets' | 'board';
type Filter = 'all' | CompanyId | 'money';
type Tone = 'bad' | 'warn' | 'neutral';
const LAYOUT_KEY = 'fh-dash-layout';
const DONE_KEY = 'fh-dash-done';
const BUILT_INS: CompanyId[] = ['waveink', 'metaztech', 'skeidar'];
const STACK: CompanyId[] = ['skeidar', 'metaztech', 'waveink'];
const LETTER_TONES: ClientKey[] = ['metaztech', 'waveink', 'skeidar', 'money'];
/** "This week" lists this many deadlines at most. */
const WEEK_ROWS = 5;

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayMonth = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
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
/** Rows ticked off for today that have nothing to record (a deadline, a renewal, a reminder). */
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
/** Images made out of all the images asked for, across these jobs. */
function outputs(jobs: SkeidarJob[]): { done: number; total: number } {
  return jobs.reduce(
    (s, j) => {
      const o = jobOutputs(j);
      return { done: s.done + o.done, total: s.total + o.total };
    },
    { done: 0, total: 0 },
  );
}
/** What a model is worth, for the Value column: MetaZtech's fee once its tier is set, a client's rate per item. */
function feeText(m: Model, cfg?: CompanyConfig): string {
  if (!cfg || (cfg.pay.kind === 'tiered' && !m.complexity)) return '';
  const fee = modelFee(cfg, m.complexity);
  return fee ? formatMoney(fee, cfg.currency) : '';
}
/** "Due today 18:00", "Due by end of day". */
function dueText(d: DeadlineHit): string {
  return `Due ${d.days === 0 ? 'today ' : ''}${d.time ?? 'by end of day'}`;
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
  icon: IconName;
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
interface Tile {
  client: ClientKey;
  icon: IconName;
  name: string;
  big: string;
  sub: string;
  pct: number;
  title: string;
  /** This period's progress against the client's output target, when it has one. */
  pace?: Pace;
  open(): void;
}

export function Today({ state, now }: { state: AppState; now: Date }) {
  const { go, toast } = useApp();
  const [layout, setLayoutState] = useState<Layout>(readLayout);
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState<CompanyId | null>(null);
  const [checked, setChecked] = useState<Map<string, Checked>>(new Map());
  const today = localDate(now);
  const [localDone, setLocalDone] = useState<{ date: string; ids: string[] }>(() => ({ date: today, ids: readDone(today) }));
  const doneIds = localDone.date === today ? localDone.ids : [];

  const actions = useMemo(() => nextActions(state, now), [state, now]);
  const earnings = useMemo(() => allEarnings(state, now), [state, now]);
  const cfg = (id: CompanyId) => state.companies.find(c => c.id === id)!;
  const find = (id: string) => state.companies.find(c => c.id === id);
  // Clients added by hand show up beside the built-in ones until they are archived.
  const added = state.companies.filter(c => !isBuiltIn(c) && !c.archived);
  const filters: Filter[] = ['all', ...BUILT_INS, ...added.map(c => c.id), 'money'];
  const shownFilter = filters.includes(filter) ? filter : 'all';
  const base = state.settings.baseCurrency;
  const rates = state.settings.rates;
  const inBase = (v: number, e: CompanyEarnings) => convert(v, e.currency, base, rates);
  const month = today.slice(0, 7);
  const models = useMemo(() => new Map(state.models.map(m => [m.id, m])), [state.models]);
  const clientName = (c: ClientKey) => (c === 'money' ? 'Money' : c === 'portfolio' ? 'Portfolio' : (find(c)?.name ?? c));

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
  const sk = cfg('skeidar');
  const skRate = sk.pay.kind === 'per-item' ? sk.pay.rate : 5;
  const skOpen = state.skeidarJobs.filter(j => j.status === 'open' && (j.company ?? 'skeidar') === 'skeidar');
  const skOut = outputs(skOpen);
  const owed = earnings.reduce((s, e) => s + inBase(e.outstanding, e), 0);
  const received = earnings.reduce((s, e) => s + inBase(e.received, e), 0);
  const earningMonth = earnings.reduce((s, e) => s + inBase(e.thisMonth, e), 0);
  // Earned months whose pay day (plus 3 days' grace) has passed without the full amount recorded.
  const late = earnings.reduce(
    (s, e) => s + e.months.filter(l => l.due && l.month < month && plusDays(l.due, 3) < today).reduce((t, l) => t + Math.max(0, inBase(l.net - (e.paidByMonth[l.month] ?? 0), e)), 0),
    0,
  );
  const mzDue = (() => {
    const e = earnings.find(x => x.company === 'metaztech');
    return e ? e.months.filter(l => l.month < month).reduce((s, l) => s + l.net - (e.paidByMonth[l.month] ?? 0), 0) : 0;
  })();

  // ----- up next -----
  const describe = (a: NextAction): Row => {
    const m = a.modelId ? models.get(a.modelId) : undefined;
    const id = a.id;
    const client: ClientKey = a.company;
    let icon: IconName | undefined;
    let value = '';
    let date: string | undefined;
    let kind: Row['kind'] = m ? 'model' : 'local';
    let check = m ? `Mark ${statusLabel(checkTo(m), m.company)}` : 'Done for today';
    if (id.startsWith('overdue-')) {
      const e = earnings.find(x => id.startsWith(`overdue-${x.company}-`));
      if (e?.overdue) value = formatMoney(e.overdue.net - e.overdue.paid, e.currency);
      kind = 'open';
      check = 'Record the payment';
    } else if (id.startsWith('mz-payout-')) {
      value = formatMoney(mzDue, 'INR');
      kind = 'open';
      check = 'Record the payment';
    } else if (/^(mz-target|target|pace)-/.test(id)) {
      const p = a.company && weekProgress(state, a.company, now);
      if (p) value = `${p.done} / ${p.target}`;
    } else if (id.startsWith('dl-')) {
      icon = 'clock';
      date = id.slice(-10);
    } else if (id.startsWith('sub-')) {
      const s = state.subscriptions.find(x => id.startsWith(`sub-${x.id}-`));
      icon = 'repeat';
      date = id.slice(-10);
      if (s?.amount != null) value = formatMoney(s.amount, s.currency, s.amount % 1 ? 2 : 0);
    } else if (id.startsWith('sk-')) {
      const j = state.skeidarJobs.find(x => id === `sk-${x.id}`);
      const c = j && find(j.company ?? 'skeidar');
      if (j && c?.pay.kind === 'per-item') {
        const o = jobOutputs(j);
        value = formatMoney((o.total - o.done) * c.pay.rate, c.currency);
      }
      kind = 'open';
      check = 'Open the job to tick images';
    } else if (id.startsWith('pf-')) {
      kind = 'portfolio';
      check = 'Mark done';
    }
    if (m) {
      if (m.dueDate) date = m.dueDate;
      value = feeText(m, find(m.company));
    }
    const name = clientName(client);
    const detail = !a.detail ? name : !name || a.detail.startsWith(name) ? a.detail : `${name} · ${a.detail}`;
    const text = date ? whenText(date, now) : id.startsWith('wi-next-') && m?.rows?.length ? `Row ${m.rows[0]}` : a.priority === 1 ? 'Today' : a.priority === 2 ? 'This week' : 'Queue';
    return {
      a,
      client,
      icon: icon ?? clientIcon({ id: client, workflow: find(client)?.workflow }),
      detail,
      due: { text, tone: a.priority === 1 ? 'bad' : a.priority === 2 ? 'warn' : 'neutral' },
      value,
      kind,
      models: m ? [m] : [],
      check,
    };
  };

  const display = useMemo(() => {
    const out = actions.filter(a => !checked.has(a.id));
    [...checked.values()].sort((p, q) => p.index - q.index).forEach(c => out.splice(Math.min(c.index, out.length), 0, c.action));
    return out;
  }, [actions, checked]);
  const rows = display.filter(a => shownFilter === 'all' || a.company === shownFilter).map(describe);
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
    const to = checkTo(r.models[0]);
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
      const n = actions.filter(x => x.id.startsWith('fix-') && x.company === a.company).length;
      const m = a.modelId ? models.get(a.modelId) : undefined;
      // MetaZtech rejects; clients added by hand ask for revisions.
      const word = a.company === 'metaztech' ? 'rejection' : 'revision';
      return n > 1 ? `${n} ${clientName(a.company)} ${word}s to fix` : `Fix ${word}: ${m?.code ?? m?.name ?? ''}`;
    }
    if (a.id.startsWith('overdue-')) return `${state.companies.find(c => a.id.startsWith(`overdue-${c.id}-`))?.name ?? 'A'} payment is late`;
    if (a.id.startsWith('dl-waveink-wi-report-')) return 'Waveink update log due today';
    return a.title.length > 44 ? `${a.title.slice(0, 42)}…` : a.title;
  };

  // ----- this week: each client's recurring deadlines -----
  const week = agenda(state, now, 7).slice(0, WEEK_ROWS);

  // ----- earnings -----
  const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyStart = `${fyYear}-04`;
  const receivedFY = state.payments.filter(p => p.date.slice(0, 7) >= fyStart).reduce((s, p) => s + convert(p.amount, p.currency, base, rates), 0);
  // Archived clients still earned what they earned.
  const stack = [...STACK, ...state.companies.filter(c => !isBuiltIn(c)).map(c => c.id)];
  const bars = monthsBetween(fyStart, month).map(mk => {
    const segs = stack.flatMap(cid => {
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
    { label: 'Waveink model', icon: 'cube', client: 'waveink', onSelect: () => setAdding('waveink') },
    { label: 'MetaZtech model', icon: 'cubeFocus', client: 'metaztech', onSelect: () => setAdding('metaztech') },
    { label: 'Skeidar job', icon: 'brush', client: 'skeidar', onSelect: () => go({ view: 'skeidar' }) },
    // A variations client's jobs are added on its own screen, like Skeidar's.
    ...added.map(
      (c): MenuItem => ({
        label: `${c.name} ${c.workflow === 'variations' ? 'job' : 'model'}`,
        icon: clientIcon(c),
        client: c.id,
        onSelect: () => (c.workflow === 'variations' ? go(clientTarget(c)) : setAdding(c.id)),
      }),
    ),
    { label: 'Record a payment', icon: 'wallet', client: 'money', onSelect: () => go({ view: 'earnings' }) },
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

  // A client added by hand gets a tile like the built-in one it works like: models done, or images made on open jobs.
  const clientTile = (c: CompanyConfig): Tile => {
    const base = { client: c.id, icon: clientIcon(c), name: c.name, open: () => go(clientTarget(c)) };
    if (c.workflow === 'variations') {
      const open = state.skeidarJobs.filter(j => j.company === c.id && j.status === 'open');
      const out = outputs(open);
      const each = c.pay.kind === 'per-item' ? ` · ${formatMoney(c.pay.rate, c.currency)} each` : '';
      return {
        ...base,
        big: open.length ? `${out.done}/${out.total}` : 'No open jobs',
        sub: `${open.length === 1 ? `${open[0].name} variations` : open.length ? `${open.length} open jobs` : 'New jobs land here'}${each}`,
        pct: out.total ? out.done / out.total : 0,
        title: `${out.done} of ${out.total} images made across open jobs`,
      };
    }
    const list = state.models.filter(m => m.company === c.id && m.status !== 'skipped');
    const done = doneCount(list);
    const count = (s: ModelStatus) => list.filter(m => m.status === s).length;
    return {
      ...base,
      big: list.length ? `${done}/${list.length}` : 'No models',
      sub: list.length
        ? ['models done', count('revision') && `${count('revision')} to fix`, `${count('in_progress')} in progress`, count('review') && `${count('review')} in review`].filter(Boolean).join(' · ')
        : 'Add the first one on its screen',
      pct: list.length ? done / list.length : 0,
      title: `${done} of ${list.length} models done`,
    };
  };
  // A client with an output target shows this period's pace under its figures, and its bar follows the pace.
  const paced = (t: Tile): Tile => {
    const p = weekProgress(state, t.client, now);
    // Nothing to pace in a week the job hasn't reached yet
    if (!p || !p.target) return t;
    return { ...t, pace: p, pct: p.target ? p.done / p.target : 0, title: `${paceText(p)}${p.per === 'week' && p.expected ? ` · ${p.expected} expected by now` : ''}` };
  };

  const clientTiles: Tile[] = [
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
      name: cfg('metaztech').name,
      big: !mz.length ? 'No models' : mzRejected ? `${mzRejected} rejected` : `${mzApprovedMonth} approved`,
      sub: !mz.length ? 'Pull them from the portal' : mzRejected ? `${mzApprovedMonth} approved this month · ${mzReview} in review` : `this month · ${mzReview} in review`,
      pct: 0,
      title: `${mzApprovedMonth} approved this month`,
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
    ...added.map(clientTile),
  ];
  const tiles: Tile[] = [
    ...clientTiles.map(paced),
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
  const pctOf = (n: number, p: Pace) => Math.round(Math.min(1, p.target ? n / p.target : 0) * 100);

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
            items={[{ label: 'Export everything to Excel', icon: 'excel', onSelect: () => void exportAll() }]}
          />
        </div>
      </header>

      {layout === 'board' ? (
        <Board state={state} now={now} addItems={addItems} />
      ) : (
        <>
          {/* More than four tiles wrap into rows of even length (five as 3 + 2, six as 3 + 3) */}
          <section className={`dash-tiles ${tiles.length > 4 ? 'many' : ''}`} style={{ '--tile-cols': Math.ceil(tiles.length / Math.ceil(tiles.length / 4)) } as CSSProperties} aria-label="Clients">
            {tiles.map(t => (
              <button key={t.client} type="button" className={`dash-tile c-${t.client} c-fill ${t.pace ? 'paced' : ''}`} onClick={t.open} title={t.title}>
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
                {t.pace && (
                  <span className="dash-tile-pace">
                    {t.pace.behind && <Icon name="flag" size={12} weight="fill" />}
                    <span className="ellipsis">{paceText(t.pace)}</span>
                  </span>
                )}
                <span className="dash-tile-bar">
                  <span style={{ width: `${Math.round(Math.min(1, t.pct) * 100)}%` }} />
                  {/* Where a weekly target should be by now */}
                  {t.pace?.per === 'week' && t.pace.expected > 0 && t.pace.expected < t.pace.target && <i style={{ left: `${pctOf(t.pace.expected, t.pace)}%` }} />}
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
                  {filters.map(f => (
                    <button key={f} type="button" className={`chip ${f !== 'all' ? `c-${f}` : ''} ${shownFilter === f ? 'on' : ''}`} aria-pressed={shownFilter === f} onClick={() => setFilter(f)}>
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
              <Calendar state={state} now={now} />
              <section className="panel dash-week" aria-label="This week">
                <h2>This week</h2>
                {!week.length && <p className="muted small">Nothing due in the next 7 days.</p>}
                <ul>
                  {week.map(d => {
                    const c = find(d.company);
                    // Waveink's Friday log is built from the status changes, so its row offers the export.
                    const log = d.company === 'waveink' && d.id === 'wi-report';
                    return (
                      <li key={`dl-${d.company}-${d.id}-${d.date}`}>
                        <span className={`dash-date c-${d.company} c-soft`} aria-hidden="true">
                          <small>{d.at.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase()}</small>
                          <b>{d.at.getDate()}</b>
                        </span>
                        <span className="grow dash-week-t">
                          <b className="ellipsis">{d.label}</b>
                          <span className="ellipsis">{[clientName(d.company), dueText(d)].join(' · ')}</span>
                        </span>
                        {log ? (
                          <button type="button" className="mini" onClick={() => void exportLog()} title="Builds the Daily Update Log sheet from your status changes">
                            Export
                          </button>
                        ) : (
                          c && (
                            <button type="button" className="mini" onClick={() => go(clientTarget(c))} aria-label={`Open ${c.name}`}>
                              Open
                            </button>
                          )
                        )}
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
          // AddModel works for any client; its type still names the two it was written for.
          company={adding as 'waveink' | 'metaztech'}
          groups={[...new Set(state.models.filter(m => m.company === adding).map(m => m.group).filter((g): g is string => !!g))]}
          onClose={() => setAdding(null)}
        />
      )}
    </div>
  );
}

function Calendar({ state, now }: { state: AppState; now: Date }) {
  const [offset, setOffset] = useState(0);
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const y = first.getFullYear();
  const key = `${y}-${pad(first.getMonth() + 1)}`;
  const count = new Date(y, first.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const today = localDate(now);
  const marks = new Map<number, { kind: 'trial' | 'due' | 'pay'; label: string }[]>();
  const add = (date: string | undefined, kind: 'trial' | 'due' | 'pay', label: string) => {
    if (!date?.startsWith(key)) return;
    const d = Number(date.slice(8, 10));
    marks.set(d, [...(marks.get(d) ?? []), { kind, label }]);
  };
  // Each client's recurring deadlines
  for (const d of deadlinesBetween(state, `${key}-01`, `${key}-${pad(count)}`, now)) {
    add(d.date, 'due', `${state.companies.find(c => c.id === d.company)?.name ?? d.company}: ${d.label}, ${d.time ?? 'by end of day'}`);
  }
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
          const mark = `${key}-${pad(d)}` === today ? 'today' : (['trial', 'due', 'pay'] as const).find(k => ms.some(m => m.kind === k)) ?? '';
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
          <i className="due" />
          Deadline
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
