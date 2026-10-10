import { useEffect, useMemo, useState } from 'react';
import type { AppState, CompanyId, Model, ModelStatus } from '../../shared/types';
import { isOpen, lastWorked, statusesFor, statusLabel } from '../../shared/status';
import { modelLabel } from '../../shared/planner';
import { nextDeadlines, paceText, weekProgress } from '../../shared/pace';
import { hub } from '../hub';
import { ClientTile, Empty, Icon, Modal, StatusPicker, fmtDate, useApp } from '../ui';
import { modelPriority, PRIORITY_LABEL, PRIORITY_ORDER, type Priority } from '../priority';
import { AddModel, ModelDrawer } from './Models';
import { when } from './MetaZtechParts';
import { DashMenu, type MenuItem } from './DashMenu';
import { AssetsPanel } from './AssetsPanel';
import { JobDetails, JobEditor, clientIcon, jobPayText } from './JobDetails';
import './Client.css';

type Tab = ModelStatus | 'all';
/** The row's one-click next step; anything else opens the model. */
const ACTION: Partial<Record<ModelStatus, { to: ModelStatus; label: string }>> = {
  revision: { to: 'in_progress', label: 'Fix now' },
  todo: { to: 'in_progress', label: 'Start' },
  in_progress: { to: 'review', label: 'Submit' },
  review: { to: 'done', label: 'Done' },
};
const RANK: Partial<Record<ModelStatus, number>> = { revision: 0, in_progress: 1, todo: 2, review: 3 };
const touched = (m: Model) => lastWorked(m) ?? m.updatedAt;

