import { useEffect, useMemo, useState } from 'react';
import type { AppState, Complexity, Model, ModelStatus } from '../../shared/types';
import { COMPANY_STATUSES, COMPLEXITY_LABELS, isOpen, lastWorked, statusLabel } from '../../shared/status';
import { formatMoney, ordinal, tierFee } from '../../shared/money';
import { modelLabel } from '../../shared/planner';
import { hub } from '../hub';
import { Dropdown, Empty, Icon, MenuButton, MenuCheck, Modal, PageHead, StatusPicker, fmtDate, useApp, type Choice, type IconName } from '../ui';
import { modelPriority, PRIORITY_LABEL, PRIORITY_ORDER, type Priority } from '../priority';
import { AddModel, ModelDrawer, nextStep } from './Models';
import { PortalImport } from './PortalImport';
import { DailyTarget, FeeTiers, MenuRadio, when } from './MetaZtechParts';
import { JobDrawer } from './JobDetails';
import { clientFolder, withFolder } from '../../shared/assets';
import { sppMessage } from '../../shared/outputs';
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
const CX_SHORT: Record<Complexity, string> = { simple: 'Simple', complex: 'Complex', super: 'Super Complex', super1: 'Super Complex-1', super2: 'Super Complex-2+' };
const RANK: Partial<Record<ModelStatus, number>> = { revision: 0, in_progress: 1, todo: 2, review: 3, done: 4 };
const touched = (m: Model) => lastWorked(m) ?? m.updatedAt;

