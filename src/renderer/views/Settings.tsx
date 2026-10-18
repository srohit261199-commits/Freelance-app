import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { AppState, CompanyConfig, CompanyId, Complexity, Currency, Model, PortalField, PortalMapping, PortalTable } from '../../shared/types';
import { COMPLEXITY_LABELS, isComplete } from '../../shared/status';
import { daysUntil, ordinal } from '../../shared/money';
import { DEFAULT_WORKDAYS, paceText, weekProgress, WEEKDAYS } from '../../shared/pace';
import { clientFolder, withFolder } from '../../shared/assets';
import { hub } from '../hub';
import { CompanyDot, ConfirmButton, Dropdown, Field, Icon, PageHead, fmtDate, useApp, type IconName } from '../ui';
import { FIELDS, PortalImport, parsePaste } from './PortalImport';
import { AddClient, JobEditor, clientIcon, daysText, isBuiltIn, jobPayText } from './JobDetails';
import './Settings.css';

type AppInfo = { version: string; dataDir: string };

export function Settings({ state, now }: { state: AppState; now: Date }) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    hub.appInfo().then(setInfo);
  }, []);

  return (
    <div className="page set-page">
      <PageHead title="Settings & import" meta={<span>Client sheets, clients and pay, folders, currencies and the app</span>} />

      <div className="set-grid">
        <div className="set-main">
          <ImportPanel state={state} />
          <ClientList state={state} now={now} />
        </div>
        <div className="panel set-prefs">
          <h2 className="sr-only">Preferences</h2>
          <MoneySection state={state} />
          <FoldersSection state={state} />
          <AppSection state={state} />
          <DataSection info={info} />
        </div>
      </div>

      <section className="panel" aria-labelledby="set-pay-title">
        <div className="panel-head set-panel-head">
          <h2 id="set-pay-title">Pay and briefs</h2>
          <span className="muted small">Each client's pay rule, and the brief kept with it</span>
        </div>
        <div className="set-pays">
          {state.companies
            .filter(c => !c.archived)
            .map(c => (
              <CompanyEditor key={c.id} company={c} />
            ))}
        </div>
      </section>
    </div>
  );
}

/* ---------- import ---------- */

const SPREADSHEET = ['xlsx', 'xls', 'xlsm', 'xlsb', 'ods', 'numbers'];
const TEXT_TABLE = ['csv', 'tsv', 'txt'];
const SHORT: Record<PortalField, string> = { id: 'ID', name: 'name', status: 'status', complexity: 'complexity', revisions: 'rejections', due: 'due date', approved: 'approved on', project: 'project' };
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const firstAdded = (ms: Model[]) => ms.reduce((a, m) => (!a || m.createdAt < a ? m.createdAt : a), '');

