import { useEffect, useMemo, useState } from 'react';
import type { AppState, PortalField, PortalMapping, PortalTable } from '../../shared/types';
import type { PortalRow } from '../../shared/ops';
import { COMPLEXITY_LABELS, mapComplexity, mapPortalStatus, statusLabel } from '../../shared/status';
import { hub } from '../hub';
import { Field, Icon, Modal, StatusPill, fmtDate, useApp } from '../ui';
import { sppMessage } from '../../shared/outputs';
import './PortalImport.css';

const ID = /(^#$)|\b(id|code|no|number|ref)\b/i;
const WHEN = /date|\b(on|at|time)\b/i;

/** Header guesses per field, best first; a column matching `skip` is never guessed for that field. */
export const FIELDS: { key: PortalField; label: string; guess: RegExp[]; skip?: RegExp }[] = [
  { key: 'id', label: 'Job / ID', guess: [ID, /^(job|ticket|sku)\b|#/i], skip: /serial|^(s|sr|sl)\.?\s*no\b|name|title/i },
  { key: 'name', label: 'Model name', guess: [/name|title/i, /model|product|item|asset/i], skip: new RegExp(`${ID.source}|project|client|customer|brand`, 'i') },
  { key: 'status', label: 'Status', guess: [/status|stage|state/i, /progress|approval/i], skip: WHEN },
  { key: 'complexity', label: 'Complexity', guess: [/complex|level|difficulty|category|type|tier/i] },
  { key: 'revisions', label: 'Rejections / revisions', guess: [/reject|revision|iteration|attempt|version|round/i], skip: WHEN },
  { key: 'due', label: 'Due date', guess: [/due|deadline|target|\beta\b/i] },
  { key: 'approved', label: 'Approved on', guess: [/approv.*(date|\b(on|at)\b)|date.*approv/i, /^approved$/i] },
  { key: 'project', label: 'Project / client', guess: [/project|client|brand|batch/i] },
];

export function signature(t: PortalTable): string {
  return t.headers.map(h => h.toLowerCase()).join('|');
}

function guessFields(t: PortalTable, saved?: PortalMapping): Partial<Record<PortalField, number>> {
  const out: Partial<Record<PortalField, number>> = { ...saved?.fields };
  const used = new Set(Object.values(out));
  // A saved mapping keeps the user's choices (-1 = "—"); only fields added since it was saved are guessed.
  for (const f of FIELDS.filter(f => !saved || (f.key === 'approved' && !(f.key in saved.fields))))
    for (const re of f.guess) {
      const i = t.headers.findIndex((h, idx) => !used.has(idx) && re.test(h) && !f.skip?.test(h));
      if (i < 0) continue;
      out[f.key] = i;
      used.add(i);
      break;
    }
  return out;
}

/** Reads a pasted or saved table. Tabs split plainly; commas and semicolons follow CSV quoting, so a quoted cell may hold the separator, "" or a line break. */
export function parsePaste(text: string): PortalTable | null {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const first = clean.split('\n').find(l => l.trim()) ?? '';
  const sep = first.includes('\t') ? '\t' : first.includes(';') && !first.includes(',') ? ';' : ',';
  const all: string[][] = [];
  if (sep === '\t') for (const l of clean.split('\n')) all.push(l.split('\t').map(c => c.trim()));
  else {
    let row: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      if (q) {
        if (ch !== '"') cur += ch;
        else if (clean[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else if (ch === '"' && !cur.trim()) {
        q = true;
        cur = '';
      } else if (ch === sep) {
        row.push(cur.trim());
        cur = '';
      } else if (ch === '\n') {
        row.push(cur.trim());
        all.push(row);
        row = [];
        cur = '';
      } else cur += ch;
    }
    row.push(cur.trim());
    all.push(row);
  }
  const lines = all.filter(r => r.some(Boolean));
  if (lines.length < 2) return null;
  const [headers, ...rows] = lines;
  return { source: 'Pasted table', headers, rows, links: rows.map(() => '') };
}

const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Reads a portal date as written, with no time zone shift. 05/10/2026 is 5 Oct unless the numbers say otherwise. */
function toDate(s: string): string | undefined {
  const t = s.toLowerCase();
  let y: number, m: number, d: number, p: RegExpMatchArray | null;
  if ((p = t.match(/(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/))) [y, m, d] = [+p[1], +p[2], +p[3]];
  else if ((p = t.match(/(?<!\d)(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/))) {
    [d, m, y] = [+p[1], +p[2], +p[3]];
    if (d <= 12 && m > 12) [d, m] = [m, d];
  } else if ((p = t.match(new RegExp(`(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?[\\s-]+${MONTH},?[\\s-]+(\\d{4}|\\d{2})(?!\\d)`))))
    [d, m, y] = [+p[1], MONTHS.indexOf(p[2]) + 1, +p[3]];
  else if ((p = t.match(new RegExp(`\\b${MONTH}[\\s-]+(\\d{1,2})(?:st|nd|rd|th)?,?[\\s-]+(\\d{4}|\\d{2})(?!\\d)`))))
    [m, d, y] = [MONTHS.indexOf(p[1]) + 1, +p[2], +p[3]];
  else return undefined;
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > new Date(y, m, 0).getDate()) return undefined;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Portal status words and the status each becomes, listed under the preview. */
const WORDS: [string, PortalRow['status']][] = [
  ['approved', 'done'],
  ['rejected / redo', 'revision'],
  ['submitted / QC', 'review'],
  ['in progress', 'in_progress'],
  ['hold', 'on_hold'],
  ['assigned / not started', 'todo'],
];

export function PortalImport({ state, mode, file, onClose }: { state: AppState; mode: 'pull' | 'paste' | 'file'; file?: PortalTable; onClose(): void }) {
  const { toast } = useApp();
  const [tables, setTables] = useState<PortalTable[]>(file ? [file] : []);
  const [pageInfo, setPageInfo] = useState('');
  const [loading, setLoading] = useState(mode === 'pull');
  const [error, setError] = useState('');
  const [pick, setPick] = useState(0);
  const [paste, setPaste] = useState('');
  // A full pull is the whole dashboard, so jobs missing from it (approved) can be found in the output folder.
  const [whole, setWhole] = useState(mode === 'pull');
  const [fields, setFields] = useState<Partial<Record<PortalField, number>>>({});
  const [remap, setRemap] = useState(false);
  const has = (f: PortalField) => (fields[f] ?? -1) >= 0;

  const pull = async () => {
    setLoading(true);
    setError('');
    const r = await hub.portalPull();
    setLoading(false);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    setPageInfo(`${r.title} — ${r.url}`);
    const useful = r.tables.filter(t => t.rows.length && t.headers.length >= 2).sort((a, b) => b.rows.length - a.rows.length);
    setTables(useful);
    setPick(0);
    if (!useful.length) setError('No table found on the open page. In the portal window, open the page that lists your models (and log in if asked), then click Pull again.');
  };

  useEffect(() => {
    if (mode === 'pull') void pull();
  }, []);

  useEffect(() => {
    if (mode !== 'paste') return;
    const t = parsePaste(paste);
    setTables(t ? [t] : []);
    setPick(0);
  }, [paste, mode]);

  const table = tables[pick];
  useEffect(() => {
    if (!table) return;
    const saved = state.settings.portalMappings.find(m => m.signature === signature(table));
    setFields(guessFields(table, saved));
  }, [table && signature(table)]);

  const rows: PortalRow[] = useMemo(() => {
    if (!table) return [];
    const get = (r: string[], f: PortalField) => (has(f) ? (r[fields[f]!] ?? '').trim() : '');
    return table.rows.map((r, i) => {
      const statusText = get(r, 'status');
      const rev = get(r, 'revisions');
      return {
        code: get(r, 'id') || undefined,
        name: get(r, 'name') || get(r, 'id'),
        status: mapPortalStatus(statusText),
        statusText,
        complexity: mapComplexity(get(r, 'complexity')),
        revisions: rev && /\d/.test(rev) ? Number(rev.match(/\d+/)![0]) : undefined,
        due: toDate(get(r, 'due')),
        approvedOn: toDate(get(r, 'approved')),
        project: get(r, 'project') || undefined,
        link: table.links[i] || undefined,
        raw: Object.fromEntries(table.headers.map((h, k) => [h || `Column ${k + 1}`, r[k] ?? ''])),
      };
    }).filter(r => r.name);
  }, [table, fields]);

  const doImport = async () => {
    if (!table) return;
    const counts = await hub.portalImport(rows, { fullList: whole });
    const mapping: PortalMapping = { signature: signature(table), fields };
    await hub.patchSettings({ portalMappings: [...state.settings.portalMappings.filter(m => m.signature !== mapping.signature), mapping] });
    toast(`MetaZtech: ${counts.added} added, ${counts.updated} updated, ${counts.unchanged} unchanged.`);
    if (counts.spp && !('error' in counts.spp)) {
      const text = sppMessage(counts.spp);
      if (text) toast(text);
    }
    onClose();
  };

  const saved = table && state.settings.portalMappings.some(m => m.signature === signature(table));
  // A saved mapping that finds rows stays folded away until asked for.
  const foldable = saved && rows.length > 0;
  const title = mode === 'pull' ? 'Pull models from the MetaZtech portal' : mode === 'file' ? `Import ${file?.source ?? 'a table'} into MetaZtech` : 'Import a pasted table';

  return (
    <Modal
      wide
      title={title}
      onClose={onClose}
      footer={
        <>
          {mode === 'pull' && (
            <button type="button" onClick={pull} disabled={loading}>
              <Icon name="sync" /> {loading ? 'Reading the page…' : 'Pull again'}
            </button>
          )}
          <label className="pi-whole" title="Jobs that drop off the dashboard are approved: when one has a .spp in the MetaZtech output folder, it's marked Approved">
            <input type="checkbox" checked={whole} onChange={e => setWhole(e.target.checked)} />
            My whole dashboard list
          </label>
          <span className="grow" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={doImport} disabled={!rows.length || !has('name') && !has('id')}>
            Import {rows.length} row{rows.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <div className="pi">
        {mode === 'pull' && (
          <p className="pi-intro">
            Reads the page open in the CMS window (log in there once; the session is kept). Open the list of your assigned models there, and the rejected or submitted lists if they are separate pages, and pull each one.
            {pageInfo && <span className="pi-page">Page: {pageInfo}</span>}
          </p>
        )}
        {mode === 'paste' && (
          <Field label="Paste the table, headers first (select it in the portal or a sheet, Ctrl+C, then Ctrl+V here)">
            <textarea rows={6} value={paste} onChange={e => setPaste(e.target.value)} placeholder={'Job ID\tModel\tComplexity\tStatus\nMZ-101\tOffice chair\tComplex\tRejected'} />
          </Field>
        )}
        {mode === 'file' && file && (
          <div className="pi-file">
            <span className="pi-file-ic" aria-hidden="true">
              <Icon name="table" size={18} weight="fill" />
            </span>
            <div className="grow">
              <b className="ellipsis">{file.source}</b>
              <small>
                {file.rows.length} row{file.rows.length === 1 ? '' : 's'} · {file.headers.length} columns
              </small>
            </div>
          </div>
        )}
        {loading && !table && <p className="pi-intro">Reading the page…</p>}
        {error && <div className="banner warn">{error}</div>}
        {tables.length > 1 && (
          <Field label="Table on the page">
            <select value={pick} onChange={e => setPick(Number(e.target.value))}>
              {tables.map((t, i) => (
                <option key={i} value={i}>
                  {t.source}: {t.rows.length} rows · {t.headers.slice(0, 5).join(', ')}
                </option>
              ))}
            </select>
          </Field>
        )}
        {table && (
          <>
            <div className="pi-sec">
              <h3>Which column is which?</h3>
              {saved && <span className="tag ok">Saved mapping</span>}
              {foldable && (
                <button type="button" className="link-btn pi-toggle" aria-expanded={remap} onClick={() => setRemap(!remap)}>
                  {remap ? 'Hide' : 'Change'}
                </button>
              )}
            </div>
            {(!foldable || remap) && (
              <div className="pi-map">
                {FIELDS.map(f => (
                  <Field key={f.key} label={f.label}>
                    <select
                      className={has(f.key) ? 'set' : ''}
                      value={has(f.key) ? fields[f.key] : ''}
                      onChange={e => setFields({ ...fields, [f.key]: e.target.value === '' ? -1 : Number(e.target.value) })}
                    >
                      <option value="">—</option>
                      {table.headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
              </div>
            )}
            <div className="pi-sec">
              <h3>Preview</h3>
              <span className="muted small">{rows.length > 10 ? `First 10 of ${rows.length} rows` : `${rows.length} row${rows.length === 1 ? '' : 's'}`}</span>
            </div>
            {rows.length ? (
              <div className="table-wrap pi-preview">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Name</th>
                      <th className="pi-c-portal">Portal status</th>
                      <th>Becomes</th>
                      <th className="pi-c-cx">Complexity</th>
                      <th className="num">Rejections</th>
                      {has('due') && <th>Due</th>}
                      {has('approved') && <th>Approved on</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 10).map((r, i) => (
                      <tr key={i}>
                        <td className="pi-code">{r.code}</td>
                        <td className="pi-name">{r.name}</td>
                        <td className="muted pi-c-portal">{r.statusText}</td>
                        <td>
                          <StatusPill status={r.status} company="metaztech" />
                        </td>
                        <td className="pi-c-cx">{r.complexity ? COMPLEXITY_LABELS[r.complexity] : <span className="muted">not set</span>}</td>
                        <td className="num">{r.revisions ?? ''}</td>
                        {has('due') && <td className="nowrap">{fmtDate(r.due)}</td>}
                        {has('approved') && <td className="nowrap">{fmtDate(r.approvedOn)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="pi-intro">No rows yet: pick the column that holds the model name or the job ID.</p>
            )}
            <p className="pi-note">
              Existing models are matched by job ID (by name when there is no ID), so pulling again only updates them. Status words are read as{' '}
              {WORDS.map(([w, st]) => `${w} → ${statusLabel(st, 'metaztech')}`).join(' · ')}.
            </p>
            {!has('approved') && rows.some(r => r.status === 'done') && (
              <p className="pi-note warn-text">No "Approved on" column picked: approved models new to the app count toward this month's earnings.</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
