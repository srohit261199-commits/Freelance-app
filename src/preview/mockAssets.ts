// Preview stand-ins for job folders and client assets. The app reads real folders on disk; the preview has a small
// labelled sample: Skeidar's "Justin stol" job (the real supplier sheet, three placeholder photos, a few finished images)
// and a handful of files for Waveink and MetaZtech.
import type { FolderSyncResult } from '../shared/api';
import type { AppState, AssetFile, CompanyId, FolderEntry, JobFolderInfo } from '../shared/types';
import { applyJobFolders, classifyJobFiles, clientFolder, fileKind, parseProductSheet, samePath } from '../shared/assets';
import { JUSTIN_SHEET } from './sampleJob';

export interface MockCtx {
  state(): AppState;
  commit(change: (draft: AppState) => void): void;
  notice(text: string, link?: string): void;
}

export const SAMPLE_ROOTS = {
  skeidar: 'D:\\Files\\Projects\\Skediar\\genrativeAI',
  waveink: 'D:\\Files\\Projects\\Waveink',
  metaztech: 'D:\\Files\\Projects\\MetaZtech',
};
const JUSTIN = `${SAMPLE_ROOTS.skeidar}\\Justin stol`;

// [path relative to its root, size in KB, modified]
const TREE: Record<string, [string, number, string][]> = {
  [SAMPLE_ROOTS.skeidar]: [
    ['Justin stol\\Justin_stol.xlsx', 163, '2026-10-08T09:12:00'],
    ['Justin stol\\Justin stol - front.jpg', 412, '2026-10-08T09:13:00'],
    ['Justin stol\\Justin stol - back.jpg', 398, '2026-10-08T09:13:00'],
    ['Justin stol\\Justin stol - 3-4.jpg', 455, '2026-10-08T09:13:00'],
    ['Justin stol\\output\\Justin stol - Kiara 851 Beige - front.jpg', 1210, '2026-10-09T15:40:00'],
    ['Justin stol\\output\\Justin stol - Kiara 851 Beige - back.jpg', 1180, '2026-10-09T15:52:00'],
    ['Justin stol\\output\\Justin stol - Kiara 851 Beige - 3-4.jpg', 1255, '2026-10-09T16:05:00'],
    ['Justin stol\\output\\Justin stol - Kiara 854 Light Grey - front.jpg', 1190, '2026-10-10T10:20:00'],
    ['Justin stol\\output\\1398521_front.jpg', 1170, '2026-10-10T10:41:00'],
    ['Justin stol\\output\\kiara-855-taupe_3-4.jpg', 1240, '2026-10-10T11:02:00'],
  ],
  [SAMPLE_ROOTS.waveink]: [
    ['Tech_Products Designer.xlsx', 96, '2026-10-01T10:00:00'],
    ['PP Apparel Hub catalogue 2025.pdf', 10848, '2026-10-01T10:05:00'],
    ['Brief - GLB delivery specs.pdf', 220, '2026-09-02T12:00:00'],
    ['refs\\ITCC 701 - FYCAR front.jpg', 310, '2026-10-08T18:30:00'],
    ['glb\\ITCC 701.glb', 2840, '2026-10-09T20:15:00'],
  ],
  [SAMPLE_ROOTS.metaztech]: [
    ['Onboarding - Freelance L3 guidelines.pdf', 540, '2026-09-20T11:00:00'],
    ['MZ-2318 Ergonomic mesh office chair\\MZ-2318.spp', 18400, '2026-10-09T19:00:00'],
    ['MZ-2318 Ergonomic mesh office chair\\MZ-2318.glb', 6120, '2026-10-09T19:05:00'],
    ['MZ-2318 Ergonomic mesh office chair\\rejection notes.txt', 2, '2026-10-08T14:00:00'],
  ],
};

function filesUnder(folder: string): AssetFile[] {
  const root = Object.keys(TREE).find(r => samePath(r, folder) || folder.toLowerCase().startsWith(r.toLowerCase() + '\\'));
  if (!root) return [];
  const prefix = samePath(root, folder) ? '' : folder.slice(root.length + 1) + '\\';
  return TREE[root]
    .filter(([rel]) => rel.toLowerCase().startsWith(prefix.toLowerCase()))
    .map(([rel, kb, modified]) => {
      const own = rel.slice(prefix.length);
      const name = own.split('\\').pop()!;
      return { path: `${root}\\${rel}`, name, rel: own, kind: fileKind(name), size: kb * 1024, modified: new Date(modified).toISOString() };
    });
}

