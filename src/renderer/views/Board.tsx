import { useMemo, useState, type DragEvent } from 'react';
import type { AppState, CompanyId, Model, SkeidarJob } from '../../shared/types';
import { daysUntil, formatMoney, jobOutputs, modelFee } from '../../shared/money';
import { modelLabel } from '../../shared/planner';
import { isComplete, statusEvents, statusLabel } from '../../shared/status';
import { hub } from '../hub';
import { PRIORITY_LABEL, PRIORITY_ORDER, jobPriority, modelPriority, type Priority } from '../priority';
import { Dropdown, Icon, useApp, type Choice } from '../ui';
import { DashMenu, type MenuItem } from './DashMenu';
import { isBuiltIn } from './JobDetails';

type Col = 'todo' | 'in_progress' | 'review' | 'revision' | 'done';
const COLS: { id: Col; name: string }[] = [
  { id: 'todo', name: 'To do' },
  { id: 'in_progress', name: 'In progress' },
  { id: 'review', name: 'In review' },
  { id: 'revision', name: 'Rejected' },
  { id: 'done', name: 'Done' },
];
const BUILT_INS: CompanyId[] = ['waveink', 'metaztech', 'skeidar'];
const RECENT = 14 * 86400000;

interface Card {
  key: string;
  client: CompanyId;
  code: string;
  title: string;
  prio: Priority;
  col: Col;
  date: string;
  late?: boolean;
  meta: string;
  order: string;
  model?: Model;
  job?: SkeidarJob;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (iso: string) => {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

/** When a model was finished: its last status change to done, or the portal's approval date. Catalog imports carry no real date. */
function doneAt(m: Model): string | undefined {
  return statusEvents(m).filter(h => isComplete(h.to)).at(-1)?.at ?? (m.source === 'catalog' || m.completedAtApprox ? undefined : m.completedAt);
}

export function Board({ state, now, addItems }: { state: AppState; now: Date; addItems: MenuItem[] }) {
  const { go, toast } = useApp();
  const [filter, setFilter] = useState<'all' | CompanyId>('all');
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Col | null>(null);
  // The built-in clients, then the ones added by hand that aren't archived
  const clients = useMemo(() => [...BUILT_INS, ...state.companies.filter(c => !isBuiltIn(c) && !c.archived).map(c => c.id)], [state.companies]);
  const shownFilter = filter === 'all' || clients.includes(filter) ? filter : 'all';

  const { cards, more } = useMemo(() => {
    const cfg = (id: CompanyId) => state.companies.find(c => c.id === id);
    const gone = new Set(state.companies.filter(c => c.archived).map(c => c.id));
    // MetaZtech's fee shows once its tier is set; a client paid per item shows its rate.
    const feeOf = (m: Model) => {
      const c = cfg(m.company);
      const f = c && !(c.pay.kind === 'tiered' && !m.complexity) ? modelFee(c, m.complexity) : undefined;
      return c && f ? formatMoney(f, c.currency) : '';
    };
    const out: Card[] = [];
    const more: Partial<Record<CompanyId, number>> = {};
    const due = (d?: string) => {
      if (!d) return undefined;
      const n = daysUntil(d, now);
      return { date: n < 0 ? 'Overdue' : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : short(d), late: n <= 0 };
    };
    const lastTo = (m: Model, s: Model['status']) => statusEvents(m).filter(h => h.to === s).at(-1)?.at;

    for (const m of state.models) {
      const col = (isComplete(m.status) ? 'done' : m.status === 'on_hold' || m.status === 'skipped' ? undefined : m.status) as Col | undefined;
      if (!col || gone.has(m.company)) continue;
      const prio = modelPriority(m, state, now);
      if (col === 'todo' && prio === 'low') {
        more[m.company] = (more[m.company] ?? 0) + 1;
        continue;
      }
      const fee = feeOf(m);
      const label = statusLabel(m.status, m.company);
      let when: { date: string; late?: boolean };
      let meta = '';
      let order = m.dueDate ?? '9999';
      if (col === 'done') {
        const at = doneAt(m);
        if (!at || now.getTime() - new Date(at).getTime() > RECENT) continue;
        when = { date: short(at) };
        meta = m.company === 'metaztech' ? `${label}${fee ? ` ${fee}` : ''}` : fee ? `${label} · ${fee}` : label;
        order = at;
      } else if (col === 'todo') {
        when = due(m.dueDate) ?? { date: m.company === 'waveink' && m.rows?.length ? `Row ${m.rows[0]}` : 'Queue' };
        meta = fee || m.subcategories?.[0] || m.group || '';
      } else if (col === 'in_progress') {
        when = due(m.dueDate) ?? { date: m.startedAt ? `Since ${short(m.startedAt)}` : 'Started' };
        meta = m.percent ? `${m.percent}% done` : fee || m.subcategories?.[0] || '';
      } else if (col === 'review') {
        const at = lastTo(m, 'review');
        when = due(m.dueDate) ?? { date: at ? short(at) : 'Waiting' };
        meta = fee ? `${label} · ${fee}` : label;
      } else {
        const at = lastTo(m, 'revision');
        when = due(m.dueDate) ?? { date: at ? short(at) : 'Sent back', late: true };
        meta = m.company === 'metaztech' ? `Rejected ${m.revisions || 1}×` : m.notes?.trim() || label;
      }
      out.push({ key: m.id, client: m.company, code: m.code ?? m.group ?? 'Model', title: m.name, prio, col, ...when, meta, order, model: m });
    }

    for (const j of state.skeidarJobs) {
      const client = j.company ?? 'skeidar';
      const c = cfg(client);
      if (!c || gone.has(client)) continue;
      const o = jobOutputs(j);
      const col: Col = j.status === 'delivered' ? 'done' : o.done ? 'in_progress' : 'todo';
      if (col === 'done' && now.getTime() - new Date(j.deliveredAt ?? j.receivedAt).getTime() > RECENT) continue;
      out.push({
        key: j.id,
        client,
        code: 'Job',
        title: `${j.name}, ${j.fabrics.length} fabric${j.fabrics.length === 1 ? '' : 's'}`,
        prio: jobPriority(j, now, state),
        col,
        date: col === 'done' ? short(j.deliveredAt ?? j.receivedAt) : short(j.receivedAt),
        meta: col !== 'done' ? `${o.done} / ${o.total} images` : c.pay.kind === 'per-item' ? `${formatMoney(o.done * c.pay.rate, c.currency)} earned` : `${o.done} images`,
        order: col === 'done' ? (j.deliveredAt ?? j.receivedAt) : j.receivedAt,
        job: j,
      });
    }
    return { cards: out, more };
  }, [state, now]);

  const shown = cards.filter(c => shownFilter === 'all' || c.client === shownFilter);
  const column = (col: Col) =>
    shown
      .filter(c => c.col === col)
      .sort((a, b) =>
        col === 'done'
          ? b.order.localeCompare(a.order)
          : PRIORITY_ORDER.indexOf(a.prio) - PRIORITY_ORDER.indexOf(b.prio) || a.order.localeCompare(b.order) || a.title.localeCompare(b.title),
      );
  const name = (id: CompanyId) => state.companies.find(c => c.id === id)?.name ?? id;
  const filterOptions = ['all', ...clients].map(
    (f): Choice => ({
      value: f,
      label: f === 'all' ? 'All clients' : name(f),
      short: f === 'all' ? 'All' : undefined,
      client: f === 'all' ? undefined : f,
      count: cards.filter(c => f === 'all' || c.client === f).length,
    }),
  );

  const open = (c: Card) => (c.model ? go({ view: 'company', company: c.model.company, modelId: c.model.id }) : go({ view: 'skeidar', company: c.job!.company, jobId: c.job!.id }));

  const move = async (c: Card, to: Col) => {
    if (c.col === to) return;
    if (c.model) {
      await hub.setStatus([c.model.id], to);
      toast(`${modelLabel(c.model)} → ${statusLabel(to, c.model.company)}`);
    } else if (c.job) {
      const j = c.job;
      if (to === 'done') {
        await hub.upsert('skeidarJobs', { ...j, status: 'delivered', deliveredAt: new Date().toISOString() });
        toast(`${j.name} delivered`);
      } else if (j.status === 'delivered') {
        await hub.upsert('skeidarJobs', { ...j, status: 'open', deliveredAt: undefined });
        toast(`${j.name} reopened`);
      } else toast(`A ${name(c.client)} job moves on as you tick its images on the ${name(c.client)} screen.`);
    }
  };

  const items = (c: Card): MenuItem[] => [
    { label: 'Open', icon: 'arrowUpRight', onSelect: () => open(c) },
    ...(c.job
      ? [c.job.status === 'open' ? { label: 'Mark delivered', icon: 'check' as const, onSelect: () => void move(c, 'done') } : { label: 'Reopen', icon: 'arrowDownLeft' as const, onSelect: () => void move(c, 'todo') }]
      : COLS.filter(x => x.id !== c.col).map(x => ({ label: `Move to ${x.name}`, icon: 'arrowRight' as const, onSelect: () => void move(c, x.id) }))),
  ];

  const drop = (col: Col) => (e: DragEvent) => {
    e.preventDefault();
    const key = e.dataTransfer.getData('text/plain') || dragging;
    const c = cards.find(x => x.key === key);
    setOver(null);
    setDragging(null);
    if (c) void move(c, col);
  };

  return (
    <>
      <div className="dash-board-bar">
        <Dropdown label="Client" prefix="Client" value={shownFilter} options={filterOptions} onChange={setFilter} />
        <span className="dash-hint" title="MetaZtech statuses sync from the CMS">
          Drag cards between columns
        </span>
      </div>
      <div className="dash-cols-wrap">
        <div className="dash-cols">
          {COLS.map(col => {
            const list = column(col.id);
            const hidden = col.id === 'todo' ? clients.filter(c => (shownFilter === 'all' || shownFilter === c) && more[c]) : [];
            return (
              <section
                key={col.id}
                className={`dash-colm ${over === col.id ? 'over' : ''}`}
                aria-label={`${col.name}, ${list.length} card${list.length === 1 ? '' : 's'}`}
                onDragOver={e => {
                  if (!dragging) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (over !== col.id) setOver(col.id);
                }}
                onDragLeave={e => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(o => (o === col.id ? null : o))}
                onDrop={drop(col.id)}
              >
                <header className="dash-colhead">
                  <span className={`dot st-${col.id}`} aria-hidden="true" />
                  <h3>{col.name}</h3>
                  <span className="n">{list.length}</span>
                  {col.id === 'todo' && <DashMenu iconOnly icon="plus" label="Add a task" items={addItems} className="ghost mini dash-col-add" />}
                </header>
                <div className="dash-cards">
                  {list.map(c => (
                    <article
                      key={c.key}
                      className={`dash-card ${dragging === c.key ? 'dragging' : ''}`}
                      draggable
                      onDragStart={e => {
                        e.dataTransfer.setData('text/plain', c.key);
                        e.dataTransfer.effectAllowed = 'move';
                        setDragging(c.key);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                      onClick={e => !(e.target as HTMLElement).closest('button, .menu') && open(c)}
                    >
                      <div className="dash-card-top">
                        <span className={`cdot c-${c.client}`} />
                        <span className="ellipsis">
                          {name(c.client)} · {c.code}
                        </span>
                        <DashMenu iconOnly icon="dots" label={`Move or open ${c.title}`} items={items(c)} className="ghost mini dash-card-more" />
                      </div>
                      <button type="button" className="dash-card-title" title={c.title} onClick={() => open(c)}>
                        <span className="clamp">{c.title}</span>
                      </button>
                      {c.meta && (
                        <span className="dash-card-meta ellipsis" title={c.meta}>
                          {c.meta}
                        </span>
                      )}
                      <div className="dash-card-foot">
                        <span className={`flag ${c.prio}`}>
                          <Icon name="flag" weight="fill" size={12} />
                          {PRIORITY_LABEL[c.prio]}
                        </span>
                        <span className={c.late ? 'bad-text' : ''}>
                          <Icon name="calendar" size={13} />
                          {c.date}
                        </span>
                      </div>
                    </article>
                  ))}
                  {hidden.map(c => (
                    <button key={c} type="button" className="link-btn dash-more" onClick={() => go({ view: 'company', company: c })}>
                      +{more[c]} more in {name(c)}
                    </button>
                  ))}
                  {!list.length && !hidden.length && <p className="dash-col-empty">{dragging ? 'Drop here' : 'Nothing here'}</p>}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