/** One action in the header's ⋯ menu: closes the menu, then runs. */
function Act({ icon, label, title, external, close, run }: { icon: IconName; label: string; title?: string; external?: boolean; close(): void; run(): void }) {
  return (
    <button
      type="button"
      role="menuitem"
      title={title}
      onClick={() => {
        close();
        run();
      }}
    >
      <Icon name={icon} />
      <span className="grow">{label}</span>
      {external && <Icon name="external" size={13} />}
    </button>
  );
}

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

  const root = clientFolder(state, 'metaztech');
  // Jobs approved since the last look: their job folder holds a .spp and they've left the dashboard.
  const checkFolder = async (quiet: boolean) => {
    const r = await hub.checkSppFolders();
    if ('error' in r) return quiet || toast(r.error, 'error');
    const text = sppMessage(r);
    if (text && !(quiet && r.needsPull)) toast(text);
    else if (!quiet) toast(`Output folder checked: nothing new${r.onDashboard ? ` (${r.onDashboard} with a .spp still on the dashboard)` : ''}.`);
  };
  useEffect(() => {
    if (root && state.settings.portalLastPull) void checkFolder(true);
  }, [root]);
  const changeRoot = async () => {
    const p = await hub.pickFolder(root || undefined);
    if (!p) return;
    await hub.upsert('companies', { ...withFolder(cfg, p) });
    toast(`MetaZtech output folder: ${p}`);
  };

  useEffect(() => {
    setOpenModel(openId);
    if (!openId) return;
    setTab('all');
    requestAnimationFrame(() => document.getElementById(`mz-row-${openId}`)?.scrollIntoView({ block: 'center' }));
  }, [openId]);

  const projects = useMemo(() => [...new Set(all.map(m => m.group).filter(Boolean))].sort() as string[], [all]);
  const q = query.toLowerCase().trim();
  // Everything but the status, so each status's count is what picking it shows.
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

  const filtered = project !== 'all' || starred;
  const changed = [project !== 'all', starred, sort !== 'queue'].filter(Boolean).length;
  const tabs: Choice<Tab>[] = (['all', 'open', ...STATUSES] as const).map(s => ({
    value: s,
    label: s === 'all' ? 'All' : s === 'open' ? 'Open work' : statusLabel(s, 'metaztech'),
    tone: s === 'all' || s === 'open' ? undefined : `st-${s}`,
    count: counts[s] ?? 0,
  }));
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
    setProject('all');
    setStarred(false);
  };

  return (
    <div className="page mz-page c-metaztech">
      <PageHead
        title={cfg.name}
        icon="cubeFocus"
        meta={
          <>
            {cfg.role && <span>{cfg.role}</span>}
            {pay && (
              <>
                <span>
                  {formatMoney(Math.min(...fees), cfg.currency)}–{formatMoney(Math.max(...fees), cfg.currency)} per approved model
                </span>
                <span>{pay.tdsPercent}% TDS</span>
                <span>
                  Paid {ordinal(pay.payoutFrom)}–{ordinal(pay.payoutTo)} monthly
                </span>
              </>
            )}
            <span>
              <button type="button" className="link-btn" onClick={() => setJob(true)}>
                Job details
              </button>
            </span>
          </>
        }
      >
        <MenuButton label="More actions" icon="dots">
          {close => (
            <>
              <Act icon="external" label="Open CMS" title="Opens the portal window that Pull from portal reads; log in there once" close={close} run={() => hub.portalOpen()} />
              <Act icon="clipboard" label="Paste a table" title="Import a table copied from the portal or a sheet" close={close} run={() => setImporting('paste')} />
              <Act icon="excel" label="Export to Excel" close={close} run={() => void exportNow()} />
              <hr />
              {cfg.links.map(l => (
                <Act key={l.url} icon="link" label={l.label} external close={close} run={() => hub.openUrl(l.url)} />
              ))}
              <Act icon="info" label="Brief & pay terms" close={close} run={() => setBrief(true)} />
              <hr />
              {root && (
                <Act
                  icon="sync"
                  label="Check output folder"
                  title="Approved jobs leave the dashboard; a job folder with a .spp file that is no longer on it counts as approved"
                  close={close}
                  run={() => void checkFolder(false)}
                />
              )}
              {root && <Act icon="folderOpen" label="Open output folder" title={root} close={close} run={() => hub.openPath(root)} />}
              <Act
                icon="folder"
                label={root ? 'Change output folder' : 'Choose output folder'}
                title="Each job's folder, named starting with its job ID, holding the .spp"
                close={close}
                run={() => void changeRoot()}
              />
            </>
          )}
        </MenuButton>
        <button type="button" className="primary" onClick={() => setImporting('pull')}>
          <Icon name="cloudDown" /> Pull from portal
        </button>
      </PageHead>

      <div className="mz-grid">
        <section className="panel mz-list" aria-label="Models">
          {all.length > 0 && (
            <div className="mz-tools">
              <Dropdown label="Status" prefix="Status" value={tab} options={tabs} onChange={v => setTab(v)} />
              <label className="mz-search">
                <Icon name="search" />
                <span className="sr-only">Search models</span>
                <input type="search" placeholder="Name, job ID or project" value={query} onChange={e => setQuery(e.target.value)} />
              </label>
              <MenuButton label="Filter and sort" icon="funnel" text={<span className="mz-filter-text">Filter</span>} badge={changed}>
                {close => (
                  <>
                    {projects.length > 1 && (
                      <>
                        <h4 className="menu-sec">Project</h4>
                        {['all', ...projects].map(p => (
                          <MenuRadio key={p} label={p === 'all' ? 'All projects' : p} checked={project === p} onPick={() => setProject(p)} />
                        ))}
                        <hr />
                      </>
                    )}
                    <h4 className="menu-sec">Sort</h4>
                    {SORTS.map(([k, v]) => (
                      <MenuRadio key={k} label={v} checked={sort === k} onPick={() => setSort(k)} />
                    ))}
                    <hr />
                    <MenuCheck label="Only starred" checked={starred} onChange={setStarred} />
                    {changed > 0 && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          close();
                          clearFilters();
                          setSort('queue');
                        }}
                      >
                        <Icon name="close" />
                        <span className="grow">Reset filters and sort</span>
                      </button>
                    )}
                  </>
                )}
              </MenuButton>
              <button
                type="button"
                className={`mz-select ${selecting ? 'on' : ''}`}
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
              <button type="button" className="icon-btn" aria-label="Add model" title="Add model" onClick={() => setAdding(true)}>
                <Icon name="plus" />
              </button>
            </div>
          )}

          {filtered && (
            <div className="chips mz-active">
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
                {picked.length} selected
              </label>
              <fieldset className="mz-bulk-acts" disabled={!picked.length} aria-label="Change the selected models">
                <MenuButton label="Set status of the selected models" text="Set status" className="select-btn mini" align="start">
                  {close =>
                    STATUSES.map(s => (
                      <button
                        key={s}
                        type="button"
                        role="menuitem"
                        onClick={async () => {
                          close();
                          await set(picked, s);
                          setSelected(new Set());
                        }}
                      >
                        <span className={`dot st-${s}`} />
                        {statusLabel(s, 'metaztech')}
                      </button>
                    ))
                  }
                </MenuButton>
              </fieldset>
            </div>
          )}

          {all.length === 0 ? (
            <Empty title="No MetaZtech models yet">
              <p>
                Log in once in the CMS window, open the page that lists your assigned models, then click <strong>Pull from portal</strong>. You can also paste a table copied
                from the portal, or add a model by hand.
              </p>
              <div className="row gap wrap mz-empty-acts">
                <button type="button" className="mini" onClick={() => hub.portalOpen()}>
                  Open CMS
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
              {filtered || q
                ? 'Change the search, status or filters.'
                : `No models are ${tab === 'open' ? 'open' : statusLabel(tab as ModelStatus, 'metaztech').toLowerCase()} right now.`}
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
                <span className="mz-c-model" role="columnheader">
                  Model
                </span>
                <span className="mz-c-cx" role="columnheader">
                  Complexity
                </span>
                <span className="mz-c-fee" role="columnheader">
                  Fee
                </span>
                <span className="mz-c-st" role="columnheader">
                  Status
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
                  const act = nextStep(m);
                  const worked = lastWorked(m);
                  const p = prio.get(m.id);
                  // Rejections and in-progress work already stand out; only due dates raise a flag in the list.
                  const flag = m.dueDate && (p === 'urgent' || p === 'high') ? p : undefined;
                  const fee = m.complexity ? formatMoney(tierFee(cfg, m.complexity), cfg.currency) : undefined;
                  const updated = when(worked ?? m.updatedAt, now);
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
                      <span className="mz-c-model" role="cell">
                        <button
                          type="button"
                          className="link-btn mz-name"
                          title={[m.name, m.group].filter(Boolean).join(' · ')}
                          onClick={e => {
                            e.stopPropagation();
                            setOpenModel(m.id);
                          }}
                        >
                          {m.starred && <Icon name="star" size={12} weight="fill" />}
                          <span className="ellipsis">{m.name}</span>
                        </button>
                        <small className="mz-sub">
                          {m.code && <span>{m.code}</span>}
                          {!!m.revisions && <span className="mz-rej">Rejected {m.revisions}×</span>}
                          {flag && (
                            <span className={`flag ${flag}`} title={`Due ${fmtDate(m.dueDate)}`}>
                              <Icon name="flag" weight="fill" size={11} />
                              {PRIORITY_LABEL[flag]}
                            </span>
                          )}
                          <span className="mz-upd-inline">{updated}</span>
                        </small>
                      </span>
                      <span className="mz-c-cx" role="cell" onClick={e => e.stopPropagation()}>
                        {/* Always a select, so an upgraded complexity is one click to fix; a set value reads as text until hovered. */}
                        <select
                          className={`mz-cx ${m.complexity ? 'set' : ''}`}
                          aria-label={`Complexity of ${m.name}`}
                          title={m.complexity ? COMPLEXITY_LABELS[m.complexity] : 'Sets the fee'}
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
                      <span className="mz-c-fee tabular" role="cell">
                        {fee ?? '–'}
                      </span>
                      <span className="mz-c-st" role="cell">
                        <StatusPicker status={m.status} company="metaztech" onPick={s => set([m.id], s)} />
                      </span>
                      <span className="mz-c-upd" role="cell" title={worked ? `Status changed ${fmtDate(worked, true)}` : `No status change since it was added (${fmtDate(m.updatedAt, true)})`}>
                        {updated}
                      </span>
                      <span className="mz-c-act" role="cell" onClick={e => e.stopPropagation()}>
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
        </section>

        <aside className="panel mz-side" aria-label="Target and fees">
          <DailyTarget state={state} now={now} />
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