const IMAGE = /\.(jpe?g|png|webp|tiff?|bmp)$/i;

/** Subfolders of a sample root with their image counts, like the app's folder scan; null for folders outside the sample. */
export function scanSample(folder: string): FolderEntry[] | null {
  const files = filesUnder(folder);
  if (!files.length) return null;
  const groups = new Map<string, AssetFile[]>();
  for (const f of files) {
    const top = f.rel.includes('\\') ? f.rel.split('\\')[0] : '';
    groups.set(top, [...(groups.get(top) ?? []), f]);
  }
  return [...groups]
    .map(([top, fs]) => {
      const images = fs.filter(f => IMAGE.test(f.name));
      const last = fs.map(f => f.modified).sort().pop() ?? null;
      return { name: top || '(files in this folder)', path: top ? `${folder}\\${top}` : folder, images: images.length, lastModified: last, samples: images.slice(0, 3).map(f => f.name) };
    })
    .filter(e => e.name !== '(files in this folder)' || e.images > 0)
    .sort((a, b) => (b.lastModified ?? '').localeCompare(a.lastModified ?? ''));
}

/** Images in a sample folder and its subfolders, or null outside the sample. */
export function countSample(folder: string): number | null {
  const files = filesUnder(folder);
  return files.length ? files.filter(f => IMAGE.test(f.name)).length : null;
}

export async function listAssets(ctx: MockCtx, folder: string): Promise<AssetFile[]> {
  void ctx;
  return filesUnder(folder);
}

export async function readJobFolder(ctx: MockCtx, folder: string): Promise<JobFolderInfo> {
  void ctx;
  const files = filesUnder(folder);
  if (!files.length) throw new Error(`No sample folder at ${folder}`);
  const { masters, outputs, sheetFile } = classifyJobFiles(files);
  const sheet = sheetFile && samePath(folder, JUSTIN) ? parseProductSheet(JUSTIN_SHEET, sheetFile.path) : undefined;
  return { folder, name: folder.split('\\').pop()!, files, masters, outputs, sheet };
}

export async function syncJobFolders(ctx: MockCtx, company: CompanyId): Promise<FolderSyncResult> {
  const root = clientFolder(ctx.state(), company);
  if (!root) throw new Error('Link a folder for this client first.');
  const jobs = [...new Set(filesUnder(root).filter(f => f.rel.includes('\\')).map(f => f.rel.split('\\')[0]))];
  if (!jobs.length) {
    ctx.notice(`In the app this reads ${root} on your PC. The preview only has a sample Skeidar folder.`);
    return { created: 0, updated: 0, ticked: 0, folders: 0 };
  }
  const folders = await Promise.all(jobs.map(async name => ({ info: await readJobFolder(ctx, `${root}\\${name}`), created: '2026-10-08' })));
  let result: FolderSyncResult = { created: 0, updated: 0, ticked: 0, folders: folders.length };
  ctx.commit(s => (result = applyJobFolders(s, company, folders, new Date().toISOString())));
  return result;
}

/** Placeholder art (clearly not a photo): an armchair outline, tinted for finished images named after a fabric. */
export async function thumbnail(ctx: MockCtx, file: string): Promise<string | null> {
  void ctx;
  if (!/\.(jpe?g|png|webp)$/i.test(file)) return null;
  const name = file.split('\\').pop()!.toLowerCase();
  const tint = /beige|ivory|cream/.test(name) ? '#d9c7a7' : /grey|gray/.test(name) ? '#a7a9b0' : /taupe|mole|mink/.test(name) ? '#9c8b7c' : /blue/.test(name) ? '#5a72a8' : /1398521/.test(name) ? '#d4c09a' : '#8d8892';
  const output = /\\output\\/i.test(file);
  const back = /back/.test(name);
  const view = /3-4|three|34/.test(name) ? 'skewX(-8)' : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><rect width="160" height="120" fill="#f4f4f6"/><g transform="translate(80 64) ${view}" fill="${output ? tint : '#8d8892'}"><rect x="-38" y="-30" width="76" height="${back ? 44 : 34}" rx="6"/>${back ? '' : '<rect x="-30" y="2" width="60" height="16" rx="5" opacity=".85"/>'}<rect x="-46" y="-12" width="12" height="34" rx="4"/><rect x="34" y="-12" width="12" height="34" rx="4"/></g><g fill="#2b2b30"><rect x="40" y="86" width="3" height="14"/><rect x="117" y="86" width="3" height="14"/></g><text x="8" y="14" font-family="sans-serif" font-size="9" fill="#77757e">sample</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
