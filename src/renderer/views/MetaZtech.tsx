import { useEffect, useMemo, useState } from 'react';
import type { AppState, Complexity, Model, ModelStatus } from '../../shared/types';
import { COMPANY_STATUSES, COMPLEXITY_LABELS, isOpen, lastWorked, statusLabel } from '../../shared/status';
import { formatMoney, ordinal, tierFee } from '../../shared/money';
import { modelLabel } from '../../shared/planner';
import { hub } from '../hub';
import { ClientTile, Empty, Icon, Modal, StatusPicker, fmtDate, useApp } from '../ui';
import { modelPriority, PRIORITY_LABEL, PRIORITY_ORDER, type Priority } from '../priority';
import { AddModel, ModelDrawer } from './Models';
import { PortalImport } from './PortalImport';
import { DailyTarget, FeeTiers, FromTeams, MzPop, when } from './MetaZtechParts';
import { JobDrawer } from './JobDetails';
import './MetaZtech.css';

type Sort = 'queue' | 'status' | 'updated' | 'name';
type Tab = ModelStatus | 'all' | 'open';
const STATUSES = COMPANY_STATUSES.metaztech;
const SORTS: [Sort, string][] = [
  ['queue', 'Work order'],
  ['status', 'By status'],
  ['updated', 'Recently changed'],
  ['name', 'Name'],
];
/** The row's one-click next step; anything else opens the model. */
const ACTION: Partial<Record<ModelStatus, { to: ModelStatus; label: string }>> = {
  revision: { to: 'in_progress', label: 'Fix now' },
  in_progress: { to: 'review', label: 'Submit' },
  todo: { to: 'in_progress', label: 'Start' },
};
const CX_SHORT: Record<Complexity, string> = { simple: 'Simple', complex: 'Complex', super: 'Super Complex', super1: 'Super Complex-1', super2: 'Super Complex-2+' };
const RANK: Partial<Record<ModelStatus, number>> = { revision: 0, in_progress: 1, todo: 2, review: 3, done: 4 };
const touched = (m: Model) => lastWorked(m) ?? m.updatedAt;