function ImportPanel({ state }: { state: AppState }) {
  const { go, toast } = useApp();
  const [client, setClient] = useState<CompanyId>('metaztech');
  const [over, setOver] = useState(false);
  const [note, setNote] = useState('');
  const [importing, setImporting] = useState<{ mode: 'paste' } | { mode: 'file'; table: PortalTable } | null>(null);
  const [mapSig, setMapSig] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);
  const mz = client === 'metaztech';

  const wi = state.models.filter(m => m.company === 'waveink');
  const tech = wi.filter(m => m.source === 'catalog');
  const apparel = wi.filter(m => m.source === 'apparel-pdf');
  const techRows = tech.reduce((n, m) => n + (m.rows?.length || 1), 0);
  const maps = state.settings.portalMappings;
  const mapping = maps.find(m => m.signature === mapSig) ?? maps[maps.length - 1];
  const fromPortal = state.models.filter(m => m.company === 'metaztech' && m.source === 'portal').length;
  const openWaveink = () => go({ view: 'company', company: 'waveink' });
  const openMetaZtech = () => go({ view: 'company', company: 'metaztech' });

  const openTable = (text: string, source: string) => {
    const t = parsePaste(text);
    if (!t) return setNote(`${source} has no rows under its header row. The first row must be the column names.`);
    setNote('');
    setImporting({ mode: 'file', table: { ...t, source } });
  };

  const readFile = async (f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (!mz) return setNote(`${f.name} wasn't read: only MetaZtech tables can be imported from a file for now. Pick MetaZtech above if it's a CMS table.`);
    if (ext === 'pdf') return setNote(`${f.name} is a PDF, which can't be read here yet. Copy the table out of the PDF and paste it here, or save it as CSV and drop that.`);
    if (SPREADSHEET.includes(ext)) return setNote(`${f.name} is an Excel file, which can't be read here yet. In Excel use File → Save As → CSV UTF-8, then drop the CSV here.`);
    if (!TEXT_TABLE.includes(ext) && !f.type.startsWith('text/')) return setNote(`${f.name} isn't a table. Drop a CSV file, or paste a table copied from the CMS.`);
    try {
      openTable(await f.text(), f.name);
    } catch (err) {
      setNote(`${f.name} couldn't be read: ${String(err)}`);
    }
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) return void readFile(f);
    const text = e.dataTransfer.getData('text/plain');
    if (text && mz) openTable(text, 'Dropped table');
  };

  const hint = mz ? (
    <>
      Or{' '}
      <button type="button" className="link-btn set-inline" onClick={() => setImporting({ mode: 'paste' })}>
        paste a table
      </button>{' '}
      from the CMS. Excel and PDF tables need saving as CSV first. Re-importing updates rows instead of duplicating them.
    </>
  ) : client === 'waveink' ? (
    <>
      Waveink sheets can't be read from a file yet. The Tech catalog and apparel list below were loaded at setup;{' '}
      <button type="button" className="link-btn set-inline" onClick={openWaveink}>
        update statuses on Waveink
      </button>{' '}
      and export the sheet back.
    </>
  ) : (
    <>
      Skeidar jobs aren't imported from files: each Teams job is added on the{' '}
      <button type="button" className="link-btn set-inline" onClick={() => go({ view: 'skeidar' })}>
        Skeidar page
      </button>{' '}
      with its images and fabric list.
    </>
  );

  return (
    <section className="panel set-import" aria-labelledby="set-import-title">
      <h2 id="set-import-title" className="sr-only">
        Import
      </h2>
      <div
        className={`set-drop ${over ? 'over' : ''}`}
        onDragOver={e => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setOver(true);
        }}
        onDragLeave={e => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
        onDrop={drop}
        onPaste={e => {
          const text = e.clipboardData?.getData('text/plain');
          if (!text || (e.target as HTMLElement).closest('input, textarea')) return;
          e.preventDefault();
          if (mz) openTable(text, 'Pasted table');
          else setNote('Only MetaZtech tables can be pasted for now. Pick MetaZtech above first.');
        }}
      >
        <span className="set-drop-ic" aria-hidden="true">
          <Icon name="fileUp" size={20} />
        </span>
        <div className="set-drop-txt">
          <b>Drop an Excel, CSV or PDF</b>
          <p>{hint}</p>
        </div>
        <div className="set-drop-ctl">
          <Dropdown
            label="Which client the file is for"
            prefix="For"
            value={client}
            options={state.companies.filter(c => !c.archived).map(c => ({ value: c.id, label: c.name, client: c.id }))}
            onChange={c => {
              setClient(c);
              setNote('');
            }}
          />
          <button type="button" className="primary" disabled={!mz} title={mz ? undefined : 'Only MetaZtech tables can be imported from a file for now'} onClick={() => fileRef.current?.click()}>
            <Icon name="fileUp" /> Choose file
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf,text/csv"
            onChange={e => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void readFile(f);
            }}
          />
        </div>
      </div>
      {note && (
        <div className="banner warn small set-note" role="status">
          <Icon name="info" />
          <span className="grow">{note}</span>
          <button type="button" className="ghost icon-btn mini set-note-x" aria-label="Dismiss" onClick={() => setNote('')}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      <section className="set-sub" aria-labelledby="set-files-title">
        <h3 id="set-files-title">Imported</h3>
        <ul className="set-files">
          {tech.length > 0 && (
            <li>
              <span className="set-file-ic xl" aria-hidden="true">
                <Icon name="excel" size={18} weight="fill" />
              </span>
              <span className="set-file-txt">
                <b className="ellipsis">Tech_Products Designer.xlsx</b>
                <small>
                  {techRows} rows → {tech.length} products, grouped by Jasani code · {tech.filter(m => isComplete(m.status)).length} already done
                </small>
              </span>
              <span className="set-file-btns">
                <button
                  type="button"
                  className="mini"
                  title="Same columns and row order as the client's sheet, with 3D Model Status filled in"
                  onClick={async () => {
                    const r = await hub.exportExcel('waveink');
                    if (r.path) toast(`Saved ${r.path}`);
                    else if (r.error) toast(r.error, 'error');
                  }}
                >
                  <Icon name="download" size={14} /> Export updated sheet
                </button>
                <button type="button" className="mini" aria-label="Open Waveink" title="Open Waveink" onClick={openWaveink}>
                  Open
                </button>
              </span>
            </li>
          )}
          {apparel.length > 0 && (
            <li>
              <span className="set-file-ic pdf" aria-hidden="true">
                <Icon name="filePdf" size={18} weight="fill" />
              </span>
              <span className="set-file-txt">
                <b className="ellipsis">PP Apparel Hub catalogue 2025.pdf</b>
                <small>
                  {plural(apparel.length, 'apparel model')} · {apparel.filter(m => isComplete(m.status)).length} done · added {fmtDate(firstAdded(apparel))}
                </small>
              </span>
              <span className="set-file-btns">
                <button type="button" className="mini" aria-label="Open Waveink" title="Open Waveink" onClick={openWaveink}>
                  Open
                </button>
              </span>
            </li>
          )}
          <li>
            <span className="set-file-ic mz" aria-hidden="true">
              <Icon name="table" size={18} weight="fill" />
            </span>
            <span className="set-file-txt">
              <b className="ellipsis">MetaZtech CMS table</b>
              <small>
                {mapping
                  ? `${FIELDS.filter(f => (mapping.fields[f.key] ?? -1) >= 0)
                      .map(f => SHORT[f.key])
                      .join(', ')} · remembered${fromPortal ? ` · ${plural(fromPortal, 'model')}` : ''}`
                  : 'Not imported yet: pull, paste or drop it, and the columns you match are remembered here for next time'}
              </small>
            </span>
            <span className="set-file-btns">
              <button type="button" className="mini" aria-label="Open MetaZtech" title="Open MetaZtech" onClick={openMetaZtech}>
                Open
              </button>
            </span>
          </li>
        </ul>
      </section>

      {mapping && (
        <section className="set-sub" aria-labelledby="set-map-title">
          <div className="set-map-head">
            <h3 id="set-map-title">Column mapping</h3>
            <span className="muted small grow">MetaZtech CMS table · used again the next time a table with these columns comes in</span>
            {maps.length > 1 && (
              <select className="set-map-pick" aria-label="Saved table" value={mapping.signature} onChange={e => setMapSig(e.target.value)}>
                {maps.map((m, i) => (
                  <option key={m.signature} value={m.signature}>
                    Table {i + 1}: {m.signature.split('|').slice(0, 3).join(', ')}…
                  </option>
                ))}
              </select>
            )}
          </div>
          <MappingTable state={state} mapping={mapping} />
        </section>
      )}

      {importing && <PortalImport state={state} mode={importing.mode} file={importing.mode === 'file' ? importing.table : undefined} onClose={() => setImporting(null)} />}
    </section>
  );
}

