import type { AppState, Complexity, Model, ModelStatus, Payment, Subscription } from './types';
import { isComplete, setStatus } from './status';
import { convert } from './money';

export function uid(prefix: string): string {
  const rnd = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}-${rnd.replace(/-/g, '').slice(0, 12)}`;
}

export function applyStatus(state: AppState, ids: string[], status: ModelStatus, now: string, note?: string): void {
  const want = new Set(ids);
  state.models = state.models.map(m => (want.has(m.id) ? setStatus(m, status, now, note) : m));
}

export function patchModel(state: AppState, id: string, patch: Partial<Model>, now: string): void {
  state.models = state.models.map(m => {
    if (m.id !== id) return m;
    const { status, ...rest } = patch;
    let next: Model = { ...m, ...rest, updatedAt: now };
    if (status && status !== m.status) next = setStatus(next, status, now);
    // Logging progress on a model that hasn't been started starts it.
    else if (!status && m.status === 'todo' && (rest.percent ?? 0) > 0) next = setStatus(next, 'in_progress', now);
    if (rest.percent !== undefined && rest.percent !== m.percent) next = logProgress(next, 'percent', `${rest.percent}% done`, now);
    if (rest.glbFile !== undefined && rest.glbFile.trim() && rest.glbFile !== m.glbFile) next = logProgress(next, 'glb', `GLB ${rest.glbFile.trim()}`, now);
    if (rest.notes !== undefined && rest.notes.trim() && rest.notes !== m.notes) next = logProgress(next, 'notes', rest.notes.trim().replace(/\s+/g, ' ').slice(0, 200), now);
    return next;
  });
}

/** Records a progress edit, replacing that day's earlier entry for the same field. */
function logProgress(m: Model, field: 'percent' | 'glb' | 'notes', note: string, now: string): Model {
  const day = new Date(now).toDateString();
  const history = m.history.filter(h => !(h.kind === 'progress' && h.field === field && new Date(h.at).toDateString() === day));
  return { ...m, history: [...history, { at: now, from: m.status, to: m.status, kind: 'progress', field, note }] };
}

export interface PortalRow {
  code?: string;
  name: string;
  status: ModelStatus;
  statusText?: string;
  complexity?: Complexity;
  revisions?: number;
  due?: string;
  /** Approval date from the portal (YYYY-MM-DD), so earnings land in the right month. */
  approvedOn?: string;
  project?: string;
  link?: string;
  raw: Record<string, string>;
}

const atNoon = (date: string) => new Date(`${date}T12:00:00`).toISOString();

export interface ImportCounts {
  added: number;
  updated: number;
  unchanged: number;
}

const key = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Adds or updates MetaZtech models from a portal pull or a pasted sheet. */
export function importPortalRows(state: AppState, rows: PortalRow[], now: string): ImportCounts {
  const counts: ImportCounts = { added: 0, updated: 0, unchanged: 0 };
  const mine = state.models.filter(m => m.company === 'metaztech');
  for (const r of rows) {
    if (!r.name && !r.code) continue;
    // Match by job ID; fall back to the name only when one side has no ID, so two jobs that share a name stay separate.
    const existing =
      (r.code && mine.find(m => m.code && key(m.code) === key(r.code!))) ||
      mine.find(m => (!r.code || !m.code) && key(m.name) === key(r.name || r.code!));
    if (!existing) {
      const done = isComplete(r.status);
      const model: Model = {
        id: uid('mz'),
        company: 'metaztech',
        name: r.name || r.code!,
        code: r.code,
        group: r.project,
        status: r.status,
        complexity: r.complexity,
        revisions: r.revisions ?? (r.status === 'revision' ? 1 : 0),
        dueDate: r.due,
        portalRow: r.raw,
        portalUrl: r.link || undefined,
        source: 'portal',
        createdAt: now,
        updatedAt: now,
        // The status it already had is not work done today, so it is logged as an import, not a change.
        history: [{ at: now, from: null, to: r.status, kind: 'import', note: `Imported from portal: ${r.statusText || r.status}` }],
        ...(done ? (r.approvedOn ? { completedAt: atNoon(r.approvedOn) } : { completedAt: now, completedAtApprox: true }) : {}),
      };
      state.models.push(model);
      mine.push(model);
      counts.added++;
      continue;
    }
    let next: Model = { ...existing, portalRow: r.raw };
    let changed = false;
    if (r.code && (!existing.code || key(r.code) !== key(existing.code))) {
      next.code = r.code;
      changed = true;
    }
    if (r.complexity && r.complexity !== existing.complexity) {
      next.complexity = r.complexity;
      changed = true;
    }
    if (r.project && r.project !== existing.group) {
      next.group = r.project;
      changed = true;
    }
    if (r.due && r.due !== existing.dueDate) {
      next.dueDate = r.due;
      changed = true;
    }
    if (r.link && r.link !== existing.portalUrl) next.portalUrl = r.link;
    if (r.status !== existing.status) {
      next = setStatus(next, r.status, now, `From portal: ${r.statusText || r.status}`);
      changed = true;
    }
    if (r.revisions != null && r.revisions !== next.revisions) {
      next.revisions = r.revisions;
      changed = true;
    }
    if (r.approvedOn && isComplete(next.status) && next.completedAt !== atNoon(r.approvedOn)) {
      next.completedAt = atNoon(r.approvedOn);
      delete next.completedAtApprox;
      changed = true;
    }
    if (changed) next.updatedAt = now;
    state.models = state.models.map(m => (m.id === existing.id ? next : m));
    mine[mine.indexOf(existing)] = next;
    if (changed) counts.updated++;
    else counts.unchanged++;
  }
  return counts;
}

/** Fills in what older saved data lacks: new lists, and new fields on the built-in clients. */
export function upgradeState(state: AppState, seed: AppState): AppState {
  if (!Array.isArray(state.accounts)) state.accounts = [];
  for (const c of state.companies) {
    const def = seed.companies.find(x => x.id === c.id);
    if (!def) continue;
    c.builtIn ??= def.builtIn;
    c.workflow ??= def.workflow;
    c.startDate ??= def.startDate;
    c.expectations ??= def.expectations;
    c.folder ??= c.id === 'skeidar' ? state.settings.skeidarFolder || def.folder : def.folder;
  }
  return state;
}

/** Undoes data written by older versions: salary "Re:" replies that an earlier sync recorded as a second payment. */
export function repairState(state: AppState): AppState {
  state.payments = state.payments.filter(p => !(p.source === 'email' && /^\s*(re|fw|fwd|aw)\s*:/i.test(p.note ?? '')));
  return state;
}

export function acceptSuggestion(state: AppState, id: string, override: { payment?: Partial<Payment>; subscription?: Partial<Subscription> }): void {
  const sg = state.suggestions.find(s => s.id === id);
  if (!sg) return;
  if (sg.kind === 'payment') {
    const p = { ...sg.payment, ...override.payment } as Payment;
    const amount = Number(p.amount) || 0;
    // Fix the value in the company's currency now, so a later rate change doesn't rewrite this payment.
    const own = state.companies.find(c => c.id === p.company)?.currency;
    const settledAmount = own && p.currency !== own ? convert(amount, p.currency, own, state.settings.rates) : undefined;
    state.payments.push({ ...p, id: uid('pay'), source: 'email', emailId: sg.emailId, amount, ...(settledAmount != null ? { settledAmount } : {}) });
  } else {
    const s: Partial<Subscription> = { ...sg.subscription, ...override.subscription };
    state.subscriptions.push({
      name: s.name || 'Subscription',
      vendor: s.vendor || s.name || 'Unknown',
      category: s.category ?? 'work',
      currency: s.currency ?? 'INR',
      cycle: s.cycle ?? 'monthly',
      status: s.status ?? 'active',
      nextRenewal: s.nextRenewal,
      endsOn: s.endsOn,
      lastCharged: s.lastCharged,
      paymentMethod: s.paymentMethod,
      notes: s.notes,
      id: uid('sub'),
      amount: s.amount == null ? null : Number(s.amount),
      source: 'email',
      emailId: sg.emailId,
    });
  }
  state.suggestions = state.suggestions.filter(s => s.id !== id);
  state.handledEmails = [...state.handledEmails, sg.emailId];
}

export function dismissSuggestion(state: AppState, id: string): void {
  const sg = state.suggestions.find(s => s.id === id);
  state.suggestions = state.suggestions.filter(s => s.id !== id);
  if (sg) state.handledEmails = [...state.handledEmails, sg.emailId];
}
