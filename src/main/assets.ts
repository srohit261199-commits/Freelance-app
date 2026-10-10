// Job folders and client assets on disk: listing, reading a job folder's sheet and photos, syncing jobs, watching folders.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { nativeImage } from 'electron';
import ExcelJS from 'exceljs';
import type { AppState, AssetFile, CompanyId, JobFolderInfo, ParsedSheet } from '../shared/types';
import type { FolderSyncResult } from '../shared/api';
import { applyJobFolders, classifyJobFiles, clientFolder, decodeText, fileKind, parseCsv, parseProductSheet, SKIP_ENTRY, workflowOf, type Cell } from '../shared/assets';
import { localDate } from '../shared/money';

type Update = (change: (draft: AppState) => void) => AppState;

/** Files in a folder, `depth` levels deep, newest first within each folder. */
export async function listAssets(folder: string, depth = 3): Promise<AssetFile[]> {
  const out: AssetFile[] = [];
  const walk = async (dir: string, level: number) => {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (SKIP_ENTRY.test(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (level < depth) await walk(full, level + 1).catch(() => {});
      } else if (e.isFile()) {
        try {
          const st = await fsp.stat(full);
          out.push({ path: full, name: e.name, rel: path.relative(folder, full), kind: fileKind(e.name), size: st.size, modified: st.mtime.toISOString() });
        } catch {}
      }
      if (out.length > 2000) return;
    }
  };
  await walk(folder, 1);
  return out;
}

/**
 * Rows of the first worksheet (or of a CSV/TSV) as cell text. Uses exceljs's streaming reader: supplier templates carry
 * data validations over whole columns, which the normal reader expands cell by cell and never finishes.
 */
async function sheetRows(file: string): Promise<Cell[][]> {
  if (/\.(csv|tsv|txt)$/i.test(file)) return parseCsv(decodeText(await fsp.readFile(file)));
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(file, { worksheets: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore', entries: 'ignore' });
  const rows: Cell[][] = [];
  for await (const ws of reader) {
    for await (const row of ws) {
      const cells: Cell[] = [];
      row.eachCell({ includeEmpty: false }, (cell, c) => (cells[c - 1] = cell.text));
      rows.push(Array.from(cells, c => c ?? null));
      if (rows.length >= 5000) break;
    }
    break;
  }
  return rows;
}

/** Master photos, finished outputs and the product sheet of one job folder. */
export async function readJobFolder(folder: string): Promise<JobFolderInfo> {
  const files = await listAssets(folder, 3);
  const { masters, outputs, sheetFile } = classifyJobFiles(files);
  let sheet: ParsedSheet | undefined;
  if (sheetFile) {
    try {
      sheet = parseProductSheet(await sheetRows(sheetFile.path), sheetFile.path);
    } catch (err) {
      sheet = { path: sheetFile.path, variants: [], fabrics: [], warnings: [`Could not read ${sheetFile.name}: ${err instanceof Error ? err.message : String(err)}`] };
    }
  }
  return { folder, name: path.basename(folder), files, masters, outputs, sheet };
}

/** One job per subfolder of the client's watched folder; finished images in output folders are ticked off. */
export async function syncJobFolders(company: CompanyId, getState: () => AppState, update: Update): Promise<FolderSyncResult> {
  const root = clientFolder(getState(), company);
  if (!root) throw new Error('Link a folder for this client first.');
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(err => {
    throw new Error((err as NodeJS.ErrnoException).code === 'ENOENT' ? `Folder not found: ${root}` : String(err));
  });
  const folders: { info: JobFolderInfo; created: string }[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || SKIP_ENTRY.test(e.name)) continue;
    const dir = path.join(root, e.name);
    try {
      const st = await fsp.stat(dir);
      folders.push({ info: await readJobFolder(dir), created: localDate(st.birthtimeMs ? st.birthtime : st.mtime) });
    } catch {}
  }
  let result: FolderSyncResult = { created: 0, updated: 0, ticked: 0, folders: folders.length };
  update(s => (result = applyJobFolders(s, company, folders, new Date().toISOString())));
  return result;
}

/** Small data-URL preview of a local image, or null when it can't be read. */
export async function thumbnail(file: string, size = 256): Promise<string | null> {
  try {
    const img = nativeImage.createFromPath(file);
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    return (width >= height ? img.resize({ width: Math.min(size, width) }) : img.resize({ height: Math.min(size, height) })).toDataURL();
  } catch {
    return null;
  }
}

/**
 * Watches every variation client's folder and re-syncs it a couple of seconds after files change, so a sheet dropped
 * into a new job folder or a finished image saved to output/ shows up without clicking anything.
 */
export function startWatchers(getState: () => AppState, update: Update, onChange: (l: (s: AppState) => void) => () => void): void {
  const watchers = new Map<string, { folder: string; watcher: fs.FSWatcher; timer?: NodeJS.Timeout }>();
  const refresh = (s: AppState) => {
    const wanted = new Map(
      s.companies
        .filter(c => !c.archived && workflowOf(c) === 'variations')
        .map(c => [c.id, clientFolder(s, c.id)] as const)
        .filter((x): x is readonly [string, string] => !!x[1]),
    );
    for (const [id, w] of watchers) {
      if (wanted.get(id) === w.folder) continue;
      w.watcher.close();
      if (w.timer) clearTimeout(w.timer);
      watchers.delete(id);
    }
    for (const [id, folder] of wanted) {
      if (watchers.has(id) || !fs.existsSync(folder)) continue;
      try {
        const entry: { folder: string; watcher: fs.FSWatcher; timer?: NodeJS.Timeout } = { folder, watcher: fs.watch(folder, { recursive: true }) };
        entry.watcher.on('change', (_type, name) => {
          // The app's own temp files and Office lock files don't count.
          if (typeof name === 'string' && /(^|[\\/])(~\$|\.)/.test(name)) return;
          if (entry.timer) clearTimeout(entry.timer);
          entry.timer = setTimeout(() => void syncJobFolders(id, getState, update).catch(() => {}), 2000);
        });
        entry.watcher.on('error', () => {
          entry.watcher.close();
          watchers.delete(id);
        });
        watchers.set(id, entry);
      } catch {}
    }
  };
  refresh(getState());
  onChange(refresh);
  // A first pass at start, so files added while the app was closed are picked up.
  for (const c of getState().companies) if (workflowOf(c) === 'variations' && clientFolder(getState(), c.id)) void syncJobFolders(c.id, getState, update).catch(() => {});
}
