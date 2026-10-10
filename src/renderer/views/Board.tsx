import { useMemo, useState, type DragEvent } from 'react';
import type { AppState, CompanyId, Model, SkeidarJob } from '../../shared/types';
import { daysUntil, formatMoney, jobOutputs, tierFee } from '../../shared/money';
import { modelLabel } from '../../shared/planner';
import { isComplete, statusEvents, statusLabel } from '../../shared/status';
import { hub } from '../hub';
import { PRIORITY_LABEL, PRIORITY_ORDER, jobPriority, modelPriority, type Priority } from '../priority';
import { Icon, useApp } from '../ui';
import { DashMenu, type MenuItem } from './DashMenu';

type Col = 'todo' | 'in_progress' | 'review' | 'revision' | 'done';
const COLS: { id: Col; name: string; tone: string }[] = [
  { id: 'todo', name: 'To do', tone: 'todo' },
  { id: 'in_progress', name: 'In progress', tone: 'prog' },
  { id: 'review', name: 'In review', tone: 'rev' },
  { id: 'revision', name: 'Rejected', tone: 'bad' },
  { id: 'done', name: 'Done', tone: 'ok' },
];
const CLIENTS: CompanyId[] = ['waveink', 'metaztech', 'skeidar'];
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

  const { cards, more } = useMemo(() => {
    const cfg = (id: CompanyId) => state.companies.find(c => c.id === id)!;
    const mz = cfg('metaztech');
    const sk = cfg('skeidar');
    const rate = sk.pay.kind === 'per-item' ? sk.pay.rate : 5;
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
      if (!col) continue;
      const prio = modelPriority(m, state, now);
      if (col === 'todo' && prio === 'low') {
        more[m.company] = (more[m.company] ?? 0) + 1;
        continue;
      }
      const fee = m.company === 'metaztech' && m.complexity ? formatMoney(tierFee(mz, m.complexity), 'INR') : '';
      const label = statusLabel(m.status, m.company);
      let when: { date: string; late?: boolean };
      let meta = '';
      let order = m.dueDate ?? '9999';
      if (col === 'done') {
        const at = doneAt(m);
        if (!at || now.getTime() - new Date(at).getTime() > RECENT) continue;
        when = { date: short(at) };
        meta = m.company === 'metaztech' ? `${label}${fee ? ` ${fee}` : ''}` : m.driveFileUrl ? 'GLB on Drive' : label;
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
      const o = jobOutputs(j);
      const col: Col = j.status === 'delivered' ? 'done' : o.done ? 'in_progress' : 'todo';
      if (col === 'done' && now.getTime() - new Date(j.deliveredAt ?? j.receivedAt).getTime() > RECENT) continue;
      out.push({
        key: j.id,
        client: 'skeidar',
        code: 'Job',
        title: `${j.name}, ${j.fabrics.length} fabric${j.fabrics.length === 1 ? '' : 's'}`,
        prio: jobPriority(j, now),
        col,
        date: col === 'done' ? short(j.deliveredAt ?? j.receivedAt) : short(j.receivedAt),
        meta: col === 'done' ? `${formatMoney(o.done * rate, sk.currency)} earned` : `${o.done} / ${o.total} images`,
        order: col === 'done' ? (j.deliveredAt ?? j.receivedAt) : j.receivedAt,
        job: j,
      });
    }
    return { cards: out, more };
  }, [state, now]);

  const shown = cards.filter(c => filter === 'all' || c.client === filter);
  const column = (col: Col) =>
    shown
      .filter(c => c.col === col)
      .sort((a, b) =>
        col === 'done'
          ? b.order.localeCompare(a.order)
          : PRIORITY_ORDER.indexOf(a.prio) - PRIORITY_ORDER.indexOf(b.prio) || a.order.localeCompare(b.order) || a.title.localeCompare(b.title),
      );
  const name = (id: CompanyId) => state.companies.find(c => c.id === id)?.name ?? id;

  const open = (c: Card) => (c.model ? go({ view: 'company', company: c.model.company as 'waveink' | 'metaztech', modelId: c.model.id }) : go({ view: 'skeidar', jobId: c.job!.id }));

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
      } else toast('A Skeidar job moves on as you tick its images on the Skeidar screen.');
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
        <div className="chips on-bg" role="group" aria-label="Show client">
          {(['all', ...CLIENTS] as const).map(f => (
            <button key={f} type="button" className={`chip ${f !== 'all' ? `c-${f}` : ''} ${filter === f ? 'on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f !== 'all' && <span className="dot" />}
              {f === 'all' ? 'All' : name(f)}
            </button>
          ))}
        </div>
        <span className="dash-hint">Drag cards between columns · MetaZtech statuses sync from the CMS</span>
      </div>
      <div className="dash-cols-wrap">
        <div className="dash-cols">
          {COLS.map(col => {
            const list = column(col.id);
            const hidden = col.id === 'todo' ? CLIENTS.filter(c => c !== 'skeidar' && (filter === 'all' || filter === c) && more[c]) : [];
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
                  <span className={`dash-colpill ${col.tone}`}>
                    {col.name}
                    <span className="n">{list.length}</span>
                  </span>
                  {col.id === 'todo' && <DashMenu iconOnly icon="plus" label="Add a task" items={addItems} className="ghost dash-col-add" />}
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
                        <DashMenu iconOnly icon="dots" label={`Move or open ${c.title}`} items={items(c)} className="ghost dash-card-more" />
                      </div>
                      <button type="button" className="dash-card-title" onClick={() => open(c)}>
                        {c.title}
                      </button>
                      <span className={`flag ${c.prio}`}>
                        <Icon name="flag" weight="fill" size={12} />
                        {PRIORITY_LABEL[c.prio]}
                      </span>
                      <div className="dash-card-foot">
                        <span className={c.late ? 'bad-text' : ''}>
                          <Icon name="calendar" size={14} />
                          {c.date}
                        </span>
                        {c.meta && (
                          <span title={c.meta}>
                            <Icon name="info" size={14} />
                            <span className="ellipsis">{c.meta}</span>
                          </span>
                        )}
                      </div>
                    </article>
                  ))}
                  {hidden.map(c => (
                    <button key={c} type="button" className="link-btn dash-more" onClick={() => go({ view: 'company', company: c as 'waveink' | 'metaztech' })}>
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
