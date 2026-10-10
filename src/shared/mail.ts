import type { CompanyConfig, Currency, EmailCompany, EmailItem, Meeting, Payment, Subscription } from './types';
import { localDate } from './money';

export interface RawMail {
  id: string;
  threadId: string;
  from: string;
  to?: string;
  subject: string;
  snippet: string;
  date: string;
  labelIds: string[];
  body?: string;
  calendar?: string;
}

export function parseFrom(from: string): { name: string; email: string } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2], email: m[2].toLowerCase() };
  return { name: from.trim(), email: from.trim().toLowerCase() };
}

const TEAMS_SENDER = 'no-reply@teams.mail.microsoft';

/** Teams notification subjects look like "Ritu Agrawal sent a message" or "A and B sent 2 messages to your chat". */
export function teamsSenders(subject: string): string[] {
  const m = subject.match(/^(.*?)\s+sent\s+(a message|\d+ messages)/i);
  if (!m) return [];
  return m[1].split(/\s*(?:,|\band\b)\s*/).map(s => s.replace(/[^\p{L}\s.'-]/gu, '').trim()).filter(Boolean);
}

export function classify(mail: RawMail, companies: CompanyConfig[]): EmailCompany {
  const { email, name } = parseFrom(mail.from);
  const to = (mail.to ?? '').toLowerCase();
  const domain = email.split('@')[1] ?? '';
  const people = email === TEAMS_SENDER ? teamsSenders(mail.subject) : [name];
  const text = `${mail.subject} ${mail.snippet}`.toLowerCase();
  for (const c of companies) {
    if (c.match.domains.some(d => domain === d || domain.endsWith('.' + d) || to.includes('@' + d))) return c.id;
    if ((c.match.emails ?? []).some(e => e && (email === e.toLowerCase() || to.includes(e.toLowerCase())))) return c.id;
  }
  for (const c of companies) {
    const names = c.match.names.map(n => n.toLowerCase());
    if (people.some(p => names.some(n => n && p.toLowerCase().includes(n)))) return c.id;
  }
  for (const c of companies) {
    if (c.match.keywords.some(k => k && text.includes(k.toLowerCase()))) return c.id;
  }
  return 'other';
}

const ATTENTION = [
  'rejection', 'rejected', 'reject', 'revision', 'redo', 'rework', 'urgent', 'asap', 'deadline', 'today', 'eod',
  'tomorrow', 'upload', 'hold', 'feedback', 'target', 'low performer', 'removing', 'meeting', 'call', 'review',
  'please', 'payment', 'salary', 'invoice',
];

export function attentionWords(mail: RawMail): string[] {
  const text = `${mail.subject} ${mail.snippet}`.toLowerCase();
  return ATTENTION.filter(w => new RegExp(`\\b${w}\\b`).test(text)).slice(0, 4);
}

export function gmailUrl(id: string): string {
  return `https://mail.google.com/mail/u/0/#all/${id}`;
}

/** "Re:", "Fwd:" — a reply about a payment is not a second payment. */
const REPLY = /^\s*(re|fw|fwd|aw)\s*:/i;

export function toEmailItem(mail: RawMail, companies: CompanyConfig[]): EmailItem {
  const { name, email } = parseFrom(mail.from);
  const teams = email === TEAMS_SENDER;
  const kind: EmailItem['kind'] = teams
    ? 'teams'
    : mail.calendar || /^(updated )?invitation|invitation from/i.test(mail.subject)
      ? 'invite'
      : !REPLY.test(mail.subject) && /salary|payout|payment|remittance|transfer reference/i.test(mail.subject)
        ? 'payment'
        : /receipt|invoice|subscription|renew/i.test(mail.subject)
          ? 'receipt'
          : 'mail';
  return {
    id: mail.id,
    threadId: mail.threadId,
    company: classify(mail, companies),
    from: email,
    fromName: teams ? teamsSenders(mail.subject).join(', ') || 'Teams' : name,
    subject: mail.subject,
    snippet: decodeEntities(mail.snippet),
    date: mail.date,
    unread: mail.labelIds.includes('UNREAD'),
    url: gmailUrl(mail.id),
    kind,
    attention: attentionWords(mail),
  };
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[͏​­﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON3 = MONTHS.map(m => m.slice(0, 3));

function monthIndex(word: string): number {
  const w = word.toLowerCase().slice(0, 3);
  return MON3.indexOf(w === 'sep' ? 'sep' : w);
}

/** Waveink salary mail: "Salary Transfer Reference – Rohit - September 2026". */
export function parseWaveinkSalary(mail: RawMail, retainer: number): Partial<Payment> | null {
  if (REPLY.test(mail.subject) || !/salary/i.test(mail.subject)) return null;
  const ref = `${mail.subject} ${mail.body ?? mail.snippet}`.match(/transfer reference:?\s*([A-Z0-9]{6,})/i)?.[1];
  const per = mail.subject.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i);
  const period = per ? `${per[2]}-${String(monthIndex(per[1]) + 1).padStart(2, '0')}` : undefined;
  return {
    company: 'waveink',
    date: localDate(mail.date),
    amount: retainer,
    currency: 'AED',
    period,
    reference: ref,
    note: mail.subject,
    source: 'email',
    emailId: mail.id,
  };
}

export function looksLikePayout(mail: RawMail): boolean {
  return !REPLY.test(mail.subject) && /payout|payment|remittance|credited|transferred|invoice|salary|paid/i.test(mail.subject);
}

const CUR: Record<string, Currency> = { '₹': 'INR', rs: 'INR', 'rs.': 'INR', inr: 'INR', aed: 'AED', $: 'USD', usd: 'USD' };

function money(text: string): { amount: number; currency: Currency } | null {
  const make = (sym: string, num: string) => {
    const currency = CUR[sym.toLowerCase()];
    const amount = Number(num.replace(/,/g, ''));
    return currency && Number.isFinite(amount) && amount > 0 ? { amount, currency } : null;
  };
  const before = text.match(/(₹|rs\.?|inr|aed|\$|usd)\s?([\d,]+(?:\.\d{1,2})?)/i);
  if (before) return make(before[1], before[2]);
  const after = text.match(/([\d,]+(?:\.\d{1,2})?)\s?(inr|aed|usd)\b/i);
  return after ? make(after[2], after[1]) : null;
}

function parseLooseDate(text: string): string | undefined {
  // "9 Nov 2026", "Nov 9, 2026", "2027-09-28"
  let m = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})/);
  if (m && monthIndex(m[2]) >= 0) return `${m[3]}-${String(monthIndex(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = text.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && monthIndex(m[1]) >= 0) return `${m[3]}-${String(monthIndex(m[1]) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return undefined;
}

function addCycle(date: string, cycle: 'monthly' | 'yearly'): string {
  const [y, m, d] = date.split('-').map(Number);
  const out = new Date(Date.UTC(y, m - 1 + (cycle === 'yearly' ? 12 : 1), d));
  return out.toISOString().slice(0, 10);
}

/** Turns a receipt, renewal or cancellation mail into a subscription proposal. */
export function parseSubscription(mail: RawMail): Partial<Subscription> | null {
  const body = mail.body ?? mail.snippet;
  const text = `${mail.subject}\n${body}`;
  const from = parseFrom(mail.from).email;
  const date = localDate(mail.date);

  // Google Play: "Claude Pro Subscription (Claude by Anthropic) ₹1,999.00/month"
  const play = body.match(/^\s*(.+?)\s+(₹|\$|AED\s?|USD\s?|INR\s?)([\d,]+(?:\.\d+)?)\/(month|year|week)/im);
  if (from.includes('googleplay') && play) {
    const cur = CUR[play[2].trim().toLowerCase()] ?? 'INR';
    const cycle = play[4] === 'year' ? 'yearly' : 'monthly';
    const name = play[1].replace(/\s*\([^)]*\bby\b[^)]*\)/gi, '').replace(/\s+/g, ' ').trim();
    const vendor = body.match(/from\s+(.+?)\s+on Google Play/i)?.[1] ?? 'Google Play';
    const trialEnd = body.match(/trial will end on ([^.]+)\./i)?.[1];
    return {
      name,
      vendor: vendor.replace(/,? (PBC|LLC|Limited|Corporation|Inc\.?)$/i, ''),
      amount: Number(play[3].replace(/,/g, '')),
      currency: cur,
      cycle,
      status: trialEnd ? 'trial' : 'active',
      lastCharged: trialEnd ? undefined : date,
      nextRenewal: trialEnd ? parseLooseDate(trialEnd) : addCycle(date, cycle),
      paymentMethod: body.match(/Payment method:\s*\n?\s*([^\n]+)/i)?.[1]?.trim(),
      source: 'email',
      emailId: mail.id,
    };
  }

  // "Your ChatGPT subscription from OpenAI ... will be cancelled on 9 Nov 2026"
  const cancel = text.match(/your (.+?) subscription(?: from (.+?))?(?: on Google Play)? will be cancel+ed on ([^.\n]+)/i);
  if (cancel) {
    return {
      name: cancel[1].trim(),
      vendor: (cancel[2] ?? cancel[1]).replace(/,? (OpCo|PBC|LLC|Limited|Inc\.?)(,? LLC)?$/i, '').trim(),
      status: 'cancelling',
      endsOn: parseLooseDate(cancel[3]),
      source: 'email',
      emailId: mail.id,
    };
  }

  // Chaos-style: "stop it from renewing on 2027-09-28"
  const stop = text.match(/stop it from renewing on ([\d-]+)/i);
  if (stop) {
    return {
      name: vendorName(mail),
      vendor: vendorName(mail),
      status: 'cancelling',
      endsOn: parseLooseDate(stop[1]),
      source: 'email',
      emailId: mail.id,
    };
  }

  // Stripe / Link / generic receipts and invoices
  if (/receipt|invoice|renew|subscription|charged/i.test(mail.subject)) {
    const amt = money(text.match(/(?:total|amount paid|account balance|amount)[^\n\d₹$]*([^\n]+)/i)?.[1] ?? text);
    if (!amt) return null;
    const vendor = mail.subject.match(/receipt from (.+?)(?:\s*#|$)/i)?.[1] ?? text.match(/your (.+?) receipt/i)?.[1] ?? vendorName(mail);
    const yearly = /annual|yearly|\/year|per year/i.test(text);
    return {
      name: vendor,
      vendor,
      amount: amt.amount,
      currency: amt.currency,
      cycle: yearly ? 'yearly' : 'monthly',
      status: 'active',
      lastCharged: date,
      nextRenewal: addCycle(date, yearly ? 'yearly' : 'monthly'),
      source: 'email',
      emailId: mail.id,
    };
  }
  return null;
}

function vendorName(mail: RawMail): string {
  const { name, email } = parseFrom(mail.from);
  const domain = email.split('@')[1] ?? '';
  const base = domain.split('.').slice(-2, -1)[0] ?? name;
  return /no-?reply|notifications?/i.test(name) || !name ? base.charAt(0).toUpperCase() + base.slice(1) : name;
}

/** Minimal iCalendar reader for Outlook / Teams invites attached to mails. */
export function parseIcs(ics: string): { title: string; start: string; end?: string; joinUrl?: string; organizer?: string } | null {
  const unfolded = ics.replace(/\r?\n[ \t]/g, '');
  const get = (key: string) => unfolded.match(new RegExp(`^${key}(?:;[^:\\n]*)?:(.*)$`, 'mi'))?.[1]?.trim();
  const start = get('DTSTART');
  if (!start) return null;
  const desc = (get('DESCRIPTION') ?? '').replace(/\\n/g, '\n').replace(/\\,/g, ',');
  return {
    title: (get('SUMMARY') ?? 'Meeting').replace(/\\,/g, ','),
    start: icsDate(start, unfolded.match(/^DTSTART;TZID=([^:]+):/mi)?.[1]),
    end: get('DTEND') ? icsDate(get('DTEND')!, unfolded.match(/^DTEND;TZID=([^:]+):/mi)?.[1]) : undefined,
    joinUrl: findJoinUrl(`${desc}\n${get('LOCATION') ?? ''}\n${get('X-MICROSOFT-SKYPETEAMSMEETINGURL') ?? ''}`),
    organizer: get('ORGANIZER')?.replace(/^mailto:/i, ''),
  };
}

const TZ_OFFSETS: Record<string, string> = {
  'india standard time': '+05:30',
  'asia/kolkata': '+05:30',
  'asia/calcutta': '+05:30',
  'arabian standard time': '+04:00',
  'asia/dubai': '+04:00',
  utc: 'Z',
};

function icsDate(v: string, tz?: string): string {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return v;
  if (!m[4]) return `${m[1]}-${m[2]}-${m[3]}`;
  const off = m[7] ? 'Z' : TZ_OFFSETS[(tz ?? '').toLowerCase()] ?? '';
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${off}`;
}

export function findJoinUrl(text: string): string | undefined {
  return (
    text.match(/https:\/\/teams\.microsoft\.com\/(?:l\/meetup-join|meet)\/[^\s"<>)\]]+/i)?.[0] ??
    text.match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/i)?.[0] ??
    text.match(/https:\/\/[\w.]*zoom\.us\/j\/[^\s"<>)]+/i)?.[0]
  );
}

/** Google invite subjects carry the time: "Invitation: Kickoff @ Tue Sep 1, 2026 7:30pm - 8:30pm (GMT+4) (me@x)". */
export function meetingFromInviteSubject(mail: RawMail, company: EmailCompany): Meeting | null {
  const m = mail.subject.match(/(?:invitation(?: from an unknown sender)?):\s*(.+?)\s+@\s+\w{3}\s+(\w{3})\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2})(?::(\d{2}))?(am|pm)\s*-\s*(\d{1,2})(?::(\d{2}))?(am|pm)\s*\(GMT([+-]\d{1,2})(?::?(\d{2}))?\)/i);
  if (!m) return null;
  const mon = monthIndex(m[2]);
  if (mon < 0) return null;
  const off = `${m[11].startsWith('-') ? '-' : '+'}${m[11].replace(/[+-]/, '').padStart(2, '0')}:${m[12] ?? '00'}`;
  const at = (h: string, min: string | undefined, ap: string) => {
    let hh = Number(h) % 12;
    if (ap.toLowerCase() === 'pm') hh += 12;
    return `${m[4]}-${String(mon + 1).padStart(2, '0')}-${m[3].padStart(2, '0')}T${String(hh).padStart(2, '0')}:${min ?? '00'}:00${off}`;
  };
  return {
    id: `mail-${mail.id}`,
    company,
    title: m[1].trim(),
    start: new Date(at(m[5], m[6], m[7])).toISOString(),
    end: new Date(at(m[8], m[9], m[10])).toISOString(),
    joinUrl: findJoinUrl(mail.body ?? mail.snippet),
    link: gmailUrl(mail.id),
    organizer: parseFrom(mail.from).email,
    source: 'email',
  };
}
