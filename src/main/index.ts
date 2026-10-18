import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { HubApi, NewModel, SettingsPatch } from '../shared/api';
import type { AppState, Collection, Model } from '../shared/types';
import { applyStatus, importPortalRows, patchModel, uid } from '../shared/ops';
import { applySppFolders, recordPull, type SppResult } from '../shared/outputs';
import { clientFolder } from '../shared/assets';
import * as outputs from './outputs';
import { dataDir, flush, getState, loadState, onChange, replaceState, update } from './store';
import { openPortal, pullPortal } from './portal';
import { folderImageCount, scanFolder } from './files';
import { exportExcel, exportName } from './exporter';
import * as assets from './assets';
import * as accounts from './accounts';
import { localDate } from '../shared/money';
import { tick } from './notify';

let win: BrowserWindow | null = null;

// Lets tests and a second profile run against a separate data folder.
if (process.env.FREELANCE_HUB_DATA) app.setPath('userData', process.env.FREELANCE_HUB_DATA);
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => focus());
app.setAppUserModelId('com.rohitsharma.freelancehub');

/**
 * Start with Windows. The portable exe runs from a temporary copy that is deleted on exit, so the login item must point
 * at the real file, which the portable launcher passes in PORTABLE_EXECUTABLE_FILE.
 */
function setLaunchAtLogin(on: boolean): void {
  app.setLoginItemSettings({ openAtLogin: on, path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath });
}

function focus(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    title: 'Freelance Hub',
    icon: path.join(__dirname, '../icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#f6f7f9',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:') && !url.startsWith(process.env.VITE_DEV_SERVER_URL ?? '\0')) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.on('closed', () => (win = null));
}

function newModel(input: NewModel, now: string): Model {
  return {
    status: 'todo',
    source: 'manual',
    history: [],
    ...input,
    id: input.id ?? uid(input.company === 'waveink' ? 'wm' : input.company === 'metaztech' ? 'mz' : input.company === 'skeidar' ? 'sk' : 'cm'),
    createdAt: now,
    updatedAt: now,
  };
}

const handlers: HubApi = {
  async getState() {
    return getState();
  },
  async setStatus(ids, status, note) {
    update(s => applyStatus(s, ids, status, new Date().toISOString(), note));
  },
  async patchModel(id, patch) {
    update(s => patchModel(s, id, patch, new Date().toISOString()));
  },
  async addModel(input) {
    const m = newModel(input, new Date().toISOString());
    update(s => void s.models.push(m));
    return m.id;
  },
  async upsert(collection: Collection, item) {
    const id = (item.id as string) || uid(collection.slice(0, 3));
    update(s => {
      const list = s[collection] as unknown as { id: string }[];
      const i = list.findIndex(x => x.id === id);
      if (i >= 0) list[i] = { ...list[i], ...item, id };
      else list.push({ ...item, id } as { id: string });
    });
    return id;
  },
  async remove(collection, id) {
    // A removed software account's sign-in is forgotten too.
    if (collection === 'accounts') await accounts.forgetAccount({ id }).catch(() => {});
    update(s => {
      (s as any)[collection] = (s[collection] as unknown as { id: string }[]).filter(x => x.id !== id);
    });
  },
  async patchSettings(patch: SettingsPatch) {
    update(s => {
      s.settings = { ...s.settings, ...patch, rates: { ...s.settings.rates, ...patch.rates } };
    });
    if (patch.launchAtStartup !== undefined) setLaunchAtLogin(patch.launchAtStartup);
  },
  async portalOpen() {
    openPortal(getState().settings.metaztechPortalUrl);
  },
  async portalPull() {
    try {
      return await pullPortal(getState().settings.metaztechPortalUrl);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
  async portalImport(rows, opts) {
    const now = new Date().toISOString();
    let counts = { added: 0, updated: 0, unchanged: 0 };
    let full = false;
    update(s => {
      counts = importPortalRows(s, rows, now);
      if (opts?.fullList) full = recordPull(s, rows, now);
    });
    return full && clientFolder(getState(), 'metaztech') ? { ...counts, spp: await checkSpp() } : counts;
  },
  async downloadReferences(id) {
    const s = getState();
    const m = s.models.find(x => x.id === id);
    if (!m) return { error: 'That model is no longer in the app.' };
    const root = clientFolder(s, m.company);
    if (!root) return { error: 'Choose the output folder first.' };
    if (!m.sourceUrls?.length) return { error: `${m.code ?? m.name} has no image links in the catalog.` };
    try {
      const r = await outputs.downloadReferences(m, root);
      update(st => {
        const x = st.models.find(y => y.id === id);
        if (x) x.outputFolder = r.folder;
      });
      return r;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
  async checkSppFolders() {
    return checkSpp();
  },
  async pickFolder(defaultPath) {
    const pick = await dialog.showOpenDialog(win!, { defaultPath, properties: ['openDirectory'] });
    return pick.canceled ? null : pick.filePaths[0] ?? null;
  },
  async scanFolder(dir) {
    try {
      return await scanFolder(dir);
    } catch (err) {
      return { error: (err as NodeJS.ErrnoException).code === 'ENOENT' ? `Folder not found: ${dir}` : String(err) };
    }
  },
  async countImages(dir) {
    return folderImageCount(dir);
  },
  async exportExcel(scope) {
    const pick = await dialog.showSaveDialog(win!, {
      defaultPath: path.join(app.getPath('documents'), `${exportName(getState(), scope)}-${localDate(new Date())}.xlsx`),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (pick.canceled || !pick.filePath) return {};
    try {
      await exportExcel(getState(), scope, pick.filePath);
      shell.showItemInFolder(pick.filePath);
      return { path: pick.filePath };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
  async openUrl(url) {
    if (/^(https?|mailto):/.test(url)) await shell.openExternal(url);
  },
  async openPath(p) {
    await shell.openPath(p);
  },
  async backup() {
    const pick = await dialog.showSaveDialog(win!, {
      defaultPath: path.join(app.getPath('documents'), `freelance-hub-backup-${localDate(new Date())}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (pick.canceled || !pick.filePath) return null;
    fs.writeFileSync(pick.filePath, JSON.stringify(getState(), null, 1));
    return pick.filePath;
  },
  async restore() {
    const pick = await dialog.showOpenDialog(win!, { filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (pick.canceled || !pick.filePaths[0]) return false;
    const data = JSON.parse(fs.readFileSync(pick.filePaths[0], 'utf8')) as AppState;
    if (!Array.isArray(data.models) || !data.settings) throw new Error('Not a Freelance Hub backup.');
    replaceState(data);
    return true;
  },
  async openDataFolder() {
    await shell.openPath(dataDir());
  },
  async appInfo() {
    return { version: app.getVersion(), dataDir: dataDir() };
  },
  async listAssets(folder) {
    try {
      return await assets.listAssets(folder);
    } catch (err) {
      return { error: (err as NodeJS.ErrnoException).code === 'ENOENT' ? `Folder not found: ${folder}` : String(err) };
    }
  },
  async readJobFolder(folder) {
    try {
      return await assets.readJobFolder(folder);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
  async syncJobFolders(company) {
    try {
      return await assets.syncJobFolders(company, getState, update);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
  async thumbnail(file, size) {
    return assets.thumbnail(file, size);
  },
  async accountOpen(id) {
    const a = getState().accounts.find(x => x.id === id);
    if (a) accounts.openAccount(a);
  },
  async accountRead(id) {
    const a = getState().accounts.find(x => x.id === id);
    if (!a) return { error: 'That account is no longer in the list.' };
    try {
      const got = await accounts.readAccount(a);
      update(s => {
        const x = s.accounts.find(y => y.id === id);
        if (x) {
          x.lastRead = new Date().toISOString();
          delete x.lastError;
        }
      });
      return got;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      update(s => {
        const x = s.accounts.find(y => y.id === id);
        if (x) x.lastError = msg;
      });
      return { error: msg };
    }
  },
};

/** Reads MetaZtech's output folder and marks jobs approved that left the dashboard with their .spp delivered. */
async function checkSpp(): Promise<SppResult | { error: string }> {
  const root = clientFolder(getState(), 'metaztech');
  if (!root) return { error: 'Link the MetaZtech output folder first.' };
  try {
    const folders = await outputs.scanSppFolders(root);
    let result: SppResult = { approved: [], created: [], onDashboard: 0 };
    update(s => (result = applySppFolders(s, folders, new Date().toISOString())));
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

for (const [name, fn] of Object.entries(handlers)) {
  ipcMain.handle(`hub:${name}`, (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
}

app.whenReady().then(() => {
  const state = loadState();
  // Re-point a login item an older portable build registered at its temporary copy.
  if (process.platform === 'win32' && state.settings.launchAtStartup) setLaunchAtLogin(true);
  // Older versions kept a Google sign-in here for reading Gmail, Calendar and Drive.
  fs.rmSync(path.join(dataDir(), 'google-token.bin'), { force: true });
  onChange(s => win?.webContents.send('hub:state', s));
  createWindow();
  setInterval(() => tick(getState(), focus), 60000);
  setTimeout(() => tick(getState(), focus), 8000);
  // Job folders: re-sync a few seconds after files change in a watched client folder.
  setTimeout(() => assets.startWatchers(getState, update, onChange), 3000);
  // Jobs approved while the app was closed: checked once at start when there is a pull to compare with.
  setTimeout(() => {
    if (getState().settings.portalLastPull && clientFolder(getState(), 'metaztech')) void checkSpp();
  }, 5000);
});

app.on('window-all-closed', () => {
  flush();
  app.quit();
});
app.on('before-quit', flush);