/** The saved MetaZtech mapping, one row per sheet column, with the first imported value as a sample. */
function MappingTable({ state, mapping }: { state: AppState; mapping: PortalMapping }) {
  const parts = mapping.signature.split('|');
  const keyOf = (k: string, i: number) => (parts[i] === '' && k === `Column ${i + 1}` ? '' : k.toLowerCase());
  const sample = state.models.find(m => m.company === 'metaztech' && m.portalRow && Object.keys(m.portalRow).map(keyOf).join('|') === mapping.signature)?.portalRow;
  const keys = sample ? Object.keys(sample) : [];
  const cols = parts.map((p, i) => ({ name: keys[i] || (p ? p[0].toUpperCase() + p.slice(1) : `Column ${i + 1}`), first: sample?.[keys[i]] ?? '' }));
  const fieldOf = (i: number) => FIELDS.find(f => mapping.fields[f.key] === i)?.key ?? '';

  const assign = (i: number, key: PortalField | '') => {
    const fields = { ...mapping.fields };
    for (const f of FIELDS) if (fields[f.key] === i) fields[f.key] = -1;
    if (key) fields[key] = i;
    void hub.patchSettings({ portalMappings: state.settings.portalMappings.map(m => (m.signature === mapping.signature ? { ...m, fields } : m)) });
  };

  return (
    <div className="set-map">
      <div className="set-map-row set-th" aria-hidden="true">
        <span>Sheet column</span>
        <span>First value</span>
        <span>Goes into</span>
      </div>
      <ul>
        {cols.map((c, i) => (
          <li key={i} className="set-map-row">
            <span className="set-map-col ellipsis" title={c.name}>
              {c.name}
            </span>
            <span className="set-map-val ellipsis" title={c.first}>
              {c.first || <span className="faint">—</span>}
            </span>
            <select className={fieldOf(i) ? '' : 'none'} value={fieldOf(i)} aria-label={`Goes into, for the column ${c.name}`} onChange={e => assign(i, e.target.value as PortalField | '')}>
              <option value="">— Not used</option>
              {FIELDS.map(f => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- clients ---------- */

const WORKFLOW: Record<'models' | 'variations', string> = { models: 'List of models', variations: 'Image variations' };
const SHORT_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Every client, built-in and added by hand. Archived ones stay listed, dimmed, so they can be brought back. */
function ClientList({ state, now }: { state: AppState; now: Date }) {
  const [editing, setEditing] = useState<CompanyId | null>(null);
  const [adding, setAdding] = useState(false);
  const list = [...state.companies].sort((a, b) => Number(!!a.archived) - Number(!!b.archived));
  const live = list.filter(c => !c.archived).length;

  return (
    <section className="panel set-cl" aria-labelledby="set-clients-title">
      <div className="panel-head set-panel-head">
        <h2 id="set-clients-title">Clients</h2>
        <span className="muted small grow">
          {live} on the books{list.length > live ? `, ${list.length - live} archived` : ''} · start dates, targets and deadlines decide what's urgent
        </span>
        <button type="button" className="mini" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} /> Add client
        </button>
      </div>
      <div className="set-cl-row set-th" aria-hidden="true">
        <span>Client</span>
        <span>Pay</span>
        <span>Started</span>
        <span>Weekly expectations</span>
        <span />
      </div>
      <ul>
        {list.map(c => {
          const ex = c.expectations;
          const t = ex?.target;
          // A weekly target the job hasn't reached yet (it starts after this week's working days) shows as the target itself
          const p = weekProgress(state, c.id, now);
          const pace = p?.target ? p : null;
          const dl = ex?.deadlines ?? [];
          // "5 models a week", with the working days when they aren't Monday to Friday
          const goal = t && `${t.count} ${t.unit} a ${t.per}${ex?.workdays?.length && daysText(ex.workdays) !== daysText(DEFAULT_WORKDAYS) ? ` · ${daysText(ex.workdays)}` : ''}`;
          const dlText = dl.length > 0 && `${dl.length} deadline${dl.length === 1 ? '' : 's'} · ${[...new Set(dl.map(d => SHORT_DAY[d.weekday]))].join(', ')}`;
          const starts = c.startDate ? daysUntil(c.startDate, now) : undefined;
          const ended = !!c.endDate && daysUntil(c.endDate, now) < 0;
          const work = WORKFLOW[c.workflow ?? (c.id === 'skeidar' ? 'variations' : 'models')];
          return (
            <li key={c.id} className={`set-cl-row ${c.archived ? 'off' : ''}`}>
              <div className="set-cl-who" title={c.role || (isBuiltIn(c) ? 'Built in' : 'Added by hand')}>
                <span className={`set-cl-ic c-${c.id}`} aria-hidden="true">
                  <Icon name={clientIcon(c)} size={16} weight="fill" />
                </span>
                <span className="set-cl-name">
                  <b className="ellipsis">{c.name}</b>
                  <small className="ellipsis">{c.archived ? `Archived · ${work}` : work}</small>
                </span>
              </div>
              <span className="set-cl-cell" data-label="Pay">
                {jobPayText(c)}
              </span>
              <span className="set-cl-cell" data-label="Started">
                {!c.startDate ? <span className="faint">Not set</span> : starts !== undefined && starts > 0 ? `Starts ${fmtDate(c.startDate)}` : fmtDate(c.startDate)}
                {c.endDate && <small>{`${ended ? 'Ended' : 'Ends'} ${fmtDate(c.endDate)}`}</small>}
              </span>
              <span className="set-cl-cell set-cl-pace" data-label="Weekly expectations">
                {pace ? (
                  <span className={pace.behind ? 'set-cl-behind' : ''}>
                    {pace.behind && <Icon name="flag" size={12} weight="fill" />}
                    {paceText(pace)}
                  </span>
                ) : (
                  goal || <span className="faint">No target</span>
                )}
                {(pace || dlText) && (
                  <small title={dl.map(d => `${d.label}, every ${WEEKDAYS[d.weekday]}${d.time ? ` at ${d.time}` : ''}`).join('\n') || undefined}>
                    {[pace && goal, dlText].filter(Boolean).join(' · ')}
                  </small>
                )}
              </span>
              <div className="set-cl-btns">
                <button type="button" className="mini" onClick={() => setEditing(c.id)} aria-label={`Edit ${c.name}`} title={isBuiltIn(c) ? undefined : c.archived ? 'Edit, or restore the client' : 'Edit, or archive the client'}>
                  <Icon name="pencil" size={14} /> Edit
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {editing && <JobEditor state={state} company={editing} onClose={() => setEditing(null)} />}
      {adding && <AddClient state={state} onClose={() => setAdding(false)} />}
    </section>
  );
}

/* ---------- preferences ---------- */

function MoneySection({ state }: { state: AppState }) {
  const s = state.settings;
  return (
    <section className="set-sec" aria-labelledby="set-money-title">
      <h3 id="set-money-title">Currency</h3>
      <div className="set-money">
        <Field label="Base currency">
          <select value={s.baseCurrency} onChange={e => hub.patchSettings({ baseCurrency: e.target.value as Currency })}>
            <option value="INR">₹ INR</option>
            <option value="AED">AED</option>
            <option value="USD">US$ USD</option>
          </select>
        </Field>
        <Field label="1 AED in ₹">
          <NumberInput digits={2} value={s.rates.AED} onSave={v => hub.patchSettings({ rates: { AED: v } })} />
        </Field>
        <Field label="1 US$ in ₹">
          <NumberInput digits={2} value={s.rates.USD} onSave={v => hub.patchSettings({ rates: { USD: v } })} />
        </Field>
      </div>
    </section>
  );
}

function FoldersSection({ state }: { state: AppState }) {
  const s = state.settings;
  // The folder the app actually reads is the Skeidar client's; the old setting is kept in step with it.
  const skeidarRoot = clientFolder(state, 'skeidar') ?? '';
  const setSkeidarRoot = async (p: string) => {
    const cfg = state.companies.find(c => c.id === 'skeidar');
    if (cfg) await hub.upsert('companies', { ...withFolder(cfg, p.trim() || undefined) });
    await hub.patchSettings({ skeidarFolder: p.trim() });
  };
  return (
    <section className="set-sec" aria-labelledby="set-folders-title">
      <h3 id="set-folders-title">Folders and links</h3>
      <FolderRow
        client="skeidar"
        icon="folder"
        label="Skeidar"
        name="Skeidar project folder"
        value={skeidarRoot}
        onSave={v => void setSkeidarRoot(v)}
        onChange={async () => {
          const p = await hub.pickFolder(skeidarRoot || undefined);
          if (p) await setSkeidarRoot(p);
        }}
      />
      {(['waveink', 'metaztech'] as const).map(id => {
        const cfg = state.companies.find(c => c.id === id);
        if (!cfg) return null;
        const root = clientFolder(state, id) ?? '';
        const save = async (p: string) => {
          await hub.upsert('companies', { ...withFolder(cfg, p.trim() || undefined) });
        };
        return (
          <FolderRow
            key={id}
            client={id}
            icon="folder"
            label={`${cfg.name} output`}
            name={id === 'waveink' ? 'Waveink output folder (Download images saves each model here)' : 'MetaZtech output folder (job folders with their .spp files)'}
            value={root}
            onSave={v => void save(v)}
            onChange={async () => {
              const picked = await hub.pickFolder(root || undefined);
              if (picked) await save(picked);
            }}
          />
        );
      })}
      <FolderRow client="metaztech" icon="link" label="MetaZtech CMS" name="MetaZtech portal URL" value={s.metaztechPortalUrl} onSave={v => hub.patchSettings({ metaztechPortalUrl: v })} />
      <FolderRow client="portfolio" icon="globe" label="Portfolio" name="Portfolio link" placeholder="https://…" value={s.portfolioUrl} onSave={v => hub.patchSettings({ portfolioUrl: v })} />
    </section>
  );
}

/** A folder or link on one line. The value is editable in place; Change opens the folder picker, or selects the value to paste over it. */
function FolderRow({ client, icon, label, name, value, placeholder, onSave, onChange }: {
  client: string;
  icon: IconName;
  label: string;
  name: string;
  value: string;
  placeholder?: string;
  onSave(v: string): void;
  onChange?(): void;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className={`set-folder c-${client}`}>
      <span className="set-folder-label">
        <Icon name={icon} size={16} weight="fill" />
        {label}
      </span>
      <input
        ref={ref}
        aria-label={name}
        title={v || name}
        value={v}
        placeholder={placeholder ?? 'Not set'}
        onChange={e => setV(e.target.value)}
        onBlur={() => v !== value && onSave(v.trim())}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape' && v !== value) {
            e.stopPropagation();
            setV(value);
          }
        }}
      />
      <button
        type="button"
        className="mini"
        aria-label={`Change ${name}`}
        onClick={() => {
          if (onChange) return onChange();
          ref.current?.focus();
          ref.current?.select();
        }}
      >
        Change
      </button>
    </div>
  );
}

function Toggle({ label, hint, on, onFlip }: { label: string; hint?: string; on: boolean; onFlip(v: boolean): void }) {
  return (
    <div className="set-line">
      <span className="set-line-txt">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className="set-toggle" onClick={() => onFlip(!on)}>
        <span />
      </button>
    </div>
  );
}

const THEMES: [AppState['settings']['theme'], string][] = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['system', 'System'],
];

function AppSection({ state }: { state: AppState }) {
  const s = state.settings;
  return (
    <section className="set-sec" aria-labelledby="set-app-title">
      <h3 id="set-app-title">App</h3>
      <div className="set-line">
        <span className="set-line-txt">Theme</span>
        <div className="seg" role="group" aria-label="Theme">
          {THEMES.map(([k, l]) => (
            <button key={k} type="button" className={s.theme === k ? 'on' : ''} aria-pressed={s.theme === k} onClick={() => hub.patchSettings({ theme: k })}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <Toggle label="Desktop reminders" hint="Renewals and the Friday report" on={s.notifications} onFlip={v => hub.patchSettings({ notifications: v })} />
      <Toggle label="Start with Windows" on={s.launchAtStartup} onFlip={v => hub.patchSettings({ launchAtStartup: v })} />
    </section>
  );
}

function DataSection({ info }: { info: AppInfo | null }) {
  const { toast } = useApp();
  return (
    <section className="set-sec" aria-labelledby="set-data-title">
      <h3 id="set-data-title">Backup and data</h3>
      <div className="set-btns">
        <button
          type="button"
          className="mini"
          onClick={async () => {
            const p = await hub.backup();
            if (p) toast(`Backup saved to ${p}`);
          }}
        >
          <Icon name="download" size={14} /> Back up data
        </button>
        <ConfirmButton
          className="mini"
          label="Restore backup"
          confirmLabel="Click again: this replaces everything"
          onConfirm={async () => {
            try {
              if (await hub.restore()) toast('Backup restored');
            } catch (err) {
              toast(String(err), 'error');
            }
          }}
        />
        <button type="button" className="mini" onClick={() => hub.openDataFolder()}>
          <Icon name="folder" size={14} /> Open data folder
        </button>
      </div>
      <p className="set-fine">
        Everything is stored on this computer{info ? ` in ${info.dataDir}` : ''}. A copy is kept automatically each day in the data folder (last 14 days).
        {info && ` Version ${info.version}.`}
      </p>
    </section>
  );
}

/* ---------- helpers ---------- */

function NumberInput({ value, onSave, digits }: { value: number; onSave(v: number): void; digits?: number }) {
  const show = (n: number) => (digits ? n.toFixed(digits) : String(n));
  const [v, setV] = useState(show(value));
  useEffect(() => setV(show(value)), [value]);
  return (
    <input
      type="number"
      step="0.01"
      value={v}
      onChange={e => setV(e.target.value)}
      onBlur={() => Number(v) > 0 && Number(v) !== value && onSave(Number(v))}
      onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

const PAY_KIND: Record<CompanyConfig['pay']['kind'], string> = { retainer: 'Monthly retainer', tiered: 'Paid per approved model', 'per-item': 'Paid per item' };

/** One client's pay rule (a label and its value per line) and brief, as a column of the Pay and briefs panel. */
function CompanyEditor({ company: c }: { company: CompanyConfig }) {
  const save = (patch: Partial<CompanyConfig>) => hub.upsert('companies', { ...c, ...patch });
  const pay = c.pay;
  return (
    <section className="set-pay" aria-labelledby={`set-client-${c.id}`}>
      <div className="set-pay-head">
        <CompanyDot company={c.id} />
        <h3 id={`set-client-${c.id}`} className="ellipsis">
          {c.name}
        </h3>
        <span className="tag">{PAY_KIND[pay.kind]}</span>
      </div>
      {c.role && <small className="set-pay-role">{c.role}</small>}
      {pay.kind === 'retainer' && (
        <div className="set-rates">
          <Field label={`Monthly retainer (${c.currency})`}>
            <NumberInput value={pay.amount} onSave={v => save({ pay: { ...pay, amount: v } })} />
          </Field>
          <Field label="Started">
            <input type="date" value={pay.startDate} onChange={e => save({ pay: { ...pay, startDate: e.target.value } })} />
          </Field>
          <Field label="Paid on day">
            <NumberInput value={pay.payday} onSave={v => save({ pay: { ...pay, payday: Math.min(28, Math.round(v)) } })} />
          </Field>
        </div>
      )}
      {pay.kind === 'tiered' && (
        <div className="set-rates">
          {(Object.keys(COMPLEXITY_LABELS) as Complexity[]).map(k => (
            <Field key={k} label={`${COMPLEXITY_LABELS[k]} (₹)`}>
              <NumberInput value={pay.tiers[k]} onSave={v => save({ pay: { ...pay, tiers: { ...pay.tiers, [k]: v } } })} />
            </Field>
          ))}
          <Field label="TDS %">
            <NumberInput value={pay.tdsPercent} onSave={v => save({ pay: { ...pay, tdsPercent: v } })} />
          </Field>
          <p className="set-fine">
            Paid between the {ordinal(pay.payoutFrom)} and {ordinal(pay.payoutTo)} of the following month.
          </p>
        </div>
      )}
      {pay.kind === 'per-item' && (
        <div className="set-rates">
          <Field label={`Rate per ${pay.unit} (${c.currency})`}>
            <NumberInput value={pay.rate} onSave={v => save({ pay: { ...pay, rate: v } })} />
          </Field>
        </div>
      )}
      <Field label="Brief / notes">
        <textarea rows={4} defaultValue={c.notes} onBlur={e => e.target.value !== c.notes && save({ notes: e.target.value })} />
      </Field>
    </section>
  );
}
