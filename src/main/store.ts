import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AppState } from '../shared/types';
import { initialState, SEED_VERSION } from './seed/initial';
import { repairState, upgradeState } from '../shared/ops';

const FILE = 'freelance-hub.json';
const KEEP_BACKUPS = 14;

let state: AppState;
let saveTimer: NodeJS.Timeout | null = null;
const listeners = new Set<(s: AppState) => void>();

export function dataDir(): string {
  return app.getPath('userData');
}

function filePath(): string {
  return path.join(dataDir(), FILE);
}

export function loadState(): AppState {
  const now = new Date().toISOString();
  const seed = initialState(now);
  try {
    const raw = JSON.parse(fs.readFileSync(filePath(), 'utf8')) as AppState;
    state = migrate(raw, seed);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Keep the unreadable file instead of overwriting it.
      try {
        fs.copyFileSync(filePath(), filePath() + `.broken-${Date.now()}`);
      } catch {}
    }
    state = seed;
    writeNow();
  }
  return state;
}

/** Brings an older saved file up to the current shape without losing the user's edits. */
function migrate(saved: AppState, seed: AppState): AppState {
  const out: AppState = { ...seed, ...saved };
  out.settings = {
    ...seed.settings,
    ...saved.settings,
    google: { ...seed.settings.google, ...saved.settings?.google },
    rates: { ...seed.settings.rates, ...saved.settings?.rates },
  };
  for (const key of ['models', 'skeidarJobs', 'payments', 'subscriptions', 'emails', 'meetings', 'portfolioTasks', 'portfolioLog', 'suggestions', 'handledEmails'] as const) {
    if (!Array.isArray(out[key])) (out as any)[key] = (seed as any)[key];
  }
  for (const c of seed.companies) if (!out.companies.some(x => x.id === c.id)) out.companies.push(c);
  if ((saved.version ?? 0) < SEED_VERSION) {
    const have = new Set(out.models.map(m => m.id));
    for (const m of seed.models) if (!have.has(m.id)) out.models.push(m);
    out.version = SEED_VERSION;
  }
  return repairState(upgradeState(out, seed));
}

export function getState(): AppState {
  return state;
}

/** Applies a change to a copy of the state, saves it and tells every window. */
export function update(change: (draft: AppState) => void): AppState {
  const draft = structuredClone(state);
  change(draft);
  state = draft;
  scheduleSave();
  for (const l of listeners) l(state);
  return state;
}

export function replaceState(next: AppState): AppState {
  state = migrate(next, initialState(new Date().toISOString()));
  writeNow();
  for (const l of listeners) l(state);
  return state;
}

export function onChange(listener: (s: AppState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 300);
}

export function flush(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    writeNow();
  }
}

function writeNow(): void {
  saveTimer = null;
  const target = filePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, target);
  backupDaily(target);
}

function backupDaily(source: string): void {
  const dir = path.join(dataDir(), 'backups');
  const name = `freelance-hub-${new Date().toISOString().slice(0, 10)}.json`;
  const dest = path.join(dir, name);
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(source, dest);
  const old = fs.readdirSync(dir).filter(f => f.startsWith('freelance-hub-')).sort();
  for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) fs.rmSync(path.join(dir, f), { force: true });
}
