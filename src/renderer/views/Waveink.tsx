import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { AppState, Model, ModelStatus } from '../../shared/types';
import { COMPANY_STATUSES, isComplete, isOpen, lastWorked, statusLabel } from '../../shared/status';
import { formatMoney } from '../../shared/money';
import { modelLabel, waveinkQueue } from '../../shared/planner';
import { hub } from '../hub';
import { ClientTile, Drawer, Empty, Icon, Modal, relTime, useApp } from '../ui';
import { modelPriority, PRIORITY_LABEL } from '../priority';
import { AddWaveinkModel, Pop, WaveinkDetail, WiStatus } from './WaveinkDetail';
import { JobDrawer } from './JobDetails';
import { nextDeadlines, paceText, weekProgress } from '../../shared/pace';
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
  const { go, toast } = useApp();
  const wide = useWide();
  const cfg = state.companies.find(c => c.id === 'waveink')!;
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
      <header className="wi-head">
        <span className="client-tile c-fill" aria-hidden="true">
          <Icon name="cube" size={30} weight="fill" />
        </span>
        <div className="wi-title">
          <h1>{cfg.name}</h1>
          <div className="wi-chips">
            <span className="wi-chip">{cfg.role}</span>
            {cfg.pay.kind === 'retainer' && <span className="wi-chip c-soft strong">{formatMoney(cfg.pay.amount, cfg.currency)} retainer</span>}
            {report && (
              <span className="wi-chip">
                Report to {report[1]} every {report[2]}
              </span>
            )}
            {pace && <span className={`wi-chip ${pace.behind && pace.per === 'week' ? 'warn' : ''}`}>{paceText(pace)}</span>}
            {dueToday.map(d => (
              <span key={d.id} className={`wi-chip ${d.passed ? '' : 'bad'}`}>
                {d.label} today{d.time ? ` ${d.time}` : ''}
              </span>
            ))}
            <button type="button" className="wi-chip wi-chip-btn" onClick={() => setJob(true)}>
              <Icon name="calendar" size={13} /> Job details
            </button>
          </div>
        </div>
        <div className="wi-prog">
          <div className="wi-prog-top">
            <span>
              {done} of {total} {tech.length ? 'Tech ' : ''}models done
            </span>
            <span className="muted tabular">{pct}%</span>
          </div>
          <div className="wi-bar" role="progressbar" aria-label={`${tech.length ? 'Tech ' : ''}models done`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <div style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="wi-actions">
          <Pop label="Links, brief and add model" icon={<Icon name="dots" size={22} />} className="wi-ibtn lg-ic">
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
          </Pop>
          <button type="button" className="lg primary" onClick={exportNow}>
            <Icon name="excel" size={18} /> Export Excel
          </button>
        </div>
      </header>

      <div className="wi-grid">
        <section className="panel wi-list" aria-label="Models">
          <div className="wi-tools">
            <div className="wi-tabs" role="group" aria-label="Group">
              {groups.map(g => (
                <button key={g} type="button" className={`wi-tab ${g === group ? 'on' : ''}`} aria-pressed={g === group} onClick={() => pickGroup(g)}>
                  {g} · {all.filter(m => groupOf(m) === g && hit(m)).length}
                </button>
              ))}
            </div>
            <label className="wi-search">
              <Icon name="search" size={16} />
              <span className="sr-only">Search models</span>
              <input type="search" placeholder="Name or Jasani code" value={query} onChange={e => setQuery(e.target.value)} />
            </label>
            <Pop label="Filter and sort" kind="dialog" icon={<Icon name="funnel" size={17} />} dot={filtered || sort !== 'queue'}>
              {() => (
                <>
                  <div className="wi-fsec">
                    <span className="wi-flabel">Status</span>
                    <div className="chips">
                      {(['all', 'open', ...COMPANY_STATUSES.waveink] as const).map(s => (
                        <button key={s} type="button" className={`chip ${status === s ? 'on' : ''}`} aria-pressed={status === s} onClick={() => setStatusFilter(s)}>
                          {s === 'all' ? 'All' : s === 'open' ? 'Open' : statusLabel(s, 'waveink')}
                          <span className="n">{counts[s] ?? 0}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="wi-fgrid">
                    {subs.length > 0 && (
                      <label className="field">
                        <span>Subcategory</span>
                        <select value={sub} onChange={e => setSub(e.target.value)}>
                          <option value="all">All subcategories</option>
                          {subs.map(s => (
                            <option key={s}>{s}</option>
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
                  <div className="row gap between">
                    <button type="button" className={`chip ${starred ? 'on' : ''}`} aria-pressed={starred} onClick={() => setStarred(!starred)}>
                      <Icon name="star" size={13} weight={starred ? 'fill' : 'regular'} /> Only starred
                    </button>
                    <button type="button" className="ghost mini" onClick={clearFilters} disabled={!filtered}>
                      Clear filters
                    </button>
                  </div>
                </>
              )}
            </Pop>
            <button
              type="button"
              className={`wi-tool ${selecting ? 'on' : ''}`}
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
            <button type="button" className="wi-ibtn" aria-label="Add model" title="Add model" onClick={() => setAdding(true)}>
              <Icon name="plus" size={18} />
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
                <strong>{picked.length} selected</strong>
              </label>
              <span className="muted small">Set status</span>
              {COMPANY_STATUSES.waveink.map(s => (
                <button
                  key={s}
                  type="button"
                  className={`pill st-${s} wi-pill`}
                  disabled={!picked.length}
                  onClick={async () => {
                    await set(picked, s);
                    setSelected(new Set());
                  }}
                >
                  {statusLabel(s, 'waveink')}
                </button>
              ))}
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
                      <ClientTile client="waveink" />
                      <span className="wi-name">
                        <b>
                          {m.starred && <Icon name="star" size={13} weight="fill" />}
                          {m.name}
                        </b>
                        <small>
                          <span>{m.code}</span>
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
