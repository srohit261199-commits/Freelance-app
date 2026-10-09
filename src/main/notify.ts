import { Notification } from 'electron';
import type { AppState, EmailItem } from '../shared/types';
import { daysUntil, rollRenewal } from '../shared/money';

const shown = new Set<string>();

function show(id: string, title: string, body: string, onClick?: () => void): void {
  if (shown.has(id) || !Notification.isSupported()) return;
  shown.add(id);
  const n = new Notification({ title, body, silent: false });
  if (onClick) n.on('click', onClick);
  n.show();
}

/** Called every minute: meetings about to start, renewals tomorrow, Friday report. */
export function tick(state: AppState, focus: () => void): void {
  if (!state.settings.notifications) return;
  const now = new Date();
  for (const m of state.meetings) {
    const mins = (new Date(m.start).getTime() - now.getTime()) / 60000;
    if (mins > 0 && mins <= 15) {
      const who = state.companies.find(c => c.id === m.company)?.name ?? '';
      show(`meet-${m.id}`, `${who ? who + ' · ' : ''}Meeting in ${Math.round(mins)} min`, m.title, focus);
    }
  }
  if (now.getHours() >= 9) {
    for (const s of state.subscriptions) {
      if (s.status === 'cancelled') continue;
      const next = s.status === 'cancelling' ? s.endsOn : rollRenewal(s, now);
      if (next && daysUntil(next, now) === 1) {
        show(`sub-${s.id}-${next}`, s.status === 'cancelling' ? `${s.name} ends tomorrow` : `${s.name} renews tomorrow`, s.amount != null ? `${s.currency} ${s.amount}` : '', focus);
      }
    }
    if (now.getDay() === 5) {
      show(`wi-friday-${now.toDateString()}`, 'Waveink: Friday update', 'Send the Daily Update Log to Sibi before end of day.', focus);
    }
  }
}

/** Pops a notice for new client mail that reads like a request. */
export function newMail(before: Set<string>, emails: EmailItem[], companyName: (id: string) => string, focus: () => void): void {
  const fresh = emails.filter(e => !before.has(e.id) && e.company !== 'other' && e.unread && Date.now() - new Date(e.date).getTime() < 86400000);
  if (!fresh.length) return;
  if (fresh.length === 1) {
    const e = fresh[0];
    show(`mail-${e.id}`, `${companyName(e.company)} · ${e.fromName}`, e.subject, focus);
  } else {
    show(`mail-batch-${fresh[0].id}`, `${fresh.length} new client messages`, fresh.map(e => `${companyName(e.company)}: ${e.subject}`).slice(0, 3).join('\n'), focus);
  }
}
