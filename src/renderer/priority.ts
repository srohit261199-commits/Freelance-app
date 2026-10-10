import type { AppState, Model, SkeidarJob } from '../shared/types';
import { isComplete } from '../shared/status';
import { jobOutputs, localDate } from '../shared/money';
import { waveinkQueue } from '../shared/planner';

export type Priority = 'urgent' | 'high' | 'normal' | 'low';
export const PRIORITY_ORDER: Priority[] = ['urgent', 'high', 'normal', 'low'];

const DAY = 86400000;
/** How many of the next to-do models count as "next in queue". */
const QUEUE = 3;

function daysTo(date: string | undefined, now: Date): number | undefined {
  if (!date) return undefined;
  return Math.round((new Date(date.slice(0, 10) + 'T00:00:00').getTime() - new Date(localDate(now) + 'T00:00:00').getTime()) / DAY);
}

/**
 * Worked out, never stored: rejected or due today = urgent, due this week or being worked on = high,
 * next in the queue or waiting on review = normal, everything else = low.
 */
export function modelPriority(m: Model, state: AppState, now: Date): Priority {
  if (isComplete(m.status) || m.status === 'skipped' || m.status === 'on_hold') return 'low';
  if (m.status === 'revision') return 'urgent';
  const due = daysTo(m.dueDate, now);
  if (due !== undefined && due <= 0) return 'urgent';
  if ((due !== undefined && due <= 7) || m.status === 'in_progress') return 'high';
  if (m.status === 'review') return 'normal';
  const next =
    m.company === 'waveink'
      ? waveinkQueue(state.models).slice(0, QUEUE)
      : state.models
          .filter(x => x.company === m.company && x.status === 'todo')
          .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.createdAt.localeCompare(b.createdAt))
          .slice(0, QUEUE);
  return next.some(x => x.id === m.id) ? 'normal' : 'low';
}

/** Skeidar jobs are paid per image, so an open job is always worth doing soon; a job open for 3+ days is urgent. */
export function jobPriority(j: SkeidarJob, now: Date): Priority {
  if (j.status === 'delivered') return 'low';
  const { total, done } = jobOutputs(j);
  if (total > 0 && done >= total) return 'normal';
  const age = -(daysTo(j.receivedAt, now) ?? 0);
  return age >= 3 ? 'urgent' : 'high';
}

export const PRIORITY_LABEL: Record<Priority, string> = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };
