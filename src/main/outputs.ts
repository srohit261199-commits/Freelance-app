// Work folders on disk: a Waveink model's reference images, and MetaZtech job folders with their .spp files.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { net } from 'electron';
import type { Model } from '../shared/types';
import type { ReferenceResult } from '../shared/api';
import { imageExt, modelFolderName, referenceStem, type SppFolder } from '../shared/outputs';
import { SKIP_ENTRY } from '../shared/assets';

const TIMEOUT = 45000;

async function fetchImage(url: string): Promise<{ data: Buffer; type: string | null }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    // Electron's own network stack, so the PC's proxy and certificates apply.
    const res = await net.fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type');
    if (type && !/^image\//i.test(type)) throw new Error(`not an image (${type.split(';')[0]})`);
    return { data: Buffer.from(await res.arrayBuffer()), type };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Saves a model's catalog images into "<root>/<Code - Name>/" as "<Code> - 01.jpg", "<Code> - 02.png"… Images already
 * there are kept, so a second click only fetches what's missing.
 */
export async function downloadReferences(model: Pick<Model, 'code' | 'name' | 'sourceUrls'>, root: string): Promise<ReferenceResult> {
  const urls = [...new Set(model.sourceUrls ?? [])];
  const folder = path.join(root, modelFolderName(model));
  await fsp.mkdir(folder, { recursive: true });
  const have = new Set((await fsp.readdir(folder).catch(() => [] as string[])).map(f => f.replace(/\.[^.]+$/, '').toLowerCase()));
  const result: ReferenceResult = { folder, saved: 0, skipped: 0, failed: [] };
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      const stem = referenceStem(model, i);
      if (have.has(stem.toLowerCase())) {
        result.skipped++;
        continue;
      }
      try {
        const { data, type } = await fetchImage(urls[i]);
        await fsp.writeFile(path.join(folder, stem + imageExt(type, urls[i])), data);
        result.saved++;
      } catch (err) {
        result.failed.push({ url: urls[i], error: err instanceof Error ? (err.name === 'AbortError' ? 'timed out' : err.message) : String(err) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, worker));
  return result;
}

async function newestSpp(dir: string, depth: number): Promise<{ file: string; mtime: Date } | undefined> {
  let best: { file: string; mtime: Date } | undefined;
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (SKIP_ENTRY.test(e.name)) continue;
    const full = path.join(dir, e.name);
    let hit: { file: string; mtime: Date } | undefined;
    if (e.isFile() && /\.spp$/i.test(e.name)) hit = { file: full, mtime: (await fsp.stat(full)).mtime };
    else if (e.isDirectory() && depth > 1) hit = await newestSpp(full, depth - 1);
    if (hit && (!best || hit.mtime > best.mtime)) best = hit;
  }
  return best;
}

/** Job folders in MetaZtech's output folder, each with its newest Substance Painter file (looked for a few levels down). */
export async function scanSppFolders(root: string): Promise<SppFolder[]> {
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(err => {
    throw new Error((err as NodeJS.ErrnoException).code === 'ENOENT' ? `Folder not found: ${root}` : String(err));
  });
  const out: SppFolder[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || SKIP_ENTRY.test(e.name)) continue;
    const full = path.join(root, e.name);
    const spp = await newestSpp(full, 3);
    out.push({ name: e.name, path: full, ...(spp ? { spp: spp.file, sppModified: spp.mtime.toISOString() } : {}) });
  }
  return out;
}
