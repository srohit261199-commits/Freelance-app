import { BrowserWindow, shell } from 'electron';
import type { PortalSnapshot } from '../shared/types';

let win: BrowserWindow | null = null;

/** The MetaZtech CMS opens in its own window with a saved session, so you log in once. */
export function openPortal(url: string): BrowserWindow {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return win;
  }
  win = new BrowserWindow({
    width: 1300,
    height: 880,
    title: 'MetaZtech portal (Freelance Hub)',
    autoHideMenuBar: true,
    webPreferences: { partition: 'persist:metaztech', contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/.test(target) && new URL(target).hostname.endsWith('metaztech.ai')) return { action: 'allow' };
    if (/^https?:/.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  win.on('closed', () => (win = null));
  win.loadURL(url);
  return win;
}

function loaded(w: BrowserWindow): Promise<void> {
  if (!w.webContents.isLoading()) return Promise.resolve();
  return new Promise(resolve => w.webContents.once('did-stop-loading', () => resolve()));
}

/** Reads every table it can find on the page that is open in the portal window. */
export async function pullPortal(url: string): Promise<PortalSnapshot> {
  const w = openPortal(url);
  await loaded(w);
  // Pages that render rows after load (Livewire, Vue) need a moment.
  await new Promise(r => setTimeout(r, 600));
  return (await w.webContents.executeJavaScript(EXTRACT, true)) as PortalSnapshot;
}

/* Runs inside the portal page. Collects HTML tables, ARIA grids and JSON page data (Inertia / Livewire). */
const EXTRACT = `(() => {
  const text = el => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
  const tables = [];
  document.querySelectorAll('table').forEach((t, i) => {
    let headRow = t.querySelector('thead tr');
    let bodyRows = [...t.querySelectorAll('tbody tr')];
    if (!headRow) { headRow = t.querySelector('tr'); bodyRows = [...t.querySelectorAll('tr')].slice(1); }
    if (!headRow) return;
    const headers = [...headRow.children].map(text);
    const rows = [], links = [];
    for (const tr of bodyRows) {
      const cells = [...tr.children].map(td => {
        const sel = td.querySelector('select');
        if (sel && sel.selectedOptions && sel.selectedOptions[0]) return text(sel.selectedOptions[0]);
        return text(td);
      });
      if (!cells.some(Boolean)) continue;
      rows.push(cells);
      const a = tr.querySelector('a[href]');
      links.push(a ? a.href : '');
    }
    if (rows.length) tables.push({ source: 'Table ' + (i + 1), headers, rows, links });
  });
  document.querySelectorAll('[role=grid],[role=table]').forEach((g, i) => {
    const rowsEl = [...g.querySelectorAll('[role=row]')];
    if (rowsEl.length < 2) return;
    const cellsOf = r => [...r.querySelectorAll('[role=columnheader],[role=cell],[role=gridcell]')].map(text);
    const headers = cellsOf(rowsEl[0]);
    const rows = rowsEl.slice(1).map(cellsOf).filter(r => r.some(Boolean));
    if (rows.length) tables.push({ source: 'Grid ' + (i + 1), headers, rows, links: rows.map(() => '') });
  });
  const flat = (o, pre, out) => {
    for (const [k, v] of Object.entries(o || {})) {
      const key = pre ? pre + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length < 12 && !pre) flat(v, key, out);
      else if (v === null || typeof v !== 'object') out[key] = v == null ? '' : String(v);
      else if (Array.isArray(v) && v.every(x => typeof x !== 'object')) out[key] = v.join(', ');
    }
    return out;
  };
  const seen = new Set();
  const walk = (v, path, depth) => {
    if (!v || typeof v !== 'object' || depth > 6 || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      if (v.length && v.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
        const objs = v.map(x => flat(x, '', {}));
        const headers = [...new Set(objs.flatMap(o => Object.keys(o)))].slice(0, 40);
        if (headers.length >= 2) tables.push({ source: 'Data: ' + path, headers, rows: objs.map(o => headers.map(h => o[h] ?? '')), links: objs.map(() => '') });
      }
      v.forEach((x, i) => walk(x, path + '[' + i + ']', depth + 1));
      return;
    }
    for (const [k, x] of Object.entries(v)) walk(x, path ? path + '.' + k : k, depth + 1);
  };
  const page = document.querySelector('[data-page]');
  if (page) { try { walk(JSON.parse(page.getAttribute('data-page')).props, 'props', 0); } catch (e) {} }
  document.querySelectorAll('[wire\\\\:snapshot]').forEach((el, i) => {
    try { walk(JSON.parse(el.getAttribute('wire:snapshot')).data, 'livewire' + (i + 1), 0); } catch (e) {}
  });
  if (window.__NEXT_DATA__) walk(window.__NEXT_DATA__.props, 'next', 0);
  return { url: location.href, title: document.title, tables };
})()`;