/** Screen for a client added by hand that works with a list of models. */
export function Client({ state, company, openId, now }: { state: AppState; company: CompanyId; openId?: string; now: Date }) {
  const { toast } = useApp();
  const cfg = state.companies.find(c => c.id === company);
  const all = useMemo(() => state.models.filter(m => m.company === company), [state.models, company]);
  const statuses = statusesFor(company);
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [openModel, setOpenModel] = useState<string | undefined>(openId);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [brief, setBrief] = useState(false);

  useEffect(() => {
    setOpenModel(openId);
    if (!openId) return;
    setTab('all');
    requestAnimationFrame(() => document.getElementById(`cl-row-${openId}`)?.scrollIntoView({ block: 'center' }));
  }, [openId]);

  const q = query.toLowerCase().trim();
  const matching = useMemo(() => all.filter(m => !q || `${m.name} ${m.code ?? ''} ${m.group ?? ''} ${m.notes ?? ''}`.toLowerCase().includes(q)), [all, q]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: matching.length };
    for (const m of matching) c[m.status] = (c[m.status] ?? 0) + 1;
    return c;
  }, [matching]);
  const prio = useMemo(() => new Map<string, Priority>(all.map(m => [m.id, modelPriority(m, state, now)])), [all, state, now]);
  const shown = useMemo(() => {
    const p = (m: Model) => PRIORITY_ORDER.indexOf(prio.get(m.id) ?? 'low');
    return matching
      .filter(m => tab === 'all' || m.status === tab)
      .sort(
        (a, b) =>
          Number(!!b.starred) - Number(!!a.starred) ||
          p(a) - p(b) ||
          (RANK[a.status] ?? 5) - (RANK[b.status] ?? 5) ||
          (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
          touched(b).localeCompare(touched(a)),
      );
  }, [matching, tab, prio]);

  if (!cfg) {
    return (
      <div className="page cl-page">
        <Empty title="This client is no longer in the list">It may have been removed. Pick another client in the sidebar.</Empty>
      </div>
    );
  }

  const pace = weekProgress(state, company, now);
  const today = nextDeadlines(cfg, now, 0);
  const current = openModel ? all.find(m => m.id === openModel) : undefined;
  const groups = [...new Set(all.map(m => m.group).filter((g): g is string => !!g))];
  const open = all.filter(m => isOpen(m.status)).length;

  const set = async (ids: string[], to: ModelStatus) => {
    await hub.setStatus(ids, to);
    const one = ids.length === 1 && all.find(m => m.id === ids[0]);
    toast(`${one ? modelLabel(one) : `${ids.length} models`} → ${statusLabel(to, company)}`);
  };
  const exportAll = async () => {
    const r = await hub.exportExcel('all');
    if (r.path) toast(`Saved ${r.path}`);
    else if (r.error) toast(r.error, 'error');
  };
  const why = (m: Model, p: Priority): string => {
    if (m.dueDate) return `Due ${fmtDate(m.dueDate)}`;
    if (p === 'urgent' && today.length) return `${today[0].label} is today`;
    return pace?.per === 'week' ? `Behind this week's target (${pace.done} of ${pace.target})` : `Today's target: ${pace?.done ?? 0} of ${pace?.target ?? 0}`;
  };
  const menu: MenuItem[] = [
    { label: 'Edit job details', icon: 'pencil', onSelect: () => setEditing(true) },
    ...(cfg.notes.trim() ? [{ label: 'Brief & pay terms', icon: 'info' as const, onSelect: () => setBrief(true) }] : []),
    ...cfg.links.map(l => ({ label: l.label, icon: 'link' as const, onSelect: () => void hub.openUrl(l.url) })),
    { label: 'Export everything to Excel', icon: 'excel', onSelect: () => void exportAll() },
  ];

  return (
    <div className={`page cl-page c-${company}`}>
      {cfg.archived && (
        <div className="banner warn">
          <Icon name="info" size={18} />
          <span className="grow">{cfg.name} is archived: it's left out of Up next, the board and the sidebar. Its models and pay history are kept.</span>
          <button type="button" className="mini" onClick={() => hub.upsert('companies', { ...cfg, archived: false }).then(() => toast(`${cfg.name} restored`))}>
            Restore
          </button>
        </div>
      )}
      <header className="cl-head">
        <span className="client-tile c-fill" aria-hidden="true">
          <Icon name={clientIcon(cfg)} size={30} weight="fill" />
        </span>
        <div className="cl-title">
          <h1>{cfg.name}</h1>
          <div className="cl-chips">
            {cfg.role && <span className="cl-chip">{cfg.role}</span>}
            <span className="cl-chip c-soft">{jobPayText(cfg)}</span>
            {pace && <span className={`cl-chip ${pace.behind && pace.per === 'week' ? 'warn' : ''}`}>{paceText(pace)}</span>}
            {today.map(d => (
              <span key={d.id} className="cl-chip bad">
                {d.label} today{d.time ? ` ${d.time}` : ''}
              </span>
            ))}
          </div>
        </div>
        <div className="cl-actions">
          <DashMenu iconOnly icon="dots" label="Job details, links and export" items={menu} className="cl-ibtn" />
          <button type="button" className="lg primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={18} /> Add model
          </button>
        </div>
      </header>

      <div className="cl-bar">
        <div className="tabs cl-tabs" role="group" aria-label="Status">
          {(['all', ...statuses] as const).map(s => (
            <button key={s} type="button" className={`tab ${s === 'revision' && counts[s] ? 'bad' : ''} ${tab === s ? 'on' : ''}`} aria-pressed={tab === s} onClick={() => setTab(s)}>
              {s === 'all' ? 'All' : statusLabel(s, company)}
              <span className="n">{counts[s] ?? 0}</span>
            </button>
          ))}
        </div>
        <label className="cl-search">
          <Icon name="search" size={16} />
          <span className="sr-only">Search models</span>
          <input type="search" placeholder="Name, ID or project" value={query} onChange={e => setQuery(e.target.value)} />
        </label>
      </div>

      <div className="cl-grid">
        <section className="panel cl-list" aria-label="Models">
          {all.length === 0 ? (
            <Empty title={`No ${cfg.name} models yet`}>
              <p>
                Click <strong>Add model</strong> for each piece of work {cfg.name} gives you: its name, the ID they use for it, and where it stands. Start it, submit it for review and mark it done from
                this list; finished models count toward the weekly target and pay.
              </p>
              <div className="row gap wrap cl-empty-acts">
                <button type="button" className="mini primary" onClick={() => setAdding(true)}>
                  <Icon name="plus" size={14} /> Add the first model
                </button>
                <button type="button" className="mini" onClick={() => setEditing(true)}>
                  Set the weekly target
                </button>
              </div>
            </Empty>
          ) : shown.length === 0 ? (
            <Empty title="Nothing matches">
              {q ? 'Change the search, or pick another tab.' : `No models are ${statusLabel(tab as ModelStatus, company).toLowerCase()} right now.`}
            </Empty>
          ) : (
            <div className="cl-table" role="table" aria-label={`${cfg.name} models`} aria-rowcount={shown.length + 1}>
              <div className="cl-row cl-th" role="row">
                <span role="columnheader">Model</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Updated</span>
                <span role="columnheader">
                  <span className="sr-only">Next step</span>
                </span>
              </div>
              <div role="rowgroup">
                {shown.map(m => {
                  const act = ACTION[m.status];
                  const p = prio.get(m.id) ?? 'low';
                  // In-progress work is high anyway; flag what the due date, the target or a deadline raised.
                  const flag = m.status !== 'revision' && (p === 'urgent' || (p === 'high' && (m.status !== 'in_progress' || m.dueDate))) ? p : undefined;
                  const worked = lastWorked(m);
                  return (
                    <div key={m.id} id={`cl-row-${m.id}`} role="row" className={`cl-row ${m.status === 'revision' ? 'bad' : ''} ${m.id === openModel ? 'open' : ''}`} onClick={() => setOpenModel(m.id)}>
                      <span className="cl-c-model" role="cell">
                        <ClientTile client={company} size="sm" icon={clientIcon(cfg)} />
                        <span className="cl-name">
                          <button
                            type="button"
                            className="link-btn"
                            title={[m.name, m.group].filter(Boolean).join(' · ')}
                            onClick={e => {
                              e.stopPropagation();
                              setOpenModel(m.id);
                            }}
                          >
                            {m.starred && <Icon name="star" size={13} weight="fill" />}
                            <span className="ellipsis">{m.name}</span>
                          </button>
                          <small>
                            {m.code && <span>{m.code}</span>}
                            {m.group && <span>{m.group}</span>}
                            <span className="cl-upd-inline">{when(worked ?? m.updatedAt, now)}</span>
                            {flag && (
                              <span className={`flag ${flag}`} title={why(m, flag)}>
                                <Icon name="flag" weight="fill" size={12} />
                                {PRIORITY_LABEL[flag]}
                              </span>
                            )}
                          </small>
                        </span>
                      </span>
                      <span className="cl-c-st" role="cell">
                        <StatusPicker status={m.status} company={company} onPick={s => set([m.id], s)} />
                      </span>
                      <span className="cl-c-upd" role="cell" title={worked ? `Status changed ${fmtDate(worked, true)}` : `Added ${fmtDate(m.createdAt, true)}`}>
                        {when(worked ?? m.updatedAt, now)}
                      </span>
                      <span className="cl-c-act" role="cell" onClick={e => e.stopPropagation()}>
                        {act ? (
                          <button type="button" className={`cl-act ${m.status === 'revision' ? 'ink' : ''}`} onClick={() => set([m.id], act.to)} aria-label={`${act.label}: ${m.name}`}>
                            {act.label}
                          </button>
                        ) : (
                          <button type="button" className="cl-act" onClick={() => setOpenModel(m.id)} aria-label={`View ${m.name}`}>
                            View
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {all.length > 0 && (
            <p className="cl-foot muted small">
              {open} open · {counts.review ?? 0} {statusLabel('review', company).toLowerCase()} · {all.length} in all
            </p>
          )}
        </section>

        <aside className="cl-side" aria-label="Job details and files">
          <JobDetails state={state} company={company} now={now} />
          <AssetsPanel state={state} company={company} />
        </aside>
      </div>

      {current && <ModelDrawer model={current} state={state} onClose={() => setOpenModel(undefined)} />}
      {/* AddModel works for any client; its type still names the two it was written for. */}
      {adding && <AddModel company={company as 'metaztech'} groups={groups} onClose={() => setAdding(false)} />}
      {editing && <JobEditor state={state} company={company} onClose={() => setEditing(false)} />}
      {brief && (
        <Modal title="Brief & pay terms" onClose={() => setBrief(false)}>
          <p className="cl-brief">{cfg.notes}</p>
          {cfg.links.length > 0 && (
            <div className="row gap wrap">
              {cfg.links.map(l => (
                <button key={l.url} type="button" className="mini" onClick={() => hub.openUrl(l.url)}>
                  {l.label} <Icon name="external" size={12} />
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
