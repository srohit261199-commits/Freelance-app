import type { AppState, CompanyId, Model, SkeidarJob } from '../shared/types';
import { isComplete } from '../shared/status';
import { jobOutputs, localDate } from '../shared/money';
import { waveinkQueue } from '../shared/planner';
import { nextDeadlines, weekProgress } from '../shared/pace';

export type Priority = 'urgent' | 'high' | 'normal' | 'low';
export const PRIORITY_ORDER: Priority[] = ['urgent', 'high', 'normal', 'low'];

const DAY = 86400000;
/** How many of the next to-do models count as "next in queue". */
const QUEUE = 3;

function daysTo(date: string | undefined, now: Date): number | undefined {
  if (!date) return undefined;
  return Math.round((new Date(date.slice(0, 10) + 'T00:00:00').getTime() - new Date(localDate(now) + 'T00:00:00').getTime()) / DAY);
}

/** Per client: behind its output target, or a recurring deadline (demo, report) falls today. Worked out once per state and minute. */
const pressure = new WeakMap<AppState, { at: number; by: Map<CompanyId, { behind: boolean; deadline: boolean }> }>();
function clientPressure(state: AppState, company: CompanyId, now: Date): { behind: boolean; deadline: boolean } {
  let memo = pressure.get(state);
  if (!memo || memo.at !== now.getTime()) pressure.set(state, (memo = { at: now.getTime(), by: new Map() }));
  let p = memo.by.get(company);
  if (!p) {
    const cfg = state.companies.find(c => c.id === company);
    p = { behind: !!weekProgress(state, company, now)?.behind, deadline: !!cfg && nextDeadlines(cfg, now, 0).length > 0 };
    memo.by.set(company, p);
  }
  return p;
}

const raise = (p: Priority, to: Priority): Priority => (PRIORITY_ORDER.indexOf(to) < PRIORITY_ORDER.indexOf(p) ? to : p);

/**
 * Worked out, never stored: rejected or due today = urgent, due this week or being worked on = high,
 * next in the queue or waiting on review = normal, everything else = low.
 * The client's job details raise it: work in progress or in review is urgent on the day of a recurring deadline,
 * and work in progress or next in the queue is at least high while the client is behind its target.
 */
export function modelPriority(m: Model, state: AppState, now: Date): Priority {
  if (isComplete(m.status) || m.status === 'skipped' || m.status === 'on_hold') return 'low';
  if (m.status === 'revision') return 'urgent';
  const due = daysTo(m.dueDate, now);
  if (due !== undefined && due <= 0) return 'urgent';
  const { behind, deadline } = clientPressure(state, m.company, now);
  if (deadline && (m.status === 'in_progress' || m.status === 'review')) return 'urgent';
  if ((due !== undefined && due <= 7) || m.status === 'in_progress') return 'high';
  if (m.status === 'review') return 'normal';
  const next =
    m.company === 'waveink'
      ? waveinkQueue(state.models).slice(0, QUEUE)
      : state.models
          .filter(x => x.company === m.company && x.status === 'todo')
          .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.createdAt.localeCompare(b.createdAt))
          .slice(0, QUEUE);
  if (!next.some(x => x.id === m.id)) return 'low';
  return behind ? 'high' : 'normal';
}

/**
 * Skeidar jobs are paid per image, so an open job is always worth doing soon; a job open for 3+ days is urgent.
 * With the state, the client's job details raise an open job to urgent on a deadline day and keep it at least high while behind.
 */
export function jobPriority(j: SkeidarJob, now: Date, state?: AppState): Priority {
  if (j.status === 'delivered') return 'low';
  const { total, done } = jobOutputs(j);
  const age = -(daysTo(j.receivedAt, now) ?? 0);
  let p: Priority = total > 0 && done >= total ? 'normal' : age >= 3 ? 'urgent' : 'high';
  if (state && p !== 'normal') {
    const { behind, deadline } = clientPressure(state, j.company ?? 'skeidar', now);
    if (deadline) p = 'urgent';
    else if (behind) p = raise(p, 'high');
  }
  return p;
}

export const PRIORITY_LABEL: Record<Priority, string> = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };
