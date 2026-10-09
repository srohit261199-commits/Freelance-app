import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ActionTarget } from '../shared/planner';
import { nextActions } from '../shared/planner';
import { isComplete } from '../shared/status';
import { hub, useAppState, useNow } from './hub';
import { AppCtx, Icon, relTime, type Route } from './ui';
import { Today } from './views/Today';
import { Models } from './views/Models';
import { Skeidar } from './views/Skeidar';
import { Inbox } from './views/Inbox';
import { Earnings } from './views/Earnings';
import { Subscriptions } from './views/Subscriptions';
import { Portfolio } from './views/Portfolio';
import { Settings } from './views/Settings';

interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error';
}

export function App() {
  const state = useAppState();
  const now = useNow();
  const [route, setRoute] = useState<Route>({ view: 'today' });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [syncing, setSyncing] = useState(false);

  const toast = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, text, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);

  const go = useCallback((r: Route | ActionTarget) => {
    if ('url' in r) {
      void hub.openUrl(r.url);
      return;
    }
    if (r.view === 'company' && r.company === 'skeidar') setRoute({ view: 'skeidar' });
    else setRoute(r as Route);
  }, []);

  useEffect(() => {
    const theme = state?.settings.theme ?? 'system';
    document.documentElement.dataset.theme = theme;
  }, [state?.settings.theme]);

  const counts = useMemo(() => {
    if (!state) return null;
    const by = (c: string) => state.models.filter(m => m.company === c);
    const open = (c: string) => by(c).filter(m => m.status === 'in_progress' || m.status === 'revision').length;
    return {
      today: nextActions(state, now).filter(a => a.priority === 1).length,
      waveink: `${by('waveink').filter(m => isComplete(m.status)).length}/${by('waveink').filter(m => m.status !== 'skipped').length}`,
      metaztech: open('metaztech'),
      skeidar: state.skeidarJobs.filter(j => j.status === 'open').length,
      inbox: state.emails.filter(e => e.unread && e.company !== 'other').length + state.suggestions.length,
      subs: state.subscriptions.filter(s => s.status === 'active' || s.status === 'trial').length,
      portfolio: state.portfolioTasks.filter(t => !t.done).length,
    };
  }, [state, now]);

  if (!state || !counts) return <div className="boot">Loading…</div>;

  const sync = async () => {
    if (!state.settings.google.connected) {
      setRoute({ view: 'settings' });
      toast('Connect Google first (Settings → Google account).', 'error');
      return;
    }
    setSyncing(true);
    const r = await hub.sync();
    setSyncing(false);
    if (r.ok) toast(`Synced: ${r.newEmails} new mails, ${r.meetings} upcoming meetings, ${r.driveMatches} GLBs on Drive${r.newSuggestions ? `, ${r.newSuggestions} to review` : ''}.`);
    else toast(r.error ?? 'Sync failed', 'error');
  };

  const color = (id: string) => state.companies.find(c => c.id === id)?.color;
  const nav: { route: Route; label: string; icon: Parameters<typeof Icon>[0]['name']; badge?: string | number; dot?: string }[] = [
    { route: { view: 'today' }, label: 'Today', icon: 'dashboard', badge: counts.today || undefined },
    { route: { view: 'company', company: 'waveink' }, label: 'Waveink', icon: 'cube', badge: counts.waveink, dot: color('waveink') },
    { route: { view: 'company', company: 'metaztech' }, label: 'MetaZtech', icon: 'cube', badge: counts.metaztech || undefined, dot: color('metaztech') },
    { route: { view: 'skeidar' }, label: 'Skeidar', icon: 'image', badge: counts.skeidar || undefined, dot: color('skeidar') },
    { route: { view: 'portfolio' }, label: 'Portfolio', icon: 'globe', badge: counts.portfolio || undefined },
    { route: { view: 'inbox' }, label: 'Inbox & meetings', icon: 'mail', badge: counts.inbox || undefined },
    { route: { view: 'earnings' }, label: 'Earnings', icon: 'money' },
    { route: { view: 'subscriptions' }, label: 'Subscriptions', icon: 'repeat', badge: counts.subs },
    { route: { view: 'settings' }, label: 'Settings', icon: 'gear' },
  ];
  const active = (r: Route) => r.view === route.view && (r.view !== 'company' || (route.view === 'company' && r.company === route.company));
  const g = state.settings.google;

  return (
    <AppCtx.Provider value={{ go, toast }}>
      <div className="shell">
        <nav className="side">
          <div className="brand">
            <span className="logo">FH</span>
            <div>
              <strong>Freelance Hub</strong>
              <small>Rohit Sharma</small>
            </div>
          </div>
          <div className="nav">
            {nav.map(n => (
              <button key={n.label} type="button" className={active(n.route) ? 'on' : ''} onClick={() => setRoute(n.route)}>
                {n.dot ? <span className="cdot" style={{ background: n.dot }} /> : <Icon name={n.icon} />}
                <span className="grow">{n.label}</span>
                {n.badge !== undefined && <span className="count">{n.badge}</span>}
              </button>
            ))}
          </div>
          <div className="side-foot">
            <button type="button" className="sync-btn" onClick={sync} disabled={syncing}>
              <Icon name="sync" />
              {syncing ? 'Syncing…' : 'Sync Gmail & Calendar'}
            </button>
            <small className="muted">
              {g.connected ? (g.lastSync ? `Last sync ${relTime(g.lastSync, now)}` : 'Not synced yet') : 'Google not connected'}
              {g.lastError && <span className="err-dot" title={g.lastError}> · error</span>}
            </small>
          </div>
        </nav>
        <main className="content">
          {route.view === 'today' && <Today state={state} now={now} onSync={sync} />}
          {route.view === 'company' && <Models key={route.company} state={state} company={route.company} openId={route.modelId} now={now} />}
          {route.view === 'skeidar' && <Skeidar state={state} now={now} openId={route.jobId} />}
          {route.view === 'inbox' && <Inbox state={state} now={now} onSync={sync} syncing={syncing} />}
          {route.view === 'earnings' && <Earnings state={state} now={now} />}
          {route.view === 'subscriptions' && <Subscriptions state={state} now={now} />}
          {route.view === 'portfolio' && <Portfolio state={state} now={now} />}
          {route.view === 'settings' && <Settings state={state} now={now} />}
        </main>
      </div>
      <div className="toasts">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}
