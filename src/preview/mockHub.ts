/**
 * Browser stand-in for the Electron main process. The app screens are the real ones; this file fakes
 * only what needs Windows: the portal and folders return labelled samples, and Excel export builds a
 * real workbook offered through the page's save prompt.
 */
import type { Hub, NewModel } from '../shared/api';
import type { AppState, Collection, Model } from '../shared/types';
import { initialState } from '../main/seed/initial';
import { applyStatus, importPortalRows, patchModel, repairState, uid, upgradeState } from '../shared/ops';
import { localDate } from '../shared/money';
import { recordPull } from '../shared/outputs';
import { clientFolder } from '../shared/assets';
import * as mockAssets from './mockAssets';
import * as mockAccounts from './mockAccounts';
import { SAMPLE_FOLDER, SAMPLE_PORTAL } from './samples';

declare global {
  interface Window {
    claude?: { use(name: string): Promise<any> };
  }
}

const KEY = 'freelance-hub-preview-v1';

type NoticeListener = (text: string, link?: string) => void;
const noticeListeners = new Set<NoticeListener>();
export function onNotice(l: NoticeListener): () => void {
  noticeListeners.add(l);
  return () => noticeListeners.delete(l);
}
function notice(text: string, link?: string) {
  noticeListeners.forEach(l => l(text, link));
}

function fresh(): AppState {
  return withSampleFolders(initialState(new Date().toISOString()));
}

/** The preview's sample folders for Waveink and MetaZtech (the app leaves these for Rohit to link). */
function withSampleFolders(s: AppState): AppState {
  for (const id of ['waveink', 'metaztech'] as const) {
    const c = s.companies.find(x => x.id === id);
    if (c && !c.folder) c.folder = mockAssets.SAMPLE_ROOTS[id];
  }
  return s;
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as AppState;
      if (Array.isArray(s.models) && s.settings) return withSampleFolders(repairState(upgradeState(s, fresh())));
    }
  } catch {}
  return fresh();
}

let state = load();
const listeners = new Set<(s: AppState) => void>();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

function commit(change: (draft: AppState) => void) {
  const draft = structuredClone(state);
  change(draft);
  state = draft;
  save();
  listeners.forEach(l => l(state));
}

export function resetPreview() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
  state = fresh();
  listeners.forEach(l => l(state));
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function openLink(url: string) {
  let opened: Window | null = null;
  try {
    opened = window.open(url, '_blank', 'noopener');
  } catch {}
  if (!opened) notice('The app opens this link in your browser:', url);
}

const ctx: mockAssets.MockCtx = { state: () => state, commit, notice };
// Like the app at start-up: job folders are read once, so the dashboard shows Skeidar's sample job straight away.
setTimeout(() => void mockAssets.syncJobFolders(ctx, 'skeidar').catch(() => {}), 0);

