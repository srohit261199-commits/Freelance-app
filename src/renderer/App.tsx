import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ActionTarget } from '../shared/planner';
import type { CompanyConfig } from '../shared/types';
import { nextActions } from '../shared/planner';
import { isComplete } from '../shared/status';
import { hub, useAppState, useNow } from './hub';
import { AppCtx, Icon, type Route } from './ui';
import { Omni, type Screen } from './Omni';
import { allEarnings, localDate } from '../shared/money';
import { Today, readDone } from './views/Today';
import { Waveink } from './views/Waveink';
import { MetaZtech } from './views/MetaZtech';
import { Client } from './views/Client';
import { AddClient } from './views/JobDetails';
import { Skeidar } from './views/Skeidar';
import { Earnings } from './views/Earnings';
import { Subscriptions } from './views/Subscriptions';
import { Portfolio } from './views/Portfolio';
import { Settings } from './views/Settings';
import { ScreenBoundary } from './ScreenBoundary';

interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error';
}

export function App() {
  const state = useAppState();
  const stateRef = useRef(state);
  stateRef.current = state;
  const [addingClient, setAddingClient] = useState(false);
  const now = useNow();
  const [route, setRoute] = useState<Route>({ view: 'today' });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const side = useRef<HTMLElement>(null);
  const main = useRef<HTMLElement>(null);

  const dismiss = useCallback((id: number) => setToasts(t => t.filter(x => x.id !== id)), []);
  const toast = useCallback(
    (text: string, kind: 'ok' | 'error' = 'ok') => {
      const id = Date.now() + Math.random();
      setToasts(t => [...t.slice(-2), { id, text, kind }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 3500);
    },
    [dismiss],
  );

  const go = useCallback((r: Route | ActionTarget) => {
    if ('url' in r) {
      void hub.openUrl(r.url);
      return;
    }
    if (r.view === 'company' && r.company === 'skeidar') setRoute({ view: 'skeidar' });
    else if (r.view === 'company' && stateRef.current?.companies.find(c => c.id === r.company)?.workflow === 'variations')
      setRoute({ view: 'skeidar', company: r.company });
    else setRoute(r as Route);
  }, []);

  // A new screen starts at its top, and on the phone bar the current screen scrolls into view.
  useEffect(() => {
    main.current?.scrollTo(0, 0);
    const bar = side.current;
    const on = bar?.querySelector<HTMLElement>('.nav-item.on');
    if (!bar || !on || bar.scrollWidth <= bar.clientWidth) return;
    const a = bar.getBoundingClientRect();
    const b = on.getBoundingClientRect();
    bar.scrollBy({ left: b.left - a.left - (a.width - b.width) / 2, behavior: 'smooth' });
  }, [route]);

  useEffect(() => {
    const theme = state?.settings.theme ?? 'system';
    const root = document.documentElement;
    if (theme !== 'system') {
      root.dataset.theme = theme;
      root.dataset.themeSetBy = 'app';
    } else if (root.dataset.themeSetBy === 'app') {
      delete root.dataset.theme;
      delete root.dataset.themeSetBy;
    }
  }, [state?.settings.theme]);

  // Rows ticked off on the dashboard today don't count toward its badge.
  const [doneTick, bumpDone] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    addEventListener('fh-dash-done', bumpDone);
    return () => removeEventListener('fh-dash-done', bumpDone);
  }, []);

  const counts = useMemo(() => {
    if (!state) return null;
    const by = (c: string) => state.models.filter(m => m.company === c);
    return {
      today: (() => {
        const done = readDone(localDate(now));
        return nextActions(state, now).filter(a => !done.includes(a.id)).length;
      })(),
      // Tech catalog progress, as on the Waveink screen and dashboard tile
      waveink: `${by('waveink').filter(m => m.group === 'Tech' && isComplete(m.status)).length}/${by('waveink').filter(m => m.group === 'Tech' && m.status !== 'skipped').length}`,
      metaztech: by('metaztech').filter(m => m.status === 'revision').length,
      skeidar: state.skeidarJobs.filter(j => j.status === 'open').length,
      late: allEarnings(state, now).filter(e => e.overdue).length,
      subs: state.subscriptions.filter(s => s.status === 'active' || s.status === 'trial').length,
      portfolio: state.portfolioTasks.filter(t => !t.done).length,
    };
  }, [state, now, doneTick]);

  if (!state || !counts) return <div className="boot">Loading…</div>;

  const screens: (Screen & { section: string; badge?: string | number })[] = [
    { section: 'Menu', route: { view: 'today' }, label: 'Dashboard', icon: 'dashboard', badge: counts.today || undefined },
    { section: 'Clients', route: { view: 'company', company: 'waveink' }, label: 'Waveink', icon: 'cube', client: 'waveink', badge: counts.waveink },
    { section: 'Clients', route: { view: 'company', company: 'metaztech' }, label: 'MetaZtech', icon: 'cubeFocus', client: 'metaztech', badge: counts.metaztech || undefined },
    { section: 'Clients', route: { view: 'skeidar' }, label: 'Skeidar', icon: 'brush', client: 'skeidar', badge: counts.skeidar || undefined },
    ...state.companies
      .filter(c => !c.builtIn && !c.archived)
      .map(c => ({
        section: 'Clients',
        route: (c.workflow === 'variations' ? { view: 'skeidar', company: c.id } : { view: 'company', company: c.id }) as Route,
        label: c.name,
        icon: (c.workflow === 'variations' ? 'brush' : 'cube') as Screen['icon'],
        client: c.id,
        badge:
          (c.workflow === 'variations'
            ? state.skeidarJobs.filter(j => j.company === c.id && j.status === 'open').length
            : state.models.filter(m => m.company === c.id && (m.status === 'in_progress' || m.status === 'revision')).length) || undefined,
      })),
    { section: 'Money', route: { view: 'earnings' }, label: 'Payments', icon: 'wallet', badge: counts.late || undefined },
    { section: 'Money', route: { view: 'subscriptions' }, label: 'Subscriptions', icon: 'repeat', badge: counts.subs || undefined },
    { section: 'Tools', route: { view: 'settings' }, label: 'Settings & import', icon: 'gear' },
    { section: 'Tools', route: { view: 'portfolio' }, label: 'Portfolio', icon: 'globe', badge: counts.portfolio || undefined },
  ];
  const active = (r: Route) =>
    r.view === route.view &&
    (r.view === 'company' ? route.view === 'company' && r.company === route.company : r.view === 'skeidar' ? route.view === 'skeidar' && (r.company ?? 'skeidar') === (route.company ?? 'skeidar') : true);
  const title = screens.find(s => active(s.route))?.label ?? '';
  const sections = [...new Set(screens.map(s => s.section))];

  return (
    <AppCtx.Provider value={{ go, toast }}>
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <span className="mark" aria-hidden="true">
              FH
            </span>
            <span className="name">Freelance Hub</span>
            {title && <span className="where">— {title}</span>}
          </div>
          <Omni state={state} screens={screens} onGo={go} />
        </header>
        <div className="body">
          <nav className="side" ref={side} aria-label="Screens">
            <button type="button" className="profile" onClick={() => setRoute({ view: 'settings' })} title="Settings">
              <span className="avatar">RS</span>
              <span className="who">
                <b>Rohit Sharma</b>
                <small>Freelance 3D artist</small>
              </span>
              <Icon name="caretUpDown" />
            </button>
            {sections.map(sec => (
              <div key={sec} className="nav-sec">
                <h4>{sec}</h4>
                {screens
                  .filter(s => s.section === sec)
                  .map(s => (
                    <button key={s.label} type="button" className={`nav-item ${active(s.route) ? 'on' : ''}`} aria-current={active(s.route) ? 'page' : undefined} onClick={() => setRoute(s.route)}>
                      {s.client ? <span className={`swatch c-${s.client} c-fill`} /> : <Icon name={s.icon} size={20} />}
                      <span className="label">{s.label}</span>
                      {s.badge !== undefined && <span className="badge">{s.badge}</span>}
                    </button>
                  ))}
                {sec === 'Clients' && (
                  <button type="button" className="nav-item add" onClick={() => setAddingClient(true)}>
                    <Icon name="plus" size={20} />
                    <span className="label">Add client</span>
                  </button>
                )}
              </div>
            ))}
          </nav>
          <main className="content" ref={main}>
            <ScreenBoundary screen={JSON.stringify(route)}>
              {route.view === 'today' && <Today state={state} now={now} />}
              {route.view === 'company' && route.company === 'waveink' && <Waveink state={state} openId={route.modelId} now={now} />}
              {route.view === 'company' && route.company === 'metaztech' && <MetaZtech state={state} openId={route.modelId} now={now} />}
              {route.view === 'company' && route.company !== 'waveink' && route.company !== 'metaztech' && (
                <Client key={route.company} state={state} company={route.company} openId={route.modelId} now={now} />
              )}
              {route.view === 'skeidar' && <Skeidar key={route.company ?? 'skeidar'} state={state} now={now} openId={route.jobId} company={route.company ?? 'skeidar'} />}
              {route.view === 'earnings' && <Earnings state={state} now={now} />}
              {route.view === 'subscriptions' && <Subscriptions state={state} now={now} />}
              {route.view === 'portfolio' && <Portfolio state={state} now={now} />}
              {route.view === 'settings' && <Settings state={state} now={now} />}
            </ScreenBoundary>
          </main>
        </div>
      </div>
      {/* Clients added by hand get the same --c / --c-tint / --c-deep variables the built-in ones have in styles.css */}
      <style>{clientColours(state.companies)}</style>
      {addingClient && <AddClient state={state} onClose={() => setAddingClient(false)} />}
      <div className="toasts" role="status" aria-atomic="false">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)} title="Click to dismiss">
            <span className="grow">{t.text}</span>
            <button type="button" className="toast-x" aria-label="Dismiss">
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}

/** CSS variables for clients added by hand, mixed from their colour so tints work in both themes. */
function clientColours(companies: CompanyConfig[]): string {
  return companies
    .filter(c => !c.builtIn && /^[a-z0-9-]+$/i.test(c.id) && /^#[0-9a-f]{3,8}$/i.test(c.color))
    .map(c => `.c-${c.id}{--c:${c.color};--c-tint:color-mix(in srgb,${c.color} 22%,var(--panel));--c-deep:color-mix(in srgb,${c.color} 62%,var(--text))}`)
    .join('');
}
