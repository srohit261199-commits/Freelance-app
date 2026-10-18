import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { AppState, Model, ModelStatus } from '../../shared/types';
import { COMPANY_STATUSES, isComplete, isOpen, lastWorked, statusLabel } from '../../shared/status';
import { formatMoney } from '../../shared/money';
import { modelLabel, waveinkQueue } from '../../shared/planner';
import { hub } from '../hub';
import { Drawer, Dropdown, Empty, Icon, MenuButton, Modal, PageHead, relTime, useApp, type Choice } from '../ui';
import { modelPriority, PRIORITY_LABEL } from '../priority';
import { AddWaveinkModel, WaveinkDetail, WiStatus } from './WaveinkDetail';
import { JobDrawer } from './JobDetails';
import { nextDeadlines, paceText, weekProgress } from '../../shared/pace';
import { clientFolder, withFolder } from '../../shared/assets';
import { useReferenceDownload } from './References';
import './Waveink.css';

type Sort = 'queue' | 'sheet' | 'status' | 'updated' | 'name';
type StatusFilter = ModelStatus | 'all' | 'open';
const SORTS: [Sort, string][] = [
  ['queue', 'Work order'],
  ['sheet', 'Sheet order'],
  ['status', 'By status'],
  ['updated', 'Recently worked'],
  ['name', 'Name'],
];
const WIDE = '(min-width: 1100px)';
const groupOf = (m: Model) => m.group || 'Other';
const firstRow = (m: Model) => Math.min(...(m.rows ?? [1e6]));
const groupRank = (g: string) => (g === 'Tech' ? 0 : g === 'Apparel' ? 1 : g === 'Other' ? 3 : 2);
const DAYS = 'Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday';

