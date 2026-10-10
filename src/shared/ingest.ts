/**
 * Turns fetched mail, calendar events and Drive files into app state.
 * Shared by the desktop sync and the browser preview, so both sort and parse the same way.
 */
import type { AppState, EmailItem, Meeting, Model, Payment, Subscription, Suggestion, SyncResult } from './types';
import { classify, findJoinUrl, looksLikePayout, meetingFromInviteSubject, parseIcs, parseSubscription, parseWaveinkSalary, toEmailItem, type RawMail } from './mail';
import { normaliseCode } from './status';
import { foldVendorMail, matchVendorSub, parseVendorMail, vendorOfMail } from './vendors';
import { localDate } from './money';

const DAY = 86400000;
const KEEP_EMAIL_DAYS = 90;
const MAX_EMAILS = 600;

export interface CalEventLike {
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

export interface DriveGlb {
  code: string;
  url: string;
  modified: string;
}

export interface Ingested {
  items: EmailItem[];
  payments: Payment[];
  suggestions: Suggestion[];
  subUpdates: { id: string; patch: Partial<Subscription> }[];
  /** New mail about a plan already waiting in Mail scan. */
  suggestionUpdates: { id: string; patch: Partial<Subscription>; detail: string }[];
  mailMeetings: Meeting[];
  handledNow: string[];
  newEmails: number;
}

/** Email ids that need their full body fetched (receipts, payment and invite mails not yet handled). */
export function needsBody(state: AppState, raw: Pick<RawMail, 'id' | 'subject'>, receiptIds: Set<string>): boolean {
  if (state.handledEmails.includes(raw.id) || state.suggestions.some(s => s.emailId === raw.id)) return false;
  return receiptIds.has(raw.id) || /salary|payout|payment|remittance|invitation|meeting|invite/i.test(raw.subject);
}

export function ingestMail(state: AppState, raws: RawMail[], receiptIds: Set<string>, clientIds: Set<string>, nowIso: string): Ingested {
  const out: Ingested = { items: [], payments: [], suggestions: [], subUpdates: [], suggestionUpdates: [], mailMeetings: [], handledNow: [], newEmails: 0 };
  const vendorMails: VendorMail[] = [];
  const known = new Set(state.emails.map(e => e.id));
  const handled = new Set([...state.handledEmails, ...state.suggestions.map(s => s.emailId)]);
  const wi = state.companies.find(c => c.id === 'waveink')!;
  const retainer = wi.pay.kind === 'retainer' ? wi.pay.amount : 0;

  for (const raw of raws) {
    const item = toEmailItem(raw, state.companies);
    if (receiptIds.has(raw.id) && !clientIds.has(raw.id)) {
      item.company = 'other';
      item.kind = 'receipt';
    }
    out.items.push(item);
    if (!known.has(raw.id)) out.newEmails++;
    if (handled.has(raw.id)) continue;

    if (item.company === 'waveink' && /salary/i.test(raw.subject) && raw.from.toLowerCase().includes('waveink')) {
      const p = parseWaveinkSalary(raw, retainer);
      if (p) {
        out.payments.push({ ...(p as Omit<Payment, 'id'>), id: `pay-${raw.id}` });
        out.handledNow.push(raw.id);
        continue;
      }
    }
    if (item.company === 'metaztech' && looksLikePayout(raw) && !/onboarding|password/i.test(raw.subject)) {
      out.suggestions.push({
        id: `sg-${raw.id}`,
        kind: 'payment',
        emailId: raw.id,
        emailUrl: item.url,
        title: `MetaZtech payment mail: ${raw.subject}`,
        detail: 'Enter the amount that reached your bank.',
        payment: { company: 'metaztech', date: localDate(raw.date), currency: 'INR', note: raw.subject, source: 'email', emailId: raw.id },
        createdAt: nowIso,
      });
      continue;
    }
    if (item.company !== 'other' && (raw.calendar || item.kind === 'invite')) {
      const ics = raw.calendar ? parseIcs(raw.calendar) : null;
      const meeting: Meeting | null = ics
        ? {
            id: `mail-${raw.id}`,
            company: item.company,
            title: ics.title,
            start: new Date(ics.start).toISOString(),
            end: ics.end ? new Date(ics.end).toISOString() : undefined,
            joinUrl: ics.joinUrl ?? findJoinUrl(raw.body ?? ''),
            link: item.url,
            organizer: ics.organizer,
            source: 'email',
          }
        : meetingFromInviteSubject(raw, item.company);
      if (meeting && !Number.isNaN(new Date(meeting.start).getTime())) out.mailMeetings.push(meeting);
    }
    if (receiptIds.has(raw.id) && raw.body) {
      // Software vendors' mail is read by the vendor rules only, so their promotions never become subscriptions.
      if (vendorOfMail(raw, state.accounts)) {
        const found = parseVendorMail(raw, state.accounts);
        if (found) vendorMails.push({ raw, url: item.url, found });
        else out.handledNow.push(raw.id);
        continue;
      }
      const sub = parseSubscription(raw);
      if (!sub) continue;
      const match = findSubscription(state.subscriptions, sub);
      if (match) {
        out.subUpdates.push({ id: match.id, patch: subscriptionPatch(match, sub) });
        out.handledNow.push(raw.id);
      } else if (sub.amount != null || sub.status === 'cancelling') {
        out.suggestions.push({
          id: `sg-${raw.id}`,
          kind: 'subscription',
          emailId: raw.id,
          emailUrl: item.url,
          title: `New subscription? ${sub.name}`,
          detail: raw.subject,
          subscription: sub,
          createdAt: nowIso,
        });
      }
    }
  }
  foldVendorMails(state, vendorMails, out, nowIso);
  return out;
}

interface VendorMail {
  raw: RawMail;
  url: string;
  found: Partial<Subscription>;
}

/**
 * A vendor's mails about one plan (trial, order, invoice, auto-renew off) become one update or one proposal: each mail,
 * oldest first, is folded into the subscription, waiting proposal or new proposal it belongs to.
 */
function foldVendorMails(state: AppState, mails: VendorMail[], out: Ingested, nowIso: string): void {
  type Target = { key: string; kind: 'sub' | 'sg' | 'new'; base: Partial<Subscription>; cur: Partial<Subscription>; mails: VendorMail[] };
  const targets = new Map<string, Target>();
  const waiting = state.suggestions.filter(s => s.kind === 'subscription' && s.subscription);
  for (const m of [...mails].sort((a, b) => a.raw.date.localeCompare(b.raw.date))) {
    const pool = [
      ...state.subscriptions.map(s => ({ key: `sub:${s.id}`, kind: 'sub' as const, base: s })),
      ...waiting.map(s => ({ key: `sg:${s.id}`, kind: 'sg' as const, base: s.subscription! })),
      ...[...targets.values()].filter(t => t.kind === 'new'),
    ].map(c => ({ ...c, cur: targets.get(c.key)?.cur ?? c.base }));
    const hit = matchVendorSub(
      pool.map(c => ({ ...c.cur, id: c.key, name: c.cur.name ?? '', vendor: c.cur.vendor ?? '', status: c.cur.status ?? 'active' }) as Subscription),
      m.found,
    );
    const c = hit ? pool.find(x => x.key === hit.id)! : { key: `new:${m.raw.id}`, kind: 'new' as const, base: {}, cur: {} };
    const t: Target = targets.get(c.key) ?? { key: c.key, kind: c.kind, base: c.base, cur: c.cur, mails: [] };
    t.cur = foldVendorMail(t.cur, m.found);
    t.mails.push(m);
    targets.set(c.key, t);
  }
  for (const t of targets.values()) {
    out.handledNow.push(...t.mails.map(m => m.raw.id));
    const last = t.mails[t.mails.length - 1];
    const detail = t.mails.length === 1 ? last.raw.subject : `${t.mails.length} ${t.cur.vendor} mails, latest: ${last.raw.subject}`;
    if (t.kind === 'sub') {
      const patch = Object.fromEntries(Object.entries(t.cur).filter(([k, v]) => k !== 'emailId' && JSON.stringify(v) !== JSON.stringify((t.base as Record<string, unknown>)[k])));
      if (Object.keys(patch).length) out.subUpdates.push({ id: t.key.slice(4), patch });
    } else if (t.kind === 'sg') {
      out.suggestionUpdates.push({ id: t.key.slice(3), patch: t.cur, detail });
    } else if (t.cur.name !== t.cur.vendor || t.cur.amount != null || t.cur.status === 'cancelling') {
      out.suggestions.push({
        id: `sg-${last.raw.id}`,
        kind: 'subscription',
        emailId: last.raw.id,
        emailUrl: last.url,
        title: `New subscription? ${t.cur.name}`,
        detail,
        subscription: { currency: 'USD', cycle: 'yearly', ...t.cur },
        createdAt: nowIso,
      });
    }
  }
}

export function calendarMeetings(events: CalEventLike[], state: AppState): Meeting[] {
  return events
    .filter(e => e.start.dateTime && e.status !== 'cancelled')
    .map(e => {
      const attendees = (e.attendees ?? []).map(a => a.email).filter(Boolean).join(', ');
      const company = classify(
        { id: e.id, threadId: e.id, from: e.organizer?.email ?? '', to: attendees, subject: e.summary ?? '', snippet: e.description ?? '', date: '', labelIds: [] },
        state.companies,
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
}

export function driveGlbs(files: { name: string; webViewLink: string; modifiedTime: string }[]): DriveGlb[] {
  return files
    .filter(f => /\.(glb|gltf)$/i.test(f.name))
    .map(f => ({ code: normaliseCode(f.name.replace(/\.(glb|gltf)$/i, '')), url: f.webViewLink, modified: f.modifiedTime }));
}

/** Writes one sync's findings into the state. `drive` is null when Drive was not read, so existing matches are kept. */
export function applySync(s: AppState, got: Ingested, calMeetings: Meeting[], drive: DriveGlb[] | null, nowMs: number, result: SyncResult): void {
  const byId = new Map(s.emails.map(e => [e.id, e]));
  for (const e of got.items) byId.set(e.id, e);
  const cutoff = nowMs - KEEP_EMAIL_DAYS * DAY;
  s.emails = [...byId.values()]
    .filter(e => new Date(e.date).getTime() > cutoff)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_EMAILS);
  result.newEmails += got.newEmails;

  for (const p of got.payments) {
    if (
      s.payments.some(
        x => x.emailId === p.emailId || (p.reference && x.reference === p.reference) || (p.period && x.company === p.company && x.period === p.period),
      )
    )
      continue;
    s.payments.push(p);
    result.newPayments++;
  }
  for (const sg of got.suggestions) {
    if (s.suggestions.some(x => x.emailId === sg.emailId)) continue;
    s.suggestions.push(sg);
    result.newSuggestions++;
  }
  for (const u of got.subUpdates) {
    const i = s.subscriptions.findIndex(x => x.id === u.id);
    if (i >= 0) s.subscriptions[i] = { ...s.subscriptions[i], ...u.patch };
  }
  for (const u of got.suggestionUpdates) {
    const sg = s.suggestions.find(x => x.id === u.id);
    if (!sg) continue;
    sg.subscription = { ...sg.subscription, ...u.patch };
    sg.title = `New subscription? ${sg.subscription.name}`;
    sg.detail = u.detail;
  }
  s.handledEmails = [...new Set([...s.handledEmails, ...got.handledNow])].slice(-2000);

  // Calendar wins over the same meeting found in a mail.
  const keep = s.meetings.filter(m => m.source === 'email' && new Date(m.start).getTime() > nowMs - 7 * DAY && !got.mailMeetings.some(x => x.id === m.id));
  const merged = [...calMeetings];
  for (const m of [...keep, ...got.mailMeetings]) {
    const dup = merged.some(c => Math.abs(new Date(c.start).getTime() - new Date(m.start).getTime()) < 10 * 60000 && similar(c.title, m.title));
    if (!dup) merged.push(m);
  }
  s.meetings = merged.sort((a, b) => a.start.localeCompare(b.start));
  result.meetings = s.meetings.filter(m => new Date(m.start).getTime() > nowMs).length;

  if (drive) {
    const codeMap = new Map(drive.map(f => [f.code, f]));
    s.models = s.models.map((m: Model) => {
      if (m.company !== 'waveink' || !m.code) return m;
      const f = codeMap.get(normaliseCode(m.code));
      if (!f) return m.driveFileUrl ? { ...m, driveFileUrl: undefined, driveModifiedAt: undefined } : m;
      result.driveMatches++;
      if (m.driveFileUrl === f.url && m.driveModifiedAt === f.modified) return m;
      return { ...m, driveFileUrl: f.url, driveModifiedAt: f.modified, glbFile: m.glbFile || `${m.code}.glb` };
    });
  }
  s.settings.google.lastSync = new Date(nowMs).toISOString();
  delete s.settings.google.lastError;
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
