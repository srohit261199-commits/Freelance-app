import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppState, Complexity, Model, ModelStatus, StatusEvent } from '../../shared/types';
import { statusesFor, COMPLEXITY_LABELS, isComplete, isOpen, lastWorked, statusEvents, statusLabel } from '../../shared/status';
import { formatMoney, tierFee } from '../../shared/money';
import { modelLabel, waveinkQueue } from '../../shared/planner';
import { hub } from '../hub';
import { ConfirmButton, Drawer, Empty, Field, Icon, Modal, Progress, StatusPicker, Thumb, fmtDate, relTime, useApp } from '../ui';
import { PortalImport } from './PortalImport';

type Sort = 'queue' | 'name' | 'updated' | 'status';
export const NEXT: Partial<Record<ModelStatus, { to: ModelStatus; label: string }>> = {
  todo: { to: 'in_progress', label: 'Start' },
  in_progress: { to: 'review', label: 'Submit' },
  revision: { to: 'review', label: 'Resubmit' },
  review: { to: 'done', label: 'Approve' },
};

export function Models({ state, company, openId, now }: { state: AppState; company: 'waveink' | 'metaztech'; openId?: string; now: Date }) {
  const { toast } = useApp();
  const cfg = state.companies.find(c => c.id === company)!;
  const all = useMemo(() => state.models.filter(m => m.company === company), [state.models, company]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ModelStatus | 'all' | 'open'>('all');
  const [group, setGroup] = useState('all');
  const [sub, setSub] = useState('all');
  const [starred, setStarred] = useState(false);
  const [sort, setSort] = useState<Sort>('queue');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openModel, setOpenModel] = useState<string | undefined>(openId);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState<'pull' | 'paste' | null>(null);
  const [showNotes, setShowNotes] = useState(false);

  useEffect(() => setOpenModel(openId), [openId]);

  const groups = [...new Set(all.map(m => m.group).filter(Boolean))] as string[];
  const subs = [...new Set(all.filter(m => group === 'all' || m.group === group).flatMap(m => m.subcategories ?? []))].sort();
  // Everything but the status filter, so each chip's count is what clicking it shows.
  const matching = useMemo(() => {
    const q = query.toLowerCase().trim();
    return all.filter(
      m =>
        (group === 'all' || m.group === group) &&
        (sub === 'all' || m.subcategories?.includes(sub)) &&
        (!starred || m.starred) &&
        (!q || `${m.name} ${m.code ?? ''} ${m.brand ?? ''} ${m.notes ?? ''} ${(m.subcategories ?? []).join(' ')}`.toLowerCase().includes(q)),
    );
  }, [all, query, group, sub, starred]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: matching.length, open: 0 };
    for (const m of matching) {
      c[m.status] = (c[m.status] ?? 0) + 1;
      if (isOpen(m.status)) c.open++;
    }
    return c;
  }, [matching]);

  const shown = useMemo(() => {
    let list = matching.filter(m => status === 'all' || (status === 'open' ? isOpen(m.status) : m.status === status));
    const order = statusesFor(company);
    if (sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'updated') list = [...list].sort((a, b) => (lastWorked(b) ?? '').localeCompare(lastWorked(a) ?? ''));
    else if (sort === 'status') list = [...list].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
    else {
      // Work order: revisions and in-progress first, then the to-do queue, then everything else.
      const queue = company === 'waveink' ? waveinkQueue(all).map(m => m.id) : all.filter(m => m.status === 'todo').map(m => m.id);
      const rank = (m: Model) =>
        m.status === 'revision' ? 0 : m.status === 'in_progress' ? 1 : m.status === 'todo' ? 2 + queue.indexOf(m.id) / 1e4 : m.status === 'review' ? 3 : 4;
      list = [...list].sort((a, b) => Number(!!b.starred) - Number(!!a.starred) || rank(a) - rank(b) || Math.min(...(a.rows ?? [1e6])) - Math.min(...(b.rows ?? [1e6])));
    }
    return list;
  }, [all, matching, status, sort, company]);

  const done = all.filter(m => isComplete(m.status)).length;
  const total = all.filter(m => m.status !== 'skipped').length;
  const driveWaiting = all.filter(m => m.driveFileUrl && (m.status === 'todo' || m.status === 'in_progress'));
  const current = openModel ? all.find(m => m.id === openModel) : undefined;
  const picked = shown.filter(m => selected.has(m.id)).map(m => m.id);
  const unpriced = all.filter(m => isComplete(m.status) && !m.complexity).length;

  const set = async (ids: string[], to: ModelStatus, note?: string) => {
    await hub.setStatus(ids, to, note);
    const one = ids.length === 1 && all.find(m => m.id === ids[0]);
    toast(`${one ? modelLabel(one) : `${ids.length} models`} → ${statusLabel(to, company)}`);
  };
  const toggle = (id: string) =>
    setSelected(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const exportNow = async () => {
    const r = await hub.exportExcel(company);
    if (r.path) toast(`Saved ${r.path}`);
    else if (r.error) toast(r.error, 'error');
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>
            <span className="cdot big" style={{ background: cfg.color }} /> {cfg.name}
          </h1>
          <p className="muted">
            {cfg.role} · {done}/{total} done
            {company === 'metaztech' && cfg.pay.kind === 'tiered' && ` · ${formatMoney(all.filter(m => isComplete(m.status)).reduce((s, m) => s + tierFee(cfg, m.complexity), 0), 'INR')} approved work`}
          </p>
          {company === 'metaztech' && unpriced > 0 && (
            <p className="muted small">
              {unpriced} approved model{unpriced > 1 ? 's have' : ' has'} no complexity and {unpriced > 1 ? 'are' : 'is'} counted at the {formatMoney(tierFee(cfg, undefined), 'INR')} tier.
            </p>
          )}
          <Progress value={done} total={total} color={cfg.color} />
        </div>
        <div className="actions wrap">
          {company === 'metaztech' && (
            <>
              <button type="button" onClick={() => hub.portalOpen()}>
                <Icon name="external" /> Open portal
              </button>
              <button type="button" className="primary" onClick={() => setImporting('pull')}>
                <Icon name="download" /> Pull from portal
              </button>
              <button type="button" onClick={() => setImporting('paste')}>
                Paste a table
              </button>
            </>
          )}
          <button type="button" onClick={() => setAdding(true)}>
            <Icon name="plus" /> Add model
          </button>
          <button type="button" className={company === 'waveink' ? 'primary' : ''} onClick={exportNow}>
            <Icon name="download" /> Export Excel
          </button>
        </div>
      </header>

      <div className="link-row-bar">
        {cfg.links.map(l => (
          <button key={l.url} type="button" className="chip-link" onClick={() => hub.openUrl(l.url)}>
            {l.label} <Icon name="external" size={12} />
          </button>
        ))}
        <button type="button" className="chip-link" onClick={() => setShowNotes(!showNotes)}>
          {showNotes ? 'Hide' : 'Show'} brief & pay terms
        </button>
      </div>
      {showNotes && <div className="note-card">{cfg.notes}</div>}

      {company === 'waveink' && driveWaiting.length > 0 && (
        <div className="banner">
          <span>
            <strong>{driveWaiting.length}</strong> GLB{driveWaiting.length > 1 ? 's are' : ' is'} already in the Drive folder but still marked To do / In progress ({driveWaiting.slice(0, 5).map(m => m.code).join(', ')}
            {driveWaiting.length > 5 ? '…' : ''}).
          </span>
          <button type="button" className="mini primary" onClick={() => set(driveWaiting.map(m => m.id), 'review', 'GLB uploaded to Drive')}>
            Mark as Under review
          </button>
        </div>
      )}
      {company === 'metaztech' && all.length === 0 && (
        <div className="banner info">
          <span>
            No MetaZtech models yet. Click <strong>Open portal</strong>, log in once, open the page that lists your assigned models, then click <strong>Pull from portal</strong>. You
            can also copy the table from the portal and use <strong>Paste a table</strong>.
          </span>
        </div>
      )}

      <div className="filters">
        <input className="search" placeholder="Search name, code, brand, notes…" value={query} onChange={e => setQuery(e.target.value)} />
        <div className="chips">
          {(['all', 'open', ...statusesFor(company)] as const).map(s => (
            <button key={s} type="button" className={`chip ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>
              {s === 'all' ? 'All' : s === 'open' ? 'Open' : statusLabel(s, company)}
              <span className="n">{counts[s] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="row gap wrap">
          {groups.length > 1 && (
            <select value={group} onChange={e => (setGroup(e.target.value), setSub('all'))}>
              <option value="all">All groups</option>
              {groups.map(g => (
                <option key={g}>{g}</option>
              ))}
            </select>
          )}
          {subs.length > 0 && (
            <select value={sub} onChange={e => setSub(e.target.value)}>
              <option value="all">All subcategories</option>
              {subs.map(s => (
                <option key={s}>{s}</option>
              ))}
            </select>
          )}
          <select value={sort} onChange={e => setSort(e.target.value as Sort)}>
            <option value="queue">Work order</option>
            <option value="status">By status</option>
            <option value="updated">Recently changed</option>
            <option value="name">Name</option>
          </select>
          <button type="button" className={`chip ${starred ? 'on' : ''}`} onClick={() => setStarred(!starred)} title="Only starred">
            <Icon name="star" size={13} /> Starred
          </button>
        </div>
      </div>

      {picked.length > 0 && (
        <div className="bulk">
          <strong>{picked.length} selected</strong>
          <span className="muted">Set status:</span>
          {statusesFor(company).map(s => (
            <button
              key={s}
              type="button"
              className={`mini pill st-${s}`}
              onClick={async () => {
                await set(picked, s);
                setSelected(new Set());
              }}
            >
              {statusLabel(s, company)}
            </button>
          ))}
          <button type="button" className="ghost mini" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {shown.length === 0 ? (
        <Empty title="Nothing matches">Change the filters or add a model.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="models">
            <thead>
              <tr>
                <th className="w-check">
                  <input
                    type="checkbox"
                    checked={shown.length > 0 && shown.every(m => selected.has(m.id))}
                    onChange={e => setSelected(e.target.checked ? new Set(shown.map(m => m.id)) : new Set())}
                    aria-label="Select all shown"
                  />
                </th>
                {company === 'waveink' && <th className="w-thumb" />}
                <th>Model</th>
                <th>{company === 'waveink' ? 'Subcategory' : 'Project'}</th>
                <th>Status</th>
                {company === 'metaztech' ? (
                  <>
                    <th>Complexity</th>
                    <th className="num">Fee</th>
                    <th className="num">Rejections</th>
                  </>
                ) : (
                  <th>GLB</th>
                )}
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map(m => {
                const next = NEXT[m.status];
                return (
                  <tr key={m.id} className={selected.has(m.id) ? 'sel' : ''} onClick={() => setOpenModel(m.id)}>
                    <td className="w-check" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} aria-label={`Select ${m.name}`} />
                    </td>
                    {company === 'waveink' && (
                      <td className="w-thumb">
                        <Thumb url={m.sourceUrls?.[0]} label={m.group === 'Apparel' ? 'A' : '3D'} />
                      </td>
                    )}
                    <td>
                      <div className="name">
                        <button type="button" className="link-btn" onClick={() => setOpenModel(m.id)}>
                          {m.starred && <Icon name="star" size={12} />} {m.name}
                        </button>
                      </div>
                      <div className="muted small">
                        {[m.code, m.brand, m.colour].filter(Boolean).join(' · ')}
                        {m.revised && <span className="tag">revised</span>}
                        {m.hasPrintArea === false && <span className="tag">no print area</span>}
                      </div>
                    </td>
                    <td className="small">{company === 'waveink' ? (m.subcategories ?? []).join(', ') || m.group : m.group}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <StatusPicker status={m.status} company={company} onPick={s => set([m.id], s)} />
                    </td>
                    {company === 'metaztech' ? (
                      <>
                        <td onClick={e => e.stopPropagation()}>
                          <select
                            className={`cx ${m.complexity ? '' : 'unset'}`}
                            value={m.complexity ?? ''}
                            onChange={e => hub.patchModel(m.id, { complexity: (e.target.value || undefined) as Complexity | undefined })}
                          >
                            <option value="">Set…</option>
                            {Object.entries(COMPLEXITY_LABELS).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="num">{m.complexity ? formatMoney(tierFee(cfg, m.complexity), 'INR') : '–'}</td>
                        <td className="num">{m.revisions || ''}</td>
                      </>
                    ) : (
                      <td className="small">
                        {m.driveFileUrl ? (
                          <button
                            type="button"
                            className="tag ok link"
                            onClick={e => {
                              e.stopPropagation();
                              hub.openUrl(m.driveFileUrl!);
                            }}
                          >
                            on Drive
                          </button>
                        ) : m.percent ? (
                          `${m.percent}%`
                        ) : (
                          ''
                        )}
                      </td>
                    )}
                    <td className="small muted">{lastWorked(m) ? relTime(lastWorked(m)!, now) : ''}</td>
                    <td className="row-actions" onClick={e => e.stopPropagation()}>
                      {next && (
                        <button type="button" className="mini" onClick={() => set([m.id], next.to)}>
                          {next.label}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {current && <ModelDrawer model={current} state={state} onClose={() => setOpenModel(undefined)} />}
      {adding && <AddModel company={company} groups={groups} onClose={() => setAdding(false)} />}
      {importing && <PortalImport state={state} mode={importing} onClose={() => setImporting(null)} />}
    </div>
  );
}

export function ModelDrawer({ model: m, state, onClose }: { model: Model; state: AppState; onClose(): void }) {
  const { toast } = useApp();
  const cfg = state.companies.find(c => c.id === m.company)!;
  const [notes, setNotes] = useState(m.notes ?? '');
  const [glb, setGlb] = useState(m.glbFile ?? '');
  useEffect(() => {
    setNotes(m.notes ?? '');
    setGlb(m.glbFile ?? '');
  }, [m.id]);
  const patch = (p: Partial<Model>) => hub.patchModel(m.id, p);
  // Typed fields save shortly after typing stops, on blur, and when the drawer closes (Escape or an outside click never blurs them).
  const pending = useRef<{ id: string; patch: Partial<Model> } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const p = pending.current;
    pending.current = null;
    if (p && Object.keys(p.patch).length) hub.patchModel(p.id, p.patch);
  }, []);
  const edit = (key: 'notes' | 'glbFile' | 'group', value: string) => {
    const next = { ...pending.current?.patch };
    if (value === (m[key] ?? '')) delete next[key];
    else next[key] = value;
    pending.current = { id: m.id, patch: next };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  };
  useEffect(() => flush, [m.id, flush]);

  return (
    <Drawer onClose={onClose} title={m.name} subtitle={[m.code, m.group, ...(m.subcategories ?? [])].filter(Boolean).join(' · ')}>
      <div className="row gap wrap">
        <StatusPicker status={m.status} company={m.company} onPick={s => hub.setStatus([m.id], s).then(() => toast(`${modelLabel(m)} → ${statusLabel(s, m.company)}`))} />
        <button type="button" className={`chip ${m.starred ? 'on' : ''}`} onClick={() => patch({ starred: !m.starred })}>
          <Icon name="star" size={13} /> {m.starred ? 'Starred' : 'Star'}
        </button>
        {m.driveFileUrl && (
          <button type="button" className="chip" onClick={() => hub.openUrl(m.driveFileUrl!)}>
            GLB on Drive <Icon name="external" size={12} />
          </button>
        )}
        {m.portalUrl && (
          <button type="button" className="chip" onClick={() => hub.openUrl(m.portalUrl!)}>
            Portal page <Icon name="external" size={12} />
          </button>
        )}
      </div>

      {m.company === 'waveink' && (
        <div className="grid2">
          <Field label={`% complete (${m.percent ?? 0}%)`}>
            <input type="range" min={0} max={100} step={5} value={m.percent ?? 0} onChange={e => patch({ percent: Number(e.target.value) })} />
          </Field>
          <Field label="GLB file name">
            <input value={glb} placeholder={`${m.code ?? 'name'}.glb`} onChange={e => (setGlb(e.target.value), edit('glbFile', e.target.value))} onBlur={flush} />
          </Field>
        </div>
      )}
      {m.company === 'metaztech' && (
        <div className="grid2">
          <Field label="Complexity" hint={m.complexity ? `${formatMoney(tierFee(cfg, m.complexity), 'INR')} before 1% TDS` : 'Sets the fee'}>
            <select value={m.complexity ?? ''} onChange={e => patch({ complexity: (e.target.value || undefined) as Complexity | undefined })}>
              <option value="">Not set</option>
              {Object.entries(COMPLEXITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rejections">
            <input type="number" min={0} value={m.revisions ?? 0} onChange={e => patch({ revisions: Number(e.target.value) })} />
          </Field>
          <Field label="Due date">
            <input type="date" value={m.dueDate ?? ''} onChange={e => patch({ dueDate: e.target.value || undefined })} />
          </Field>
          <Field label="Project">
            <input key={m.id} defaultValue={m.group ?? ''} onChange={e => edit('group', e.target.value)} onBlur={flush} />
          </Field>
        </div>
      )}

      <Field label={m.company === 'waveink' ? 'Rohit update / notes (goes into the tracker export)' : 'Notes (feedback, what to fix)'}>
        <textarea rows={4} value={notes} onChange={e => (setNotes(e.target.value), edit('notes', e.target.value))} onBlur={flush} />
      </Field>

      {m.sourceUrls && m.sourceUrls.length > 0 && (
        <>
          <h4>Reference images</h4>
          <div className="gallery">
            {m.sourceUrls.slice(0, 12).map(u => (
              <button key={u} type="button" onClick={() => hub.openUrl(u)} title="Open full size">
                <Thumb url={u} label="image" />
              </button>
            ))}
          </div>
        </>
      )}

      {(m.description || m.brandingAreas || m.printMethods || m.variants) && (
        <dl className="facts">
          {m.brand && (
            <>
              <dt>Brand</dt>
              <dd>{m.brand}</dd>
            </>
          )}
          {m.colour && (
            <>
              <dt>Colour</dt>
              <dd>{m.colour}</dd>
            </>
          )}
          {m.templateId && (
            <>
              <dt>Template ID</dt>
              <dd>{m.templateId} (backend image files are named by this)</dd>
            </>
          )}
          {m.brandingAreas && (
            <>
              <dt>Branding areas</dt>
              <dd className="pre">{m.brandingAreas}</dd>
            </>
          )}
          {m.printMethods && (
            <>
              <dt>Print methods</dt>
              <dd>{m.printMethods}</dd>
            </>
          )}
          {m.variants && (
            <>
              <dt>Variants</dt>
              <dd className="pre">{m.variants}</dd>
            </>
          )}
          {m.description && (
            <>
              <dt>Description</dt>
              <dd>{m.description}</dd>
            </>
          )}
        </dl>
      )}
      {m.portalRow && (
        <dl className="facts">
          {Object.entries(m.portalRow)
            .filter(([, v]) => v)
            .slice(0, 16)
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
      )}

      <h4>History</h4>
      {m.history.length > 0 && (
        <ul className="history">
          {[...m.history].reverse().map((h, i) => (
            <li key={i}>
              <span className="muted small">{fmtDate(h.at, true)}</span>{' '}
              {h.kind === 'progress' ? (
                <span className="muted">{progressText(h)}</span>
              ) : (
                <>
                  {h.kind === 'import' ? 'Imported as ' : h.from ? `${statusLabel(h.from, m.company)} → ` : ''}
                  <strong>{statusLabel(h.to, m.company)}</strong>
                  {h.note && <span className="muted"> · {h.kind === 'import' ? h.note.replace(/^Imported /, '') : h.note}</span>}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {statusEvents(m).length === 0 && (
        <p className="muted small">No status changes yet{m.source === 'catalog' && isComplete(m.status) ? ' (marked done in the Waveink catalog)' : ''}.</p>
      )}
      {m.source !== 'catalog' && (
        <ConfirmButton
          icon={<Icon name="trash" />}
          label="Delete model"
          confirmLabel="Click again to delete"
          onConfirm={async () => {
            await hub.remove('models', m.id);
            onClose();
          }}
        />
      )}
    </Drawer>
  );
}

export function progressText(h: StatusEvent): string {
  const note = h.note ?? '';
  if (h.field === 'glb') return `GLB: ${note.replace(/^GLB /, '')}`;
  if (h.field === 'notes') return `Note: ${note}`;
  return note.replace(/ done$/, '');
}

export function AddModel({ company, groups, onClose }: { company: 'waveink' | 'metaztech'; groups: string[]; onClose(): void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [group, setGroup] = useState(company === 'waveink' ? 'Tech' : groups[0] ?? '');
  const [sub, setSub] = useState('');
  const [complexity, setComplexity] = useState<Complexity | ''>('');
  const [status, setStatus] = useState<ModelStatus>('todo');
  const save = async () => {
    if (!name.trim()) return;
    await hub.addModel({
      company,
      name: name.trim(),
      code: code.trim() || undefined,
      group: group.trim() || undefined,
      subcategories: sub.trim() ? [sub.trim()] : undefined,
      complexity: complexity || undefined,
      status: 'todo',
    }).then(id => (status !== 'todo' ? hub.setStatus([id], status) : undefined));
    onClose();
  };
  return (
    <Modal
      title="Add model"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={save} disabled={!name.trim()}>
            Add
          </button>
        </>
      }
    >
      <Field label="Name">
        <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} />
      </Field>
      <div className="grid2">
        <Field label={company === 'waveink' ? 'Jasani code' : 'Job / asset ID'}>
          <input value={code} onChange={e => setCode(e.target.value)} />
        </Field>
        <Field label={company === 'waveink' ? 'Group' : 'Project'}>
          <input list="groups" value={group} onChange={e => setGroup(e.target.value)} />
          <datalist id="groups">
            {groups.map(g => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </Field>
        {company === 'waveink' && (
          <Field label="Subcategory">
            <input value={sub} onChange={e => setSub(e.target.value)} />
          </Field>
        )}
        {company === 'metaztech' && (
          <Field label="Complexity">
            <select value={complexity} onChange={e => setComplexity(e.target.value as Complexity)}>
              <option value="">Not set</option>
              {Object.entries(COMPLEXITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Status">
          <select value={status} onChange={e => setStatus(e.target.value as ModelStatus)}>
            {statusesFor(company).map(s => (
              <option key={s} value={s}>
                {statusLabel(s, company)}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  );
}
