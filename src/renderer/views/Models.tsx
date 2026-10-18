import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState, Complexity, Model, ModelStatus, StatusEvent } from '../../shared/types';
import { statusesFor, COMPLEXITY_LABELS, isComplete, statusLabel } from '../../shared/status';
import { formatMoney, tierFee } from '../../shared/money';
import { modelLabel } from '../../shared/planner';
import { hub } from '../hub';
import { ConfirmButton, Drawer, Field, Icon, Modal, StatusPicker, Thumb, fmtDate, useApp, type IconName } from '../ui';
import './Models.css';

export interface NextStep {
  to: ModelStatus;
  label: string;
  icon: IconName;
}
const NEXT: Partial<Record<ModelStatus, NextStep>> = {
  revision: { to: 'in_progress', label: 'Fix now', icon: 'pencil' },
  todo: { to: 'in_progress', label: 'Start', icon: 'play' },
  in_progress: { to: 'review', label: 'Submit', icon: 'send' },
  review: { to: 'done', label: 'Done', icon: 'checkCircle' },
};

/** A model's one-click next step, shown on its list row and beside its status in the drawer. MetaZtech's portal approves what is in review, so there is none there. */
export function nextStep(m: Pick<Model, 'status' | 'company'>): NextStep | undefined {
  return m.status === 'review' && m.company === 'metaztech' ? undefined : NEXT[m.status];
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
  const setStatus = (to: ModelStatus) => hub.setStatus([m.id], to).then(() => toast(`${modelLabel(m)} → ${statusLabel(to, m.company)}`));
  const step = nextStep(m);

  return (
    <Drawer className="md-drawer" onClose={onClose} title={m.name} subtitle={[m.code, m.group, ...(m.subcategories ?? [])].filter(Boolean).join(' · ')}>
      <div className="md-acts">
        <StatusPicker className="status-dd" status={m.status} company={m.company} onPick={s => void setStatus(s)} />
        {step && (
          <button type="button" className="primary" onClick={() => void setStatus(step.to)}>
            <Icon name={step.icon} />
            {step.label}
          </button>
        )}
        <span className="grow" />
        {m.portalUrl && (
          <button type="button" className="ghost mini" onClick={() => hub.openUrl(m.portalUrl!)}>
            Portal page <Icon name="external" size={12} />
          </button>
        )}
        <button
          type="button"
          className="ghost icon-btn mini md-star"
          aria-label="Star"
          aria-pressed={!!m.starred}
          title={m.starred ? 'Starred: first in the work order' : 'Star to put it first in the work order'}
          onClick={() => patch({ starred: !m.starred })}
        >
          <Icon name="star" weight={m.starred ? 'fill' : 'regular'} />
        </button>
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
          <h3>Reference images</h3>
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
        <>
          <h3>From the portal</h3>
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
        </>
      )}

      <h3>History</h3>
      {m.history.length > 0 ? (
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
      ) : (
        <p className="muted small">No status changes yet{m.source === 'catalog' && isComplete(m.status) ? ' (marked done in the Waveink catalog)' : ''}.</p>
      )}
      {m.source !== 'catalog' && (
        <ConfirmButton
          className="danger ghost mini md-delete"
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

function progressText(h: StatusEvent): string {
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