export function MetaZtech({ state, openId, now }: { state: AppState; openId?: string; now: Date }) {
  const { toast } = useApp();
  const cfg = state.companies.find(c => c.id === 'metaztech')!;
  const all = useMemo(() => state.models.filter(m => m.company === 'metaztech'), [state.models]);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [project, setProject] = useState('all');
  const [starred, setStarred] = useState(false);
  const [sort, setSort] = useState<Sort>('queue');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openModel, setOpenModel] = useState<string | undefined>(openId);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState<'pull' | 'paste' | null>(null);
  const [brief, setBrief] = useState(false);
  const [job, setJob] = useState(false);

  useEffect(() => {
    setOpenModel(openId);
    if (!openId) return;
    setTab('all');
    requestAnimationFrame(() => document.getElementById(`mz-row-${openId}`)?.scrollIntoView({ block: 'center' }));
  }, [openId]);

  const projects = useMemo(() => [...new Set(all.map(m => m.group).filter(Boolean))].sort() as string[], [all]);
  const q = query.toLowerCase().trim();
  // Everything but the status tab, so each tab's count is what clicking it shows.
  const matching = useMemo(
    () =>
      all.filter(
        m =>
          (project === 'all' || m.group === project) &&
          (!starred || m.starred) &&
          (!q || `${m.name} ${m.code ?? ''} ${m.group ?? ''} ${m.brand ?? ''} ${m.notes ?? ''} ${(m.subcategories ?? []).join(' ')}`.toLowerCase().includes(q)),
      ),
    [all, project, starred, q],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: matching.length, open: 0 };
    for (const m of matching) {
      c[m.status] = (c[m.status] ?? 0) + 1;
      if (isOpen(m.status)) c.open++;
    }
    return c;
  }, [matching]);
  const prio = useMemo(() => new Map<string, Priority>(all.map(m => [m.id, modelPriority(m, state, now)])), [all, state, now]);
  const shown = useMemo(() => {
    const list = matching.filter(m => tab === 'all' || (tab === 'open' ? isOpen(m.status) : m.status === tab));
    if (sort === 'name') return list.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'updated') return list.sort((a, b) => touched(b).localeCompare(touched(a)));
    if (sort === 'status') return list.sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || touched(b).localeCompare(touched(a)));
    // Work order: starred, then the worked-out priority (rejections and due dates first), then the workflow step.
    const p = (m: Model) => PRIORITY_ORDER.indexOf(prio.get(m.id) ?? 'low');
    return list.sort(
      (a, b) =>
        Number(!!b.starred) - Number(!!a.starred) ||
        p(a) - p(b) ||
        (RANK[a.status] ?? 5) - (RANK[b.status] ?? 5) ||
        (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
        touched(b).localeCompare(touched(a)),
    );
  }, [matching, tab, sort, prio]);

  const filtered = tab === 'open' || project !== 'all' || starred;
  const picked = shown.filter(m => selected.has(m.id)).map(m => m.id);
  const allPicked = shown.length > 0 && picked.length === shown.length;
  const current = openModel ? all.find(m => m.id === openModel) : undefined;
  const pay = cfg.pay.kind === 'tiered' ? cfg.pay : undefined;
  const fees = pay ? Object.values(pay.tiers) : [];

  const set = async (ids: string[], to: ModelStatus, note?: string) => {
    await hub.setStatus(ids, to, note);
    const one = ids.length === 1 && all.find(m => m.id === ids[0]);
    toast(`${one ? modelLabel(one) : `${ids.length} models`} → ${statusLabel(to, 'metaztech')}`);
  };
  const toggle = (id: string) =>
    setSelected(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const exportNow = async () => {
    const r = await hub.exportExcel('metaztech');
    if (r.path) toast(`Saved ${r.path}`);
    else if (r.error) toast(r.error, 'error');
  };
  const clearFilters = () => {
    if (tab === 'open') setTab('all');
    setProject('all');
    setStarred(false);
  };

  return (
    <div className="page mz-page c-metaztech">
      <header className="mz-head">
        <span className="client-tile c-fill" aria-hidden="true">
          <Icon name="cubeFocus" size={30} weight="fill" />
        </span>
        <div className="mz-title">
          <h1>{cfg.name}</h1>
          <div className="mz-chips">
            <span className="mz-chip">{cfg.role}</span>
            {pay && (
              <>
                <span className="mz-chip c-soft">
                  {formatMoney(Math.min(...fees), cfg.currency)}–{formatMoney(Math.max(...fees), cfg.currency)} per approved model
                </span>
                <span className="mz-chip">{pay.tdsPercent}% TDS</span>
                <span className="mz-chip">
                  Paid {ordinal(pay.payoutFrom)}–{ordinal(pay.payoutTo)} monthly
                </span>
              </>
            )}
            <button type="button" className="mz-chip mz-chip-btn" onClick={() => setJob(true)}>
              <Icon name="calendar" size={13} /> Job details
            </button>
          </div>
        </div>
        <div className="mz-actions">
          <MzPop label="Add model, export, links and brief" icon={<Icon name="dots" size={22} />} className="mz-ibtn lg">
            {close => (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    setAdding(true);
                  }}
                >
                  <Icon name="plus" size={15} />
                  <span className="grow">Add model</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    void exportNow();
                  }}
                >
                  <Icon name="excel" size={15} />
                  <span className="grow">Export Excel</span>
                </button>
                <hr />
                {cfg.links.map(l => (
                  <button
                    key={l.url}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      hub.openUrl(l.url);
                    }}
                  >
                    <Icon name="link" size={15} />
                    <span className="grow">{l.label}</span>
                    <Icon name="external" size={13} />
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    setBrief(true);
                  }}
                >
                  <Icon name="info" size={15} />
                  <span className="grow">Brief & pay terms</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    setJob(true);
                  }}
                >
                  <Icon name="calendar" size={15} />
                  <span className="grow">Job details & files</span>
                </button>
              </>
            )}
          </MzPop>
          <button type="button" className="lg" onClick={() => hub.portalOpen()}>
            <Icon name="external" size={18} /> Open CMS
          </button>
          <button type="button" className="lg" onClick={() => setImporting('paste')}>
            <Icon name="clipboard" size={18} /> Paste a table
          </button>
          <button type="button" className="lg primary" onClick={() => setImporting('pull')}>
            <Icon name="cloudDown" size={18} /> Pull from portal
          </button>
        </div>
      </header>

      <div className="mz-bar">
        <div className="tabs mz-tabs" role="group" aria-label="Status">
          {(['all', ...STATUSES] as const).map(s => (
            <button key={s} type="button" className={`tab ${s === 'revision' && counts[s] ? 'bad' : ''} ${tab === s ? 'on' : ''}`} aria-pressed={tab === s} onClick={() => setTab(s)}>
              {s === 'all' ? 'All' : statusLabel(s, 'metaztech')}
              <span className="n">{counts[s] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="mz-tools">
          <label className="mz-search">
            <Icon name="search" size={16} />
            <span className="sr-only">Search models</span>
            <input type="search" placeholder="Name, job ID or project" value={query} onChange={e => setQuery(e.target.value)} />
          </label>
          <MzPop label="Filter and sort" kind="dialog" icon={<Icon name="funnel" size={18} />} dot={filtered || sort !== 'queue'}>
            {() => (
              <>
                <div className="mz-fgrid">
                  {projects.length > 1 && (
                    <label className="field">
                      <span>Project</span>
                      <select value={project} onChange={e => setProject(e.target.value)}>
                        <option value="all">All projects</option>
                        {projects.map(p => (
                          <option key={p}>{p}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="field">
                    <span>Sort</span>
                    <select value={sort} onChange={e => setSort(e.target.value as Sort)}>
                      {SORTS.map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="chips">
                  <button type="button" className={`chip ${tab === 'open' ? 'on' : ''}`} aria-pressed={tab === 'open'} onClick={() => setTab(tab === 'open' ? 'all' : 'open')}>
                    Open work only <span className="n">{counts.open}</span>
                  </button>
                  <button type="button" className={`chip ${starred ? 'on' : ''}`} aria-pressed={starred} onClick={() => setStarred(!starred)}>
                    <Icon name="star" size={13} weight={starred ? 'fill' : 'regular'} /> Only starred
                  </button>
                </div>
                <div className="row end">
                  <button type="button" className="ghost mini" onClick={clearFilters} disabled={!filtered}>
                    Clear filters
                  </button>
                </div>
              </>
            )}
          </MzPop>
          <button
            type="button"
            className={`mz-tool ${selecting ? 'on' : ''}`}
            aria-pressed={selecting}
            onClick={() => {
              setSelecting(!selecting);
              setSelected(new Set());
            }}
          >
            {selecting ? (
              <>
                Done<span className="sr-only"> selecting</span>
              </>
            ) : (
              'Select'
            )}
          </button>
          <button type="button" className="mz-ibtn" aria-label="Add model" title="Add model" onClick={() => setAdding(true)}>
            <Icon name="plus" size={18} />
          </button>
        </div>
      </div>

      <div className="mz-grid">
        <section className="panel mz-list" aria-label="Models">
          {filtered && (
            <div className="chips mz-active">
              {tab === 'open' && (
                <button type="button" className="chip on" onClick={() => setTab('all')} aria-label="Remove filter Open work">
                  Open work <Icon name="close" size={12} />
                </button>
              )}
              {project !== 'all' && (
                <button type="button" className="chip on" onClick={() => setProject('all')} aria-label={`Remove filter ${project}`}>
                  {project} <Icon name="close" size={12} />
                </button>
              )}
              {starred && (
                <button type="button" className="chip on" onClick={() => setStarred(false)} aria-label="Remove filter starred">
                  Starred <Icon name="close" size={12} />
                </button>
              )}
              <span className="muted small">{shown.length} shown</span>
            </div>
          )}

          {selecting && (
            <div className="mz-bulk">
              <label className="row gap">
                <input type="checkbox" checked={allPicked} onChange={e => setSelected(e.target.checked ? new Set(shown.map(m => m.id)) : new Set())} aria-label="Select all shown" />
                <strong>{picked.length} selected</strong>
              </label>
              <span className="muted small">Set status</span>
              {STATUSES.map(s => (
                <button
                  key={s}
                  type="button"
                  className={`pill st-${s} mz-pill`}
                  disabled={!picked.length}
                  onClick={async () => {
                    await set(picked, s);
                    setSelected(new Set());
                  }}
                >
                  {statusLabel(s, 'metaztech')}
                </button>
              ))}
            </div>
          )}

          {all.length === 0 ? (
            <Empty title="No MetaZtech models yet">
              <p>
                Click <strong>Open CMS</strong>, log in once and open the page that lists your assigned models, then click <strong>Pull from portal</strong>. You can also copy the table from the portal and use{' '}
                <strong>Paste a table</strong>, or add a model by hand.
              </p>
              <div className="row gap wrap mz-empty-acts">
                <button type="button" className="mini primary" onClick={() => setImporting('pull')}>
                  Pull from portal
                </button>
                <button type="button" className="mini" onClick={() => setImporting('paste')}>
                  Paste a table
                </button>
                <button type="button" className="mini" onClick={() => setAdding(true)}>
                  Add model
                </button>
              </div>
            </Empty>
          ) : shown.length === 0 ? (
            <Empty title="Nothing matches">
              {filtered || q ? 'Change the search or filters, or pick another tab.' : `No models are ${tab === 'all' ? 'here' : statusLabel(tab as ModelStatus, 'metaztech').toLowerCase()} right now.`}
              {filtered && (
                <div>
                  <button type="button" className="mini" onClick={clearFilters}>
                    Clear filters
                  </button>
                </div>
              )}
            </Empty>
          ) : (
            <div className={`table-wrap mz-table ${selecting ? 'selecting' : ''}`} role="table" aria-label="MetaZtech models" aria-rowcount={shown.length + 1}>
              <div className="mz-row mz-th" role="row">
                {selecting && (
                  <span className="mz-c-chk" role="columnheader">
                    <span className="sr-only">Selected</span>
                  </span>
                )}
                <span className="mz-c-id" role="columnheader">
                  ID
                </span>
                <span className="mz-c-model" role="columnheader">
                  Model
                </span>
                <span className="mz-c-cx" role="columnheader">
                  Complexity
                </span>
                <span className="mz-c-st" role="columnheader">
                  Status
                </span>
                <span className="mz-c-rej" role="columnheader">
                  Rejections
                </span>
                <span className="mz-c-fee" role="columnheader">
                  Fee
                </span>
                <span className="mz-c-upd" role="columnheader">
                  Updated
                </span>
                <span className="mz-c-act" role="columnheader">
                  <span className="sr-only">Next step</span>
                </span>
              </div>
              <div role="rowgroup">
                {shown.map(m => {
                  const act = ACTION[m.status];
                  const worked = lastWorked(m);
                  const p = prio.get(m.id);
                  // Rejections and in-progress work already stand out; only due dates raise a flag in the list.
                  const flag = m.dueDate && (p === 'urgent' || p === 'high') ? p : undefined;
                  const fee = m.complexity ? formatMoney(tierFee(cfg, m.complexity), cfg.currency) : undefined;
                  return (
                    <div
                      key={m.id}
                      id={`mz-row-${m.id}`}
                      role="row"
                      className={`mz-row ${m.status === 'revision' ? 'bad' : ''} ${selected.has(m.id) ? 'checked' : ''} ${m.id === openModel ? 'open' : ''}`}
                      onClick={() => setOpenModel(m.id)}
                    >
                      {selecting && (
                        <span className="mz-c-chk" role="cell" onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} aria-label={`Select ${m.name}`} />
                        </span>
                      )}
                      <span className="mz-c-id" role="cell">
                        {m.code ?? '—'}
                      </span>
                      <span className="mz-c-model" role="cell">
                        <ClientTile client="metaztech" size="sm" />
                        <span className="mz-name">
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
                            {m.code && <span className="mz-code">{m.code}</span>}
                            <span className="mz-upd-inline">{when(worked ?? m.updatedAt, now)}</span>
                            {!!m.revisions && <span className="mz-rej-inline">Rejected {m.revisions}×</span>}
                            {flag && (
                              <span className={`flag ${flag}`} title={`Due ${fmtDate(m.dueDate)}`}>
                                <Icon name="flag" weight="fill" size={12} />
                                {PRIORITY_LABEL[flag]}
                              </span>
                            )}
                          </small>
                        </span>
                      </span>
                      <span className="mz-c-cx" role="cell" onClick={e => e.stopPropagation()}>
                        {/* Always a select, so an upgraded complexity is one click to fix; a set value reads as text until hovered. */}
                        <select
                          className={`mz-cx ${m.complexity ? 'set' : ''}`}
                          aria-label={`Complexity of ${m.name}`}
                          title={m.complexity ? COMPLEXITY_LABELS[m.complexity] : undefined}
                          value={m.complexity ?? ''}
                          onChange={e => e.target.value && hub.patchModel(m.id, { complexity: e.target.value as Complexity })}
                        >
                          {!m.complexity && <option value="">Set…</option>}
                          {(Object.keys(CX_SHORT) as Complexity[]).map(k => (
                            <option key={k} value={k}>
                              {CX_SHORT[k]}
                            </option>
                          ))}
                        </select>
                        {fee && <small className="mz-fee-inline">{fee}</small>}
                      </span>
                      <span className="mz-c-st" role="cell">
                        <StatusPicker status={m.status} company="metaztech" onPick={s => set([m.id], s)} />
                      </span>
                      <span className={`mz-c-rej ${m.revisions ? 'has' : ''}`} role="cell">
                        {m.revisions ? `${m.revisions}×` : '—'}
                        {!!m.revisions && <span className="sr-only"> rejected</span>}
                      </span>
                      <span className="mz-c-fee tabular" role="cell">
                        {fee ?? '–'}
                      </span>
                      <span className="mz-c-upd" role="cell" title={worked ? `Status changed ${fmtDate(worked, true)}` : `No status change since it was added (${fmtDate(m.updatedAt, true)})`}>
                        {when(worked ?? m.updatedAt, now)}
                      </span>
                      <span className="mz-c-act" role="cell" onClick={e => e.stopPropagation()}>
                        {act ? (
                          <button type="button" className={`mz-act ${m.status === 'revision' ? 'ink' : ''}`} onClick={() => set([m.id], act.to)} aria-label={`${act.label}: ${m.name}`}>
                            {act.label}
                          </button>
                        ) : (
                          <button type="button" className="mz-act" onClick={() => setOpenModel(m.id)} aria-label={`View ${m.name}`}>
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
        </section>

        <aside className="mz-side" aria-label="Today and the team">
          <DailyTarget state={state} now={now} />
          <FromTeams state={state} cfg={cfg} now={now} />
          <FeeTiers
            cfg={cfg}
            all={all}
            onShowApproved={() => {
              setTab('done');
              setSort('queue');
            }}
          />
        </aside>
      </div>

      {current && <ModelDrawer model={current} state={state} onClose={() => setOpenModel(undefined)} />}
      {job && <JobDrawer state={state} company="metaztech" now={now} onClose={() => setJob(false)} />}
      {adding && <AddModel company="metaztech" groups={projects} onClose={() => setAdding(false)} />}
      {importing && <PortalImport state={state} mode={importing} onClose={() => setImporting(null)} />}
      {brief && (
        <Modal title="Brief & pay terms" onClose={() => setBrief(false)}>
          <p className="mz-brief">{cfg.notes}</p>
          <div className="row gap wrap">
            {cfg.links.map(l => (
              <button key={l.url} type="button" className="mini" onClick={() => hub.openUrl(l.url)}>
                {l.label} <Icon name="external" size={12} />
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
