import type { AppState, CompanyId, EmailItem, Model, StatusEvent } from './types';
import { companyEarnings, daysUntil, formatMoney, jobOutputs, localDate, monthLabel, ordinal, rollRenewal, tierFee } from './money';
import { isComplete, statusEvents, statusLabel } from './status';

export type ActionTarget =
  | { view: 'company'; company: CompanyId; modelId?: string }
  | { view: 'skeidar'; jobId?: string }
  | { view: 'inbox'; emailId?: string }
  | { view: 'earnings' }
  | { view: 'subscriptions' }
  | { view: 'portfolio' }
  | { url: string };

export interface NextAction {
  id: string;
  /** 1 = do today, 2 = soon, 3 = queue. */
  priority: 1 | 2 | 3;
  company?: CompanyId | 'portfolio' | 'money';
  title: string;
  detail?: string;
  target?: ActionTarget;
  /** Model the action is about, so the list can offer Start / Done buttons. */
  modelId?: string;
}

const DAY = 86400000;

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Waveink "to do" queue: starred first, then subcategory by size (big batches first), then name. */
export function waveinkQueue(models: Model[]): Model[] {
  const size = new Map<string, number>();
  for (const m of models) for (const s of m.subcategories ?? []) size.set(s, (size.get(s) ?? 0) + 1);
  const key = (m: Model) => m.subcategories?.[0] ?? m.group ?? '';
  return models
    .filter(m => m.company === 'waveink' && m.status === 'todo')
    .sort(
      (a, b) =>
        Number(!!b.starred) - Number(!!a.starred) ||
        (a.group === 'Tech' ? 0 : 1) - (b.group === 'Tech' ? 0 : 1) ||
        (size.get(key(b)) ?? 0) - (size.get(key(a)) ?? 0) ||
        key(a).localeCompare(key(b)) ||
        a.name.localeCompare(b.name),
    );
}