/** A toolbar button with a small panel of controls under it; closes on Escape or an outside click and gives focus back. */
function Pop({ label, text, badge, children }: { label: string; text: string; badge: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('button, input')?.focus();
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    // Capture phase, so a drawer around the panel doesn't also close on the same Escape; a menu open in the panel closes first.
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || panel.current?.querySelector('.menu')) return;
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', esc, true);
    };
  }, [open]);
  return (
    <div className="wi-pop" ref={ref}>
      <button ref={btn} type="button" title={label} aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="funnel" />
        <span className="wi-pop-text">{text}</span>
        {badge > 0 && <span className="count">{badge}</span>}
      </button>
      {open && (
        <div ref={panel} className="wi-pop-panel" role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}

function useWide() {
  const [wide, setWide] = useState(() => matchMedia(WIDE).matches);
  useEffect(() => {
    const mq = matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

export function Waveink({ state, openId, now }: { state: AppState; openId?: string; now: Date }) {
  const { toast } = useApp();
  const wide = useWide();
  const cfg = state.companies.find(c => c.id === 'waveink')!;
  const root = clientFolder(state, 'waveink');
  const { run: download, busy: downloading } = useReferenceDownload(state);
  const all = useMemo(() => state.models.filter(m => m.company === 'waveink'), [state.models]);
  const groups = useMemo(() => [...new Set(all.map(groupOf))].sort((a, b) => groupRank(a) - groupRank(b) || a.localeCompare(b)), [all]);
  const [groupPick, setGroup] = useState(() => {
    const m = openId ? all.find(x => x.id === openId) : undefined;
    return m ? groupOf(m) : 'Tech';
  });
  const group = groups.includes(groupPick) ? groupPick : (groups[0] ?? 'Tech');
  const [query, setQuery] = useState('');
  const [status, setStatusFilter] = useState<StatusFilter>('all');
  const [sub, setSub] = useState('all');
  const [starred, setStarred] = useState(false);
  const [sort, setSort] = useState<Sort>('queue');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | undefined>(openId);
  const [adding, setAdding] = useState(false);
  const [brief, setBrief] = useState(false);
  const [job, setJob] = useState(false);
  const detailBox = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!openId) return;
    setSel(openId);
    const m = all.find(x => x.id === openId);
    if (m) setGroup(groupOf(m));
    requestAnimationFrame(() => document.getElementById(`wi-row-${openId}`)?.scrollIntoView({ block: 'center' }));
  }, [openId]);

  const q = query.toLowerCase().trim();
  const hit = (m: Model) => !q || `${m.name} ${m.code ?? ''} ${m.brand ?? ''} ${m.notes ?? ''} ${(m.subcategories ?? []).join(' ')}`.toLowerCase().includes(q);
  const subs = useMemo(() => [...new Set(all.filter(m => groupOf(m) === group).flatMap(m => m.subcategories ?? []))].sort(), [all, group]);
  // Everything but the status filter, so each status chip's count is what clicking it shows.
  const matching = useMemo(
    () => all.filter(m => groupOf(m) === group && (sub === 'all' || m.subcategories?.includes(sub)) && (!starred || m.starred) && hit(m)),
    [all, group, sub, starred, q],
  );
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
    const order = COMPANY_STATUSES.waveink;
    if (sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'sheet') list = [...list].sort((a, b) => firstRow(a) - firstRow(b) || a.name.localeCompare(b.name));
    else if (sort === 'updated') list = [...list].sort((a, b) => (lastWorked(b) ?? '').localeCompare(lastWorked(a) ?? ''));
    else if (sort === 'status') list = [...list].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
    else {
      // Work order: revisions and in-progress first, then the to-do queue, then everything else.
      const queue = waveinkQueue(all).map(m => m.id);
      const rank = (m: Model) =>
        m.status === 'revision' ? 0 : m.status === 'in_progress' ? 1 : m.status === 'todo' ? 2 + queue.indexOf(m.id) / 1e4 : m.status === 'review' ? 3 : 4;
      list = [...list].sort((a, b) => Number(!!b.starred) - Number(!!a.starred) || rank(a) - rank(b) || firstRow(a) - firstRow(b));
    }
    return list;
  }, [all, matching, status, sort]);
  // Only flag what needs attention in the list; to-do models without a due date are never urgent or high.
  const flags = useMemo(() => {
    const f = new Map<string, 'urgent' | 'high'>();
    for (const m of all) {
      if (m.status === 'todo' && !m.dueDate) continue;
      const p = modelPriority(m, state, now);
      if (p === 'urgent' || p === 'high') f.set(m.id, p);
    }
    return f;
  }, [all, state, now]);

  const tech = all.filter(m => m.group === 'Tech');
  const base = tech.length ? tech : all;
  const done = base.filter(m => isComplete(m.status)).length;
  const total = base.filter(m => m.status !== 'skipped').length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const report = cfg.notes.match(new RegExp(`\\bto ([A-Z][a-z]+) every (${DAYS})`));
  const pace = weekProgress(state, 'waveink', now);
  const dueToday = nextDeadlines(cfg, now, 0);
  const picked = shown.filter(m => selected.has(m.id)).map(m => m.id);
  const allPicked = shown.length > 0 && picked.length === shown.length;
  const filtered = status !== 'all' || sub !== 'all' || starred;
  const changed = [status !== 'all', sub !== 'all', starred, sort !== 'queue'].filter(Boolean).length;
  const statusChoices: Choice<StatusFilter>[] = (['all', 'open', ...COMPANY_STATUSES.waveink] as const).map(s => ({
    value: s,
    label: s === 'all' ? 'All' : s === 'open' ? 'Open' : statusLabel(s, 'waveink'),
    tone: s === 'all' || s === 'open' ? undefined : `st-${s}`,
    count: counts[s] ?? 0,
  }));
  const groupCount = (g: string) => all.filter(m => groupOf(m) === g && hit(m)).length;
  const chosen = sel ? all.find(m => m.id === sel) : undefined;
  const current = chosen ?? (wide ? shown[0] : undefined);
  useEffect(() => {
    // A block body: scrollTo returns a Promise in Electron 44, and an effect must return nothing or a cleanup.
    detailBox.current?.scrollTo(0, 0);
  }, [current?.id]);

  const set = async (ids: string[], to: ModelStatus) => {
    await hub.setStatus(ids, to);
    const one = ids.length === 1 && all.find(m => m.id === ids[0]);
    toast(`${one ? modelLabel(one) : `${ids.length} models`} → ${statusLabel(to, 'waveink')}`);
  };
  const toggle = (id: string) =>
    setSelected(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const exportNow = async () => {
    const r = await hub.exportExcel('waveink');
    if (r.path) toast(`Saved ${r.path}`);
    else if (r.error) toast(r.error, 'error');
  };
  const pickGroup = (g: string) => {
    setGroup(g);
    setSub('all');
    setSelected(new Set());
    if (chosen && groupOf(chosen) !== g) setSel(undefined);
  };
  const clearFilters = () => {
    setStatusFilter('all');
    setSub('all');
    setStarred(false);
  };
  // Up and down move through the rows; on wide screens the detail follows.
  const arrows = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || !(e.target as HTMLElement).classList.contains('wi-main')) return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.wi-main')];
    const next = rows[rows.indexOf(e.target as HTMLButtonElement) + (e.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    next.focus();
    if (wide) next.click();
  };

  const detail = current && <WaveinkDetail m={current} state={state} now={now} inDrawer={!wide} onDeleted={() => setSel(undefined)} onPin={() => !sel && setSel(current.id)} />;

  return (
    <div className="page wi-page c-waveink">
      <PageHead
        title={cfg.name}
        icon="cube"
        meta={
          <>
            {cfg.role && <span>{cfg.role}</span>}
            {cfg.pay.kind === 'retainer' && <span>{formatMoney(cfg.pay.amount, cfg.currency)} retainer</span>}
            {report && (
              <span>
                Report to {report[1]} every {report[2]}
              </span>
            )}
            {pace && pace.target > 0 && <span className={pace.behind && pace.per === 'week' ? 'warn-text' : ''}>{paceText(pace)}</span>}
            {dueToday.map(d => (
              <span key={d.id} className={d.passed ? '' : 'bad-text'}>
                {d.label} today{d.time ? ` ${d.time}` : ''}
              </span>
            ))}
            <span>
              <button type="button" className="link-btn" onClick={() => setJob(true)}>
                Job details
              </button>
            </span>
          </>
        }
      >
        <div className="wi-prog" title={`${done} of ${total} ${tech.length ? 'Tech ' : ''}models done`}>
          <div className="wi-prog-top">
            <span>
              <b className="tabular">
                {done} / {total}
              </b>{' '}
              {tech.length ? 'Tech ' : ''}done
            </span>
            <span className="tabular">{pct}%</span>
          </div>
          <div className="progress" role="progressbar" aria-label={`${tech.length ? 'Tech ' : ''}models done`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <div style={{ width: `${pct}%` }} />
          </div>
        </div>
        <MenuButton label="More actions" icon="dots">
          {close => (
            <>
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
                  <Icon name="link" />
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
                <Icon name="info" />
                <span className="grow">Brief & pay terms</span>
              </button>
              <hr />
              {root && (
                <button
                  type="button"
                  role="menuitem"
                  title={root}
                  onClick={() => {
                    close();
                    hub.openPath(root);
                  }}
                >
                  <Icon name="folderOpen" />
                  <span className="grow">Open output folder</span>
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                title="Download images saves each model's catalog images in its own folder here"
                onClick={async () => {
                  close();
                  const p = await hub.pickFolder(root || undefined);
                  if (p) await hub.upsert('companies', { ...withFolder(cfg, p) });
                }}
              >
                <Icon name="folder" />
                <span className="grow">{root ? 'Change output folder' : 'Choose output folder'}</span>
              </button>
            </>
          )}
        </MenuButton>
        <button type="button" className="primary" onClick={exportNow}>
          <Icon name="excel" /> Export to Excel
        </button>
      </PageHead>

      <div className="wi-grid">
        <section className="panel wi-list" aria-label="Models">
          <div className="wi-tools">
            {groups.length <= 3 ? (
              <div className="seg wi-groups" role="group" aria-label="Group">
                {groups.map(g => (
                  <button key={g} type="button" className={g === group ? 'on' : ''} aria-pressed={g === group} onClick={() => pickGroup(g)}>
                    {g} <span className="n">{groupCount(g)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <Dropdown label="Group" value={group} options={groups.map(g => ({ value: g, label: g, count: groupCount(g) }))} onChange={pickGroup} className="wi-groups" />
            )}
            <label className="wi-search">
              <Icon name="search" />
              <span className="sr-only">Search models</span>
              <input type="search" placeholder="Name or code" value={query} onChange={e => setQuery(e.target.value)} />
            </label>
            <Pop label="Filter and sort" text="Filter" badge={changed}>
              <Dropdown label="Status" prefix="Status" value={status} options={statusChoices} onChange={v => setStatusFilter(v)} />
              {subs.length > 0 && (
                <Dropdown label="Subcategory" prefix="Subcategory" value={sub} options={[{ value: 'all', label: 'All' }, ...subs.map(s => ({ value: s, label: s }))]} onChange={setSub} />
              )}
              <Dropdown label="Sort" prefix="Sort" value={sort} options={SORTS.map(([value, label]) => ({ value, label }))} onChange={v => setSort(v)} />
              <div className="row gap between">
                <label className="row gap wi-check">
                  <input type="checkbox" checked={starred} onChange={e => setStarred(e.target.checked)} />
                  Only starred
                </label>
                <button type="button" className="ghost mini" onClick={clearFilters} disabled={!filtered}>
                  Clear filters
                </button>
              </div>
            </Pop>
            <button
              type="button"
              className={`wi-select ${selecting ? 'on' : ''}`}
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

          {filtered && (
            <div className="chips wi-active">
              {status !== 'all' && (
                <button type="button" className="chip on" onClick={() => setStatusFilter('all')} aria-label={`Remove filter ${status === 'open' ? 'Open' : statusLabel(status, 'waveink')}`}>
                  {status === 'open' ? 'Open' : statusLabel(status, 'waveink')} <Icon name="close" size={12} />
                </button>
              )}
              {sub !== 'all' && (
                <button type="button" className="chip on" onClick={() => setSub('all')} aria-label={`Remove filter ${sub}`}>
                  {sub} <Icon name="close" size={12} />
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
            <div className="wi-bulk">
              <label className="row gap">
                <input type="checkbox" checked={allPicked} onChange={e => setSelected(e.target.checked ? new Set(shown.map(m => m.id)) : new Set())} aria-label="Select all shown" />
                {picked.length} selected
              </label>
              <fieldset className="wi-bulk-acts" disabled={!picked.length} aria-label="Change the selected models">
                <MenuButton label="Set status of the selected models" text="Set status" className="select-btn mini" align="start">
                  {close =>
                    COMPANY_STATUSES.waveink.map(s => (
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
                        {statusLabel(s, 'waveink')}
                      </button>
                    ))
                  }
                </MenuButton>
                <button type="button" className="mini" disabled={!!downloading} onClick={() => download(all.filter(m => picked.includes(m.id)))}>
                  <Icon name="download" size={14} /> {downloading ?? 'Download images'}
                </button>
              </fieldset>
            </div>
          )}

          {shown.length === 0 ? (
            <Empty title="Nothing matches">
              {filtered || q ? 'Change the search or filters, or add a model.' : 'No models in this group yet.'}
              {filtered && (
                <div>
                  <button type="button" className="mini" onClick={clearFilters}>
                    Clear filters
                  </button>
                </div>
              )}
            </Empty>
          ) : (
            <div className={`wi-rows ${selecting ? 'selecting' : ''}`} onKeyDown={arrows}>
              {shown.map(m => {
                const on = m.id === current?.id;
                const flag = flags.get(m.id);
                const worked = lastWorked(m);
                const subText = (m.subcategories ?? []).join(', ') || m.group || '';
                return (
                  <div key={m.id} id={`wi-row-${m.id}`} className={`wi-row ${on ? 'on' : ''} ${selected.has(m.id) ? 'checked' : ''}`} onClick={() => setSel(m.id)}>
                    {selecting && (
                      <input
                        type="checkbox"
                        className="wi-chk"
                        checked={selected.has(m.id)}
                        onChange={() => toggle(m.id)}
                        onClick={e => e.stopPropagation()}
                        aria-label={`Select ${m.name}`}
                      />
                    )}
                    <button
                      type="button"
                      className="wi-main"
                      aria-current={on && wide ? 'true' : undefined}
                      onClick={e => {
                        e.stopPropagation();
                        setSel(m.id);
                      }}
                    >
                      <span className="wi-name">
                        <b>
                          {m.starred && <Icon name="star" size={12} weight="fill" />}
                          {m.name}
                        </b>
                        <small>
                          {m.code && <span>{m.code}</span>}
                          {subText && <span className="wi-sub-inline">{subText}</span>}
                          {!!m.percent && !isComplete(m.status) && <span>{m.percent}%</span>}
                          {worked && <span>{relTime(worked, now)}</span>}
                          {flag && (
                            <span className={`flag ${flag}`}>
                              <Icon name="flag" weight="fill" size={11} />
                              {PRIORITY_LABEL[flag]}
                            </span>
                          )}
                        </small>
                      </span>
                      <span className="wi-sub">{subText}</span>
                    </button>
                    <div className="wi-st">
                      <WiStatus m={m} onPick={s => set([m.id], s)} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {wide && (
          <section ref={detailBox} className="panel wi-detail" aria-label="Model details">
            {detail ?? <Empty title="No model selected">Pick a model on the left to see its details.</Empty>}
          </section>
        )}
      </div>

      {job && <JobDrawer state={state} company="waveink" now={now} onClose={() => setJob(false)} />}
      {!wide && current && (
        <Drawer onClose={() => setSel(undefined)} title={current.name}>
          {detail}
        </Drawer>
      )}
      {adding && (
        <AddWaveinkModel
          all={all}
          group={group}
          onClose={() => setAdding(false)}
          onAdded={(id, g) => {
            setGroup(g);
            setSel(id);
            toast('Model added');
          }}
        />
      )}
      {brief && (
        <Modal title="Brief & pay terms" onClose={() => setBrief(false)}>
          <p className="wi-brief">{cfg.notes}</p>
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
