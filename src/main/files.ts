import fs from 'node:fs/promises';
import path from 'node:path';
import type { FolderEntry } from '../shared/types';

const IMAGE = /\.(jpe?g|png|webp|tiff?|exr|psd|bmp|heic|avif)$/i;

async function countImages(dir: string, depth: number): Promise<{ images: number; last: number; samples: string[] }> {
  let images = 0;
  let last = 0;
  const samples: string[] = [];
  let entries: import('node:fs').Dirent[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { images, last, samples };
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && depth > 0) {
      const sub = await countImages(full, depth - 1);
      images += sub.images;
      last = Math.max(last, sub.last);
      if (samples.length < 4) samples.push(...sub.samples.slice(0, 4 - samples.length));
    } else if (e.isFile() && IMAGE.test(e.name)) {
      images++;
      if (samples.length < 4) samples.push(e.name);
      try {
        last = Math.max(last, (await fs.stat(full)).mtimeMs);
      } catch {}
    }
  }
  return { images, last, samples };
}

/** One entry per subfolder (a job), plus loose images in the folder itself. */
export async function scanFolder(root: string): Promise<FolderEntry[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const out: FolderEntry[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(root, e.name);
    const { images, last, samples } = await countImages(full, 3);
    out.push({ name: e.name, path: full, images, lastModified: last ? new Date(last).toISOString() : null, samples });
  }
  const loose = await countImages(root, 0);
  if (loose.images) {
    out.push({ name: '(files in this folder)', path: root, images: loose.images, lastModified: loose.last ? new Date(loose.last).toISOString() : null, samples: loose.samples });
  }
  return out.sort((a, b) => (b.lastModified ?? '').localeCompare(a.lastModified ?? ''));
}

export async function folderImageCount(dir: string): Promise<number> {
  return (await countImages(dir, 3)).images;
}
