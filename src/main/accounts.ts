// Software accounts (Autodesk, Adobe, Chaos…): each opens in its own window with a kept session, so Rohit signs in
// once and the app can read the plans page whenever he asks.
import { BrowserWindow, session, shell } from 'electron';
import type { FoundPlan, SoftwareAccount } from '../shared/types';
import { accountDomains, looksSignedOut, parsePlansText, vendorById } from '../shared/vendors';

const windows = new Map<string, BrowserWindow>();

/** Sign-in pages vendors hand off to (Google, Apple, Microsoft, Facebook single sign-on). */
const SSO = ['google.com', 'apple.com', 'microsoftonline.com', 'live.com', 'facebook.com', 'okta.com', 'auth0.com'];

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};
const within = (host: string, domains: string[]) => domains.some(d => host === d || host.endsWith(`.${d}`));

const locked = new Set<string>();

/** Pages in an account window get no camera, microphone, location, notifications or other device access. */
function lockDown(partition: string): void {
  if (locked.has(partition)) return;
  locked.add(partition);
  const ses = session.fromPartition(partition);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}

/**
 * Keeps an account window (and any sign-in pop-up it opens) on the vendor's site and the single sign-on pages it hands
 * off to. Anything else opens in the normal browser.
 */
function guard(contents: Electron.WebContents, allowed: string[]): void {
  const ok = (url: string) => url.startsWith('https:') && within(hostOf(url), allowed);
  contents.setWindowOpenHandler(({ url }) => {
    if (ok(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } };
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  const stay = (e: Electron.Event, url: string) => {
    if (ok(url)) return;
    e.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  };
  contents.on('will-navigate', stay);
  contents.on('will-redirect', stay);
  contents.on('did-create-window', child => guard(child.webContents, allowed));
}

/** The account's window, created on first use. `show` false keeps it hidden while reading. */
function windowFor(account: SoftwareAccount, show: boolean): BrowserWindow {
  const open = windows.get(account.id);
  if (open && !open.isDestroyed()) {
    if (show) {
      open.show();
      open.focus();
    }
    return open;
  }
  const domains = accountDomains(account);
  const partition = `persist:account-${account.id}`;
  lockDown(partition);
  const win = new BrowserWindow({
    width: 1200,
    height: 860,
    show,
    title: `${account.label} account (Freelance Hub)`,
    autoHideMenuBar: true,
    webPreferences: { partition, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // Some sign-in pages refuse browsers that call themselves Electron.
  win.webContents.setUserAgent(win.webContents.getUserAgent().replace(/\s(Electron|freelance-hub|Freelance Hub)\/\S+/gi, ''));
  guard(win.webContents, [...domains, ...SSO]);
  win.on('page-title-updated', e => e.preventDefault());
  win.on('closed', () => windows.delete(account.id));
  windows.set(account.id, win);
  void win.loadURL(account.plansUrl);
  return win;
}

export function openAccount(account: SoftwareAccount): void {
  windowFor(account, true);
}

function settled(win: BrowserWindow): Promise<void> {
  if (!win.webContents.isLoading()) return Promise.resolve();
  return new Promise(resolve => {
    const t = setTimeout(resolve, 30000);
    win.webContents.once('did-stop-loading', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

const PAGE = `(() => ({ url: location.href, text: document.body ? document.body.innerText : '', password: !!document.querySelector('input[type=password]') }))()`;

/**
 * Reads the plans from the account window: the page Rohit has open there, or the plans page loaded in the background.
 * Account pages render their lists after load, so the text is read again until a plan shows up (up to ~12 s).
 */
export async function readAccount(account: SoftwareAccount): Promise<{ plans: FoundPlan[]; url: string }> {
  const existing = windows.get(account.id);
  const win = windowFor(account, false);
  if (existing && !existing.isDestroyed() && !within(hostOf(win.webContents.getURL()), accountDomains(account))) await win.loadURL(account.plansUrl);
  await settled(win);
  const name = vendorById(account.vendor)?.name ?? account.label;
  let page = { url: account.plansUrl, text: '', password: false };
  for (let i = 0; i < 12; i++) {
    page = (await win.webContents.executeJavaScript(PAGE, true)) as typeof page;
    if (looksSignedOut(account.vendor, page.url, page.text, page.password)) {
      win.show();
      win.focus();
      throw new Error(`Sign in to ${name} in the window that just opened, then click Read plans again.`);
    }
    if (parsePlansText(account.vendor, page.text).length) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  const plans = parsePlansText(account.vendor, page.text);
  if (!plans.length) {
    win.show();
    throw new Error(`No plans found on ${page.url}. Open the page that lists your ${name} plans in that window, then click Read plans again.`);
  }
  // Keep the window around for the next read, but out of the way if it was only opened to read.
  if (!existing && win.isVisible() === false) win.close();
  return { plans, url: page.url };
}

/** Forgets the account's sign-in (its cookies and storage) when the account is removed. */
export async function forgetAccount(account: Pick<SoftwareAccount, 'id'>): Promise<void> {
  const win = windows.get(account.id);
  if (win && !win.isDestroyed()) win.destroy();
  await session.fromPartition(`persist:account-${account.id}`).clearStorageData();
}
