// Software vendors: where each keeps its plans page, which mails it sends, and how to read plans out of both.
import type { Currency, FoundPlan, SoftwareAccount, Subscription, VendorId } from './types';
import { parseFrom, type RawMail } from './mail';
import { localDate } from './money';

export interface Vendor {
  id: VendorId;
  name: string;
  /** Account page that lists plans with their renewal dates. */
  plansUrl: string;
  /** Domains the vendor's site and sign-in pages live on. */
  domains: string[];
  /** Pages that mean "not signed in yet". */
  signIn: RegExp;
  /** Mail domains for orders, invoices and renewal notices. */
  senders: string[];
  /** Product names as the vendor writes them, longest first when matching. */
  products: string[];
  /** A few well-known products, to say what the vendor is. */
  examples: string;
}

export const VENDORS: Vendor[] = [
  {
    id: 'autodesk',
    name: 'Autodesk',
    examples: 'Maya, 3ds Max, AutoCAD, Fusion',
    plansUrl: 'https://manage.autodesk.com/billing/subscriptions-contracts',
    domains: ['autodesk.com'],
    signIn: /accounts\.autodesk\.com|signin\.autodesk\.com|manage\.autodesk\.com\/login/i,
    senders: ['autodesk.com'],
    products: [
      'Media & Entertainment Collection',
      'Architecture, Engineering & Construction Collection',
      'AEC Collection',
      'Product Design & Manufacturing Collection',
      'Maya Creative',
      'Maya Indie',
      'Maya LT',
      'Maya',
      '3ds Max Indie',
      '3ds Max',
      'Mudbox',
      'MotionBuilder',
      'Arnold',
      'AutoCAD LT',
      'AutoCAD',
      'Revit',
      'Fusion 360',
      'Fusion',
      'Inventor',
      'Flow Production Tracking',
      'ShotGrid',
    ],
  },
  {
    id: 'adobe',
    name: 'Adobe',
    examples: 'Creative Cloud, Substance 3D, Photoshop',
    plansUrl: 'https://account.adobe.com/plans',
    domains: ['adobe.com'],
    signIn: /auth\.services\.adobe\.com|adobelogin\.com|adobeid/i,
    senders: ['adobe.com'],
    products: [
      'Creative Cloud All Apps',
      'Creative Cloud Pro',
      'Creative Cloud Standard',
      'Creative Cloud Photography',
      'Photography plan',
      'Substance 3D Collection',
      'Substance 3D Texturing',
      'Substance 3D Painter',
      'Substance 3D Designer',
      'Substance 3D Sampler',
      'Substance 3D Stager',
      'Photoshop',
      'Illustrator',
      'InDesign',
      'Premiere Pro',
      'After Effects',
      'Lightroom',
      'Acrobat Pro',
      'Acrobat Standard',
      'Adobe Express',
      'Adobe Firefly',
      'Firefly',
      'Adobe Stock',
    ],
  },
  {
    id: 'chaos',
    name: 'Chaos',
    examples: 'V-Ray, Corona, Enscape, Vantage',
    plansUrl: 'https://my.chaos.com/',
    domains: ['chaos.com', 'chaosgroup.com'],
    signIn: /login\.chaos\.com|auth\.chaos\.com|chaos\.com\/(login|sign-?in)/i,
    senders: ['chaos.com', 'chaosgroup.com'],
    products: [
      'V-Ray Premium',
      'V-Ray Enterprise',
      'V-Ray Solo',
      'V-Ray Education',
      'Corona Premium',
      'Corona Solo',
      'Chaos Premium',
      'Chaos Solo',
      'Chaos Corona',
      'Chaos Vantage',
      'Chaos Cosmos',
      'Chaos Cloud',
      'Chaos Phoenix',
      'Chaos Player',
      'Chaos Scans',
      'Enscape',
      'Phoenix',
      'Vantage',
      'V-Ray',
      'Corona',
    ],
  },
];

export const vendorById = (id?: VendorId): Vendor | undefined => VENDORS.find(v => v.id === id);

