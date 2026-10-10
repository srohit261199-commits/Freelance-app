import type { AppState, AssetFile, Collection, CompanyId, FolderEntry, FoundPlan, JobFolderInfo, Model, ModelStatus, Payment, PortalSnapshot, Settings, Subscription, SyncResult } from './types';
import type { ImportCounts, PortalRow } from './ops';

export type SettingsPatch = Partial<Omit<Settings, 'google' | 'rates'>> & {
  google?: Partial<Settings['google']>;
  rates?: Partial<Settings['rates']>;
};

export type NewModel = Partial<Model> & Pick<Model, 'company' | 'name'>;

/** Everything the window can ask the main process to do. */
export interface HubApi {
  getState(): Promise<AppState>;
  setStatus(ids: string[], status: ModelStatus, note?: string): Promise<void>;
  patchModel(id: string, patch: Partial<Model>): Promise<void>;
  addModel(model: NewModel): Promise<string>;
  upsert(collection: Collection, item: { id?: string } & Record<string, unknown>): Promise<string>;
  remove(collection: Collection, id: string): Promise<void>;
  patchSettings(patch: SettingsPatch): Promise<void>;
  acceptSuggestion(id: string, override: { payment?: Partial<Payment>; subscription?: Partial<Subscription> }): Promise<void>;
  dismissSuggestion(id: string): Promise<void>;
  googleConnect(clientId: string, clientSecret: string): Promise<{ ok: boolean; email?: string; error?: string }>;
  googleDisconnect(): Promise<void>;
  loadGoogleCredentials(): Promise<{ clientId: string; clientSecret: string } | { error: string } | null>;
  sync(): Promise<SyncResult>;
  portalOpen(): Promise<void>;
  portalPull(): Promise<PortalSnapshot | { error: string }>;
  portalImport(rows: PortalRow[]): Promise<ImportCounts>;
  pickFolder(defaultPath?: string): Promise<string | null>;
  scanFolder(path: string): Promise<FolderEntry[] | { error: string }>;
  countImages(path: string): Promise<number>;
  exportExcel(scope: 'waveink' | 'metaztech' | 'skeidar' | 'all'): Promise<{ path?: string; error?: string }>;
  openUrl(url: string): Promise<void>;
  openPath(path: string): Promise<void>;
  backup(): Promise<string | null>;
  restore(): Promise<boolean>;
  openDataFolder(): Promise<void>;
  appInfo(): Promise<{ version: string; dataDir: string }>;
  /** Files in a folder (recursive, a few levels), for a client's or job's assets panel. */
  listAssets(folder: string): Promise<AssetFile[] | { error: string }>;
  /** Reads one job folder: master photos, finished outputs and the product sheet if there is one. */
  readJobFolder(folder: string): Promise<JobFolderInfo | { error: string }>;
  /** Scans the client's watched folder: creates or updates a job per subfolder and ticks off finished images. */
  syncJobFolders(company: CompanyId): Promise<FolderSyncResult | { error: string }>;
  /** Small data-URL preview of a local image, or null if it can't be read. */
  thumbnail(path: string, size?: number): Promise<string | null>;
  /** Opens the vendor's plans page in an app window (sign in once; the session is kept). */
  accountOpen(id: string): Promise<void>;
  /** Reads the plans from the vendor window's current page. */
  accountRead(id: string): Promise<{ plans: FoundPlan[]; url: string } | { error: string }>;
}

export interface FolderSyncResult {
  created: number;
  updated: number;
  /** Images newly ticked off because a matching file appeared in an output folder. */
  ticked: number;
  folders: number;
}

export const HUB_METHODS: (keyof HubApi)[] = [
  'getState',
  'setStatus',
  'patchModel',
  'addModel',
  'upsert',
  'remove',
  'patchSettings',
  'acceptSuggestion',
  'dismissSuggestion',
  'googleConnect',
  'googleDisconnect',
  'loadGoogleCredentials',
  'sync',
  'portalOpen',
  'portalPull',
  'portalImport',
  'pickFolder',
  'scanFolder',
  'countImages',
  'exportExcel',
  'openUrl',
  'openPath',
  'backup',
  'restore',
  'openDataFolder',
  'appInfo',
  'listAssets',
  'readJobFolder',
  'syncJobFolders',
  'thumbnail',
  'accountOpen',
  'accountRead',
];

export type Hub = HubApi & { onState(listener: (s: AppState) => void): () => void };
