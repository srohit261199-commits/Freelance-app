import { Fragment, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { AppState, Currency, FolderEntry, SkeidarJob, CompanyId } from '../../shared/types';
import { formatMoney, jobOutputs, localDate } from '../../shared/money';
import { uid } from '../../shared/ops';
import { hub } from '../hub';
import { ConfirmButton, Empty, Field, Icon, Modal, relTime, useApp } from '../ui';
import { jobPriority, PRIORITY_LABEL } from '../priority';
import { clientFolder, promptFor, promptList, suggestedFileName } from '../../shared/assets';
import { AssetsPanel, LocalThumb } from './AssetsPanel';
import { JobDetails } from './JobDetails';
import './Skeidar.css';

/** Colour words that show up in fabric names, so a tile looks like the fabric it stands for. */
const FABRIC_COLOURS: Record<string, string> = {
  cream: '#ede3d1', ivory: '#efe8d8', white: '#f1efe9', snow: '#f1efe9', oat: '#e3d8c3', oatmeal: '#e3d8c3', natural: '#e6dccb', ecru: '#e6dccb',
  sand: '#d8c3a0', beige: '#dccbb0', linen: '#e0d4bf', greige: '#c8beb0', taupe: '#b7a99a', stone: '#c9c2b6', pebble: '#bdb6aa', mushroom: '#a89c8e',
  grey: '#9a9a9e', gray: '#9a9a9e', silver: '#c4c6cb', ash: '#b4b4b4', charcoal: '#3f4045', graphite: '#4a4c52', anthracite: '#3a3b40', black: '#26272b', slate: '#5d6670',
  moss: '#6f7d4f', olive: '#7b7d45', sage: '#a5b39a', green: '#5f8a5a', forest: '#3f5e45', emerald: '#2f7a5a', bottle: '#2f5240', mint: '#b5dcc6', pistachio: '#b9c98f',
  teal: '#2e6f6e', petrol: '#2f5d68', turquoise: '#4aa6a6', aqua: '#8fd0d0', blue: '#4f6fae', navy: '#2f3d5c', denim: '#5b7396', indigo: '#3e4682', sky: '#9cc2e5', ocean: '#2f5f80',
  rust: '#b2582f', terracotta: '#c0663f', brick: '#9e4a37', orange: '#e08a4a', cognac: '#9a5a2c', tan: '#c19a6b', camel: '#c09363', caramel: '#b9814a', toffee: '#a8743f',
  brown: '#7a5238', chocolate: '#5a3b2a', mocha: '#7d6252', coffee: '#6f4e37', espresso: '#4b3427', walnut: '#6b4a33', chestnut: '#7b4a32',
  red: '#b93a32', burgundy: '#6e2433', wine: '#6b2a3a', bordeaux: '#6a2236', cherry: '#9b2335', plum: '#6e3555', aubergine: '#4b2a40', purple: '#6c4a8f', violet: '#7a5aa6',
  lilac: '#c5b3dc', lavender: '#c7bde3', mauve: '#b3889c', pink: '#e7a9b8', blush: '#ecc4c0', rose: '#d68e98', dusty: '#c9a3a3', coral: '#e88b72', peach: '#f3c3a4', apricot: '#f0b682',
  yellow: '#e8c547', mustard: '#c99a2e', ochre: '#c58f2c', gold: '#c9a646', honey: '#d5a24a', lemon: '#f0dc7a', saffron: '#e0a63a', mole: '#8c8178', mink: '#9d8f84',
  // Norwegian names in Skeidar's range (ø, å and æ are folded to o, a and ae first).
  gronn: '#5f8a5a', gra: '#9a9a9e', bla: '#4f6fae', rod: '#b93a32', hvit: '#f1efe9', svart: '#26272b', sort: '#26272b', brun: '#7a5238', gul: '#e8c547',
  rosa: '#e7a9b8', lilla: '#6c4a8f', oransje: '#e08a4a', beis: '#dccbb0',
};

/** The fabric's colour if its name says one, otherwise a stable pastel worked out from the name. */
function fabricColour(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z]+/)
    .filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) {
    const c = FABRIC_COLOURS[words[i]] ?? FABRIC_COLOURS[words[i].replace(/s$/, '')];
    if (c) return c;
  }
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 52% 76%)`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(iso: string, now: Date): string {
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dm = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? dm : `${dm} ${d.getFullYear()}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function Skeidar({ state, now, openId, company = 'skeidar' }: { state: AppState; now: Date; openId?: string; company?: CompanyId }) {
  const { toast } = useApp();
  const cfg = state.companies.find(c => c.id === company) ?? state.companies.find(c => c.id === 'skeidar')!;
  const root = clientFolder(state, company) ?? '';
  const rate = cfg.pay.kind === 'per-item' ? cfg.pay.rate : 5;
  const cur$ = cfg.currency;
  const viaTeams = cfg.links.some(l => /teams/i.test(l.label + l.url));
  const [editing, setEditing] = useState<SkeidarJob | 'new' | null>(null);
  const [folder, setFolder] = useState<FolderEntry[] | null>(null);
  const [folderErr, setFolderErr] = useState('');
  const [prefill, setPrefill] = useState<Partial<SkeidarJob> | undefined>();
  const [selId, setSelId] = useState(openId);
  const [flashId, setFlashId] = useState<string | undefined>();
  const [allPast, setAllPast] = useState(false);
  const [count, setCount] = useState<{ path: string; n: number } | null>(null);
  const heroRef = useRef<HTMLElement>(null);

  const scan = async () => {
    setFolderErr('');
    if (!root) return setFolder(null);
    const r = await hub.scanFolder(root);
    if ('error' in r) {
      setFolder(null);
      setFolderErr(r.error);
    } else setFolder(r);
  };
  // Job folders: each subfolder becomes a job, its sheet gives the fabrics and finished files tick themselves off.
  const syncFolders = async (quiet = false) => {
    if (!root) return;
    const r = await hub.syncJobFolders(company);
    if ('error' in r) return quiet || toast(r.error, 'error');
    if (quiet && !r.created && !r.updated && !r.ticked) return;
    const bits = [r.created && `${plural(r.created, 'new job')}`, r.updated && `${plural(r.updated, 'job')} updated`, r.ticked && `${plural(r.ticked, 'image')} ticked off from files`].filter(Boolean);
    toast(bits.length ? `${bits.join(' · ')}` : `${plural(r.folders, 'job folder')} checked, nothing new`);
  };
  useEffect(() => {
    void scan();
    void syncFolders(true);
  }, [root]);
  const changeRoot = async () => {
    const p = await hub.pickFolder(root || undefined);
    if (!p) return;
    await hub.upsert('companies', { ...cfg, folder: p });
    if (company === 'skeidar') await hub.patchSettings({ skeidarFolder: p });
  };

  // A route with a job id (from Dashboard or search) selects that job and flashes it once.
  useEffect(() => {
    if (!openId) return;
    setSelId(openId);
    setFlashId(openId);
    heroRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const t = setTimeout(() => setFlashId(undefined), 1800);
    return () => clearTimeout(t);
  }, [openId]);

  const jobs = state.skeidarJobs.filter(j => (j.company ?? 'skeidar') === company).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const open = jobs.filter(j => j.status === 'open').reverse();
  const delivered = jobs.filter(j => j.status === 'delivered').sort((a, b) => (b.deliveredAt ?? b.receivedAt).localeCompare(a.deliveredAt ?? a.receivedAt));
  const cur = jobs.find(j => j.id === selId) ?? open[0];
  const totals = jobs.reduce(
    (s, j) => {
      const o = jobOutputs(j);
      return { done: s.done + o.done, total: s.total + o.total };
    },
    { done: 0, total: 0 },
  );
  const linked = new Set(jobs.map(j => j.folder).filter(Boolean));

  useEffect(() => {
    const p = cur?.folder;
    if (!p) return;
    let live = true;
    hub.countImages(p).then(n => live && setCount({ path: p, n }));
    return () => {
      live = false;
    };
  }, [cur?.folder]);

  const toggle = async (job: SkeidarJob, key: string) => {
    const done = { ...job.done, [key]: !job.done[key] };
    await hub.upsert('skeidarJobs', { ...job, done });
  };
  const fabricAll = async (job: SkeidarJob, f: number, on: boolean) => {
    const done = { ...job.done };
    job.images.forEach((_, i) => (done[`${f}:${i}`] = on));
    await hub.upsert('skeidarJobs', { ...job, done });
  };
  const deliver = async (job: SkeidarJob) => {
    const delivering = job.status === 'open';
    await hub.upsert('skeidarJobs', { ...job, status: delivering ? 'delivered' : 'open', deliveredAt: delivering ? new Date().toISOString() : undefined });
    toast(delivering ? `${job.name} delivered` : `${job.name} reopened`);
    if (delivering) setSelId(undefined);
  };
  const scanJob = async (job: SkeidarJob) => {
    if (!job.folder) return;
    await scan();
    await syncFolders(true);
    const n = await hub.countImages(job.folder);
    setCount({ path: job.folder, n });
    toast(`Found ${plural(n, 'image')} in the job folder`);
  };
  const linkFolder = async (job: SkeidarJob) => {
    const p = await hub.pickFolder(root || undefined);
    if (!p) return;
    await hub.upsert('skeidarJobs', { ...job, folder: p });
    toast('Folder linked to the job');
  };
  const pick = (id?: string) => {
    setSelId(id);
    heroRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const newJob = (p?: Partial<SkeidarJob>) => {
    setPrefill(p);
    setEditing('new');
  };

  const entry = cur?.folder ? folder?.find(f => f.path === cur.folder) : undefined;
  const files = cur?.folder ? (count?.path === cur.folder ? count.n : entry?.images) : undefined;
  const pastShown = allPast ? delivered : delivered.slice(0, 3);

  return (
    <div className={`page sk-page c-${company}`}>
      <header className="sk-head">
        <span className="client-tile c-fill" aria-hidden="true">
          <Icon name="brush" size={30} weight="fill" />
        </span>
        <div className="sk-title">
          <h1>{cfg.name}</h1>
          <div className="sk-chips">
            <span className="sk-chip">{cfg.role}</span>
            <span className="sk-chip c-soft">{formatMoney(rate, cur$)} per image</span>
            {totals.done > 0 && (
              <span className="sk-chip">
                {plural(totals.done, 'image')} made · {formatMoney(totals.done * rate, cur$)} earned
              </span>
            )}
          </div>
        </div>
        <div className="sk-actions">
          <button
            type="button"
            className="lg"
            onClick={async () => {
              const r = await hub.exportExcel(company === 'skeidar' ? 'skeidar' : `client:${company}`);
              if (r.path) toast(`Saved ${r.path}`);
              else if (r.error) toast(r.error, 'error');
            }}
          >
            <Icon name="excel" size={18} /> Export Excel
          </button>
          <button type="button" className="lg" onClick={() => newJob()}>
            <Icon name="plus" size={18} /> New job
          </button>
        </div>
      </header>

      {open.length > 0 && (open.length > 1 || cur?.status === 'delivered') && (
        <div className="tabs sk-tabs" role="group" aria-label="Open jobs">
          {open.map(j => {
            const o = jobOutputs(j);
            return (
              <button key={j.id} type="button" className={`tab ${cur?.id === j.id ? 'on' : ''}`} aria-pressed={cur?.id === j.id} onClick={() => pick(j.id)}>
                <span className="ellipsis">{j.name}</span>
                <span className="n tabular">
                  {o.done}/{o.total}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {cur ? (
        <JobHero
          key={cur.id}
          heroRef={heroRef}
          job={cur}
          now={now}
          rate={rate}
          currency={cur$}
          viaTeams={viaTeams}
          flash={flashId === cur.id}
          onEdit={() => setEditing(cur)}
          onDeliver={() => deliver(cur)}
          onScan={() => (cur.folder ? scanJob(cur) : linkFolder(cur))}
        />
      ) : (
        <section ref={heroRef} className="sk-hero sk-hero-empty">
          <Empty title="No open jobs">
            When a Teams message brings 2 images and a fabric list, add a job: paste the fabrics, one per line. Click each tile as you finish that image.
          </Empty>
          <button type="button" className="primary lg" onClick={() => newJob()}>
            <Icon name="plus" size={18} /> New job
          </button>
        </section>
      )}

      {cur && (
        <section className="panel sk-var" aria-labelledby="sk-var-title">
          <div className="sk-var-head">
            <h2 id="sk-var-title">Variations</h2>
            <p>
              Click a tile once that fabric is generated
              {files !== undefined && ` · folder scan found ${plural(files, 'image')}`}
              {files !== undefined && entry?.lastModified && `, newest ${relTime(entry.lastModified, now)}`}
            </p>
          </div>
          <Variations job={cur} onToggle={toggle} onFabric={fabricAll} />
        </section>
      )}

      {cur && cur.fabrics.length > 0 && cur.images.length > 0 && <Prompts key={`prompts-${cur.id}`} job={cur} />}

      {delivered.length > 0 && (
        <section className="sk-past-wrap" aria-label="Past jobs">
          <div className="sk-past">
            {pastShown.map(j => {
              const o = jobOutputs(j);
              const on = cur?.id === j.id;
              return (
                <button key={j.id} type="button" className={`sk-past-card ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => pick(on ? undefined : j.id)}>
                  <span className="sk-past-ic" aria-hidden="true">
                    <Icon name="checkCircle" size={22} weight="fill" />
                  </span>
                  <span className="sk-past-txt">
                    <b>
                      {j.name} · {j.images.length} × {j.fabrics.length}
                    </b>
                    <small>
                      Delivered {shortDate(j.deliveredAt ?? j.receivedAt, now)} · {o.done === o.total ? plural(o.done, 'image') : `${o.done} of ${o.total} images`}
                    </small>
                  </span>
                  <span className="sk-past-amt">{formatMoney(o.done * rate, cur$)}</span>
                </button>
              );
            })}
          </div>
          {delivered.length > 3 && (
            <button type="button" className="ghost sk-more" onClick={() => setAllPast(!allPast)}>
              {allPast ? 'Show fewer' : `Show all ${delivered.length} delivered jobs`}
            </button>
          )}
        </section>
      )}

      <section className="panel sk-folder" aria-labelledby="sk-folder-title">
        <div className="sk-folder-head">
          <div className="grow">
            <h2 id="sk-folder-title">Project folder</h2>
            <p className="small muted break">{root || 'No folder linked yet'}</p>
            <p className="small muted">Each subfolder is a job: put the client's sheet and the master photos in it, save finished images in an output folder inside it.</p>
          </div>
          <div className="row gap wrap">
            <button
              type="button"
              className="mini primary"
              disabled={!root}
              onClick={async () => {
                await scan();
                await syncFolders();
              }}
            >
              <Icon name="sync" size={14} /> Sync folder
            </button>
            <button type="button" className="mini" onClick={changeRoot}>
              {root ? 'Change' : 'Link folder'}
            </button>
            {root && (
              <button type="button" className="mini" onClick={() => hub.openPath(root)}>
                <Icon name="folder" size={14} /> Open
              </button>
            )}
          </div>
        </div>
        {folderErr && <p className="small warn-text">{folderErr}</p>}
        {folder && folder.length === 0 && <p className="small muted">No subfolders or images yet.</p>}
        {folder && folder.length > 0 && (
          <ul className="sk-folders">
            {folder.map(f => (
              <li key={f.path}>
                <span className="sk-f-ic" aria-hidden="true">
                  <Icon name="folder" size={18} weight="fill" />
                </span>
                <div className="grow">
                  <b className="ellipsis" title={f.name}>
                    {f.name}
                  </b>
                  <small>
                    {plural(f.images, 'image')}
                    {f.lastModified && ` · ${relTime(f.lastModified, now)}`}
                  </small>
                </div>
                {linked.has(f.path) ? (
                  <span className="tag ok">Has a job</span>
                ) : (
                  f.name !== '(files in this folder)' && (
                    <button type="button" className="mini" onClick={() => newJob({ name: f.name, folder: f.path, notes: `${f.images} images in folder when created.` })}>
                      Make job
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="sk-bottom">
        <JobDetails state={state} company={company} now={now} />
        <AssetsPanel state={state} company={company} folder={cur?.folder} title={cur?.folder ? `Files in ${cur.name}` : 'Files'} />
      </div>
      {editing && <JobEditor job={editing === 'new' ? undefined : editing} prefill={prefill} rate={rate} currency={cur$} clientName={cfg.name} company={company} onClose={() => setEditing(null)} />}
    </div>
  );
}

function JobHero({
  heroRef,
  job,
  now,
  rate,
  currency,
  viaTeams,
  flash,
  onEdit,
  onDeliver,
  onScan,
}: {
  heroRef: RefObject<HTMLElement | null>;
  job: SkeidarJob;
  now: Date;
  rate: number;
  currency: Currency;
  viaTeams: boolean;
  flash: boolean;
  onEdit(): void;
  onDeliver(): void;
  onScan(): void;
}) {
  const { done, total } = jobOutputs(job);
  const isOpen = job.status === 'open';
  const p = jobPriority(job, now);
  const label = `${done}/${total}`;
  return (
    <section ref={heroRef} className={`sk-hero ${flash ? 'flash' : ''}`} aria-label={`Job: ${job.name}`}>
      <div
        className="sk-ring"
        role="progressbar"
        aria-label="Images made"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        style={{ '--deg': `${total ? (done / total) * 360 : 0}deg` } as CSSProperties}
      >
        <div>
          <b className={label.length > 7 ? 'xs' : label.length > 5 ? 'sm' : ''}>{label}</b>
          <span>images</span>
        </div>
      </div>
      <div className="sk-info">
        <div className="sk-info-top">
          {isOpen ? (
            <span className="sk-badge">
              {viaTeams && <Icon name="teams" size={14} />}
              Received {shortDate(job.receivedAt, now)}
              {viaTeams && ' on Teams'}
            </span>
          ) : (
            <span className="sk-badge ok">
              <Icon name="checkCircle" size={14} weight="fill" />
              Delivered {shortDate(job.deliveredAt ?? job.receivedAt, now)}
            </span>
          )}
          {isOpen && (
            <span className={`flag ${p}`}>
              <Icon name="flag" weight="fill" size={12} />
              {PRIORITY_LABEL[p]}
            </span>
          )}
        </div>
        <div className="sk-name">
          <h2>{job.name}</h2>
          <button type="button" className="icon-btn ghost" aria-label="Edit job" title="Edit job" onClick={onEdit}>
            <Icon name="pencil" size={18} />
          </button>
        </div>
        <p className="sk-meta">
          <span className="nowrap">{plural(job.images.length, 'master image')} × {plural(job.fabrics.length, 'fabric')}</span>
          {job.folder && (
            <>
              {' · '}
              <button type="button" className="link-btn sk-path" title="Open folder" aria-label={`Open folder ${job.folder}`} onClick={() => hub.openPath(job.folder!)}>
                {job.folder}
              </button>
            </>
          )}
        </p>
        {job.sheet && (
          <p className="sk-meta small">
            From {job.sheet.split(/[\\/]/).pop()}
            {job.options && job.options.length > 1 && ` · ${job.options.length} ${/leg/i.test(job.options.join(' ')) ? 'leg finishes' : 'options'} in the sheet (${job.options.join(', ')}) don't need their own images`}
          </p>
        )}
        {job.notes && <p className="sk-notes clamp">{job.notes}</p>}
      </div>
      <div className="sk-stats">
        <div className="sk-stat">
          <span>Earned</span>
          <b>{formatMoney(done * rate, currency)}</b>
        </div>
        <div className="sk-stat">
          <span>Still to make</span>
          <b>{formatMoney((total - done) * rate, currency)}</b>
        </div>
      </div>
      <div className="sk-hero-actions">
        {isOpen ? (
          <button type="button" className="primary lg" onClick={onDeliver}>
            <Icon name="send" size={18} /> Mark delivered
          </button>
        ) : (
          <button type="button" className="lg" onClick={onDeliver}>
            <Icon name="repeat" size={18} /> Reopen
          </button>
        )}
        <button type="button" className="sk-scan" onClick={onScan}>
          <Icon name={job.folder ? 'folderDashed' : 'folder'} size={16} /> {job.folder ? 'Scan folder' : 'Link folder'}
        </button>
      </div>
    </section>
  );
}

function Variations({ job, onToggle, onFabric }: { job: SkeidarJob; onToggle(j: SkeidarJob, key: string): void; onFabric(j: SkeidarJob, f: number, on: boolean): void }) {
  const colours = job.fabrics.map(fabricColour);
  return (
    <div className="sk-grid-wrap">
      <div className="sk-grid" style={{ '--n': job.fabrics.length } as CSSProperties}>
        <span className="sk-corner" />
        {job.fabrics.map((f, fi) => {
          const all = job.images.every((_, i) => job.done[`${fi}:${i}`]);
          return (
            <button
              key={fi}
              type="button"
              className="sk-fab"
              aria-pressed={all}
              title={`${all ? 'Untick' : 'Tick'} ${f} for every image${job.itemIds?.[f]?.length ? ` · item ${job.itemIds[f].join(', ')}` : ''}`}
              onClick={() => onFabric(job, fi, !all)}
            >
              <span className="sk-swatch" style={{ background: colours[fi] }} />
              <span>{f}</span>
            </button>
          );
        })}
        {job.images.map((im, ii) => {
          const made = job.fabrics.filter((_, fi) => job.done[`${fi}:${ii}`]).length;
          return (
            <Fragment key={ii}>
              <div className="sk-master">
                {job.imageFiles?.[ii] ? (
                  <LocalThumb path={job.imageFiles[ii]} className="sk-thumb" alt={im} />
                ) : (
                  <span className="sk-thumb ph" aria-hidden="true">
                    <Icon name="image" size={22} />
                  </span>
                )}
                <div>
                  <b>{im}</b>
                  <small>
                    {made} of {job.fabrics.length} fabrics
                  </small>
                </div>
              </div>
              {job.fabrics.map((f, fi) => {
                const key = `${fi}:${ii}`;
                const on = !!job.done[key];
                const file = job.outputs?.[key]?.split(/[\\/]/).pop();
                return (
                  <button
                    key={key}
                    type="button"
                    className={`sk-tile ${on ? 'on' : ''} ${file ? 'file' : ''}`}
                    style={on ? { background: colours[fi] } : undefined}
                    aria-pressed={on}
                    aria-label={`${f}, ${im}`}
                    title={on ? `${f} · ${im}: made${file ? ` (found ${file})` : ''}. Click to undo.` : `${f} · ${im}: click once it is made, or save it as “${suggestedFileName(job, fi, ii)}” in the output folder`}
                    onClick={() => onToggle(job, key)}
                  >
                    {on ? (
                      <span className="sk-check">
                        <Icon name="check" size={15} weight="bold" />
                      </span>
                    ) : (
                      <Icon name="plus" size={20} />
                    )}
                  </button>
                );
              })}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

/** Copies text, falling back to a dialog with the text selected when the clipboard is refused. */
function useCopy() {
  const { toast } = useApp();
  const [fallback, setFallback] = useState<{ text: string; what: string } | null>(null);
  const copy = (text: string, what: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => toast(`Copied ${what}`))
      .catch(() => setFallback({ text, what }));
  };
  const dialog = fallback && (
    <Modal title={`Copy ${fallback.what}`} onClose={() => setFallback(null)}>
      <p className="small muted">Copying was blocked. The text is selected: press Ctrl+C.</p>
      <textarea className="sk-pr-copy" readOnly rows={12} value={fallback.text} ref={el => el?.select()} />
    </Modal>
  );
  return { copy, dialog };
}

const PROMPT_ROWS = 8;

/**
 * Prompts for the image tool, one per fabric for the chosen master photo. Each comes with the file name to save the
 * result under; once that file is in the job's output folder, the tile ticks itself off.
 */
function Prompts({ job }: { job: SkeidarJob }) {
  const { copy, dialog } = useCopy();
  const [image, setImage] = useState(0);
  const [shown, setShown] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const [withMade, setWithMade] = useState(false);
  const ii = Math.min(image, job.images.length - 1);
  const colours = job.fabrics.map(fabricColour);
  const rows = job.fabrics.map((f, fi) => ({ f, fi, made: !!job.done[`${fi}:${ii}`] }));
  const todo = rows.filter(r => !r.made);
  const listed = withMade ? [...todo, ...rows.filter(r => r.made)] : todo;
  const visible = all ? listed : listed.slice(0, PROMPT_ROWS);
  const photo = promptList(job, { image: ii, onlyMissing: true });
  const left = promptList(job, { onlyMissing: true });
  const photoName = job.images[ii];

  return (
    <section className="panel sk-prompts" aria-labelledby="sk-pr-title">
      <div className="sk-pr-head">
        <div className="grow">
          <h2 id="sk-pr-title">Prompts for the image tool</h2>
          <p className="small muted">Attach the master photo, paste its prompt, then save the result under the file name shown, in the job's output folder. The app ticks it off.</p>
        </div>
        <div className="row gap wrap">
          <button type="button" className="mini primary" disabled={!photo.count} onClick={() => copy(photo.text, `${plural(photo.count, 'prompt')} for ${photoName}`)}>
            <Icon name="clipboard" size={14} /> Copy {photo.count} for {photoName}
          </button>
          {job.images.length > 1 && (
            <button type="button" className="mini" disabled={!left.count} onClick={() => copy(left.text, `all ${plural(left.count, 'prompt')} still to make`)}>
              Copy all {left.count} left
            </button>
          )}
        </div>
      </div>

      {job.images.length > 1 && (
        <div className="sk-pr-photos" role="group" aria-label="Master photo">
          {job.images.map((im, i) => {
            const n = job.fabrics.filter((_, fi) => !job.done[`${fi}:${i}`]).length;
            return (
              <button key={i} type="button" className={`sk-pr-photo ${i === ii ? 'on' : ''}`} aria-pressed={i === ii} onClick={() => (setImage(i), setShown(null))}>
                {job.imageFiles?.[i] ? (
                  <LocalThumb path={job.imageFiles[i]} className="sk-pr-thumb" alt="" />
                ) : (
                  <span className="sk-pr-thumb ph" aria-hidden="true">
                    <Icon name="image" size={16} />
                  </span>
                )}
                <span className="sk-pr-photo-txt">
                  <b>{im}</b>
                  <small>{n ? `${n} to make` : 'All made'}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {todo.length === 0 && !withMade ? (
        <p className="sk-pr-done">
          <Icon name="checkCircle" size={18} weight="fill" /> Every fabric is made for {photoName}.
        </p>
      ) : (
        <ul className="sk-pr-list">
          {visible.map(({ f, fi, made }) => {
            const file = suggestedFileName(job, fi, ii);
            const open = shown === fi;
            const ids = job.itemIds?.[f];
            return (
              <li key={fi} className={made ? 'made' : ''}>
                <div className="sk-pr-row">
                  <span className="sk-swatch" style={{ background: colours[fi] }} aria-hidden="true" />
                  <div className="sk-pr-name">
                    <b>
                      {f}
                      {ids?.length ? <span className="sk-pr-ids"> · {ids.join(', ')}</span> : null}
                    </b>
                    <small className="ellipsis" title={file}>
                      {file}
                    </small>
                  </div>
                  {made && <span className="tag ok">Made</span>}
                  <div className="sk-pr-btns">
                    <button type="button" className="mini ghost" aria-expanded={open} onClick={() => setShown(open ? null : fi)}>
                      {open ? 'Hide' : 'Show'}
                    </button>
                    <button type="button" className="mini" title={`Copy “${file}”`} onClick={() => copy(file, 'the file name')}>
                      File name
                    </button>
                    <button type="button" className="mini" onClick={() => copy(promptFor(job, fi, ii), `the prompt for ${f}`)}>
                      <Icon name="clipboard" size={14} /> Prompt
                    </button>
                  </div>
                </div>
                {open && <pre className="sk-pr-text">{promptFor(job, fi, ii)}</pre>}
              </li>
            );
          })}
        </ul>
      )}

      <div className="row gap wrap">
        {listed.length > PROMPT_ROWS && (
          <button type="button" className="ghost mini" onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${listed.length}`}
          </button>
        )}
        {rows.length > todo.length && (
          <button type="button" className="ghost mini" aria-pressed={withMade} onClick={() => setWithMade(!withMade)}>
            {withMade ? 'Hide made ones' : `Also show ${rows.length - todo.length} made`}
          </button>
        )}
      </div>
      {dialog}
    </section>
  );
}

function JobEditor({
  job,
  prefill,
  rate,
  currency,
  clientName,
  company = 'skeidar',
  onClose,
}: {
  job?: SkeidarJob;
  prefill?: Partial<SkeidarJob>;
  rate: number;
  currency: Currency;
  clientName: string;
  company?: CompanyId;
  onClose(): void;
}) {
  const base = job ?? prefill;
  const [name, setName] = useState(base?.name ?? '');
  const [received, setReceived] = useState(localDate(job?.receivedAt ?? new Date()));
  const [images, setImages] = useState((job?.images ?? ['Image 1', 'Image 2']).join('\n'));
  const [fabrics, setFabrics] = useState((job?.fabrics ?? []).join('\n'));
  const [notes, setNotes] = useState(base?.notes ?? '');
  const [folder, setFolder] = useState(base?.folder ?? '');
  const list = (s: string, sep: RegExp) =>
    s
      .split(sep)
      .map(x => x.trim())
      .filter(Boolean);
  const f = list(fabrics, /\r?\n|,(?![^(]*\))/);
  const im = list(images, /\r?\n/);
  const missing = !name.trim() ? 'Add a job name' : !f.length ? 'Add the fabrics' : !im.length ? 'Add the source images' : '';
  const save = async () => {
    if (missing) return;
    // Keep ticks (and the files found for them) for fabrics and images that are still in the list.
    const done: Record<string, boolean> = {};
    const outputs: Record<string, string> = {};
    const imageFiles: string[] = [];
    if (job) {
      im.forEach((img, ii) => {
        const oldI = job.images.indexOf(img);
        if (oldI >= 0 && job.imageFiles?.[oldI]) imageFiles[ii] = job.imageFiles[oldI];
      });
      f.forEach((fab, fi) => {
        const oldF = job.fabrics.indexOf(fab);
        if (oldF < 0) return;
        im.forEach((img, ii) => {
          const oldI = job.images.indexOf(img);
          if (oldI < 0) return;
          if (job.done[`${oldF}:${oldI}`]) done[`${fi}:${ii}`] = true;
          const out = job.outputs?.[`${oldF}:${oldI}`];
          if (out) outputs[`${fi}:${ii}`] = out;
        });
      });
    }
    await hub.upsert('skeidarJobs', {
      // Fields the editor doesn't show (sheet, item ids, leg options) stay as they are.
      ...job,
      id: job?.id ?? uid('sk'),
      name: name.trim(),
      receivedAt: received,
      images: im,
      fabrics: f,
      done,
      outputs: Object.keys(outputs).length ? outputs : undefined,
      imageFiles: imageFiles.some(Boolean) ? Array.from(imageFiles, x => x ?? '') : undefined,
      notes: notes.trim() || undefined,
      folder: folder.trim() || undefined,
      ...(company === 'skeidar' ? {} : { company: job?.company ?? company }),
      status: job?.status ?? 'open',
      deliveredAt: job?.deliveredAt,
      createdAt: job?.createdAt ?? new Date().toISOString(),
    });
    onClose();
  };
  const count = f.length * im.length;
  return (
    <Modal
      title={job ? 'Edit job' : `New ${clientName} job`}
      onClose={onClose}
      footer={
        <>
          {job && (
            <ConfirmButton
              label="Delete"
              confirmLabel="Click again to delete"
              onConfirm={async () => {
                await hub.remove('skeidarJobs', job.id);
                onClose();
              }}
            />
          )}
          <span className="grow" />
          {missing && <span className="muted small">{missing}</span>}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={save} disabled={!!missing}>
            Save ({count} images = {formatMoney(count * rate, currency)})
          </button>
        </>
      }
    >
      <div className="grid2">
        <Field label="Job name">
          <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sofa Oslo, 9 Oct" />
        </Field>
        <Field label="Received">
          <input type="date" value={received} onChange={e => setReceived(e.target.value)} />
        </Field>
        <Field label="Source images (one per line)">
          <textarea rows={3} value={images} onChange={e => setImages(e.target.value)} />
        </Field>
        <Field label="Fabrics (one per line or comma separated)">
          <textarea rows={6} value={fabrics} onChange={e => setFabrics(e.target.value)} placeholder={'Bouclé Cream\nVelvet Forest Green\nLinen Sand'} />
        </Field>
      </div>
      <Field label="Folder (optional)">
        <div className="row gap">
          <input className="grow" value={folder} onChange={e => setFolder(e.target.value)} />
          <button
            type="button"
            onClick={async () => {
              const p = await hub.pickFolder(folder || undefined);
              if (p) setFolder(p);
            }}
          >
            Browse
          </button>
        </div>
      </Field>
      <Field label="Notes">
        <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
}