/** The registrable part of a host: "manage.autodesk.com" → "autodesk.com". */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().split('.').slice(-2).join('.');
  } catch {
    return '';
  }
}

/** Domains an account's window may show and its mails come from: the preset's, or the plans page's own site. */
export function accountDomains(a: Pick<SoftwareAccount, 'vendor' | 'plansUrl'>): string[] {
  const v = vendorById(a.vendor);
  return [...new Set([...(v?.domains ?? []), ...(v?.senders ?? []), siteOf(a.plansUrl)].filter(Boolean))];
}

const onDomain = (host: string, domains: string[]) => domains.some(d => host === d || host.endsWith(`.${d}`));

/** True for a page that asks to sign in rather than showing the account. */
export function looksSignedOut(vendor: VendorId, url: string, text: string, hasPassword: boolean): boolean {
  const v = vendorById(vendor);
  if (v?.signIn.test(url)) return true;
  if (hasPassword) return true;
  return text.length < 1500 && /\b(sign|log) ?in\b/i.test(text) && !/\b(sign|log) ?out\b/i.test(text);
}

/* ---------- small readers ---------- */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthOf = (w: string) => MONTHS.indexOf(w.slice(0, 3).toLowerCase());
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : undefined;
};

/**
 * The first date in a piece of text: "2027-09-28", "September 28, 2027", "28 Sep 2027", "28-Sep-2027" or numeric
 * "09/28/2027". Numeric dates read month first unless that can't be (vendor account pages are mostly US-formatted).
 */
export function readDate(text: string, order: 'mdy' | 'dmy' = 'mdy'): string | undefined {
  const found: { at: number; date?: string }[] = [];
  for (const m of text.matchAll(/(\d{4})-(\d{1,2})-(\d{1,2})/g)) found.push({ at: m.index, date: iso(+m[1], +m[2] - 1, +m[3]) });
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/g))
    if (monthOf(m[1]) >= 0) found.push({ at: m.index, date: iso(+m[3], monthOf(m[1]), +m[2]) });
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?[\s-]+,?\s*(\d{4})/g))
    if (monthOf(m[2]) >= 0) found.push({ at: m.index, date: iso(+m[3], monthOf(m[2]), +m[1]) });
  for (const m of text.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g)) {
    const [a, b] = [+m[1], +m[2]];
    const dmy = a > 12 || (order === 'dmy' && b <= 12);
    found.push({ at: m.index, date: dmy ? iso(+m[3], b - 1, a) : iso(+m[3], a - 1, b) });
  }
  return found.filter(f => f.date).sort((x, y) => x.at - y.at)[0]?.date;
}

const SYMBOLS: [RegExp, Currency][] = [
  [/₹|^rs\.?$|^inr$/i, 'INR'],
  [/^aed$|د\.إ/i, 'AED'],
  [/\$|^usd$/i, 'USD'],
];

/** The first price in a piece of text with a currency the app keeps (₹, US$, AED). Other currencies are left to Rohit. */
export function readMoney(text: string): { amount: number; currency: Currency } | undefined {
  const num = '(\\d[\\d,]*(?:\\.\\d{1,2})?)';
  const before = text.match(new RegExp(`(₹|us\\$|\\$|د\\.إ|\\b(?:rs\\.?|inr|aed|usd))\\s?${num}`, 'i'));
  const behind = text.match(new RegExp(`${num}\\s?(inr|aed|usd)\\b`, 'i'));
  const hit = before && (!behind || before.index! <= behind.index!) ? { sym: before[1], n: before[2] } : behind ? { sym: behind[2], n: behind[1] } : null;
  if (!hit) return undefined;
  const currency = SYMBOLS.find(([re]) => re.test(hit.sym))?.[1];
  const amount = Number(hit.n.replace(/,/g, ''));
  return currency && Number.isFinite(amount) && amount > 0 ? { amount, currency } : undefined;
}

export function readCycle(text: string): Subscription['cycle'] | undefined {
  if (/\b(3|three)[- ]year|\b36 months/i.test(text)) return undefined;
  if (/\b(annual(ly)?|yearly|per year|a year|\/\s?(yr|year)\b|1[- ]year|12 months|billed every year)/i.test(text)) return 'yearly';
  if (/\b(monthly|per month|a month|\/\s?(mo|month)\b|1[- ]month|billed every month)/i.test(text)) return 'monthly';
  return undefined;
}

