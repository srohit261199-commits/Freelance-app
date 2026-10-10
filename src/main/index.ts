import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { HubApi, NewModel, SettingsPatch } from '../shared/api';
import type { AppState, Collection, Model } from '../shared/types';
import { acceptSuggestion, applyStatus, dismissSuggestion, importPortalRows, patchModel, uid } from '../shared/ops';
import { dataDir, flush, getState, loadState, onChange, replaceState, update } from './store';
import * as google from './google';
import { runSync } from './sync';
import { openPortal, pullPortal } from './portal';
import { folderImageCount, scanFolder } from './files';
import { exportExcel } from './exporter';
import * as assets from './assets';
import * as accounts from './accounts';
import { localDate } from '../shared/money';
import { newMail, tick } from './notify';

let win: BrowserWindow | null = null;
let syncTimer: NodeJS.Timeout | null = null;

// Lets tests and a second profile run against a separate data folder.
if (process.env.FREELANCE_HUB_DATA) app.setPath('userData', process.env.FREELANCE_HUB_DATA);
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => focus());
app.setAppUserModelId('com.rohitsharma.freelancehub');

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

function scheduleSync(): void {
  if (syncTimer) clearInterval(syncTimer);
  const s = getState().settings;
  if (!s.google.connected) return;
  syncTimer = setInterval(() => void syncAndNotify(), Math.max(5, s.syncMinutes) * 60000);
}

async function syncAndNotify() {
  const before = new Set(getState().emails.map(e => e.id));
  const firstRun = before.size === 0;
  const result = await runSync();
  if (result.ok && !firstRun) {
    const name = (id: string) => getState().companies.find(c => c.id === id)?.name ?? '';
    newMail(before, getState().emails, name, focus);
  }
  return result;
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
    update(s => {
      (s as any)[collection] = (s[collection] as unknown as { id: string }[]).filter(x => x.id !== id);
    });
  },
  async patchSettings(patch: SettingsPatch) {
    update(s => {
      s.settings = {
        ...s.settings,
        ...patch,
        google: { ...s.settings.google, ...patch.google },
        rates: { ...s.settings.rates, ...patch.rates },
      };
    });
    if (patch.launchAtStartup !== undefined) app.setLoginItemSettings({ openAtLogin: patch.launchAtStartup });
    if (patch.syncMinutes !== undefined) scheduleSync();
  },
  async acceptSuggestion(id, override) {
    update(s => acceptSuggestion(s, id, override));
  },
  async dismissSuggestion(id) {
    update(s => dismissSuggestion(s, id));
  },
  async googleConnect(clientId, clientSecret) {
    try {
      const { email } = await google.connect({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
      update(s => {
        s.settings.google = { ...s.settings.google, clientId: clientId.trim(), clientSecret: clientSecret.trim(), connected: true, email };
        delete s.settings.google.lastError;
      });
      scheduleSync();
      void syncAndNotify();
      focus();
      return { ok: true, email };
    } catch (err) {
      focus();
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
  async googleDisconnect() {
    google.disconnect();
    update(s => {
      s.settings.google.connected = false;
      delete s.settings.google.email;
    });
    scheduleSync();
  },
  async loadGoogleCredentials() {
    const pick = await dialog.showOpenDialog(win!, {
      title: 'Choose the OAuth client JSON you downloaded from Google Cloud',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (pick.canceled || !pick.filePaths[0]) return null;
    try {
      const json = JSON.parse(fs.readFileSync(pick.filePaths[0], 'utf8'));
      const c = json.installed ?? json.web ?? json;
      if (!c.client_id || !c.client_secret) return { error: 'That file has no client_id / client_secret. Download the JSON of a "Desktop app" OAuth client.' };
      return { clientId: c.client_id, clientSecret: c.client_secret };
    } catch {
      return { error: 'Could not read that file as JSON.' };
    }
  },
  async sync() {
    google.configure(getState().settings.google);
    return syncAndNotify();
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
  async portalImport(rows) {
    let counts = { added: 0, updated: 0, unchanged: 0 };
    update(s => (counts = importPortalRows(s, rows, new Date().toISOString())));
    return counts;
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
    const names = { waveink: 'Waveink-update', metaztech: 'MetaZtech-models', skeidar: 'Skeidar-jobs', all: 'Freelance-Hub-all' };
    const pick = await dialog.showSaveDialog(win!, {
      defaultPath: path.join(app.getPath('documents'), `${names[scope]}-${localDate(new Date())}.xlsx`),
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

for (const [name, fn] of Object.entries(handlers)) {
  ipcMain.handle(`hub:${name}`, (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
}

app.whenReady().then(() => {
  const state = loadState();
  google.configure(state.settings.google);
  if (state.settings.google.connected && !google.hasTokens()) {
    update(s => {
      s.settings.google.connected = false;
    });
  }
  onChange(s => win?.webContents.send('hub:state', s));
  createWindow();
  scheduleSync();
  if (getState().settings.google.connected) setTimeout(() => void syncAndNotify(), 4000);
  setInterval(() => tick(getState(), focus), 60000);
  setTimeout(() => tick(getState(), focus), 8000);
});

app.on('window-all-closed', () => {
  flush();
  app.quit();
});
app.on('before-quit', flush);
