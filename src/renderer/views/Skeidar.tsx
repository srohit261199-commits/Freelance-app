import { Fragment, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { AppState, Currency, FolderEntry, SkeidarJob, CompanyId } from '../../shared/types';
import { formatMoney, jobOutputs, localDate } from '../../shared/money';
import { uid } from '../../shared/ops';
import { hub } from '../hub';
import { ConfirmButton, Empty, Field, Icon, Modal, relTime, useApp } from '../ui';
import { jobPriority, PRIORITY_LABEL } from '../priority';
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
  yellow: '#e8c547', mustard: '#c99a2e', ochre: '#c58f2c', gold: '#c9a646', honey: '#d5a24a', lemon: '#f0dc7a', saffron: '#e0a63a',
};

/** The fabric's colour if its name says one, otherwise a stable pastel worked out from the name. */
function fabricColour(name: string): string {
  const words = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
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
  void company;
  const { toast } = useApp();
  const cfg = state.companies.find(c => c.id === 'skeidar')!;
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
    const r = await hub.scanFolder(state.settings.skeidarFolder);
    if ('error' in r) {
      setFolder(null);
      setFolderErr(r.error);
    } else setFolder(r);
  };
  useEffect(() => {
    void scan();
  }, [state.settings.skeidarFolder]);

  // A route with a job id (from Dashboard or search) selects that job and flashes it once.
  useEffect(() => {
    if (!openId) return;
    setSelId(openId);
    setFlashId(openId);
    heroRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const t = setTimeout(() => setFlashId(undefined), 1800);
    return () => clearTimeout(t);
  }, [openId]);

  const jobs = [...state.skeidarJobs].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
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
    const n = await hub.countImages(job.folder);
    setCount({ path: job.folder, n });
    toast(`Found ${plural(n, 'image')} in the job folder`);
  };
  const linkFolder = async (job: SkeidarJob) => {
    const p = await hub.pickFolder(state.settings.skeidarFolder);
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
    <div className="page sk-page c-skeidar">
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
              const r = await hub.exportExcel('skeidar');
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
            <p className="small muted break">{state.settings.skeidarFolder}</p>
          </div>
          <div className="row gap wrap">
            <button type="button" className="mini" onClick={scan}>
              <Icon name="sync" size={14} /> Rescan
            </button>
            <button
              type="button"
              className="mini"
              onClick={async () => {
                const p = await hub.pickFolder(state.settings.skeidarFolder);
                if (p) await hub.patchSettings({ skeidarFolder: p });
              }}
            >
              Change
            </button>
            <button type="button" className="mini" onClick={() => hub.openPath(state.settings.skeidarFolder)}>
              <Icon name="folder" size={14} /> Open
            </button>
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
      {editing && <JobEditor job={editing === 'new' ? undefined : editing} prefill={prefill} rate={rate} onClose={() => setEditing(null)} />}
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
            <button key={fi} type="button" className="sk-fab" aria-pressed={all} title={`${all ? 'Untick' : 'Tick'} ${f} for every image`} onClick={() => onFabric(job, fi, !all)}>
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
                <span className="sk-thumb ph" aria-hidden="true">
                  <Icon name="image" size={22} />
                </span>
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
                return (
                  <button
                    key={key}
                    type="button"
                    className={`sk-tile ${on ? 'on' : ''}`}
                    style={on ? { background: colours[fi] } : undefined}
                    aria-pressed={on}
                    aria-label={`${f}, ${im}`}
                    title={on ? `${f} · ${im}: made. Click to undo.` : `${f} · ${im}: click once it is made`}
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

function JobEditor({ job, prefill, rate, onClose }: { job?: SkeidarJob; prefill?: Partial<SkeidarJob>; rate: number; onClose(): void }) {
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
    // Keep ticks for fabrics and images that are still in the list.
    const done: Record<string, boolean> = {};
    if (job) {
      f.forEach((fab, fi) => {
        const oldF = job.fabrics.indexOf(fab);
        if (oldF < 0) return;
        im.forEach((img, ii) => {
          const oldI = job.images.indexOf(img);
          if (oldI >= 0 && job.done[`${oldF}:${oldI}`]) done[`${fi}:${ii}`] = true;
        });
      });
    }
    await hub.upsert('skeidarJobs', {
      id: job?.id ?? uid('sk'),
      name: name.trim(),
      receivedAt: received,
      images: im,
      fabrics: f,
      done,
      notes: notes.trim() || undefined,
      folder: folder.trim() || undefined,
      status: job?.status ?? 'open',
      deliveredAt: job?.deliveredAt,
      createdAt: job?.createdAt ?? new Date().toISOString(),
    });
    onClose();
  };
  const count = f.length * im.length;
  return (
    <Modal
      title={job ? 'Edit job' : 'New Skeidar job'}
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
            Save ({count} images = {formatMoney(count * rate, 'AED')})
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