export function readLicence(text: string): Subscription['licence'] | undefined {
  if (/\b(education(al)?|student|educator)\b/i.test(text)) return 'education';
  if (/\bperpetual\b/i.test(text)) return 'perpetual';
  if (/\btrial\b/i.test(text)) return 'trial';
  if (/\bfree (plan|licen[cs]e|version)\b|\bstarter \(free\)/i.test(text)) return 'free';
  return undefined;
}

const OFF = /auto-?renew(?:al)?\s*(?:is\s*|:\s*)?(?:off|turned off|disabled)|(?:will not|won't|does not|doesn't) (?:auto-?)?renew|non-?renewing|cancel+ed|cancel+ation (?:requested|scheduled)/i;
const ENDED = /\b(expired|has ended|ended on|inactive|terminated|suspended)\b/i;

/** Text right after a label ("Renews on", "Expires", …) up to the next label, so dates aren't taken from a neighbour. */
function after(text: string, label: RegExp): string | undefined {
  const m = text.match(label);
  return m ? text.slice(m.index! + m[0].length, m.index! + m[0].length + 48) : undefined;
}
const RENEWS = /\b(?:auto-?renews?(?: on)?|renews?(?: on)?|renewal(?: date)?|next (?:billing|payment|charge|bill)(?: date)?|billing date|billed on)\s*:?\s*/i;
const ENDS = /\b(?:expires?(?: on)?|expir(?:y|ation)(?: date)?|ends?(?: on)?|end date|valid (?:until|through|thru)|access (?:until|ends)|active until|term end)\s*:?\s*/i;

/* ---------- plans pages ---------- */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function productPattern(products: string[]): RegExp | null {
  if (!products.length) return null;
  const alts = [...products].sort((a, b) => b.length - a.length).map(p => escape(p).replace(/\s+/g, '\\s+'));
  return new RegExp(`(?<![\\w-])(${alts.join('|')})(?![\\w-])`, 'i');
}

/** Fields of one plan from the lines that follow its name. */
function planFrom(product: string, heading: string, block: string, order: 'mdy' | 'dmy'): FoundPlan {
  const cut = (s?: string) => (s ? readDate(s.split(/\b(?:renews?|renewal|expires?|expiration|ends?|valid|next billing)\b/i)[0] || s, order) : undefined);
  const renewsAt = cut(after(block, RENEWS));
  const endsAt = cut(after(block, ENDS));
  const off = OFF.test(block);
  const ended = ENDED.test(block) && !renewsAt;
  const trial = /\b(free )?trial\b/i.test(block);
  const status: FoundPlan['status'] = ended ? 'cancelled' : off ? 'cancelling' : trial ? 'trial' : 'active';
  const rest = heading
    .replace(new RegExp(escape(product).replace(/\s+/g, '\\s+'), 'i'), '')
    .replace(/^[\s\-–—·:|,()]+|[\s\-–—·:|,()]+$/g, '')
    .trim();
  const planWords = block.match(/\b(Indie|Creative|Solo|Premium|Enterprise|Education(?:al)?|Student|Teams?|Individual|Business|Named|Single[- ]user|Multi[- ]user|Standard|Pro)\b(?:\s+(?:plan|licen[cs]e|user))?/i)?.[0];
  const seats = block.match(/\b(\d{1,3})\s*(?:seats?|users?|licen[cs]es?)\b/i)?.[1] ?? block.match(/\b(?:seats?|quantity|qty)\s*:?\s*(\d{1,3})\b/i)?.[1];
  const price = readMoney(block);
  const plan: FoundPlan = {
    product,
    plan: rest && rest.length <= 40 && !/\d{4}/.test(rest) ? rest : planWords,
    amount: price?.amount,
    currency: price?.currency,
    cycle: readCycle(block),
    status,
    licence: readLicence(`${heading}\n${block}`),
    raw: block.trim().slice(0, 600),
  };
  // A plan that won't renew has an end date, not a renewal date.
  if (status === 'active' || status === 'trial') plan.renews = renewsAt ?? endsAt;
  else plan.ends = endsAt ?? renewsAt;
  if (seats && +seats > 1) plan.plan = [plan.plan, `${seats} seats`].filter(Boolean).join(' · ');
  return plan;
}

