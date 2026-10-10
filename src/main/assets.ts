// Job folders and client assets. Owned by the job-assets work; the IPC handlers in index.ts call these.
import type { AssetFile, AppState, CompanyId, JobFolderInfo } from '../shared/types';
import type { FolderSyncResult } from '../shared/api';

/** Files in a folder, a few levels deep. */
export async function listAssets(folder: string): Promise<AssetFile[]> {
  void folder;
  return [];
}

/** Masters, outputs and the parsed product sheet of one job folder. */
export async function readJobFolder(folder: string): Promise<JobFolderInfo> {
  throw new Error(`Not implemented yet: ${folder}`);
}

/** Creates or updates one job per subfolder of the client's folder and ticks off finished images. */
export async function syncJobFolders(
  company: CompanyId,
  getState: () => AppState,
  update: (change: (draft: AppState) => void) => AppState,
): Promise<FolderSyncResult> {
  void company;
  void getState;
  void update;
  return { created: 0, updated: 0, ticked: 0, folders: 0 };
}

/** Data-URL thumbnail of a local image. */
export async function thumbnail(file: string, size = 256): Promise<string | null> {
  void file;
  void size;
  return null;
}
