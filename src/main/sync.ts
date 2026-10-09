import type { AppState, SyncResult } from '../shared/types';
import type { RawMail } from '../shared/mail';
import { applySync, calendarMeetings, driveGlbs, ingestMail, needsBody, type DriveGlb } from '../shared/ingest';
import { calendarEvents, driveTree, gmailIds, gmailMessage, hasTokens, pool } from './google';
import { getState, update } from './store';

const DAY = 86400000;

let running: Promise<SyncResult> | null = null;

export function runSync(): Promise<SyncResult> {
  running ??= doSync().finally(() => (running = null));
  return running;
}

function companyQueries(state: AppState): string[] {
  const qs: string[] = [];
  for (const c of state.companies) {
    const parts = [...c.match.domains.flatMap(d => [`from:${d}`, `to:${d}`]), ...(c.match.emails ?? []).flatMap(e => [`from:${e}`, `to:${e}`])];
    if (parts.length) qs.push(`newer_than:60d {${parts.join(' ')}}`);
    const words = c.match.keywords.filter(k => k.length > 3).map(k => `subject:${k.includes(' ') ? `"${k}"` : k}`);
    if (words.length) qs.push(`newer_than:60d {${words.join(' ')}} -category:promotions`);
  }
  qs.push('from:no-reply@teams.mail.microsoft newer_than:30d');
  return qs;
}

const RECEIPTS =
  'newer_than:120d -category:promotions {from:googleplay-noreply@google.com from:link.com from:stripe.com from:paddle.com ' +
  'subject:receipt subject:invoice subject:"your subscription" subject:renewal subject:renewed subject:"free trial"}';

async function doSync(): Promise<SyncResult> {
  const result: SyncResult = { ok: true, newEmails: 0, meetings: 0, driveMatches: 0, newSuggestions: 0, newPayments: 0 };
  const start = getState();
  if (!start.settings.google.connected || !hasTokens()) {
    return { ...result, ok: false, error: 'Google is not connected yet. Open Settings → Google account.' };
  }
  try {
    const now = Date.now();
    const known = new Map(start.emails.map(e => [e.id, e]));

    // Mail: client threads, Teams notifications and receipts
    const clientIds = new Set<string>();
    for (const q of companyQueries(start)) for (const id of await gmailIds(q, 60)) clientIds.add(id);
    const receiptIds = new Set(await gmailIds(RECEIPTS, 60));
    // New mail gets fetched; recent known mail is refetched so read/unread stays current.
    const toFetch = [...new Set([...clientIds, ...receiptIds])].filter(id => {
      const k = known.get(id);
      return !k || now - new Date(k.date).getTime() < 7 * DAY;
    });
    const raws: RawMail[] = await pool(toFetch, 6, async id => {
      const meta = await gmailMessage(id, false);
      return needsBody(start, meta, receiptIds) ? gmailMessage(id, true) : meta;
    });
    const got = ingestMail(start, raws, receiptIds, clientIds, new Date(now).toISOString());

    const events = await calendarEvents(new Date(now - 7 * DAY), new Date(now + 30 * DAY));
    const meetings = calendarMeetings(events, start);

    // Waveink GLB uploads are named by Jasani code
    let drive: DriveGlb[] | null = null;
    if (start.settings.waveinkDriveFolderId) drive = driveGlbs(await driveTree(start.settings.waveinkDriveFolderId));

    update(s => applySync(s, got, meetings, drive, now, result));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    update(s => {
      s.settings.google.lastError = message;
      if (/not connected|expired/i.test(message)) s.settings.google.connected = false;
    });
    return { ...result, ok: false, error: message };
  }
  return result;
}
