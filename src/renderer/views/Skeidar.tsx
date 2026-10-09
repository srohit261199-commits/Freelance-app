import { useEffect, useState } from 'react';
import type { AppState, FolderEntry, SkeidarJob } from '../../shared/types';
import { formatMoney, jobOutputs } from '../../shared/money';
import { uid } from '../../shared/ops';
import { hub } from '../hub';
import { ConfirmButton, Empty, Field, Icon, Modal, Progress, fmtDate, relTime, useApp } from '../ui';

export function Skeidar({ state, now, openId }: { state: AppState; now: Date; openId?: string }) {
  const { toast } = useApp();
  const cfg = state.companies.find(c => c.id === 'skeidar')!;
  const rate = cfg.pay.kind === 'per-item' ? cfg.pay.rate : 5;
  const [editing, setEditing] = useState<SkeidarJob | 'new' | null>(null);
  const [folder, setFolder] = useState<FolderEntry[] | null>(null);
  const [folderErr, setFolderErr] = useState('');
  const [prefill, setPrefill] = useState<Partial<SkeidarJob> | undefined>();
  const [showDelivered, setShowDelivered] = useState(false);

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

  const jobs = [...state.skeidarJobs].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const open = jobs.filter(j => j.status === 'open');
  const delivered = jobs.filter(j => j.status === 'delivered');
  const totals = jobs.reduce(
    (s, j) => {
      const o = jobOutputs(j);
      return { done: s.done + o.done, total: s.total + o.total };
    },
    { done: 0, total: 0 },
  );
  const linked = new Set(jobs.map(j => j.folder).filter(Boolean));

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
    await hub.upsert('skeidarJobs', { ...job, status: job.status === 'open' ? 'delivered' : 'open', deliveredAt: job.status === 'open' ? new Date().toISOString() : undefined });
    toast(job.status === 'open' ? `${job.name} delivered` : `${job.name} reopened`);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>
            <span className="cdot big" style={{ background: cfg.color }} /> Skeidar
          </h1>
          <p className="muted">
            {cfg.role} · {formatMoney(rate, 'AED')} per image · {totals.done} images made, {formatMoney(totals.done * rate, 'AED')} earned
          </p>
        </div>
        <div className="actions">
          <button
            type="button"
            onClick={async () => {
              const r = await hub.exportExcel('skeidar');
              if (r.path) toast(`Saved ${r.path}`);
            }}
          >
            <Icon name="download" /> Export Excel
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              setPrefill(undefined);
              setEditing('new');
            }}
          >
            <Icon name="plus" /> New job
          </button>
        </div>
      </header>

      <div className="cols">
        <div className="grow">
          {open.length === 0 && (
            <Empty title="No open jobs">
              When a Teams message brings 2 images and a fabric list, add a job: paste the fabrics, one per line. Tick each image as you finish it.
            </Empty>
          )}
          {open.map(j => (
            <JobCard key={j.id} job={j} rate={rate} highlight={j.id === openId} onToggle={toggle} onFabric={fabricAll} onEdit={() => setEditing(j)} onDeliver={() => deliver(j)} />
          ))}
          {delivered.length > 0 && (
            <button type="button" className="ghost" onClick={() => setShowDelivered(!showDelivered)}>
              {showDelivered ? 'Hide' : 'Show'} {delivered.length} delivered job{delivered.length > 1 ? 's' : ''}
            </button>
          )}
          {showDelivered &&
            delivered.map(j => <JobCard key={j.id} job={j} rate={rate} onToggle={toggle} onFabric={fabricAll} onEdit={() => setEditing(j)} onDeliver={() => deliver(j)} />)}
        </div>

        <aside className="side-col">
          <section className="card">
            <h2>Project folder</h2>
            <p className="small muted break">{state.settings.skeidarFolder}</p>
            <div className="row gap">
              <button type="button" className="mini" onClick={scan}>
                <Icon name="sync" size={13} /> Rescan
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
                <Icon name="folder" size={13} /> Open
              </button>
            </div>
            {folderErr && <p className="small warn-text">{folderErr}</p>}
            {folder && folder.length === 0 && <p className="small muted">No subfolders or images yet.</p>}
            <ul className="list">
              {folder?.map(f => (
                <li key={f.path}>
                  <div>
                    <strong>{f.name}</strong>
                    <div className="muted small">
                      {f.images} image{f.images === 1 ? '' : 's'}
                      {f.lastModified && ` · ${relTime(f.lastModified, now)}`}
                    </div>
                  </div>
                  {!linked.has(f.path) && f.name !== '(files in this folder)' && (
                    <button
                      type="button"
                      className="mini"
                      onClick={() => {
                        setPrefill({ name: f.name, folder: f.path, notes: `${f.images} images in folder when created.` });
                        setEditing('new');
                      }}
                    >
                      Make job
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
      {editing && <JobEditor job={editing === 'new' ? undefined : editing} prefill={prefill} rate={rate} onClose={() => setEditing(null)} />}
    </div>
  );
}

function JobCard({
  job,
  rate,
  highlight,
  onToggle,
  onFabric,
  onEdit,
  onDeliver,
}: {
  job: SkeidarJob;
  rate: number;
  highlight?: boolean;
  onToggle(j: SkeidarJob, key: string): void;
  onFabric(j: SkeidarJob, f: number, on: boolean): void;
  onEdit(): void;
  onDeliver(): void;
}) {
  const { done, total } = jobOutputs(job);
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (job.folder) hub.countImages(job.folder).then(setCount);
  }, [job.folder]);
  return (
    <section className={`card job ${highlight ? 'hl' : ''} ${job.status}`}>
      <header className="row between">
        <div>
          <h3>{job.name}</h3>
          <div className="muted small">
            Received {fmtDate(job.receivedAt)} · {job.fabrics.length} fabrics × {job.images.length} images = {total} outputs · {formatMoney(done * rate, 'AED')} of {formatMoney(total * rate, 'AED')}
            {count !== null && ` · ${count} files in folder`}
          </div>
        </div>
        <div className="row gap">
          {job.folder && (
            <button type="button" className="mini" onClick={() => hub.openPath(job.folder!)}>
              <Icon name="folder" size={13} />
            </button>
          )}
          <button type="button" className="mini" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className={`mini ${job.status === 'open' && done === total && total > 0 ? 'primary' : ''}`} onClick={onDeliver}>
            {job.status === 'open' ? 'Mark delivered' : 'Reopen'}
          </button>
        </div>
      </header>
      <Progress value={done} total={total} color="#ea580c" />
      {job.notes && <p className="small muted">{job.notes}</p>}
      <div className="fabric-grid" style={{ gridTemplateColumns: `minmax(140px, 1fr) repeat(${job.images.length}, 90px)` }}>
        <div className="fg-head">Fabric</div>
        {job.images.map((im, i) => (
          <div key={i} className="fg-head center">
            {im}
          </div>
        ))}
        {job.fabrics.map((f, fi) => {
          const all = job.images.every((_, i) => job.done[`${fi}:${i}`]);
          return (
            <div key={fi} className="contents">
              <button type="button" className={`fg-name ${all ? 'done' : ''}`} onClick={() => onFabric(job, fi, !all)} title="Tick or untick this fabric for every image">
                {f}
              </button>
              {job.images.map((_, i) => (
                <label key={i} className="fg-cell">
                  <input type="checkbox" checked={!!job.done[`${fi}:${i}`]} onChange={() => onToggle(job, `${fi}:${i}`)} />
                </label>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function JobEditor({ job, prefill, rate, onClose }: { job?: SkeidarJob; prefill?: Partial<SkeidarJob>; rate: number; onClose(): void }) {
  const base = job ?? prefill;
  const [name, setName] = useState(base?.name ?? '');
  const [received, setReceived] = useState((job?.receivedAt ?? new Date().toISOString()).slice(0, 10));
  const [images, setImages] = useState((job?.images ?? ['Image 1', 'Image 2']).join('\n'));
  const [fabrics, setFabrics] = useState((job?.fabrics ?? []).join('\n'));
  const [notes, setNotes] = useState(base?.notes ?? '');
  const [folder, setFolder] = useState(base?.folder ?? '');
  const lines = (s: string) =>
    s
      .split(/\r?\n|,(?![^(]*\))/)
      .map(x => x.trim())
      .filter(Boolean);
  const save = async () => {
    const f = lines(fabrics);
    const im = lines(images);
    if (!name.trim() || !f.length || !im.length) return;
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
  const count = lines(fabrics).length * lines(images).length;
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
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={save}>
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
