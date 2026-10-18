// Work folders on disk for model clients: Waveink reference images saved per model, and MetaZtech job folders whose
// .spp file shows the work was delivered.
import type { AppState, Model } from './types';
import { isComplete, setStatus } from './status';
import { uid } from './ops';

/* ---------- Waveink reference images ---------- */

/** A name Windows accepts for a file or folder: no reserved characters, no trailing dots or spaces, not too long. */
export function safeName(s: string, max = 120): string {
  let out = s
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[\s.]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(out)) out = `${out}_`;
  return out || 'Untitled';
}

/** Folder for one model's reference images: "ITCC 701 - FYCAR Car Charger With Bluetooth Earbud". */
export function modelFolderName(m: Pick<Model, 'code' | 'name'>): string {
  const code = m.code?.trim();
  const name = m.name.trim();
  return safeName(code && !name.toLowerCase().startsWith(code.toLowerCase()) ? `${code} - ${name}` : name || code || 'Model');
}

const TYPES: Record<string, string> = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };

/** File extension for a downloaded image, from its content type or, failing that, its URL. */
export function imageExt(contentType: string | null | undefined, url: string): string {
  const fromType = TYPES[(contentType ?? '').split(';')[0].trim().toLowerCase()];
  if (fromType) return fromType;
  const fromUrl = url.split(/[?#]/)[0].match(/\.(jpe?g|png|webp|gif|avif)$/i)?.[1].toLowerCase();
  return fromUrl ? `.${fromUrl === 'jpeg' ? 'jpg' : fromUrl}` : '.jpg';
}

/** Name of the n-th reference image (from 0) without its extension: "ITCC 701 - 01". */
export function referenceStem(m: Pick<Model, 'code' | 'name'>, n: number): string {
  return `${safeName(m.code?.trim() || m.name, 60)} - ${String(n + 1).padStart(2, '0')}`;
}

/* ---------- MetaZtech job folders ---------- */

export interface SppFolder {
  /** The job folder's own name, e.g. "MZ-2318 Ergonomic mesh office chair". */
  name: string;
  path: string;
  /** Newest .spp file inside it, if any. */
  spp?: string;
  sppModified?: string;
}

export interface SppResult {
  /** Models moved to Approved because their job left the dashboard and the .spp is in the output folder. */
  approved: string[];
  /** Jobs found only in the output folder, added as approved. */
  created: string[];
  /** Folders with a .spp whose job is still on the dashboard. */
  onDashboard: number;
  /** No full portal pull has been recorded yet, so nothing can be decided. */
  needsPull?: boolean;
}

const idKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Keeps the job IDs of a full dashboard pull. A table that mostly lacks job IDs can't tell which jobs left the
 * dashboard, so it isn't kept (and nothing will be marked approved from it).
 */
export function recordPull(draft: AppState, rows: { code?: string }[], now: string): boolean {
  const codes = rows.flatMap(r => (r.code?.trim() ? [r.code.trim()] : []));
  if (!codes.length || codes.length < rows.length * 0.8) return false;
  draft.settings.portalLastPull = { at: now, codes };
  return true;
}

/**
 * The job ID a folder name starts with: the longest known job ID that begins the name, otherwise the name's first word
 * when it holds a digit ("12345 Office chair" → "12345", "MZ-2318 - Chair" → "MZ-2318").
 */
export function jobIdOf(folderName: string, knownIds: string[] = []): string | undefined {
  const k = idKey(folderName);
  const known = knownIds.filter(id => idKey(id) && k.startsWith(idKey(id))).sort((a, b) => idKey(b).length - idKey(a).length)[0];
  if (known) return known;
  const first = folderName.trim().split(/\s+-\s+|\s+|_/)[0];
  return first && /\d/.test(first) ? first.replace(/[-_.]+$/, '') : undefined;
}

/**
 * MetaZtech removes approved jobs from its dashboard. A job folder in the output folder that holds a .spp file, whose
 * job ID was not in the last full dashboard pull, is approved: its model is moved to Approved, or added if the app
 * never had it. Jobs still on the dashboard are left to the portal.
 */
export function applySppFolders(draft: AppState, folders: SppFolder[], now: string): SppResult {
  const result: SppResult = { approved: [], created: [], onDashboard: 0 };
  const pull = draft.settings.portalLastPull;
  if (!pull) return { ...result, needsPull: true };
  const onBoard = new Set(pull.codes.map(idKey));
  const mine = () => draft.models.filter(m => m.company === 'metaztech');
  const when = pull.at < now ? pull.at : now;
  for (const f of folders) {
    if (!f.spp) continue;
    const id = jobIdOf(
      f.name,
      mine().flatMap(m => (m.code ? [m.code] : [])),
    );
    if (!id) continue;
    if (onBoard.has(idKey(id))) {
      result.onDashboard++;
      continue;
    }
    const note = `Not on the MetaZtech dashboard since ${when.slice(0, 10)}, and ${f.spp.split(/[\\/]/).pop()} is in the output folder`;
    const model = mine().find(m => m.code && idKey(m.code) === idKey(id));
    if (model) {
      if (isComplete(model.status)) continue;
      const next = { ...setStatus(model, 'done', now, note), completedAt: when, completedAtApprox: true, outputFolder: f.path };
      draft.models = draft.models.map(m => (m.id === model.id ? next : m));
      result.approved.push(model.name);
      continue;
    }
    const name = f.name.trim().slice(f.name.trim().toLowerCase().indexOf(id.toLowerCase()) + id.length).replace(/^[\s\-–_.:]+/, '') || id;
    draft.models.push({
      id: uid('mz'),
      company: 'metaztech',
      name,
      code: id,
      status: 'done',
      revisions: 0,
      source: 'folder',
      outputFolder: f.path,
      createdAt: now,
      updatedAt: now,
      completedAt: when,
      completedAtApprox: true,
      notes: 'Found in the output folder after it left the dashboard. Set its complexity so its fee counts.',
      history: [{ at: now, from: null, to: 'done', kind: 'import', note }],
    });
    result.created.push(name);
  }
  return result;
}
