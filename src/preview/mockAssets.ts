// Preview stand-ins for job folders and client assets (the app reads real folders on disk).
import type { FolderSyncResult } from '../shared/api';
import type { AppState, AssetFile, CompanyId, JobFolderInfo } from '../shared/types';

export interface MockCtx {
  state(): AppState;
  commit(change: (draft: AppState) => void): void;
  notice(text: string, link?: string): void;
}

export async function listAssets(ctx: MockCtx, folder: string): Promise<AssetFile[]> {
  void ctx;
  void folder;
  return [];
}

export async function readJobFolder(ctx: MockCtx, folder: string): Promise<JobFolderInfo> {
  void ctx;
  throw new Error(`No sample folder at ${folder}`);
}

export async function syncJobFolders(ctx: MockCtx, company: CompanyId): Promise<FolderSyncResult> {
  void ctx;
  void company;
  return { created: 0, updated: 0, ticked: 0, folders: 0 };
}

export async function thumbnail(ctx: MockCtx, file: string): Promise<string | null> {
  void ctx;
  void file;
  return null;
}
