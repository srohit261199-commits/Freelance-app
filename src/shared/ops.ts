import type { AppState, Complexity, Model, ModelStatus, Payment, Subscription } from './types';
import { setStatus } from './status';

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
    return next;
  });
}

export interface PortalRow {
  code?: string;
  name: string;
  status: ModelStatus;
  statusText?: string;
  complexity?: Complexity;
  revisions?: number;
  due?: string;
  project?: string;
  link?: string;
  raw: Record<string, string>;
}

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
    const existing =
      (r.code && mine.find(m => m.code && key(m.code) === key(r.code!))) || mine.find(m => key(m.name) === key(r.name || r.code!));
    if (!existing) {
      const model: Model = {
        id: uid('mz'),
        company: 'metaztech',
        name: r.name || r.code!,
        code: r.code,
        group: r.project,
        status: 'todo',
        complexity: r.complexity,
        revisions: r.revisions ?? 0,
        dueDate: r.due,
        portalRow: r.raw,
        portalUrl: r.link || undefined,
        source: 'portal',
        createdAt: now,
        updatedAt: now,
        history: [],
      };
      const withStatus = r.status === 'todo' ? model : setStatus(model, r.status, now, `From portal: ${r.statusText ?? r.status}`);
      // A model first seen as rejected counts its earlier rejections from the sheet, not the +1 setStatus adds.
      if (r.revisions != null) withStatus.revisions = r.revisions;
      state.models.push(withStatus);
      mine.push(withStatus);
      counts.added++;
      continue;
    }
    let next: Model = { ...existing, portalRow: r.raw };
    let changed = false;
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
      next = setStatus(next, r.status, now, `From portal: ${r.statusText ?? r.status}`);
      changed = true;
    }
    if (r.revisions != null && r.revisions !== next.revisions) {
      next.revisions = r.revisions;
      changed = true;
    }
    if (changed) next.updatedAt = now;
    state.models = state.models.map(m => (m.id === existing.id ? next : m));
    if (changed) counts.updated++;
    else counts.unchanged++;
  }
  return counts;
}

export function acceptSuggestion(state: AppState, id: string, override: { payment?: Partial<Payment>; subscription?: Partial<Subscription> }): void {
  const sg = state.suggestions.find(s => s.id === id);
  if (!sg) return;
  if (sg.kind === 'payment') {
    const p = { ...sg.payment, ...override.payment } as Payment;
    state.payments.push({ ...p, id: uid('pay'), source: 'email', emailId: sg.emailId, amount: Number(p.amount) || 0 });
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
