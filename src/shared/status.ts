import type { BuiltInCompanyId, CompanyId, Complexity, Model, ModelStatus, StatusEvent } from './types';

/** Statuses each company uses, in workflow order. */
export const COMPANY_STATUSES: Record<BuiltInCompanyId, ModelStatus[]> = {
  waveink: ['todo', 'in_progress', 'review', 'revision', 'done', 'live', 'skipped'],
  metaztech: ['todo', 'in_progress', 'review', 'revision', 'done', 'on_hold'],
  skeidar: ['todo', 'in_progress', 'done'],
};

/** Statuses for clients added by hand. */
const DEFAULT_STATUSES: ModelStatus[] = ['todo', 'in_progress', 'review', 'revision', 'done', 'on_hold'];

export function statusesFor(company: CompanyId): ModelStatus[] {
  return (COMPANY_STATUSES as Record<string, ModelStatus[] | undefined>)[company] ?? DEFAULT_STATUSES;
}

const LABELS: Record<ModelStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  review: 'In review',
  revision: 'Revision',
  done: 'Done',
  live: 'Live on site',
  on_hold: 'On hold',
  skipped: 'Not needed',
};

const COMPANY_LABELS: Partial<Record<CompanyId, Partial<Record<ModelStatus, string>>>> = {
  metaztech: { review: 'Submitted', revision: 'Rejected', done: 'Approved' },
  waveink: { review: 'Under review', done: 'Done' },
};

export function statusLabel(status: ModelStatus, company?: CompanyId): string {
  return (company && COMPANY_LABELS[company]?.[status]) || LABELS[status];
}

/** Finished work: counts toward progress and pay. */
export function isComplete(status: ModelStatus): boolean {
  return status === 'done' || status === 'live';
}

/** Still on Rohit's plate. */
export function isOpen(status: ModelStatus): boolean {
  return status === 'todo' || status === 'in_progress' || status === 'revision';
}

export function setStatus(model: Model, to: ModelStatus, now: string, note?: string): Model {
  if (model.status === to) return model;
  const next: Model = {
    ...model,
    status: to,
    updatedAt: now,
    history: [...model.history, { at: now, from: model.status, to, ...(note ? { note } : {}) }],
  };
  if (to === 'in_progress' && !next.startedAt) next.startedAt = now;
  if (isComplete(to) && !next.completedAt) next.completedAt = now;
  if (!isComplete(to) && to !== 'skipped') {
    delete next.completedAt;
    delete next.completedAtApprox;
  }
  if (to === 'revision' && model.company === 'metaztech') next.revisions = (model.revisions ?? 0) + 1;
  if (model.company === 'waveink') {
    if (isComplete(to) && !isComplete(model.status)) {
      next.percentBeforeDone = model.percent ?? 0;
      next.percent = 100;
    } else if (!isComplete(to) && isComplete(model.status)) {
      next.percent = to === 'todo' ? 0 : model.percentBeforeDone ?? 0;
      delete next.percentBeforeDone;
    } else if (to === 'todo') next.percent = 0;
  }
  return next;
}

/** When work on the model last moved (status or progress), ignoring the status it was imported with. */
export function lastWorked(model: Model): string | undefined {
  return model.history.filter(h => h.kind !== 'import').at(-1)?.at;
}

/** Status changes only (not progress notes or the status a model was imported with). */
export function statusEvents(model: Model): StatusEvent[] {
  return model.history.filter(h => !h.kind || h.kind === 'status');
}

export const COMPLEXITY_LABELS: Record<Complexity, string> = {
  simple: 'Simple / Medium / Retexture',
  complex: 'Complex',
  super: 'Super Complex',
  super1: 'Super Complex-1',
  super2: 'Super Complex-2+',
};

/** Reads a status word from the MetaZtech portal (or any pasted sheet). */
export function mapPortalStatus(text: string): ModelStatus {
  const t = text.toLowerCase().trim();
  if (!t) return 'todo';
  // Order matters: negations and "pending" wording are caught before the words they contain.
  if (/\bhold\b|paused|parked/.test(t)) return 'on_hold';
  if (/reject|not approved|disapprov|unapproved|redo|re-?work|revis|correction|changes? requested|returned|re-?open|\bfail/.test(t)) return 'revision';
  if (/not started|yet to start|not yet started|to ?do\b|unassigned|\bassigned\b|^new\b|\bopen\b|queued|allocated|^pending$|not submitted|backlog/.test(t)) return 'todo';
  if (/(pending|awaiting|waiting for|under|in|for)\s*(approval|review|qc|qa|check)|(approval|review|qc)\s*pending|submitted|\breview|\bqc\b|\bqa\b|uploaded|verification|checking/.test(t)) return 'review';
  if (/incomplete|not complete|partial|in ?progress|\bwip\b|working|started|ongoing|active|modell?ing|texturing/.test(t)) return 'in_progress';
  if (/approv|accepted|complete|\bdone\b|final|deliver|closed|publish|\blive\b|passed/.test(t)) return 'done';
  return 'todo';
}

export function mapComplexity(text: string): Complexity | undefined {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  // "Super Complex-1", "SC-1", "SC 2+", "Super Complex-3" (3 and up are paid at the 2+ rate)
  const level = t.match(/(?:super[ -]?complex|\bsc)\s*-?\s*(\d+|i{1,3}\b)\s*(\+)?/);
  if (level) {
    const n = /^i+$/.test(level[1]) ? level[1].length : Number(level[1]);
    return n >= 2 ? 'super2' : n === 1 ? 'super1' : 'super';
  }
  if (/super|\bsc\b/.test(t)) return 'super';
  if (/complex|hard/.test(t)) return 'complex';
  if (/simple|medium|retexture|secondary|basic|easy|low/.test(t)) return 'simple';
  return undefined;
}

/** Waveink catalog wording for the "3D Model Status" column. */
export function catalogStatusText(model: Model): string {
  switch (model.status) {
    case 'done':
    case 'live':
      return model.revised ? 'done (R)' : 'done';
    case 'skipped':
      return 'no';
    case 'review':
      return 'in review';
    case 'revision':
      return 'revision';
    case 'in_progress':
      return 'in progress';
    default:
      return '';
  }
}

/** Waveink tracker sheet wording. */
export function trackerStatusText(status: ModelStatus): string {
  switch (status) {
    case 'in_progress':
    case 'revision':
      return 'In Progress 🔄';
    case 'review':
      return 'Under Review 👀';
    case 'done':
      return 'Approved ✅';
    case 'live':
      return 'Live on Site 🌐';
    case 'skipped':
      return 'Not needed';
    default:
      return 'Not Started ⏳';
  }
}
