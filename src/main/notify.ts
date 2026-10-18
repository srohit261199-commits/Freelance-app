import { Notification } from 'electron';
import type { AppState } from '../shared/types';
import { daysUntil, rollRenewal } from '../shared/money';

const shown = new Set<string>();

function show(id: string, title: string, body: string, onClick?: () => void): void {
  if (shown.has(id) || !Notification.isSupported()) return;
  shown.add(id);
  const n = new Notification({ title, body, silent: false });
  if (onClick) n.on('click', onClick);
  n.show();
}

/** Called every minute: renewals tomorrow, Friday report. */
export function tick(state: AppState, focus: () => void): void {
  if (!state.settings.notifications) return;
  const now = new Date();
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
