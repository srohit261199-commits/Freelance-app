import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppState, Model, ModelStatus, StatusEvent } from '../../shared/types';
import { COMPANY_STATUSES, isComplete, statusEvents, statusLabel } from '../../shared/status';
import { modelLabel } from '../../shared/planner';
import { hub } from '../hub';
import { ConfirmButton, Field, Icon, MenuButton, Modal, fmtDate, useApp } from '../ui';
import { modelPriority, PRIORITY_LABEL } from '../priority';
import { ReferenceButtons } from './References';

/** "Done (R)" for catalog rows that were delivered, then revised. */
function wiStatusText(m: Model): string {
  return statusLabel(m.status, 'waveink') + (m.revised && m.status === 'done' ? ' (R)' : '');
}

const day = (iso?: string) => (iso ? new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const sheetRows = (m: Model) => (m.rows?.length ? `sheet row${m.rows.length > 1 ? 's' : ''} ${m.rows.map(r => r + 2).join(', ')}` : '');

/** The GLB upload folder among Waveink's links. */
function glbFolderUrl(state: AppState): string | undefined {
  return state.companies.find(c => c.id === 'waveink')?.links.find(l => /glb.*folder/i.test(l.label))?.url;
}

/** Status pill that opens the Waveink statuses; shows "Done (R)" like the catalog. */
export function WiStatus({ m, onPick, className = '' }: { m: Model; onPick(s: ModelStatus): void; className?: string }) {
  return (
    <MenuButton label="Change status" text={wiStatusText(m)} className={`pill pill-btn st-${m.status} ${className}`} align="start">
      {close =>
        COMPANY_STATUSES.waveink.map(s => (
          <button
            key={s}
            type="button"
            role="menuitemradio"
            aria-checked={s === m.status}
            onClick={() => {
              close();
              if (s !== m.status) onPick(s);
            }}
          >
            <span className={`dot st-${s}`} />
            <span className="grow">{statusLabel(s, 'waveink')}</span>
            <span className="mk">{s === m.status && <Icon name="check" size={14} />}</span>
          </button>
        ))
      }
    </MenuButton>
  );
}

function progressText(h: StatusEvent): string {
  const note = h.note ?? '';
  if (h.field === 'glb') return `GLB: ${note.replace(/^GLB /, '')}`;
  if (h.field === 'notes') return `Note: ${note}`;
  return note.replace(/ done$/, '');
}

const ORIGIN: Record<Model['source'], string> = {
  catalog: 'Imported from the Tech catalog',
  'apparel-pdf': 'Imported from the apparel catalogue',
  portal: 'Pulled from the portal',
  manual: 'Added by hand',
  folder: 'Found in the output folder',
};

function History({ m }: { m: Model }) {
  const events = statusEvents(m);
  const imported = m.history.some(h => h.kind === 'import');
  const startedAs = events[0]?.from ?? m.status;
  const items: { at: string; text: ReactNode }[] = [];
  if (!imported)
    items.push({
      at: m.createdAt,
      text: (
        <>
          {ORIGIN[m.source]}
          {m.source === 'catalog' && m.rows?.length ? `, ${sheetRows(m)}` : ''}
          {startedAs !== 'todo' && (
            <>
              , already <strong>{m.revised && startedAs === 'done' ? 'Done (R)' : statusLabel(startedAs, 'waveink')}</strong>
            </>
          )}
        </>
      ),
    });
  for (const h of m.history)
    items.push({
      at: h.at,
      text:
        h.kind === 'progress' ? (
          <span className="muted">{progressText(h)}</span>
        ) : (
          <>
            {h.kind === 'import' ? 'Imported as ' : 'Moved to '}
            <strong>{statusLabel(h.to, 'waveink')}</strong>
            {h.kind !== 'import' && h.from && <span className="muted"> from {statusLabel(h.from, 'waveink')}</span>}
            {h.note && <span className="muted"> · {h.kind === 'import' ? h.note.replace(/^Imported /, '') : h.note}</span>}
          </>
        ),
    });
  return (
    <section className="wi-sec wi-history" aria-label="History">
      <h3>History</h3>
      <ol>
        {items.map((it, i) => (
          <li key={i}>
            <time dateTime={it.at} title={fmtDate(it.at, true)}>
              {day(it.at)}
            </time>
            <span className="grow">{it.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The catalog's product photos as a small thumbnail with arrows; a click opens the full size. */
function Photo({ urls }: { urls: string[] }) {
  const [i, setI] = useState(0);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const url = urls[Math.min(i, urls.length - 1)];
  if (!url) return null;
  return (
    <div className="wi-photo">
      <button type="button" className="wi-photo-open" onClick={() => hub.openUrl(url)} title="Open full size" aria-label={`Open source photo ${i + 1} full size`}>
        {failed[url] ? <Icon name="image" size={22} /> : <img src={url.replace(/image_(1024|1920)/, 'image_512')} alt="" onError={() => setFailed(f => ({ ...f, [url]: true }))} />}
      </button>
      {urls.length > 1 && (
        <div className="wi-photo-nav">
          <button type="button" aria-label="Previous image" onClick={() => setI((i + urls.length - 1) % urls.length)}>
            <Icon name="caretLeft" size={12} weight="bold" />
          </button>
          <span className="tabular">
            {i + 1} / {urls.length}
          </span>
          <button type="button" aria-label="Next image" onClick={() => setI((i + 1) % urls.length)}>
            <Icon name="caretRight" size={12} weight="bold" />
          </button>
        </div>
      )}
    </div>
  );
}

export function WaveinkDetail({ m, state, now, inDrawer, onDeleted, onPin }: { m: Model; state: AppState; now: Date; inDrawer?: boolean; onDeleted(): void; onPin?(): void }) {
  const { toast } = useApp();
  const [notes, setNotes] = useState(m.notes ?? '');
  const [glb, setGlb] = useState(m.glbFile ?? '');
  const [more, setMore] = useState(false);
  // Acting on the auto-shown model pins it, so the re-sorted list doesn't swap the panel to another model.
  const patch = (p: Partial<Model>) => (onPin?.(), hub.patchModel(m.id, p));
  // Typed fields save shortly after typing stops, on blur, and when the model changes or the panel closes.
  const pending = useRef<{ id: string; patch: Partial<Model> } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const p = pending.current;
    pending.current = null;
    if (p && Object.keys(p.patch).length) hub.patchModel(p.id, p.patch);
  }, []);
  const edit = (key: 'notes' | 'glbFile', value: string) => {
    onPin?.();
    const next = { ...pending.current?.patch };
    if (value === (m[key] ?? '')) delete next[key];
    else next[key] = value;
    pending.current = { id: m.id, patch: next };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  };
  useEffect(() => {
    setNotes(m.notes ?? '');
    setGlb(m.glbFile ?? '');
    setMore(false);
  }, [m.id]);
  useEffect(() => flush, [m.id, flush]);

  const set = (to: ModelStatus) => (onPin?.(), hub.setStatus([m.id], to)).then(() => toast(`${modelLabel(m)} → ${statusLabel(to, 'waveink')}`));
  const done = isComplete(m.status);
  const folder = glbFolderUrl(state);
  const prio = modelPriority(m, state, now);
  const sub = (m.subcategories ?? []).join(', ') || m.group || '';
  const links = [
    folder && { label: 'GLB upload folder', url: folder },
    m.sourceUrls?.[0] && { label: 'Product photo, full size', url: m.sourceUrls[0] },
    m.portalUrl && { label: 'Portal page', url: m.portalUrl },
  ].filter(Boolean) as { label: string; url: string }[];
  const none = <span className="faint">—</span>;
  const facts: [string, ReactNode][] = [
    ['Brand', m.brand || none],
    ['Colour', m.colour || none],
    ['Branding area', m.brandingAreas || (m.hasPrintArea === false ? 'No print area' : none)],
    ['Print methods', m.printMethods || none],
  ];
  if (m.variants) facts.push(['Variants', m.variants]);
  if (m.templateId)
    facts.push([
      'Template ID',
      <>
        {m.templateId} <span className="muted">· names the backend image files</span>
      </>,
    ]);

  return (
    <div className="wi-detail-body">
      <div className="wi-dhead">
        {m.code && <span className="tag wi-code">{m.code}</span>}
        <span className="wi-dsub grow">{[sub, sheetRows(m)].filter(Boolean).join(' · ')}</span>
        {!done && m.status !== 'skipped' && (
          <span className={`flag ${prio}`} title="Worked out from status, due date and the work order">
            <Icon name="flag" weight="fill" size={12} />
            {PRIORITY_LABEL[prio]}
          </span>
        )}
        <button type="button" className={`icon-btn ghost mini wi-star ${m.starred ? 'on' : ''}`} aria-pressed={!!m.starred} aria-label={m.starred ? 'Unstar (stops putting it first)' : 'Star (puts it first in the work order)'} title={m.starred ? 'Starred: first in the work order' : 'Star to put it first in the work order'} onClick={() => patch({ starred: !m.starred })}>
          <Icon name="star" weight={m.starred ? 'fill' : 'regular'} />
        </button>
        {links.length > 0 && (
          <MenuButton label="More for this model" icon="dots" className="ghost mini">
            {close =>
              links.map(l => (
                <button
                  key={l.url}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    hub.openUrl(l.url);
                  }}
                >
                  <span className="grow">{l.label}</span>
                  <Icon name="external" size={13} />
                </button>
              ))
            }
          </MenuButton>
        )}
      </div>
      {!inDrawer && <h2 className="wi-dtitle">{m.name}</h2>}

      <div className="wi-doacts">
        <WiStatus m={m} onPick={s => void set(s)} className="status-dd" />
        {!done && (
          <button type="button" className="primary" onClick={() => set('done')}>
            <Icon name="checkCircle" weight="fill" />
            Mark done
          </button>
        )}
        <span className="wi-refs">
          <ReferenceButtons m={m} state={state} />
        </span>
      </div>

      <section className="wi-sec" aria-label="Product">
        <div className="wi-product">
          <Photo key={m.id} urls={m.sourceUrls ?? []} />
          <dl className="wi-facts">
            {facts.map(([k, v]) => (
              <div key={k} className="wi-fact">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        {m.description && (
          <p className="wi-desc">
            <span className={more ? '' : 'wi-clamp'}>{m.description}</span>
            {m.description.length > 160 && (
              <button type="button" className="link-btn wi-link" onClick={() => setMore(!more)} aria-expanded={more}>
                {more ? 'Show less' : 'Show more'}
              </button>
            )}
          </p>
        )}
      </section>

      <section className="wi-sec wi-work" aria-label="Your progress">
        <div className="wi-work-row">
          <label className="field">
            <span>
              % complete <b className="tabular">{m.percent ?? 0}%</b>
            </span>
            <input type="range" min={0} max={100} step={5} value={m.percent ?? 0} onChange={e => patch({ percent: Number(e.target.value) })} />
          </label>
          <Field label="GLB file name">
            <input value={glb} placeholder={`${m.code ?? 'name'}.glb`} onChange={e => (setGlb(e.target.value), edit('glbFile', e.target.value))} onBlur={flush} />
          </Field>
        </div>
        <Field label="Update / notes · goes into the tracker export">
          <textarea rows={2} value={notes} onChange={e => (setNotes(e.target.value), edit('notes', e.target.value))} onBlur={flush} />
        </Field>
      </section>

      <History m={m} />

      {m.source !== 'catalog' && (
        <div>
          <ConfirmButton
            className="danger ghost mini wi-del"
            icon={<Icon name="trash" />}
            label="Delete model"
            confirmLabel="Click again to delete"
            onConfirm={async () => {
              clearTimeout(timer.current);
              pending.current = null;
              await hub.remove('models', m.id);
              onDeleted();
            }}
          />
        </div>
      )}
    </div>
  );
}

export function AddWaveinkModel({ all, group: initialGroup, onClose, onAdded }: { all: Model[]; group: string; onClose(): void; onAdded(id: string, group: string): void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [group, setGroup] = useState(initialGroup === 'Other' ? '' : initialGroup);
  const [sub, setSub] = useState('');
  const [status, setStatus] = useState<ModelStatus>('todo');
  const groups = [...new Set(all.map(m => m.group).filter(Boolean))] as string[];
  const subs = [...new Set(all.filter(m => !group || m.group === group).flatMap(m => m.subcategories ?? []))].sort();
  const clash = code.trim() && all.find(m => m.code?.toLowerCase() === code.trim().toLowerCase());
  const save = async () => {
    if (!name.trim()) return;
    const id = await hub.addModel({
      company: 'waveink',
      name: name.trim(),
      code: code.trim() || undefined,
      group: group.trim() || undefined,
      subcategories: sub.trim() ? [sub.trim()] : undefined,
      status: 'todo',
    });
    if (status !== 'todo') await hub.setStatus([id], status);
    onAdded(id, group.trim() || 'Other');
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
      <div className="grid2 wi-form">
        <Field label="Jasani code" hint={clash ? `Already used by ${clash.name}` : undefined}>
          <input value={code} onChange={e => setCode(e.target.value)} />
        </Field>
        <Field label="Group">
          <input list="wi-groups" value={group} onChange={e => setGroup(e.target.value)} />
          <datalist id="wi-groups">
            {groups.map(g => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </Field>
        <Field label="Subcategory">
          <input list="wi-subs" value={sub} onChange={e => setSub(e.target.value)} />
          <datalist id="wi-subs">
            {subs.map(s => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label="Status">
          <select value={status} onChange={e => setStatus(e.target.value as ModelStatus)}>
            {COMPANY_STATUSES.waveink.map(s => (
              <option key={s} value={s}>
                {statusLabel(s, 'waveink')}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  );
}
