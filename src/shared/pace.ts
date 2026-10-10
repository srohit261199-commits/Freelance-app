import type { AppState, CompanyConfig, CompanyId, Expectations, Meeting, StatusEvent } from './types';
import { jobOutputs, localDate } from './money';
import { isComplete, statusEvents } from './status';

export type Target = NonNullable<Expectations['target']>;
export type Deadline = NonNullable<Expectations['deadlines']>[number];

/** Monday to Friday, used when a client has no working days set. */
export const DEFAULT_WORKDAYS = [1, 2, 3, 4, 5];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface Pace {
  per: Target['per'];
  unit: string;
  counts: Target['counts'];
  /** First and last local date of the period (today, or Monday to Sunday). */
  from: string;
  to: string;
  /** Counted so far in the period. */
  done: number;
  /** Target for the period (a weekly target is scaled down in the week the job starts or ends). */
  target: number;
  /**
   * What should be done by now. Weekly: the target spread over the working days, counting only the days before today,
   * so today is still yours. Daily: the whole target on a working day, nothing on a day off.
   */
  expected: number;
  /** How many short of `expected`. */
  short: number;
  behind: boolean;
  /** Left to reach the target. */
  remaining: number;
  /** Today is a working day for this client (and inside its start and end dates). */
  workday: boolean;
  /**
   * Images carry no tick dates, so for an 'images' target the ticks on open jobs count as this period's work and a
   * delivered job counts in the period it was delivered. Other counts come from dated status changes.
   */
  approx: boolean;
}

export interface DeadlineHit {
  id: string;
  company: CompanyId;
  label: string;
  /** Local date of this occurrence. */
  date: string;
  time?: string;
  /** Local date and time (end of day when the deadline has no time). */
  at: Date;
  /** Calendar days from today: 0 = today. */
  days: number;
  /** It is today and the time has gone. */
  passed: boolean;
}

