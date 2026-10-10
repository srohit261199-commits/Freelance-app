import type { AppState, CompanyConfig, CompanyId, Complexity, Currency, Model, Payment, SkeidarJob, Subscription } from './types';
import { isComplete } from './status';

/** Rates are stored as the INR value of one unit; INR is always 1. */
export function convert(amount: number, from: Currency, to: Currency, rates: Record<Currency, number>): number {
  if (from === to) return amount;
  return (amount * (rates[from] || 1)) / (rates[to] || 1);
}

const SYMBOL: Record<Currency, string> = { INR: '₹', AED: 'AED ', USD: '$' };

export function formatMoney(amount: number, currency: Currency, digits = 0): string {
  const n = amount.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${SYMBOL[currency]}${n}`;
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 240; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function tierFee(cfg: CompanyConfig, complexity: Complexity | undefined): number {
  if (cfg.pay.kind !== 'tiered') return 0;
  return cfg.pay.tiers[complexity ?? 'simple'] ?? 0;
}

export function jobOutputs(job: SkeidarJob): { total: number; done: number } {
  const total = job.fabrics.length * job.images.length;
  let done = 0;
  for (let f = 0; f < job.fabrics.length; f++) for (let i = 0; i < job.images.length; i++) if (job.done[`${f}:${i}`]) done++;
  return { total, done };
}

export interface MonthLine {
  month: string;
  /** What the work done (or retainer accrued) in this month is worth, before tax. */
  gross: number;
  /** After TDS. Equal to gross where no tax is withheld. */
  net: number;
  units: number;
  /** When this month's money should arrive; empty when the client has no fixed pay day. */
  due: string;
}

export interface CompanyEarnings {
  company: CompanyId;
  currency: Currency;
  /** Net value of finished months and finished work. */
  earned: number;
  received: number;
  outstanding: number;
  /** Value still accruing this month (retainer) or done this month (per piece); paid next month. */
  thisMonth: number;
  /** Value of open work not yet finished. */
  pipeline: number;
  months: MonthLine[];
  /** How much of each month (by month key) the recorded payments cover. */
  paidByMonth: Record<string, number>;
  /** Finished MetaZtech models with no complexity set, priced at the lowest tier. */
  unpriced: number;
  /** Models imported already approved without an approval date, counted in the month they were imported. */
  approxMonth: number;
  /** Earliest month past its due date (plus 3 days' grace) that the recorded payments don't fully cover. */
  overdue?: { month: string; due: string; paid: number; net: number };
}

/** The calendar date on this computer, not in UTC (India and the UAE are hours ahead of UTC). */
export function localDate(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d.length === 10 ? d + 'T00:00:00' : d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function localMonth(d: string): string {
  return d.length === 10 ? d.slice(0, 7) : localDate(d).slice(0, 7);
}

function dueOn(month: string, day: number): string {
  const next = addMonths(month, 1);
  return `${next}-${String(day).padStart(2, '0')}`;
}

function plusDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}

/** A payment's value in the company's currency: fixed when recorded, so later rate changes don't rewrite history. */
export function paymentValue(p: Payment, currency: Currency, rates: Record<Currency, number>): number {
  if (p.currency === currency) return p.amount;
  return p.settledAmount ?? convert(p.amount, p.currency, currency, rates);
}

/**
 * Splits received money across months: payments marked for a month go there first,
 * anything left over (and unmarked payments) pays the oldest months first.
 */
export function allocate(lines: MonthLine[], payments: { period?: string; value: number }[]): Record<string, number> {
  const paid: Record<string, number> = Object.fromEntries(lines.map(l => [l.month, 0]));
  const net: Record<string, number> = Object.fromEntries(lines.map(l => [l.month, l.net]));
  let pool = 0;
  for (const p of payments) {
    if (p.period && p.period in paid) paid[p.period] += p.value;
    else pool += p.value;
  }
  for (const l of lines) {
    if (paid[l.month] > net[l.month]) {
      pool += paid[l.month] - net[l.month];
      paid[l.month] = net[l.month];
    }
  }
  for (const l of lines) {
    const take = Math.min(net[l.month] - paid[l.month], pool);
    if (take > 0) {
      paid[l.month] += take;
      pool -= take;
    }
  }
  return paid;
}

export function companyEarnings(state: AppState, company: CompanyId, now: Date): CompanyEarnings {
  const cfg = state.companies.find(c => c.id === company)!;
  const today = localDate(now);
  const thisMonth = today.slice(0, 7);
  const rates = state.settings.rates;
  const payments = state.payments.filter(p => p.company === company).map(p => ({ period: p.period, value: paymentValue(p, cfg.currency, rates) }));
  const received = payments.reduce((s, p) => s + p.value, 0);
  const months: MonthLine[] = [];
  let pipeline = 0;
  let unpriced = 0;
  let approxMonth = 0;

  if (cfg.pay.kind === 'retainer') {
    const pay = cfg.pay;
    const start = localMonth(pay.startDate);
    for (const m of monthsBetween(start, thisMonth)) {
      months.push({ month: m, gross: pay.amount, net: pay.amount, units: 1, due: dueOn(m, pay.payday) });
    }
  } else if (cfg.pay.kind === 'tiered') {
    const pay = cfg.pay;
    const byMonth = new Map<string, MonthLine>();
    for (const m of state.models) {
      if (m.company !== company) continue;
      const fee = tierFee(cfg, m.complexity);
      if (isComplete(m.status)) {
        if (!m.complexity) unpriced++;
        if (m.completedAtApprox) approxMonth++;
        const mk = localMonth(m.completedAt ?? m.updatedAt);
        const line = byMonth.get(mk) ?? { month: mk, gross: 0, net: 0, units: 0, due: dueOn(mk, pay.payoutTo) };
        line.gross += fee;
        line.net += fee * (1 - pay.tdsPercent / 100);
        line.units++;
        byMonth.set(mk, line);
      } else if (m.status !== 'on_hold' && m.status !== 'skipped') {
        pipeline += fee * (1 - pay.tdsPercent / 100);
      }
    }
    months.push(...[...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)));
  } else if (cfg.pay.kind === 'per-item' && (cfg.workflow ?? (company === 'skeidar' ? 'variations' : 'models')) === 'models') {
    // Per finished model, for clients added by hand that work like Waveink/MetaZtech.
    const pay = cfg.pay;
    const byMonth = new Map<string, MonthLine>();
    for (const m of state.models) {
      if (m.company !== company) continue;
      if (isComplete(m.status)) {
        const mk = localMonth(m.completedAt ?? m.updatedAt);
        const line = byMonth.get(mk) ?? { month: mk, gross: 0, net: 0, units: 0, due: '' };
        line.gross += pay.rate;
        line.net += pay.rate;
        line.units++;
        byMonth.set(mk, line);
      } else if (m.status !== 'on_hold' && m.status !== 'skipped') pipeline += pay.rate;
    }
    months.push(...[...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)));
  } else {
    const pay = cfg.pay;
    const byMonth = new Map<string, MonthLine>();
    for (const job of state.skeidarJobs) {
      if ((job.company ?? 'skeidar') !== company) continue;
      const { total, done } = jobOutputs(job);
      pipeline += (total - done) * pay.rate;
      if (!done) continue;
      const mk = localMonth(job.deliveredAt ?? job.receivedAt);
      const line = byMonth.get(mk) ?? { month: mk, gross: 0, net: 0, units: 0, due: '' };
      line.gross += done * pay.rate;
      line.net += done * pay.rate;
      line.units += done;
      byMonth.set(mk, line);
    }
    months.push(...[...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)));
  }

  const isRetainer = cfg.pay.kind === 'retainer';
  // A retainer month is only earned once it has ended; piece work is earned when finished.
  const earnedLines = isRetainer ? months.filter(l => l.month < thisMonth) : months;
  const earned = earnedLines.reduce((s, l) => s + l.net, 0);
  const current = months.find(l => l.month === thisMonth)?.net ?? 0;
  const paidByMonth = allocate(months, payments);

  let overdue: CompanyEarnings['overdue'];
  for (const l of earnedLines) {
    if (!l.due || paidByMonth[l.month] >= l.net - 0.5) continue;
    if (plusDays(l.due, 3) < today) overdue = { month: l.month, due: l.due, paid: paidByMonth[l.month], net: l.net };
    break;
  }

  return {
    company,
    currency: cfg.currency,
    earned,
    received,
    outstanding: Math.max(0, earned - received),
    thisMonth: current,
    pipeline,
    months,
    paidByMonth,
    unpriced,
    approxMonth,
    overdue,
  };
}

export function allEarnings(state: AppState, now: Date): CompanyEarnings[] {
  return state.companies.map(c => companyEarnings(state, c.id, now));
}

/** Monthly cost of a subscription in its own currency (yearly plans spread over 12 months). */
export function monthlyCost(sub: Subscription): number {
  if (sub.amount == null || sub.status === 'cancelled') return 0;
  if (sub.cycle === 'yearly') return sub.amount / 12;
  if (sub.cycle === 'one-off') return 0;
  return sub.amount;
}

export function daysUntil(date: string, now: Date): number {
  const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - a) / 86400000);
}

/** Moves a renewal date forward by whole cycles until it is today or later, keeping the original day of month. */
export function rollRenewal(sub: Subscription, now: Date): string | undefined {
  if (!sub.nextRenewal || sub.cycle === 'one-off') return sub.nextRenewal;
  if (daysUntil(sub.nextRenewal, now) >= 0) return sub.nextRenewal;
  const [y, m, d] = sub.nextRenewal.split('-').map(Number);
  const step = sub.cycle === 'yearly' ? 12 : 1;
  for (let k = 1; k < 600; k++) {
    const first = new Date(Date.UTC(y, m - 1 + k * step, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(d, last));
    const next = first.toISOString().slice(0, 10);
    if (daysUntil(next, now) >= 0) return next;
  }
  return sub.nextRenewal;
}

export function modelsFor(state: AppState, company: CompanyId): Model[] {
  return state.models.filter(m => m.company === company);
}
