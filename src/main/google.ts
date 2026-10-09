import { app, safeStorage, shell } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { RawMail } from '../shared/mail';

const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
];

interface Tokens {
  refresh_token: string;
  access_token?: string;
  expires_at?: number;
}

interface Client {
  clientId: string;
  clientSecret: string;
}

let client: Client | null = null;
let tokens: Tokens | null = null;

function tokenFile(): string {
  return path.join(app.getPath('userData'), 'google-token.bin');
}

function saveTokens(t: Tokens): void {
  tokens = t;
  const json = JSON.stringify(t);
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8');
  fs.writeFileSync(tokenFile(), data);
}

function readTokens(): Tokens | null {
  try {
    const buf = fs.readFileSync(tokenFile());
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function configure(c: Client): void {
  client = c.clientId && c.clientSecret ? c : null;
  tokens ??= readTokens();
}

export function hasTokens(): boolean {
  tokens ??= readTokens();
  return !!tokens?.refresh_token;
}

export function disconnect(): void {
  tokens = null;
  fs.rmSync(tokenFile(), { force: true });
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Desktop OAuth: opens Google sign-in in the browser and catches the redirect on a loopback port. */
export async function connect(c: Client): Promise<{ email: string }> {
  configure(c);
  if (!client) throw new Error('Add your Google OAuth client ID and secret first.');
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const got = url.searchParams.get('code');
      const err = url.searchParams.get('error');
      if (!got && !err) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<html><body style="font-family:system-ui;padding:40px;background:#111;color:#eee"><h2>${
          err ? 'Google sign-in was cancelled.' : 'Freelance Hub is connected.'
        }</h2><p>You can close this tab and go back to the app.</p></body></html>`,
      );
      clearTimeout(timer);
      server.close();
      if (err) reject(new Error(`Google sign-in failed: ${err}`));
      else if (url.searchParams.get('state') !== state) reject(new Error('Sign-in reply did not match; try again.'));
      else resolve({ code: got!, redirectUri });
    });
    let redirectUri = '';
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Timed out waiting for Google sign-in (5 minutes).'));
    }, 5 * 60000);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      redirectUri = `http://127.0.0.1:${port}`;
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.search = new URLSearchParams({
        client_id: client!.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        access_type: 'offline',
        prompt: 'consent',
        state,
      }).toString();
      shell.openExternal(auth.toString());
    });
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  const body = (await res.json()) as any;
  if (!res.ok || !body.refresh_token) throw new Error(`Google token exchange failed: ${body.error_description ?? body.error ?? res.status}`);
  saveTokens({ refresh_token: body.refresh_token, access_token: body.access_token, expires_at: Date.now() + body.expires_in * 1000 });
  const email = body.id_token ? JSON.parse(Buffer.from(body.id_token.split('.')[1], 'base64').toString()).email : '';
  return { email };
}

async function accessToken(force = false): Promise<string> {
  tokens ??= readTokens();
  if (!client || !tokens?.refresh_token) throw new Error('Google is not connected. Open Settings → Google.');
  if (!force && tokens.access_token && (tokens.expires_at ?? 0) > Date.now() + 60000) return tokens.access_token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const body = (await res.json()) as any;
  if (!res.ok) {
    if (body.error === 'invalid_grant') disconnect();
    throw new Error(
      body.error === 'invalid_grant'
        ? 'Google sign-in expired. Reconnect in Settings (publish the OAuth app to "In production" so it stops expiring every 7 days).'
        : `Google refresh failed: ${body.error_description ?? body.error ?? res.status}`,
    );
  }
  saveTokens({ ...tokens, access_token: body.access_token, expires_at: Date.now() + body.expires_in * 1000 });
  return body.access_token;
}

async function api<T = any>(url: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(u, { headers: { Authorization: `Bearer ${await accessToken(attempt > 0)}` } });
    if (res.status === 401 && attempt === 0) continue;
    if (res.status === 429 || res.status >= 500) {
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
      continue;
    }
    const body = (await res.json()) as any;
    if (!res.ok) throw new Error(`${u.hostname}: ${body?.error?.message ?? res.status}`);
    return body as T;
  }
  throw new Error(`${u.hostname}: request kept failing`);
}

/** Runs async work over items with a small concurrency limit. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

export async function gmailIds(q: string, max = 50): Promise<string[]> {
  const body = await api<{ messages?: { id: string }[] }>(`${GMAIL}/messages`, { q, maxResults: max });
  return (body.messages ?? []).map(m => m.id);
}

const decode = (data?: string) => (data ? Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : '');

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n');
}

export async function gmailMessage(id: string, full: boolean): Promise<RawMail> {
  // metadataHeaders repeats, so it is written into the URL rather than passed as a single param.
  const msg = await api<any>(
    full ? `${GMAIL}/messages/${id}?format=full` : `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`,
  );
  const headers: { name: string; value: string }[] = msg.payload?.headers ?? [];
  const h = (n: string) => headers.find(x => x.name.toLowerCase() === n)?.value ?? '';
  if (!full) {
    return {
      id,
      threadId: msg.threadId,
      from: h('from'),
      to: h('to'),
      subject: h('subject'),
      snippet: msg.snippet ?? '',
      date: new Date(Number(msg.internalDate)).toISOString(),
      labelIds: msg.labelIds ?? [],
    };
  }
  let text = '';
  let html = '';
  let calendar = '';
  const walk = async (part: any) => {
    if (!part) return;
    const type = (part.mimeType ?? '').toLowerCase();
    if (type === 'text/plain' && !text) text = decode(part.body?.data);
    else if (type === 'text/html' && !html) html = decode(part.body?.data);
    else if (type === 'text/calendar' || (part.filename ?? '').toLowerCase().endsWith('.ics')) {
      if (part.body?.data) calendar = decode(part.body.data);
      else if (part.body?.attachmentId) {
        const att = await api<any>(`${GMAIL}/messages/${id}/attachments/${part.body.attachmentId}`);
        calendar = decode(att.data);
      }
    }
    for (const p of part.parts ?? []) await walk(p);
  };
  await walk(msg.payload);
  return {
    id,
    threadId: msg.threadId,
    from: h('from'),
    to: h('to'),
    subject: h('subject'),
    snippet: msg.snippet ?? '',
    date: new Date(Number(msg.internalDate)).toISOString(),
    labelIds: msg.labelIds ?? [],
    body: text || stripHtml(html),
    calendar: calendar || undefined,
  };
}

export interface CalEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: { email?: string };
  attendees?: { email?: string }[];
  conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] };
  status?: string;
}

export async function calendarEvents(from: Date, to: Date): Promise<CalEvent[]> {
  const body = await api<{ items?: CalEvent[] }>('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250,
  });
  return (body.items ?? []).filter(e => e.status !== 'cancelled');
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string;
}

/** Lists a Drive folder and its subfolders (three levels deep). */
export async function driveTree(folderId: string, depth = 3): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const body = await api<{ files: DriveFile[]; nextPageToken?: string }>('https://www.googleapis.com/drive/v3/files', {
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id,name,mimeType,modifiedTime,webViewLink)',
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageToken,
    });
    for (const f of body.files) {
      if (f.mimeType === 'application/vnd.google-apps.folder') {
        if (depth > 1) out.push(...(await driveTree(f.id, depth - 1)));
      } else out.push(f);
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  return out;
}
