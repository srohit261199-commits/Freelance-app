import { useEffect, useMemo, useState } from 'react';
import type { AppState, PortalField, PortalMapping, PortalTable } from '../../shared/types';
import type { PortalRow } from '../../shared/ops';
import { COMPLEXITY_LABELS, mapComplexity, mapPortalStatus, statusLabel } from '../../shared/status';
import { hub } from '../hub';
import { Field, Modal, StatusPill, fmtDate, useApp } from '../ui';

const ID = /(^#$)|\b(id|code|no|number|ref)\b/i;
const WHEN = /date|\b(on|at|time)\b/i;

/** Header guesses per field, best first; a column matching `skip` is never guessed for that field. */
const FIELDS: { key: PortalField; label: string; guess: RegExp[]; skip?: RegExp }[] = [
  { key: 'id', label: 'Job / ID', guess: [ID, /^(job|ticket|sku)\b|#/i], skip: /serial|^(s|sr|sl)\.?\s*no\b|name|title/i },
  { key: 'name', label: 'Model name', guess: [/name|title/i, /model|product|item|asset/i], skip: new RegExp(`${ID.source}|project|client|customer|brand`, 'i') },
  { key: 'status', label: 'Status', guess: [/status|stage|state/i, /progress|approval/i], skip: WHEN },
  { key: 'complexity', label: 'Complexity', guess: [/complex|level|difficulty|category|type|tier/i] },
  { key: 'revisions', label: 'Rejections / revisions', guess: [/reject|revision|iteration|attempt|version|round/i], skip: WHEN },
  { key: 'due', label: 'Due date', guess: [/due|deadline|target|\beta\b/i] },
  { key: 'approved', label: 'Approved on', guess: [/approv.*(date|\b(on|at)\b)|date.*approv/i, /^approved$/i] },
  { key: 'project', label: 'Project / client', guess: [/project|client|brand|batch/i] },
];

function signature(t: PortalTable): string {
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

function parsePaste(text: string): PortalTable | null {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (lines.length < 2) return null;
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const split = (l: string) => {
    if (sep !== ',') return l.split(sep).map(c => c.trim());
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const headers = split(lines[0]);
  const rows = lines.slice(1).map(split);
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

export function PortalImport({ state, mode, onClose }: { state: AppState; mode: 'pull' | 'paste'; onClose(): void }) {
  const { toast } = useApp();
  const [tables, setTables] = useState<PortalTable[]>([]);
  const [pageInfo, setPageInfo] = useState('');
  const [loading, setLoading] = useState(mode === 'pull');
  const [error, setError] = useState('');
  const [pick, setPick] = useState(0);
  const [paste, setPaste] = useState('');
  const [fields, setFields] = useState<Partial<Record<PortalField, number>>>({});
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
    const counts = await hub.portalImport(rows);
    const mapping: PortalMapping = { signature: signature(table), fields };
    await hub.patchSettings({ portalMappings: [...state.settings.portalMappings.filter(m => m.signature !== mapping.signature), mapping] });
    toast(`MetaZtech: ${counts.added} added, ${counts.updated} updated, ${counts.unchanged} unchanged.`);
    onClose();
  };

  return (
    <Modal
      wide
      title={mode === 'pull' ? 'Pull models from the MetaZtech portal' : 'Import a pasted table'}
      onClose={onClose}
      footer={
        <>
          {mode === 'pull' && (
            <button type="button" onClick={pull} disabled={loading}>
              {loading ? 'Reading the page…' : 'Pull again'}
            </button>
          )}
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
      {mode === 'pull' && (
        <p className="muted small">
          Reads the page open in the portal window. Log in there once (the session is kept), open the list of your assigned models (and the rejected / submitted lists if they are separate pages), and pull each one.
          {pageInfo && (
            <>
              <br />
              Page: {pageInfo}
            </>
          )}
        </p>
      )}
      {mode === 'paste' && (
        <Field label="Paste the table (select it in the portal or a sheet, Ctrl+C, then Ctrl+V here). First row must be the headers.">
          <textarea rows={6} value={paste} onChange={e => setPaste(e.target.value)} placeholder={'Job ID\tModel\tComplexity\tStatus\nMZ-101\tOffice chair\tComplex\tRejected'} />
        </Field>
      )}
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
          <h4>Which column is which?</h4>
          <div className="grid3">
            {FIELDS.map(f => (
              <Field key={f.key} label={f.label}>
                <select
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
          <h4>Preview</h4>
          <div className="table-wrap small-table">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Portal status</th>
                  <th>Becomes</th>
                  <th>Complexity</th>
                  <th>Rejections</th>
                  {has('due') && <th>Due</th>}
                  {has('approved') && <th>Approved on</th>}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map((r, i) => (
                  <tr key={i}>
                    <td>{r.code}</td>
                    <td>{r.name}</td>
                    <td className="muted">{r.statusText}</td>
                    <td>
                      <StatusPill status={r.status} company="metaztech" />
                    </td>
                    <td>{r.complexity ? COMPLEXITY_LABELS[r.complexity] : <span className="muted">not set</span>}</td>
                    <td>{r.revisions ?? ''}</td>
                    {has('due') && <td>{fmtDate(r.due)}</td>}
                    {has('approved') && <td>{fmtDate(r.approvedOn)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 10 && <p className="muted small">…and {rows.length - 10} more.</p>}
          <p className="muted small">
            Status words are matched automatically (approved → {statusLabel('done', 'metaztech')}, rejected / redo → {statusLabel('revision', 'metaztech')}, submitted / QC →{' '}
            {statusLabel('review', 'metaztech')}, hold → On hold). Existing models are matched by job ID (by name only when there is no ID), so pulling again only updates them.
          </p>
          {!has('approved') && rows.some(r => r.status === 'done') && (
            <p className="muted small">No "Approved on" column picked: approved models new to the app count toward this month's earnings.</p>
          )}
        </>
      )}
    </Modal>
  );
}
