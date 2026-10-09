import type { AppState, EmailItem, Meeting, Model, Payment, Subscription, Suggestion, SyncResult } from '../shared/types';
import {
  classify,
  findJoinUrl,
  looksLikePayout,
  meetingFromInviteSubject,
  parseIcs,
  parseSubscription,
  parseWaveinkSalary,
  toEmailItem,
  type RawMail,
} from '../shared/mail';
import { normaliseCode } from '../shared/status';
import { calendarEvents, driveTree, gmailIds, gmailMessage, hasTokens, pool } from './google';
import { getState, update } from './store';

const DAY = 86400000;
const KEEP_EMAIL_DAYS = 90;
const MAX_EMAILS = 600;

let running: Promise<SyncResult> | null = null;

export function runSync(): Promise<SyncResult> {
  running ??= doSync().finally(() => (running = null));
  return running;
}

function companyQueries(state: AppState): string[] {
  const qs: string[] = [];
  for (const c of state.companies) {
    const parts = c.match.domains.flatMap(d => [`from:${d}`, `to:${d}`]);
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

    // 1. Mail: client threads, Teams notifications and receipts
    const clientIds = new Set<string>();
    for (const q of companyQueries(start)) for (const id of await gmailIds(q, 60)) clientIds.add(id);
    const receiptIds = new Set(await gmailIds(RECEIPTS, 60));
    const allIds = [...new Set([...clientIds, ...receiptIds])];
    // New mail gets fetched; recent known mail is refetched so read/unread stays current.
    const toFetch = allIds.filter(id => {
      const k = known.get(id);
      return !k || now - new Date(k.date).getTime() < 7 * DAY;
    });
    const handled = new Set([...start.handledEmails, ...start.suggestions.map(s => s.emailId)]);
    const needsBody = (id: string, meta: RawMail) =>
      !handled.has(id) &&
      (receiptIds.has(id) || /salary|payout|payment|remittance|invitation|meeting|invite/i.test(meta.subject));
    const raws = await pool(toFetch, 6, async id => {
      const meta = await gmailMessage(id, false);
      return needsBody(id, meta) ? gmailMessage(id, true) : meta;
    });

    const items: EmailItem[] = [];
    const payments: Payment[] = [];
    const suggestions: Suggestion[] = [];
    const subUpdates: { id: string; patch: Partial<Subscription> }[] = [];
    const mailMeetings: Meeting[] = [];
    const handledNow: string[] = [];
    const wi = start.companies.find(c => c.id === 'waveink')!;
    const retainer = wi.pay.kind === 'retainer' ? wi.pay.amount : 0;

    for (const raw of raws) {
      const item = toEmailItem(raw, start.companies);
      if (receiptIds.has(raw.id) && !clientIds.has(raw.id)) {
        item.company = 'other';
        item.kind = 'receipt';
      }
      items.push(item);
      if (!known.has(raw.id)) result.newEmails++;
      if (handled.has(raw.id)) continue;

      if (item.company === 'waveink' && /salary/i.test(raw.subject) && raw.from.toLowerCase().includes('waveink')) {
        const p = parseWaveinkSalary(raw, retainer);
        if (p) {
          payments.push({ ...(p as Omit<Payment, 'id'>), id: `pay-${raw.id}` });
          handledNow.push(raw.id);
          continue;
        }
      }
      if (item.company === 'metaztech' && looksLikePayout(raw) && !/onboarding|password/i.test(raw.subject)) {
        suggestions.push({
          id: `sg-${raw.id}`,
          kind: 'payment',
          emailId: raw.id,
          emailUrl: item.url,
          title: `MetaZtech payment mail: ${raw.subject}`,
          detail: 'Enter the amount that reached your bank.',
          payment: { company: 'metaztech', date: raw.date.slice(0, 10), currency: 'INR', note: raw.subject, source: 'email', emailId: raw.id },
          createdAt: new Date().toISOString(),
        });
        continue;
      }
      if (item.company !== 'other' && (raw.calendar || item.kind === 'invite')) {
        const ics = raw.calendar ? parseIcs(raw.calendar) : null;
        const meeting = ics
          ? {
              id: `mail-${raw.id}`,
              company: item.company,
              title: ics.title,
              start: new Date(ics.start).toISOString(),
              end: ics.end ? new Date(ics.end).toISOString() : undefined,
              joinUrl: ics.joinUrl ?? findJoinUrl(raw.body ?? ''),
              link: item.url,
              organizer: ics.organizer,
              source: 'email' as const,
            }
          : meetingFromInviteSubject(raw, item.company);
        if (meeting && !Number.isNaN(new Date(meeting.start).getTime())) mailMeetings.push(meeting);
      }
      if (receiptIds.has(raw.id) && raw.body) {
        const sub = parseSubscription(raw);
        if (!sub) continue;
        const match = findSubscription(start.subscriptions, sub);
        if (match) {
          subUpdates.push({ id: match.id, patch: subscriptionPatch(match, sub) });
          handledNow.push(raw.id);
        } else if (sub.amount != null || sub.status === 'cancelling') {
          suggestions.push({
            id: `sg-${raw.id}`,
            kind: 'subscription',
            emailId: raw.id,
            emailUrl: item.url,
            title: `New subscription? ${sub.name}`,
            detail: raw.subject,
            subscription: sub,
            createdAt: new Date().toISOString(),
          });
        }
      }
    }

    // 2. Calendar
    const events = await calendarEvents(new Date(now - 7 * DAY), new Date(now + 30 * DAY));
    const calMeetings: Meeting[] = events
      .filter(e => e.start.dateTime)
      .map(e => {
        const attendees = (e.attendees ?? []).map(a => a.email).filter(Boolean).join(', ');
        const company = classify(
          { id: e.id, threadId: e.id, from: e.organizer?.email ?? '', to: attendees, subject: e.summary ?? '', snippet: e.description ?? '', date: '', labelIds: [] },
          start.companies,
        );
        const conf = e.conferenceData?.entryPoints?.find(p => p.entryPointType === 'video')?.uri;
        return {
          id: `cal-${e.id}`,
          company,
          title: e.summary ?? '(no title)',
          start: new Date(e.start.dateTime!).toISOString(),
          end: e.end?.dateTime ? new Date(e.end.dateTime).toISOString() : undefined,
          joinUrl: e.hangoutLink ?? conf ?? findJoinUrl(`${e.description ?? ''} ${e.location ?? ''}`),
          link: e.htmlLink,
          organizer: e.organizer?.email,
          source: 'calendar' as const,
        };
      });

    // 3. Drive: Waveink GLB uploads are named by Jasani code
    let driveFiles: { code: string; url: string; modified: string }[] = [];
    if (start.settings.waveinkDriveFolderId) {
      const files = await driveTree(start.settings.waveinkDriveFolderId);
      driveFiles = files
        .filter(f => /\.(glb|gltf)$/i.test(f.name))
        .map(f => ({ code: normaliseCode(f.name.replace(/\.(glb|gltf)$/i, '')), url: f.webViewLink, modified: f.modifiedTime }));
    }

    update(s => {
      // mail
      const byId = new Map(s.emails.map(e => [e.id, e]));
      for (const e of items) byId.set(e.id, e);
      const cutoff = now - KEEP_EMAIL_DAYS * DAY;
      s.emails = [...byId.values()]
        .filter(e => new Date(e.date).getTime() > cutoff)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, MAX_EMAILS);
      // money
      for (const p of payments) {
        if (s.payments.some(x => x.emailId === p.emailId || (p.reference && x.reference === p.reference))) continue;
        s.payments.push(p);
        result.newPayments++;
      }
      for (const sg of suggestions) {
        if (s.suggestions.some(x => x.emailId === sg.emailId)) continue;
        s.suggestions.push(sg);
        result.newSuggestions++;
      }
      for (const u of subUpdates) {
        const i = s.subscriptions.findIndex(x => x.id === u.id);
        if (i >= 0) s.subscriptions[i] = { ...s.subscriptions[i], ...u.patch };
      }
      s.handledEmails = [...new Set([...s.handledEmails, ...handledNow])].slice(-2000);
      // meetings: calendar wins over the same meeting found in mail
      const keep = s.meetings.filter(m => m.source === 'email' && new Date(m.start).getTime() > now - 7 * DAY && !mailMeetings.some(x => x.id === m.id));
      const merged = [...calMeetings];
      for (const m of [...keep, ...mailMeetings]) {
        const dup = merged.some(c => Math.abs(new Date(c.start).getTime() - new Date(m.start).getTime()) < 10 * 60000 && similar(c.title, m.title));
        if (!dup) merged.push(m);
      }
      s.meetings = merged.sort((a, b) => a.start.localeCompare(b.start));
      result.meetings = s.meetings.filter(m => new Date(m.start).getTime() > now).length;
      // drive
      const codeMap = new Map(driveFiles.map(f => [f.code, f]));
      s.models = s.models.map((m: Model) => {
        if (m.company !== 'waveink' || !m.code) return m;
        const f = codeMap.get(normaliseCode(m.code));
        if (!f) return m.driveFileUrl ? { ...m, driveFileUrl: undefined, driveModifiedAt: undefined } : m;
        result.driveMatches++;
        if (m.driveFileUrl === f.url && m.driveModifiedAt === f.modified) return m;
        return { ...m, driveFileUrl: f.url, driveModifiedAt: f.modified, glbFile: m.glbFile || `${m.code}.glb` };
      });
      s.settings.google.lastSync = new Date().toISOString();
      delete s.settings.google.lastError;
    });
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

function similar(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return n(a) === n(b) || n(a).includes(n(b)) || n(b).includes(n(a));
}

const GENERIC = new Set(['subscription', 'google', 'play', 'the', 'plan', 'annual', 'monthly', 'yearly', 'pro', 'by', 'llc', 'limited', 'inc', 'pbc', 'opco', 'ireland', 'ai', 'app', 'and', 'from']);

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length > 1 && !GENERIC.has(w)),
  );
}

/** The existing subscription sharing the most distinctive words with a receipt, if any. */
export function findSubscription(subs: Subscription[], found: Partial<Subscription>): Subscription | undefined {
  const want = tokens(`${found.name ?? ''} ${found.vendor ?? ''}`);
  let best: Subscription | undefined;
  let score = 0;
  for (const s of subs) {
    const have = tokens(`${s.name} ${s.vendor}`);
    const n = [...want].filter(w => have.has(w)).length;
    if (n > score) {
      best = s;
      score = n;
    }
  }
  return best;
}

function subscriptionPatch(current: Subscription, found: Partial<Subscription>): Partial<Subscription> {
  const patch: Partial<Subscription> = {};
  if (found.status === 'cancelling') {
    patch.status = 'cancelling';
    if (found.endsOn) patch.endsOn = found.endsOn;
    return patch;
  }
  if (found.lastCharged && (!current.lastCharged || found.lastCharged > current.lastCharged)) {
    patch.lastCharged = found.lastCharged;
    if (found.nextRenewal) patch.nextRenewal = found.nextRenewal;
    if (found.amount != null) patch.amount = found.amount;
    if (current.status === 'trial') patch.status = 'active';
  }
  return patch;
}
