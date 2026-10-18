import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { AppState, CompanyConfig, CompanyId, Complexity, Currency, Model, PortalField, PortalMapping, PortalTable } from '../../shared/types';
import { COMPLEXITY_LABELS, isComplete } from '../../shared/status';
import { daysUntil, ordinal } from '../../shared/money';
import { DEFAULT_WORKDAYS, paceText, weekProgress, WEEKDAYS } from '../../shared/pace';
import { clientFolder, withFolder } from '../../shared/assets';
import { hub } from '../hub';
import { ClientTile, ConfirmButton, Field, Icon, fmtDate, useApp, type IconName } from '../ui';
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
      <header className="set-head">
        <h1>Settings &amp; import</h1>
        <p>Bring in client sheets, manage clients, set currencies and folders</p>
      </header>

      <div className="set-grid">
        <ImportPanel state={state} />
        <div className="set-side">
          <MoneyCard state={state} />
          <FoldersCard state={state} />
          <AppCard state={state} />
          <DataCard info={info} />
        </div>
      </div>

      <ClientList state={state} now={now} />

      <section className="set-clients" aria-labelledby="set-pay-title">
        <div className="set-sec-head">
          <h2 id="set-pay-title">Pay and briefs</h2>
          <p>Each client's pay rule, and the brief kept with it</p>
        </div>
        <div className="set-client-grid">
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
      <button type="button" className="link-btn set-inline" onClick={() => go({ view: 'company', company: 'waveink' })}>
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
        <span className={`set-drop-ic c-${client} c-soft`} aria-hidden="true">
          <Icon name="fileUp" size={30} weight="fill" />
        </span>
        <div className="set-drop-body">
          <div className="set-drop-txt">
            <b>Drop an Excel, CSV or PDF</b>
            <p>{hint}</p>
          </div>
          <div className="set-drop-ctl">
            <div className="set-pick" role="group" aria-label="Which client the file is for">
              {state.companies
                .filter(c => !c.archived)
                .map(c => (
                <button
                  key={c.id}
                  type="button"
                  className={`c-${c.id} ${client === c.id ? 'on' : ''}`}
                  aria-pressed={client === c.id}
                  onClick={() => {
                    setClient(c.id);
                    setNote('');
                  }}
                >
                  {c.name}
                </button>
                ))}
            </div>
            <button type="button" className="primary lg set-choose" disabled={!mz} title={mz ? undefined : 'Only MetaZtech tables can be imported from a file for now'} onClick={() => fileRef.current?.click()}>
              Choose file
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
      </div>
      {note && (
        <div className="banner warn small set-note" role="status">
          <Icon name="info" />
          <span className="grow">{note}</span>
          <button type="button" className="ghost icon-btn set-note-x" aria-label="Dismiss" onClick={() => setNote('')}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {tech.length > 0 && (
        <div className="set-cat">
          <span className="set-cat-ic" aria-hidden="true">
            <Icon name="excel" size={24} weight="fill" />
          </span>
          <div className="set-cat-txt">
            <b>Tech_Products Designer.xlsx</b>
            <span>
              {techRows} rows → {tech.length} products, grouped by Jasani code · {tech.filter(m => isComplete(m.status)).length} already done
            </span>
          </div>
          <div className="set-cat-btns">
            <button type="button" className="set-white" onClick={() => go({ view: 'company', company: 'waveink' })}>
              Open Waveink
            </button>
            <button
              type="button"
              className="primary"
              title="Same columns and row order as the client's sheet, with 3D Model Status filled in"
              onClick={async () => {
                const r = await hub.exportExcel('waveink');
                if (r.path) toast(`Saved ${r.path}`);
                else if (r.error) toast(r.error, 'error');
              }}
            >
              <Icon name="excel" size={16} /> Export updated sheet
            </button>
          </div>
        </div>
      )}

      <div className="set-map-head">
        <h3>Column mapping</h3>
        <span>{mapping ? 'MetaZtech CMS table · used again the next time a table with these columns comes in' : 'MetaZtech CMS table'}</span>
        {maps.length > 1 && mapping && (
          <select className="set-map-pick" aria-label="Saved table" value={mapping.signature} onChange={e => setMapSig(e.target.value)}>
            {maps.map((m, i) => (
              <option key={m.signature} value={m.signature}>
                Table {i + 1}: {m.signature.split('|').slice(0, 3).join(', ')}…
              </option>
            ))}
          </select>
        )}
      </div>
      {mapping ? (
        <MappingTable state={state} mapping={mapping} />
      ) : (
        <div className="set-map-empty">
          <span className="set-map-empty-ic" aria-hidden="true">
            <Icon name="table" size={22} />
          </span>
          <div className="grow">
            <b>No table mapped yet</b>
            <p>Import a MetaZtech table (pull it from the portal, paste it, or drop a CSV above) and the columns you match are remembered here for next time.</p>
          </div>
          <button type="button" onClick={() => go({ view: 'company', company: 'metaztech' })}>
            Open MetaZtech
          </button>
        </div>
      )}

      <div className="set-imps">
        {apparel.length > 0 && (
          <button type="button" className="set-imp" onClick={() => go({ view: 'company', company: 'waveink' })}>
            <span className="set-imp-ic pdf" aria-hidden="true">
              <Icon name="filePdf" size={24} weight="fill" />
            </span>
            <span className="set-imp-txt">
              <b>PP Apparel Hub catalogue 2025.pdf</b>
              <small>
                {plural(apparel.length, 'apparel model')} · {apparel.filter(m => isComplete(m.status)).length} done · added {fmtDate(firstAdded(apparel))}
              </small>
            </span>
          </button>
        )}
        <button type="button" className="set-imp" onClick={() => go({ view: 'company', company: 'metaztech' })}>
          <span className="set-imp-ic mz" aria-hidden="true">
            <Icon name="table" size={24} weight="fill" />
          </span>
          <span className="set-imp-txt">
            <b>MetaZtech CMS table</b>
            <small>
              {mapping
                ? `${FIELDS.filter(f => (mapping.fields[f.key] ?? -1) >= 0)
                    .map(f => SHORT[f.key])
                    .join(', ')} · remembered${fromPortal ? ` · ${plural(fromPortal, 'model')}` : ''}`
                : 'Not imported yet: pull or paste it on MetaZtech'}
            </small>
          </span>
        </button>
      </div>

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
      <div className="set-map-row set-map-th" aria-hidden="true">
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
  const { toast } = useApp();
  const [editing, setEditing] = useState<CompanyId | null>(null);
  const [adding, setAdding] = useState(false);
  const list = [...state.companies].sort((a, b) => Number(!!a.archived) - Number(!!b.archived));
  const live = list.filter(c => !c.archived).length;

  const archive = async (c: CompanyConfig, archived: boolean) => {
    await hub.upsert('companies', { ...c, archived });
    toast(archived ? `${c.name} archived. It stays listed here to bring back.` : `${c.name} is back in the sidebar and on the dashboard`);
  };

  return (
    <section className="set-clients" aria-labelledby="set-clients-title">
      <div className="set-sec-head set-sec-row">
        <div className="grow">
          <h2 id="set-clients-title">Clients</h2>
          <p>
            {live} on the books{list.length > live ? `, ${list.length - live} archived` : ''} · their start dates, weekly targets and deadlines decide what's urgent
          </p>
        </div>
        <button type="button" className="primary" onClick={() => setAdding(true)}>
          <Icon name="plus" /> Add client
        </button>
      </div>
      <div className="panel set-cl">
        <div className="set-cl-row set-cl-th" aria-hidden="true">
          <span>Client</span>
          <span>Work</span>
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
            return (
              <li key={c.id} className={`set-cl-row ${c.archived ? 'off' : ''}`}>
                <div className="set-cl-who">
                  <ClientTile client={c.id} icon={clientIcon(c)} size="sm" />
                  <span className="set-cl-name">
                    <b className="ellipsis">{c.name}</b>
                    <small className="ellipsis">{c.archived ? 'Archived' : c.role || (isBuiltIn(c) ? 'Built in' : 'Added by hand')}</small>
                  </span>
                </div>
                <span className="set-cl-cell" data-label="Work">
                  {WORKFLOW[c.workflow ?? (c.id === 'skeidar' ? 'variations' : 'models')]}
                </span>
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
                  <button type="button" className="mini" onClick={() => setEditing(c.id)} aria-label={`Edit ${c.name}`}>
                    <Icon name="pencil" size={14} /> Edit
                  </button>
                  {!isBuiltIn(c) &&
                    (c.archived ? (
                      <button type="button" className="mini" onClick={() => void archive(c, false)} aria-label={`Unarchive ${c.name}`}>
                        Unarchive
                      </button>
                    ) : (
                      <ConfirmButton className="mini" label="Archive" confirmLabel="Click to archive" onConfirm={() => archive(c, true)} />
                    ))}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      {editing && <JobEditor state={state} company={editing} onClose={() => setEditing(null)} />}
      {adding && <AddClient state={state} onClose={() => setAdding(false)} />}
    </section>
  );
}

/* ---------- right column ---------- */

function MoneyCard({ state }: { state: AppState }) {
  const s = state.settings;
  return (
    <section className="panel set-card" aria-labelledby="set-money-title">
      <h2 id="set-money-title">Money</h2>
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

function FoldersCard({ state }: { state: AppState }) {
  const s = state.settings;
  // The folder the app actually reads is the Skeidar client's; the old setting is kept in step with it.
  const skeidarRoot = clientFolder(state, 'skeidar') ?? '';
  const setSkeidarRoot = async (p: string) => {
    const cfg = state.companies.find(c => c.id === 'skeidar');
    if (cfg) await hub.upsert('companies', { ...withFolder(cfg, p.trim() || undefined) });
    await hub.patchSettings({ skeidarFolder: p.trim() });
  };
  return (
    <section className="panel set-card" aria-labelledby="set-folders-title">
      <h2 id="set-folders-title">Folders and links</h2>
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
      <FolderRow client="metaztech" icon="link" label="MetaZtech · CMS" name="MetaZtech portal URL" value={s.metaztechPortalUrl} onSave={v => hub.patchSettings({ metaztechPortalUrl: v })} />
      <FolderRow client="money" icon="globe" label="Portfolio" name="Portfolio link" placeholder="https://…" value={s.portfolioUrl} onSave={v => hub.patchSettings({ portfolioUrl: v })} />
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
    <div className={`set-folder c-${client}`} title={name}>
      <span className="set-folder-ic" aria-hidden="true">
        <Icon name={icon} size={18} weight="fill" />
      </span>
      <span className="set-folder-label">{label}</span>
      <input
        ref={ref}
        aria-label={name}
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
        className="set-change"
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

function AppCard({ state }: { state: AppState }) {
  const s = state.settings;
  return (
    <section className="panel set-card" aria-labelledby="set-app-title">
      <h2 id="set-app-title">App</h2>
      <Toggle label="Desktop reminders" hint="Renewals and the Friday report" on={s.notifications} onFlip={v => hub.patchSettings({ notifications: v })} />
      <Toggle label="Start with Windows" on={s.launchAtStartup} onFlip={v => hub.patchSettings({ launchAtStartup: v })} />
      <div className="set-line">
        <span>Theme</span>
        <div className="set-seg" role="group" aria-label="Theme">
          {THEMES.map(([k, l]) => (
            <button key={k} type="button" className={s.theme === k ? 'on' : ''} aria-pressed={s.theme === k} onClick={() => hub.patchSettings({ theme: k })}>
              {l}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function DataCard({ info }: { info: AppInfo | null }) {
  const { toast } = useApp();
  return (
    <section className="panel set-card" aria-labelledby="set-data-title">
      <h2 id="set-data-title">Backup and data</h2>
      <div className="set-btns">
        <button
          type="button"
          className="mini"
          onClick={async () => {
            const p = await hub.backup();
            if (p) toast(`Backup saved to ${p}`);
          }}
        >
          <Icon name="download" /> Back up data
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
          <Icon name="folder" /> Open data folder
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

function CompanyEditor({ company: c }: { company: CompanyConfig }) {
  const save = (patch: Partial<CompanyConfig>) => hub.upsert('companies', { ...c, ...patch });
  const pay = c.pay;
  return (
    <section className={`panel set-client c-${c.id}`} aria-labelledby={`set-client-${c.id}`}>
      <div className="set-client-head">
        <ClientTile client={c.id} icon={clientIcon(c)} />
        <div className="grow">
          <h3 id={`set-client-${c.id}`}>{c.name}</h3>
          <small>{c.role}</small>
        </div>
        <span className="set-chip">{PAY_KIND[pay.kind]}</span>
      </div>
      {pay.kind === 'retainer' && (
        <div className="set-fields">
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
        <>
          <div className="set-fields">
            {(Object.keys(COMPLEXITY_LABELS) as Complexity[]).map(k => (
              <Field key={k} label={`${COMPLEXITY_LABELS[k]} (₹)`}>
                <NumberInput value={pay.tiers[k]} onSave={v => save({ pay: { ...pay, tiers: { ...pay.tiers, [k]: v } } })} />
              </Field>
            ))}
            <Field label="TDS %">
              <NumberInput value={pay.tdsPercent} onSave={v => save({ pay: { ...pay, tdsPercent: v } })} />
            </Field>
          </div>
          <p className="set-fine">
            Paid between the {ordinal(pay.payoutFrom)} and {ordinal(pay.payoutTo)} of the following month.
          </p>
        </>
      )}
      {pay.kind === 'per-item' && (
        <div className="set-fields">
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