/**
 * Plans read from the text of a vendor's account page. Each plan starts at a short line naming a known product and
 * takes the lines below it (up to the next product) for its price, cycle, dates and status.
 */
export function parsePlansText(vendor: VendorId, text: string, extraProducts: string[] = []): FoundPlan[] {
  const v = vendorById(vendor);
  const re = productPattern([...(v?.products ?? []), ...extraProducts]);
  const lines = text
    .split(/\r?\n+/)
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const starts: { i: number; product: string }[] = [];
  lines.forEach((l, i) => {
    if (l.length > 90) return;
    const m = re ? l.match(re) : null;
    if (m) {
      const canon = (v?.products ?? extraProducts).find(p => p.toLowerCase().replace(/\s+/g, ' ') === m[1].toLowerCase().replace(/\s+/g, ' ')) ?? m[1];
      starts.push({ i, product: canon });
      return;
    }
    // Unknown vendors: a short line right above a renewal or expiry line is taken as the product's name.
    if (!re && i + 1 < lines.length && (RENEWS.test(lines[i + 1]) || ENDS.test(lines[i + 1])) && l.length <= 60 && !RENEWS.test(l) && !ENDS.test(l))
      starts.push({ i, product: l });
  });
  const plans: FoundPlan[] = [];
  starts.forEach((s, k) => {
    const end = Math.min(starts[k + 1]?.i ?? lines.length, s.i + 14);
    const block = lines.slice(s.i + 1, end).join('\n');
    // A menu entry or heading has none of a plan's facts.
    if (!readDate(block) && !readMoney(block) && !readCycle(block) && !/\b(trial|expired|cancel+ed|auto-?renew)/i.test(block)) return;
    plans.push(planFrom(s.product, lines[s.i], block, v ? 'mdy' : 'dmy'));
  });
  // The same plan listed twice (summary card and details): keep the fuller one.
  const score = (p: FoundPlan) => [p.amount, p.cycle, p.renews ?? p.ends, p.plan].filter(x => x != null).length;
  const out = new Map<string, FoundPlan>();
  for (const p of plans) {
    const key = `${p.product}|${p.plan ?? ''}`.toLowerCase();
    const had = out.get(key);
    if (!had || score(p) > score(had)) out.set(key, p);
  }
  return [...out.values()];
}

/* ---------- vendor mails ---------- */

/** The vendor a mail came from, by sender domain. */
export function vendorOfMail(mail: Pick<RawMail, 'from'>, accounts: SoftwareAccount[] = []): { vendor: Vendor | undefined; account?: SoftwareAccount; name: string } | null {
  const host = parseFrom(mail.from).email.split('@')[1] ?? '';
  const preset = VENDORS.find(v => onDomain(host, v.senders));
  const account = accounts.find(a => (preset ? a.vendor === preset.id : onDomain(host, accountDomains(a))));
  if (!preset && !account) return null;
  return { vendor: preset, account, name: preset?.name ?? account!.label };
}

