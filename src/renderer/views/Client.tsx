import { useEffect, useMemo, useState } from 'react';
import type { AppState, CompanyId, Model, ModelStatus } from '../../shared/types';
import { isOpen, lastWorked, statusesFor, statusLabel } from '../../shared/status';
import { modelLabel } from '../../shared/planner';
import { nextDeadlines, paceText, weekProgress } from '../../shared/pace';
import { hub } from '../hub';
import { Dropdown, Empty, Icon, MenuButton, Modal, PageHead, StatusPicker, fmtDate, useApp, type Choice, type IconName } from '../ui';
import { modelPriority, PRIORITY_LABEL, PRIORITY_ORDER, type Priority } from '../priority';
import { AddModel, ModelDrawer, nextStep } from './Models';
import { when } from './MetaZtechParts';
import { AssetsPanel } from './AssetsPanel';
import { JobDetails, JobEditor, clientIcon, jobPayText } from './JobDetails';
import './Client.css';

type Tab = ModelStatus | 'all';
const RANK: Partial<Record<ModelStatus, number>> = { revision: 0, in_progress: 1, todo: 2, review: 3 };
const touched = (m: Model) => lastWorked(m) ?? m.updatedAt;

/** An item in the header's ⋯ menu. */
function Act({ icon, label, run }: { icon: IconName; label: string; run(): void }) {
  return (
    <button type="button" role="menuitem" onClick={run}>
      <Icon name={icon} />
      <span className="grow">{label}</span>
    </button>
  );
}

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
  const tabs: Choice<Tab>[] = (['all', ...statuses] as const).map(s => ({
    value: s,
    label: s === 'all' ? 'All' : statusLabel(s, company),
    tone: s === 'all' ? undefined : `st-${s}`,
    count: counts[s] ?? 0,
  }));

  const set = async (ids: string[], to: ModelStatus) => {
    await hub.setStatus(ids, to);
    const one = ids.length === 1 && all.find(m => m.id === ids[0]);
    toast(`${one ? modelLabel(one) : `${ids.length} models`} → ${statusLabel(to, company)}`);
  };
  const exportClient = async () => {
    const r = await hub.exportExcel(`client:${company}`);
    if (r.path) toast(`Saved ${r.path}`);
    else if (r.error) toast(r.error, 'error');
  };
  const why = (m: Model, p: Priority): string => {
    if (m.dueDate) return `Due ${fmtDate(m.dueDate)}`;
    if (p === 'urgent' && today.length) return `${today[0].label} is today`;
    return pace?.per === 'week' ? `Behind this week's target (${pace.done} of ${pace.target})` : `Today's target: ${pace?.done ?? 0} of ${pace?.target ?? 0}`;
  };

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
      <PageHead
        title={cfg.name}
        icon={clientIcon(cfg)}
        meta={
          <>
            {cfg.role && <span>{cfg.role}</span>}
            <span>{jobPayText(cfg)}</span>
            {/* A week the job hasn't reached yet has nothing to count */}
            {pace && pace.target > 0 && <span className={pace.behind && pace.per === 'week' ? 'warn-text' : ''}>{paceText(pace)}</span>}
            {today.map(d => (
              <span key={d.id} className={d.passed ? '' : 'bad-text'}>
                {d.label} today{d.time ? ` ${d.time}` : ''}
              </span>
            ))}
          </>
        }
      >
        <MenuButton label="More actions" icon="dots">
          {close => (
            <>
              <Act
                icon="pencil"
                label="Edit job details"
                run={() => {
                  close();
                  setEditing(true);
                }}
              />
              {cfg.notes.trim() && (
                <Act
                  icon="info"
                  label="Brief & pay terms"
                  run={() => {
                    close();
                    setBrief(true);
                  }}
                />
              )}
              {cfg.links.length > 0 && <hr />}
              {cfg.links.map(l => (
                <Act
                  key={l.url}
                  icon="link"
                  label={l.label}
                  run={() => {
                    close();
                    void hub.openUrl(l.url);
                  }}
                />
              ))}
              <hr />
              <Act
                icon="excel"
                label="Export to Excel"
                run={() => {
                  close();
                  void exportClient();
                }}
              />
            </>
          )}
        </MenuButton>
        <button type="button" className="primary" onClick={() => setAdding(true)}>
          <Icon name="plus" /> Add model
        </button>
      </PageHead>

      <div className="cl-grid">
        <section className="panel cl-list" aria-label="Models">
          {all.length === 0 ? (
            <Empty title={`No ${cfg.name} models yet`}>
              <p>Add each piece of work they send. Finished models count toward the weekly target and pay.</p>
              <div className="row gap wrap cl-empty-acts">
                <button type="button" className="mini" onClick={() => setAdding(true)}>
                  <Icon name="plus" size={14} /> Add the first model
                </button>
                <button type="button" className="mini" onClick={() => setEditing(true)}>
                  Set the weekly target
                </button>
              </div>
            </Empty>
          ) : (
            <>
              <div className="cl-tools">
                <Dropdown label="Status" prefix="Status" value={tab} options={tabs} onChange={v => setTab(v)} />
                <label className="cl-search">
                  <Icon name="search" />
                  <span className="sr-only">Search models</span>
                  <input type="search" placeholder="Name, ID or project" value={query} onChange={e => setQuery(e.target.value)} />
                </label>
              </div>
              {shown.length === 0 ? (
                <Empty title="Nothing matches">
                  {q ? 'Change the search, or pick another status.' : `No models are ${statusLabel(tab as ModelStatus, company).toLowerCase()} right now.`}
                </Empty>
              ) : (
                <div className="cl-table" role="table" aria-label={`${cfg.name} models`} aria-rowcount={shown.length + 1}>
                  <div className="cl-row cl-th" role="row">
                    <span role="columnheader">Model</span>
                    <span role="columnheader">Status</span>
                    <span className="cl-c-upd" role="columnheader">
                      Updated
                    </span>
                    <span role="columnheader">
                      <span className="sr-only">Next step</span>
                    </span>
                  </div>
                  <div role="rowgroup">
                    {shown.map(m => {
                      const act = nextStep(m);
                      const p = prio.get(m.id) ?? 'low';
                      // In-progress work is high anyway; flag what the due date, the target or a deadline raised.
                      const flag = m.status !== 'revision' && (p === 'urgent' || (p === 'high' && (m.status !== 'in_progress' || m.dueDate))) ? p : undefined;
                      const worked = lastWorked(m);
                      return (
                        <div key={m.id} id={`cl-row-${m.id}`} role="row" className={`cl-row ${m.status === 'revision' ? 'bad' : ''} ${m.id === openModel ? 'open' : ''}`} onClick={() => setOpenModel(m.id)}>
                          <span className="cl-c-model" role="cell">
                            <button
                              type="button"
                              className="link-btn cl-name"
                              title={[m.name, m.group].filter(Boolean).join(' · ')}
                              onClick={e => {
                                e.stopPropagation();
                                setOpenModel(m.id);
                              }}
                            >
                              {m.starred && <Icon name="star" size={13} weight="fill" />}
                              <span className="ellipsis">{m.name}</span>
                            </button>
                            <small className="cl-sub">
                              {m.code && <span>{m.code}</span>}
                              {m.group && <span>{m.group}</span>}
                              <span className="cl-upd-inline">{when(worked ?? m.updatedAt, now)}</span>
                              {flag && (
                                <span className={`flag ${flag}`} title={why(m, flag)}>
                                  <Icon name="flag" weight="fill" size={11} />
                                  {PRIORITY_LABEL[flag]}
                                </span>
                              )}
                            </small>
                          </span>
                          <span className="cl-c-st" role="cell">
                            <StatusPicker status={m.status} company={company} onPick={s => set([m.id], s)} />
                          </span>
                          <span className="cl-c-upd" role="cell" title={worked ? `Status changed ${fmtDate(worked, true)}` : `Added ${fmtDate(m.createdAt, true)}`}>
                            {when(worked ?? m.updatedAt, now)}
                          </span>
                          <span className="cl-c-act" role="cell" onClick={e => e.stopPropagation()}>
                            {act && (
                              <button type="button" className="mini" onClick={() => set([m.id], act.to)} aria-label={`${act.label}: ${m.name}`}>
                                {act.label}
                              </button>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <p className="cl-foot muted small">
                {open} open · {counts.review ?? 0} {statusLabel('review', company).toLowerCase()} · {all.length} in all
              </p>
            </>
          )}
        </section>

        <aside className="panel cl-side" aria-label="Job details and files">
          <JobDetails state={state} company={company} now={now} bare />
          <AssetsPanel state={state} company={company} bare />
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
