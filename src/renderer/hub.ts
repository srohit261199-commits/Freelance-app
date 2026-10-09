import { useEffect, useState } from 'react';
import type { Hub } from '../shared/api';
import type { AppState } from '../shared/types';

declare global {
  interface Window {
    hub: Hub;
  }
}

export const hub = window.hub;

let current: AppState | null = null;
const listeners = new Set<(s: AppState) => void>();
let started = false;

function start() {
  if (started) return;
  started = true;
  hub.onState(s => {
    current = s;
    listeners.forEach(l => l(s));
  });
  hub.getState().then(s => {
    current = s;
    listeners.forEach(l => l(s));
  });
}

/** Live copy of the main-process state; re-renders whenever anything changes. */
export function useAppState(): AppState | null {
  const [s, set] = useState<AppState | null>(current);
  useEffect(() => {
    start();
    listeners.add(set);
    if (current) set(current);
    return () => void listeners.delete(set);
  }, []);
  return s;
}

/** A clock that ticks every minute so due dates and "today" stay fresh. */
export function useNow(): Date {
  const [now, set] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => set(new Date()), 60000);
    return () => clearInterval(t);
  }, []);
  return now;
}