export function nextActions(state: AppState, now: Date): NextAction[] {
  const out: NextAction[] = [];
  const cfg = (id: CompanyId) => state.companies.find(c => c.id === id)!;
  const name = (id: CompanyId) => cfg(id).name;

  // Meetings in the next 24 hours
  for (const m of state.meetings) {
    const t = new Date(m.start).getTime();
    if (t > now.getTime() - 60 * 60000 && t < now.getTime() + DAY) {
      const when = new Date(m.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      out.push({
        id: `meet-${m.id}`,
        priority: 1,
        company: m.company === 'other' ? undefined : m.company,
        title: `Meeting at ${when}: ${m.title}`,
        detail: sameDay(new Date(m.start), now) ? 'Today' : 'Tomorrow',
        target: m.joinUrl ? { url: m.joinUrl } : m.link ? { url: m.link } : { view: 'inbox' },
      });
    }
  }

  // Money that should have arrived
  for (const c of state.companies) {
    const e = companyEarnings(state, c.id, now);
    if (e.overdue) {
      out.push({
        id: `overdue-${c.id}-${e.overdue.month}`,
        priority: 1,
        company: 'money',
        title: e.overdue.paid > 0
          ? `${c.name} payment for ${monthLabel(e.overdue.month)} is only partly recorded`
          : `${c.name} payment for ${monthLabel(e.overdue.month)} not recorded`,
        detail: `Due ${e.overdue.due}. ${formatMoney(e.overdue.paid, e.currency)} of ${formatMoney(e.overdue.net, e.currency)} recorded. Record it in Earnings once it lands.`,
        target: { view: 'earnings' },
      });
    }
  }
  const mz = cfg('metaztech');
  if (mz.pay.kind === 'tiered' && now.getDate() >= mz.pay.payoutFrom && now.getDate() <= mz.pay.payoutTo + 2) {
    const e = companyEarnings(state, 'metaztech', now);
    const thisMonth = localDate(now).slice(0, 7);
    // What last month's (and older) approvals are worth minus what has been recorded against them
    const due = e.months.filter(l => l.month < thisMonth).reduce((s, l) => s + l.net - (e.paidByMonth[l.month] ?? 0), 0);
    if (due > 0.5) {
      out.push({
        id: `mz-payout-${now.getFullYear()}-${now.getMonth()}`,
        priority: 2,
        company: 'money',
        title: `MetaZtech payout window (${ordinal(mz.pay.payoutFrom)}–${ordinal(mz.pay.payoutTo)}): check your bank`,
        detail: `Expected about ${formatMoney(due, 'INR')} for last month's approvals, after ${mz.pay.tdsPercent}% TDS.`,
        target: { view: 'earnings' },
      });
    }
  }

  // MetaZtech: rejections first, the team lead keeps asking for them
  const mzModels = state.models.filter(m => m.company === 'metaztech');
  for (const m of mzModels.filter(m => m.status === 'revision')) {
    out.push({
      id: `fix-${m.id}`,
      priority: 1,
      company: 'metaztech',
      title: `Fix rejection: ${m.name}`,
      detail: [m.code, m.revisions ? `rejected ${m.revisions}×` : '', m.notes].filter(Boolean).join(' · '),
      target: { view: 'company', company: 'metaztech', modelId: m.id },
      modelId: m.id,
    });
  }
  const submittedToday = mzModels.filter(m =>
    statusEvents(m).some(h => h.to === 'review' && sameDay(new Date(h.at), now)),
  ).length;
  const mzOpen = mzModels.filter(m => m.status === 'todo' || m.status === 'in_progress').length;
  if (mzModels.length && submittedToday < 2 && mzOpen) {
    out.push({
      id: `mz-target-${now.toDateString()}`,
      priority: 2,
      company: 'metaztech',
      title: `MetaZtech daily target: submit 1–2 files (${submittedToday} today)`,
      detail: 'Ritu asked for 1–2 files per day if you skip weekends.',
      target: { view: 'company', company: 'metaztech' },
    });
  }

  // Waveink weekly report goes to Sibi every Friday by end of day
  const dow = now.getDay();
  if (dow === 4 || dow === 5) {
    out.push({
      id: `wi-report-${now.toDateString()}`,
      priority: dow === 5 ? 1 : 2,
      company: 'waveink',
      title: dow === 5 ? 'Send the Waveink daily update log to Sibi today (Friday EOD)' : 'Waveink update log is due tomorrow (Friday EOD)',
      detail: 'Export Excel on the Waveink page builds the Daily Update Log sheet from your status changes.',
      target: { view: 'company', company: 'waveink' },
    });
  }

  // Work in progress, any company
  for (const m of state.models.filter(m => m.status === 'in_progress')) {
    out.push({
      id: `cont-${m.id}`,
      priority: 2,
      company: m.company,
      title: `Continue: ${m.name}`,
      detail: [name(m.company), m.code, m.percent ? `${m.percent}%` : ''].filter(Boolean).join(' · '),
      target: { view: 'company', company: m.company, modelId: m.id },
      modelId: m.id,
    });
  }

  // Waveink models on Drive that are still marked as not started
  const onDrive = state.models.filter(m => m.company === 'waveink' && m.driveFileUrl && (m.status === 'todo' || m.status === 'in_progress'));
  if (onDrive.length) {
    out.push({
      id: 'wi-drive',
      priority: 2,
      company: 'waveink',
      title: `${onDrive.length} Waveink GLB${onDrive.length > 1 ? 's are' : ' is'} on Drive but not marked as submitted`,
      detail: onDrive.slice(0, 4).map(m => m.code).join(', '),
      target: { view: 'company', company: 'waveink' },
    });
  }

  // Skeidar jobs with images left
  for (const job of state.skeidarJobs.filter(j => j.status === 'open')) {
    const { total, done } = jobOutputs(job);
    if (done < total) {
      out.push({
        id: `sk-${job.id}`,
        priority: 2,
        company: 'skeidar',
        title: `Skeidar: ${job.name}, ${total - done} image${total - done > 1 ? 's' : ''} left`,
        detail: `${done}/${total} done · ${job.fabrics.length} fabrics × ${job.images.length} images`,
        target: { view: 'skeidar', jobId: job.id },
      });
    }
  }

  // Mail that reads like a request
  for (const e of attentionMail(state.emails, now)) {
    out.push({
      id: `mail-${e.id}`,
      priority: e.unread ? 1 : 2,
      company: e.company === 'other' ? undefined : e.company,
      title: `${e.fromName}: ${mailLine(e)}`,
      detail: e.kind === 'teams' ? 'Teams message' : e.snippet.slice(0, 140),
      target: { url: e.url },
    });
  }

  // Renewals and trials in the next week
  for (const s of state.subscriptions) {
    const next = s.status === 'cancelling' ? s.endsOn : rollRenewal(s, now);
    if (!next || s.status === 'cancelled') continue;
    const d = daysUntil(next, now);
    if (d >= 0 && d <= 7) {
      const verb = s.status === 'cancelling' ? 'ends' : s.status === 'trial' ? 'trial ends' : 'renews';
      out.push({
        id: `sub-${s.id}-${next}`,
        priority: d <= 1 ? 1 : 2,
        company: 'money',
        title: `${s.name} ${verb} ${d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`}`,
        detail: s.amount != null ? formatMoney(s.amount, s.currency, s.amount % 1 ? 2 : 0) : undefined,
        target: { view: 'subscriptions' },
      });
    }
  }

  // Next in the queues
  for (const m of mzModels.filter(m => m.status === 'todo').slice(0, 3)) {
    out.push({
      id: `mz-next-${m.id}`,
      priority: 2,
      company: 'metaztech',
      title: `Start: ${m.name}`,
      detail: [m.code, m.complexity ? `₹${tierFee(mz, m.complexity)}` : ''].filter(Boolean).join(' · '),
      target: { view: 'company', company: 'metaztech', modelId: m.id },
      modelId: m.id,
    });
  }
  for (const m of waveinkQueue(state.models).slice(0, 3)) {
    out.push({
      id: `wi-next-${m.id}`,
      priority: 3,
      company: 'waveink',
      title: `Next Waveink model: ${m.name}`,
      detail: [m.code, m.subcategories?.[0] ?? m.group].filter(Boolean).join(' · '),
      target: { view: 'company', company: 'waveink', modelId: m.id },
      modelId: m.id,
    });
  }
  for (const t of state.portfolioTasks.filter(t => !t.done).slice(0, 2)) {
    out.push({ id: `pf-${t.id}`, priority: 3, company: 'portfolio', title: `Portfolio: ${t.title}`, detail: t.detail, target: { view: 'portfolio' } });
  }

  return out.sort((a, b) => a.priority - b.priority);
}

/** A client mail that reads like a request and is still unread, or arrived in the last 3 days. */
export function needsAction(e: EmailItem, now: Date): boolean {
  return e.company !== 'other' && e.attention.length > 0 && (e.unread || new Date(e.date).getTime() > now.getTime() - 3 * DAY);
}

/** The line worth showing for a mail: a Teams notification's subject only repeats the sender's name. */
export function mailLine(e: EmailItem): string {
  return e.kind === 'teams' && e.snippet && !/^\[image\]/i.test(e.snippet) ? e.snippet : e.subject;
}

/** Newest mails that need action, for the Today page. */
export function attentionMail(emails: EmailItem[], now: Date): EmailItem[] {
  return emails
    .filter(e => needsAction(e, now))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);
}

export interface DailyLogRow {
  date: string;
  worked: string[];
  started: number;
  completed: number;
  inReview: number;
  notes: string;
}

/** "ANZIO - Recycled Leather ... - Black" with code ITWC 1138 becomes "ANZIO (ITWC 1138)". */
export function modelLabel(m: Model): string {
  const short = m.name.split(' - ')[0].trim();
  return m.code ? `${short} (${m.code})` : short;
}

/**
 * Rebuilds Waveink's "Daily Update Log": for each day, each model's net status change
 * (Done then undone the same day counts as nothing) plus its progress notes.
 */
export function dailyLog(models: Model[], company: CompanyId, from?: string): DailyLogRow[] {
  const days = new Map<string, DailyLogRow>();
  const row = (d: string) => {
    let r = days.get(d);
    if (!r) days.set(d, (r = { date: d, worked: [], started: 0, completed: 0, inReview: 0, notes: '' }));
    return r;
  };
  const add = (r: DailyLogRow, note: string) => (r.notes = r.notes ? `${r.notes}; ${note}` : note);
  for (const m of models) {
    if (m.company !== company) continue;
    const byDay = new Map<string, StatusEvent[]>();
    for (const h of m.history) {
      if (h.kind === 'import') continue;
      const d = localDate(h.at);
      if (from && d < from) continue;
      byDay.set(d, [...(byDay.get(d) ?? []), h]);
    }
    const label = modelLabel(m);
    for (const [d, evs] of byDay) {
      const changes = evs.filter(h => !h.kind || h.kind === 'status');
      const progress = evs.filter(h => h.kind === 'progress');
      const start = changes[0]?.from ?? null;
      const end = changes.at(-1)?.to;
      const moved = changes.length > 0 && start !== end;
      if (!moved && !progress.length) continue;
      const r = row(d);
      if (!r.worked.includes(label)) r.worked.push(label);
      if (moved && end) {
        if ((start === 'todo' || start === null) && end !== 'todo' && end !== 'skipped') r.started++;
        if (isComplete(end) && !(start && isComplete(start))) r.completed++;
        if (end === 'review' && start !== 'review') r.inReview++;
        const why = changes.map(h => h.note).filter(Boolean).at(-1);
        add(r, `${label}: ${start ? `${statusLabel(start, company)} → ` : ''}${statusLabel(end, company)}${why ? ` (${why})` : ''}`);
      }
      // Latest value of each progress field that day
      const latest = new Map<string, StatusEvent>();
      for (const h of progress) latest.set(h.field ?? 'notes', h);
      const bits = ['percent', 'glb', 'notes'].map(f => latest.get(f)?.note).filter(Boolean);
      if (bits.length) add(r, `${label}: ${bits.join(', ')}`);
    }
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export { localDate };