function parse(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date: string, n: number): string {
  const d = parse(date);
  return localDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

export function weekdayOf(date: string): number {
  return parse(date).getDay();
}

/** Monday of the week `now` is in (local). */
export function weekStart(now: Date): string {
  const today = localDate(now);
  return addDays(today, -((now.getDay() + 6) % 7));
}

export function workdaysOf(cfg?: Pick<CompanyConfig, 'expectations'>): number[] {
  const w = cfg?.expectations?.workdays;
  return w && w.length ? w : DEFAULT_WORKDAYS;
}

/** Whether the client is engaged on this date: on or after its start and on or before its end. */
export function activeOn(cfg: Pick<CompanyConfig, 'startDate' | 'endDate'>, date: string): boolean {
  return (!cfg.startDate || date >= cfg.startDate.slice(0, 10)) && (!cfg.endDate || date <= cfg.endDate.slice(0, 10));
}

/** Work counted toward a target between two local dates (inclusive). */
export function countWork(state: AppState, company: CompanyId, counts: Target['counts'], from: string, to: string): number {
  const inRange = (iso?: string) => !!iso && localDate(iso) >= from && localDate(iso) <= to;
  if (counts === 'images') {
    let n = 0;
    for (const j of state.skeidarJobs) {
      if ((j.company ?? 'skeidar') !== company) continue;
      if (j.status === 'open' || inRange(j.deliveredAt)) n += jobOutputs(j).done;
    }
    return n;
  }
  // Submitted: sent for review. Done: became done or live (live after done is the same piece of work).
  const hit = (h: StatusEvent) => (counts === 'submitted' ? h.to === 'review' : isComplete(h.to) && !(h.from && isComplete(h.from)));
  return state.models.filter(m => m.company === company && statusEvents(m).some(h => hit(h) && inRange(h.at))).length;
}

/** Progress against an explicit target (used for a fallback when the client has none). */
export function paceFor(state: AppState, cfg: CompanyConfig, target: Target, now: Date): Pace {
  const today = localDate(now);
  const wd = workdaysOf(cfg);
  const working = (d: string) => wd.includes(weekdayOf(d)) && activeOn(cfg, d);
  const base = { per: target.per, unit: target.unit, counts: target.counts, approx: target.counts === 'images', workday: working(today) };
  if (target.per === 'day') {
    const done = countWork(state, cfg.id, target.counts, today, today);
    const expected = base.workday ? target.count : 0;
    return { ...base, from: today, to: today, done, target: target.count, expected, short: Math.max(0, expected - done), behind: done < expected, remaining: Math.max(0, expected - done) };
  }
  const from = weekStart(now);
  const to = addDays(from, 6);
  const week = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const all = week.filter(d => wd.includes(weekdayOf(d))).length;
  const days = week.filter(working);
  const goal = !all || days.length === all ? target.count : Math.round((target.count * days.length) / all);
  const before = days.filter(d => d < today).length;
  const expected = days.length ? Math.floor((goal * before) / days.length) : 0;
  const done = countWork(state, cfg.id, target.counts, from, to);
  return { ...base, from, to, done, target: goal, expected, short: Math.max(0, expected - done), behind: done < expected, remaining: Math.max(0, goal - done) };
}

/** This period's progress against the client's output target, or null when it has none (or is archived). */
export function weekProgress(state: AppState, company: CompanyId, now: Date): Pace | null {
  const cfg = state.companies.find(c => c.id === company);
  const t = cfg?.expectations?.target;
  if (!cfg || cfg.archived || !t || !(t.count > 0)) return null;
  return paceFor(state, cfg, t, now);
}

/** "3 of 10 models this week · 2 behind", "1 of 2 files today", "Day off · 1 file today". */
export function paceText(p: Pace): string {
  const when = p.per === 'day' ? 'today' : 'this week';
  if (p.per === 'day' && !p.workday) return `Day off · ${p.done} ${p.unit} ${when}`;
  const head = `${p.done} of ${p.target} ${p.unit} ${when}`;
  if (p.behind && p.per === 'week') return `${head} · ${p.short} behind`;
  if (!p.remaining) return `${head} · target met`;
  return head;
}

function validTime(t?: string): string | undefined {
  const m = t?.match(/^(\d{1,2}):(\d{2})$/);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : undefined;
}

/** Every occurrence of the client's recurring deadlines between two local dates (inclusive), in date order. */
export function deadlineDates(cfg: CompanyConfig, from: string, to: string): { id: string; label: string; date: string; time?: string }[] {
  const list = cfg.archived ? [] : (cfg.expectations?.deadlines ?? []).filter(d => d.weekday >= 0 && d.weekday <= 6 && d.label.trim());
  const out: { id: string; label: string; date: string; time?: string }[] = [];
  if (!list.length) return out;
  for (let d = from, i = 0; d <= to && i < 400; d = addDays(d, 1), i++) {
    if (!activeOn(cfg, d)) continue;
    const wd = weekdayOf(d);
    for (const x of list) if (x.weekday === wd) out.push({ id: x.id, label: x.label.trim(), date: d, time: validTime(x.time) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '24').localeCompare(b.time ?? '24'));
}

/** Upcoming recurring deadlines from today through `days` days ahead. Today's stay listed after their time, marked passed. */
export function nextDeadlines(cfg: CompanyConfig, now: Date, days = 7): DeadlineHit[] {
  const today = localDate(now);
  return deadlineDates(cfg, today, addDays(today, days)).map(o => {
    const [h, m] = (o.time ?? '23:59').split(':').map(Number);
    const d = parse(o.date);
    const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
    const n = Math.round((parse(o.date).getTime() - parse(today).getTime()) / 86400000);
    return { ...o, company: cfg.id, at, days: n, passed: n === 0 && at.getTime() < now.getTime() };
  });
}

/** Upcoming deadlines for every client still on the books, soonest first. */
export function allDeadlines(state: AppState, now: Date, days = 7): DeadlineHit[] {
  return state.companies.flatMap(c => nextDeadlines(c, now, days)).sort((a, b) => a.at.getTime() - b.at.getTime());
}

const words = (t: string) => new Set(t.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4));

/** The calendar meeting that is this deadline (same client, within 45 minutes, a word in common), if one came in. */
export function meetingFor(meetings: Meeting[], d: DeadlineHit): Meeting | undefined {
  if (!d.time) return undefined;
  const label = words(d.label);
  return meetings.find(m => m.company === d.company && Math.abs(new Date(m.start).getTime() - d.at.getTime()) <= 45 * 60000 && [...words(m.title)].some(w => label.has(w)));
}

/** "Today 18:00", "Tomorrow", "Wed 14 Oct 19:30". */
export function deadlineWhen(d: Pick<DeadlineHit, 'days' | 'date' | 'time'>): string {
  const day = d.days === 0 ? 'Today' : d.days === 1 ? 'Tomorrow' : parse(d.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return d.time ? `${day} ${d.time}` : day;
}

/** Whole weeks since the start date, or null before it starts. */
export function weeksIn(cfg: Pick<CompanyConfig, 'startDate'>, now: Date): number | null {
  if (!cfg.startDate) return null;
  const days = Math.round((parse(localDate(now)).getTime() - parse(cfg.startDate.slice(0, 10)).getTime()) / 86400000);
  return days < 0 ? null : Math.floor(days / 7);
}