const MARKETING = /finish (purchasing|your purchase)|complete your (purchase|order)|\d+ ?% off|save (up to|\d)|special offer|limited[- ]time|black friday|cyber monday|webinar|newsletter|what'?s new|tips (and|&) tricks|inspiration|tutorial|we miss you|come back|discover|event invitation/i;
const TRANSACTIONAL =
  /order\s*(#|number|no\.?)|your order|invoice|receipt|payment (received|confirmation|successful)|subscription .{0,30}(cancel+ed|renewed|expir|will renew)|auto-?renew|renewal (notice|reminder|confirmation)|has been renewed|will (auto-?)?renew|expires? on|expiration|trial (ends|will end|has ended|expires)|your (free )?trial|licen[cs]e (key|activated)/i;

/**
 * A subscription proposal from a vendor's order, invoice, renewal, cancellation or trial mail. Marketing mail ("finish
 * purchasing", offers) is ignored even when it names a product.
 */
export function parseVendorMail(mail: RawMail, accounts: SoftwareAccount[] = []): Partial<Subscription> | null {
  const who = vendorOfMail(mail, accounts);
  if (!who) return null;
  const body = mail.body ?? mail.snippet ?? '';
  const text = `${mail.subject}\n${body}`;
  if (MARKETING.test(mail.subject) || !TRANSACTIONAL.test(text)) return null;
  const re = productPattern(who.vendor?.products ?? []);
  const hit = re ? text.match(re)?.[1] : undefined;
  const product = hit ? ((who.vendor?.products ?? []).find(p => p.toLowerCase() === hit.toLowerCase().replace(/\s+/g, ' ')) ?? hit) : undefined;
  const date = localDate(mail.date);
  const base: Partial<Subscription> = {
    name: product ?? who.name,
    vendor: who.name,
    source: 'email',
    emailId: mail.id,
    category: 'work',
    ...(who.account ? { accountId: who.account.id } : {}),
  };
  const addDays = (n: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
  const licence = readLicence(product ? (text.match(new RegExp(`${escape(product)}[^\\n]{0,60}`, 'i'))?.[0] ?? '') : '');

  // Auto-renew turned off / cancelled: access runs to the date it would have renewed.
  if (OFF.test(text) && !/reactivated|turned (back )?on/i.test(mail.subject)) {
    const ends = readDate(after(text, /(?:renewing on|renew on|until|expires? on|expiration date|access ends(?: on)?)\s*:?\s*/i) ?? '') ?? readDate(body);
    return { ...base, status: 'cancelling', endsOn: ends };
  }
  // Trial started or ending.
  const trialEnd = text.match(/trial (?:ends|will end|expires)\s+(tomorrow|today|on\s+[^\n.]+|in (\d+) days)/i);
  if (trialEnd) {
    const when = trialEnd[1].toLowerCase();
    const ends = when === 'tomorrow' ? addDays(1) : when === 'today' ? date : trialEnd[2] ? addDays(+trialEnd[2]) : readDate(when);
    return { ...base, status: 'trial', nextRenewal: ends, licence: 'trial' };
  }
  const trialStart = text.match(/trial\s*[-–—:]?\s*(\d{1,3})[- ]days?/i) ?? text.match(/(\d{1,3})[- ]day (?:free )?trial/i);
  if (trialStart && /(started|start|get started|welcome|let'?s get you started|activated)/i.test(text)) {
    return { ...base, status: 'trial', nextRenewal: addDays(+trialStart[1]), licence: 'trial' };
  }
  // Orders and renewals: product, term and the date the term ends or renews.
  const price = readMoney(after(text, /(?:total|amount (?:paid|due|charged)|account balance|grand total|order total|price)\s*:?\s*/i) ?? '') ?? readMoney(text);
  const term = readDate(after(text, RENEWS) ?? '') ?? readDate(after(text, ENDS) ?? '');
  const isInvoice = /invoice|receipt/i.test(mail.subject);
  const cycle = readCycle(product ? (text.match(new RegExp(`${escape(product)}[^\\n]{0,60}`, 'i'))?.[0] ?? text) : text);
  if (!product && !price) return null;
  return {
    ...base,
    status: 'active',
    amount: price?.amount ?? null,
    currency: price?.currency,
    cycle,
    lastCharged: date,
    // An invoice's own dates are due dates, not renewals.
    nextRenewal: isInvoice ? undefined : term,
    licence: licence && licence !== 'trial' ? licence : undefined,
  };
}

/** Gmail query for the vendors' order and renewal mail (promotions excluded), or null when there's nothing to watch. */
export function vendorMailQuery(accounts: SoftwareAccount[]): string | null {
  const domains = [...new Set([...VENDORS.flatMap(v => v.senders), ...accounts.flatMap(accountDomains)])];
  if (!domains.length) return null;
  return `newer_than:400d -category:promotions {${domains.map(d => `from:${d}`).join(' ')}}`;
}

/* ---------- matching plans to subscriptions ---------- */

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length > 1 && !['plan', 'subscription', 'annual', 'monthly', 'the', 'adobe', 'autodesk', 'chaos'].includes(w)),
  );

/**
 * The subscription a found plan or vendor mail belongs to: same vendor (or account) and the most product words in
 * common. A mail that names no product matches only when the vendor has exactly one live subscription.
 */
export function matchVendorSub(subs: Subscription[], found: { name?: string; vendor?: string; accountId?: string; product?: string }): Subscription | undefined {
  const vendor = (found.vendor ?? '').toLowerCase();
  const mine = subs.filter(s => (found.accountId && s.accountId === found.accountId) || (vendor && s.vendor.toLowerCase().includes(vendor)));
  const want = words(found.product ?? found.name ?? '');
  if (!want.size) {
    const live = mine.filter(s => s.status !== 'cancelled');
    return live.length === 1 ? live[0] : undefined;
  }
  let best: Subscription | undefined;
  let score = 0;
  for (const s of mine) {
    const have = words(s.name);
    const n = [...want].filter(w => have.has(w)).length;
    if (n > score) [best, score] = [s, n];
  }
  return best;
}

/** A found plan as a subscription, keeping what Rohit already entered for it. */
export function planToSubscription(p: FoundPlan, account: SoftwareAccount, existing?: Subscription): Partial<Subscription> {
  return {
    ...existing,
    name: existing?.name ?? p.product,
    notes: existing?.notes ?? (p.plan ? `${p.plan} (read from the ${account.label} account page)` : undefined),
    vendor: existing?.vendor ?? vendorById(account.vendor)?.name ?? account.label,
    amount: p.amount ?? existing?.amount ?? null,
    currency: p.currency ?? existing?.currency ?? 'INR',
    cycle: p.cycle ?? existing?.cycle ?? 'yearly',
    status: p.status ?? existing?.status ?? 'active',
    nextRenewal: p.renews ?? existing?.nextRenewal,
    endsOn: p.ends ?? existing?.endsOn,
    licence: p.licence ?? existing?.licence,
    seats: Number(p.plan?.match(/(\d+) seats/)?.[1]) || existing?.seats,
    category: existing?.category ?? 'work',
    source: existing?.source ?? 'account',
    accountId: account.id,
  };
}

/**
 * One vendor mail folded into what earlier mails said (fold oldest first): an order names the product and term, an
 * invoice adds the price, a cancellation turns auto-renew off, a trial only counts until something is paid.
 */
export function foldVendorMail(cur: Partial<Subscription>, found: Partial<Subscription>): Partial<Subscription> {
  const next: Partial<Subscription> = { ...cur };
  if (found.name && found.name !== found.vendor && (!cur.name || cur.name === cur.vendor)) next.name = found.name;
  next.vendor ??= found.vendor;
  if (found.accountId) next.accountId ??= found.accountId;
  if (found.amount != null) {
    next.amount = found.amount;
    next.currency = found.currency ?? next.currency;
  }
  if (found.cycle) next.cycle = found.cycle;
  if (found.licence && found.licence !== 'trial') next.licence = found.licence;
  if (found.lastCharged && (!next.lastCharged || found.lastCharged >= next.lastCharged)) next.lastCharged = found.lastCharged;
  if (found.status === 'cancelling') {
    next.status = 'cancelling';
    next.endsOn = found.endsOn ?? next.endsOn ?? next.nextRenewal;
  } else if (found.status === 'trial') {
    if (!next.status || next.status === 'trial') {
      next.status = 'trial';
      next.licence = 'trial';
      next.nextRenewal = found.nextRenewal ?? next.nextRenewal;
    }
  } else if (found.status === 'active') {
    if (found.nextRenewal) next.nextRenewal = found.nextRenewal;
    if (!next.status || next.status === 'trial') next.status = 'active';
    if (next.licence === 'trial') delete next.licence;
  }
  next.emailId = found.emailId ?? next.emailId;
  next.category ??= 'work';
  next.source ??= 'email';
  return next;
}