const hub: Hub = {
  async getState() {
    return state;
  },
  onState(listener) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  async setStatus(ids, status, note) {
    commit(s => applyStatus(s, ids, status, new Date().toISOString(), note));
  },
  async patchModel(id, patch) {
    commit(s => patchModel(s, id, patch, new Date().toISOString()));
  },
  async addModel(input: NewModel) {
    const now = new Date().toISOString();
    const m: Model = { status: 'todo', source: 'manual', history: [], ...input, id: input.id ?? uid('mm'), createdAt: now, updatedAt: now };
    commit(s => void s.models.push(m));
    return m.id;
  },
  async upsert(collection: Collection, item) {
    const id = (item.id as string) || uid(collection.slice(0, 3));
    commit(s => {
      const list = s[collection] as unknown as { id: string }[];
      const i = list.findIndex(x => x.id === id);
      if (i >= 0) list[i] = { ...list[i], ...item, id };
      else list.push({ ...item, id } as { id: string });
    });
    return id;
  },
  async remove(collection, id) {
    commit(s => {
      (s as any)[collection] = (s[collection] as unknown as { id: string }[]).filter(x => x.id !== id);
    });
  },
  async patchSettings(patch) {
    commit(s => {
      s.settings = { ...s.settings, ...patch, rates: { ...s.settings.rates, ...patch.rates } };
    });
    if (patch.launchAtStartup !== undefined) notice('In the app this sets Freelance Hub to start with Windows.');
  },
  async portalOpen() {
    notice('In the app this opens cms.metaztech.ai in its own window, where you log in once. Use "Pull from portal" to see how importing works with a sample table.');
  },
  async portalPull() {
    await wait(600);
    notice('This is a made-up sample table. In the app, Pull from portal reads the page you have open in the MetaZtech window.');
    return SAMPLE_PORTAL;
  },
  async portalImport(rows, opts) {
    const now = new Date().toISOString();
    let counts = { added: 0, updated: 0, unchanged: 0 };
    let full = false;
    commit(s => {
      counts = importPortalRows(s, rows, now);
      if (opts?.fullList) full = recordPull(s, rows, now);
    });
    return full && clientFolder(state, 'metaztech') ? { ...counts, spp: await hub.checkSppFolders() } : counts;
  },
  async downloadReferences(id) {
    try {
      return await mockAssets.downloadReferences(ctx, id);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
  async checkSppFolders() {
    try {
      return await mockAssets.checkSppFolders(ctx);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
  async pickFolder(defaultPath) {
    notice('In the app this opens a Windows folder picker.');
    return defaultPath ?? null;
  },
  async scanFolder(root) {
    return mockAssets.scanSample(root) ?? SAMPLE_FOLDER;
  },
  async countImages(dir) {
    return mockAssets.countSample(dir) ?? SAMPLE_FOLDER.find(f => f.path === dir)?.images ?? 0;
  },
  async exportExcel(scope) {
    try {
      const { buildWorkbook, exportName } = await import('../main/exporter');
      const wb = await buildWorkbook(state, scope);
      const buf = await wb.xlsx.writeBuffer();
      const filename = `${exportName(state, scope)}-${localDate(new Date())}.xlsx`;
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const downloads = await window.claude?.use('downloads').catch(() => null);
      if (downloads) {
        try {
          await downloads.save({ filename, data: blob });
          return { path: filename };
        } catch (err: any) {
          if (err?.code === 'declined') return {};
          return { error: `The browser could not save the file (${err?.code ?? 'unknown'}). The app saves it straight to your Documents folder.` };
        }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      return { path: filename };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
  async openUrl(url) {
    openLink(url);
  },
  async openPath(p) {
    notice(`In the app this opens ${p} in File Explorer.`);
  },
  async backup() {
    notice('In the app this saves a JSON backup of everything to a file you choose.');
    return null;
  },
  async restore() {
    notice('In the app this replaces everything with a backup file you pick.');
    return false;
  },
  async openDataFolder() {
    notice('In the app this opens %APPDATA%\\Freelance Hub in File Explorer.');
  },
  async appInfo() {
    return { version: '1.0.0 (browser preview)', dataDir: 'this browser (the app uses %APPDATA%\\Freelance Hub)' };
  },
  async listAssets(folder) {
    return mockAssets.listAssets(ctx, folder);
  },
  async readJobFolder(folder) {
    try {
      return await mockAssets.readJobFolder(ctx, folder);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
  async syncJobFolders(company) {
    try {
      return await mockAssets.syncJobFolders(ctx, company);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
  async thumbnail(file) {
    return mockAssets.thumbnail(ctx, file);
  },
  async accountOpen(id) {
    return mockAccounts.accountOpen(ctx, id);
  },
  async accountRead(id) {
    try {
      const got = await mockAccounts.accountRead(ctx, id);
      commit(s => {
        const a = s.accounts.find(x => x.id === id);
        if (a) {
          a.lastRead = new Date().toISOString();
          delete a.lastError;
        }
      });
      return got;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      commit(s => {
        const a = s.accounts.find(x => x.id === id);
        if (a) a.lastError = msg;
      });
      return { error: msg };
    }
  },
};

window.hub = hub;
