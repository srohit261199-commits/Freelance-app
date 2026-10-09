import type { CompanyId, Complexity, Model, ModelStatus } from './types';

/** Statuses each company uses, in workflow order. */
export const COMPANY_STATUSES: Record<CompanyId, ModelStatus[]> = {
  waveink: ['todo', 'in_progress', 'review', 'revision', 'done', 'live', 'skipped'],
  metaztech: ['todo', 'in_progress', 'review', 'revision', 'done', 'on_hold'],
  skeidar: ['todo', 'in_progress', 'done'],
};

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
  if (!isComplete(to) && to !== 'skipped') delete next.completedAt;
  if (to === 'revision' && model.company === 'metaztech') next.revisions = (model.revisions ?? 0) + 1;
  if (isComplete(to) && model.company === 'waveink') next.percent = 100;
  return next;
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
  if (/hold|paused|parked/.test(t)) return 'on_hold';
  if (/reject|redo|rework|revis|correction|changes? requested|returned|re-?open|fail/.test(t)) return 'revision';
  if (/(pending|awaiting|under|in|for)\s*(approval|review|qc|qa)|submitted|review|\bqc\b|\bqa\b|uploaded|verification|checking/.test(t)) return 'review';
  if (/approv|accept|complete|\bdone\b|final|deliver|closed|publish|\blive\b|passed/.test(t)) return 'done';
  if (/progress|\bwip\b|working|started|ongoing|active|modell?ing|texturing/.test(t)) return 'in_progress';
  return 'todo';
}

export function mapComplexity(text: string): Complexity | undefined {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  if (/super ?complex ?-? ?(2|ii)\b|2\s*\+/.test(t)) return 'super2';
  if (/super ?complex ?-? ?(1|i)\b/.test(t)) return 'super1';
  if (/super/.test(t)) return 'super';
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
      return 'In Progress 🔄';
    case 'review':
    case 'revision':
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

export function normaliseCode(code: string): string {
  return code.toUpperCase().replace(/\.GLB$/i, '').replace(/[\s_-]+/g, ' ').trim();
}
