/**
 * Browser stand-in for the Electron main process. The app screens are the real ones; this file fakes
 * only what needs Windows or Google: sign-in loads a dated snapshot, the portal and folders return
 * labelled samples, and Excel export builds a real workbook offered through the page's save prompt.
 */
import type { Hub, NewModel } from '../shared/api';
import type { AppState, Collection, Model, SyncResult } from '../shared/types';
import { initialState } from '../main/seed/initial';
import { acceptSuggestion, applyStatus, dismissSuggestion, importPortalRows, patchModel, uid } from '../shared/ops';
import { applySync, calendarMeetings, driveGlbs, ingestMail } from '../shared/ingest';
import { RECEIPT_IDS, SAMPLE_FOLDER, SAMPLE_PORTAL, SNAPSHOT_DRIVE, SNAPSHOT_EVENTS, SNAPSHOT_MAIL } from './snapshot';

declare global {
  interface Window {
    claude?: { use(name: string): Promise<any> };
  }
}

const KEY = 'freelance-hub-preview-v1';
const DAY = 86400000;

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
  return initialState(new Date().toISOString());
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as AppState;
      if (Array.isArray(s.models) && s.settings) return s;
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

function runSnapshotSync(): SyncResult {
  const result: SyncResult = { ok: true, newEmails: 0, meetings: 0, driveMatches: 0, newSuggestions: 0, newPayments: 0 };
  const now = Date.now();
  const clientIds = new Set(SNAPSHOT_MAIL.map(m => m.id).filter(id => !RECEIPT_IDS.has(id)));
  const got = ingestMail(state, SNAPSHOT_MAIL, RECEIPT_IDS, clientIds, new Date(now).toISOString());
  // The live sync asks Calendar for 7 days back and 30 ahead.
  const events = SNAPSHOT_EVENTS.filter(e => {
    const t = new Date(e.start.dateTime!).getTime();
    return t > now - 7 * DAY && t < now + 30 * DAY;
  });
  const meetings = calendarMeetings(events, state);
  commit(s => applySync(s, got, meetings, driveGlbs(SNAPSHOT_DRIVE), now, result));
  return result;
}

function openLink(url: string) {
  let opened: Window | null = null;
  try {
    opened = window.open(url, '_blank', 'noopener');
  } catch {}
  if (!opened) notice('The app opens this link in your browser:', url);
}

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
      s.settings = { ...s.settings, ...patch, google: { ...s.settings.google, ...patch.google }, rates: { ...s.settings.rates, ...patch.rates } };
    });
    if (patch.launchAtStartup !== undefined) notice('In the app this sets Freelance Hub to start with Windows.');
  },
  async acceptSuggestion(id, override) {
    commit(s => acceptSuggestion(s, id, override));
  },
  async dismissSuggestion(id) {
    commit(s => dismissSuggestion(s, id));
  },
  async googleConnect(clientId, clientSecret) {
    if (!/\.apps\.googleusercontent\.com$/.test(clientId.trim())) {
      return { ok: false, error: 'That client ID should end in .apps.googleusercontent.com. Copy it from Google Cloud → Clients, or load the downloaded JSON.' };
    }
    if (!clientSecret.trim()) return { ok: false, error: 'Add the client secret too.' };
    notice('In the app your browser opens Google sign-in now. The preview skips that and loads a snapshot of your Gmail, Calendar and Drive from 9 Oct.');
    await wait(1200);
    commit(s => {
      s.settings.google = { ...s.settings.google, clientId: clientId.trim(), clientSecret: clientSecret.trim(), connected: true, email: 's.rohit.261199@gmail.com' };
    });
    runSnapshotSync();
    return { ok: true, email: 's.rohit.261199@gmail.com' };
  },
  async googleDisconnect() {
    commit(s => {
      s.settings.google.connected = false;
      delete s.settings.google.email;
    });
  },
  async loadGoogleCredentials() {
    notice('In the app this opens the client JSON you downloaded from Google Cloud. The preview fills in sample values.');
    return { clientId: 'preview-sample-client.apps.googleusercontent.com', clientSecret: 'GOCSPX-preview-sample' };
  },
  async sync() {
    if (!state.settings.google.connected) return { ok: false, error: 'Google is not connected yet. Open Settings → Google account.', newEmails: 0, meetings: 0, driveMatches: 0, newSuggestions: 0, newPayments: 0 };
    await wait(700);
    return runSnapshotSync();
  },
  async portalOpen() {
    notice('In the app this opens cms.metaztech.ai in its own window, where you log in once. Use "Pull from portal" to see how importing works with a sample table.');
  },
  async portalPull() {
    await wait(600);
    notice('This is a made-up sample table. In the app, Pull from portal reads the page you have open in the MetaZtech window.');
    return SAMPLE_PORTAL;
  },
  async portalImport(rows) {
    let counts = { added: 0, updated: 0, unchanged: 0 };
    commit(s => (counts = importPortalRows(s, rows, new Date().toISOString())));
    return counts;
  },
  async pickFolder(defaultPath) {
    notice('In the app this opens a Windows folder picker.');
    return defaultPath ?? null;
  },
  async scanFolder() {
    return SAMPLE_FOLDER;
  },
  async countImages(dir) {
    return SAMPLE_FOLDER.find(f => f.path === dir)?.images ?? 0;
  },
  async exportExcel(scope) {
    try {
      const { buildWorkbook } = await import('../main/exporter');
      const wb = await buildWorkbook(state, scope);
      const buf = await wb.xlsx.writeBuffer();
      const names = { waveink: 'Waveink-update', metaztech: 'MetaZtech-models', skeidar: 'Skeidar-jobs', all: 'Freelance-Hub-all' };
      const filename = `${names[scope]}-${new Date().toISOString().slice(0, 10)}.xlsx`;
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
};

window.hub = hub;
