import { useMemo } from 'react';
import type { AppState, Model, ModelStatus } from '../../shared/types';
import { mailLine, modelLabel, needsAction, nextActions } from '../../shared/planner';
import { allEarnings, convert, daysUntil, formatMoney, jobOutputs, localDate, rollRenewal } from '../../shared/money';
import { isComplete, statusLabel } from '../../shared/status';
import { hub } from '../hub';
import { CompanyDot, Icon, Progress, fmtDate, relTime, useApp } from '../ui';

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const NEXT: Partial<Record<ModelStatus, { to: ModelStatus; label: string }>> = {
  todo: { to: 'in_progress', label: 'Start' },
  in_progress: { to: 'review', label: 'Submit' },
  revision: { to: 'review', label: 'Resubmit' },
};

export function Today({ state, now, onSync }: { state: AppState; now: Date; onSync(): void }) {
  const { go, toast } = useApp();
  const actions = useMemo(() => nextActions(state, now), [state, now]);
  const earnings = useMemo(() => allEarnings(state, now), [state, now]);
  const models = new Map(state.models.map(m => [m.id, m]));
  const company = (id?: string) => state.companies.find(c => c.id === id);
  const base = state.settings.baseCurrency;
  const rates = state.settings.rates;
  const month = localDate(now).slice(0, 7);

  const wi = state.models.filter(m => m.company === 'waveink' && m.status !== 'skipped');
  const wiDone = wi.filter(m => isComplete(m.status)).length;
  const mz = state.models.filter(m => m.company === 'metaztech');
  // Models imported already approved, with no approval date, weren't approved this month.
  const mzApprovedMonth = mz.filter(m => isComplete(m.status) && m.completedAt && !m.completedAtApprox && localDate(m.completedAt).startsWith(month)).length;
  const skOpen = state.skeidarJobs.filter(j => j.status === 'open');
  const skLeft = skOpen.reduce((s, j) => {
    const o = jobOutputs(j);
    return s + o.total - o.done;
  }, 0);
  const expectedMonth = earnings.reduce((s, e) => s + convert(e.thisMonth, e.currency, base, rates), 0);
  const outstanding = earnings.reduce((s, e) => s + convert(e.outstanding, e.currency, base, rates), 0);

  const upcoming = state.meetings.filter(m => new Date(m.end ?? m.start).getTime() > now.getTime() && daysUntil(m.start, now) <= 7).slice(0, 6);
  const renewals = state.subscriptions
    .map(s => ({ s, date: s.status === 'cancelling' ? s.endsOn : rollRenewal(s, now) }))
    .filter(x => x.date && x.s.status !== 'cancelled' && daysUntil(x.date, now) >= 0 && daysUntil(x.date, now) <= 30)
    .sort((a, b) => a.date!.localeCompare(b.date!));
  const recent = state.emails.filter(e => e.company !== 'other').slice(0, 6);

  const move = async (m: Model, to: ModelStatus) => {
    await hub.setStatus([m.id], to);
    toast(`${modelLabel(m)} → ${statusLabel(to, m.company)}`);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>
            {greeting(now)}, Rohit
          </h1>
          <p className="muted">{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="actions">
          {!state.settings.google.connected && (
            <button type="button" className="primary" onClick={() => go({ view: 'settings' })}>
              Connect Google
            </button>
          )}
          <button type="button" onClick={onSync}>
            <Icon name="sync" /> Sync
          </button>
          <button
            type="button"
            onClick={async () => {
              const r = await hub.exportExcel('all');
              if (r.path) toast(`Saved ${r.path}`);
              else if (r.error) toast(r.error, 'error');
            }}
          >
            <Icon name="download" /> Export everything
          </button>
        </div>
      </header>

      <section className="kpis">
        <button type="button" className="kpi" onClick={() => go({ view: 'company', company: 'waveink' })}>
          <div className="kpi-top">
            <CompanyDot color={company('waveink')!.color} /> Waveink
          </div>
          <div className="kpi-num">
            {wiDone}
            <small>/{wi.length} models</small>
          </div>
          <Progress value={wiDone} total={wi.length} color={company('waveink')!.color} />
          <div className="muted small">
            {wi.filter(m => m.status === 'in_progress').length} in progress · {wi.filter(m => m.status === 'review').length} in review
          </div>
        </button>
        <button type="button" className="kpi" onClick={() => go({ view: 'company', company: 'metaztech' })}>
          <div className="kpi-top">
            <CompanyDot color={company('metaztech')!.color} /> MetaZtech
          </div>
          <div className="kpi-num">
            {mzApprovedMonth}
            <small> approved this month</small>
          </div>
          <div className="muted small">
            {mz.length
              ? `${mz.filter(m => m.status === 'review').length} submitted · ${mz.filter(m => m.status === 'revision').length} rejected · ${mz.filter(m => m.status === 'todo' || m.status === 'in_progress').length} to do`
              : 'No models yet: pull them from the portal'}
          </div>
        </button>
        <button type="button" className="kpi" onClick={() => go({ view: 'skeidar' })}>
          <div className="kpi-top">
            <CompanyDot color={company('skeidar')!.color} /> Skeidar
          </div>
          <div className="kpi-num">
            {skLeft}
            <small> images left</small>
          </div>
          <div className="muted small">
            {skOpen.length} open job{skOpen.length === 1 ? '' : 's'} · 5 AED per image
          </div>
        </button>
        <button type="button" className="kpi" onClick={() => go({ view: 'earnings' })}>
          <div className="kpi-top">
            <Icon name="money" /> Earning this month
          </div>
          <div className="kpi-num">{formatMoney(expectedMonth, base)}</div>
          <div className="muted small">
            paid next month · still owed {formatMoney(outstanding, base)}
          </div>
        </button>
      </section>

      <div className="cols">
        <section className="card grow">
          <h2>Up next</h2>
          {actions.length === 0 && <p className="muted">Nothing pressing. Pick the next model from a company page.</p>}
          <ul className="actions-list">
            {actions.slice(0, 18).map(a => {
              const m = a.modelId ? models.get(a.modelId) : undefined;
              const next = m ? NEXT[m.status] : undefined;
              const c = a.company && a.company !== 'portfolio' && a.company !== 'money' ? company(a.company) : undefined;
              return (
                <li key={a.id} className={`p${a.priority}`}>
                  <span className="prio" title={a.priority === 1 ? 'Today' : a.priority === 2 ? 'Soon' : 'Queue'} />
                  <button type="button" className="action-main" onClick={() => a.target && go(a.target)}>
                    <span className="action-title">
                      {c && <CompanyDot color={c.color} />}
                      {a.title}
                    </span>
                    {a.detail && <span className="muted small clamp">{a.detail}</span>}
                  </button>
                  {m && next && (
                    <button type="button" className="mini" onClick={() => move(m, next.to)}>
                      {next.label}
                    </button>
                  )}
                  {m && m.status === 'in_progress' && m.company === 'waveink' && (
                    <button type="button" className="mini ok" onClick={() => move(m, 'done')}>
                      Done
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <div className="side-col">
          <section className="card">
            <h2>Meetings</h2>
            {!upcoming.length && <p className="muted small">{state.settings.google.connected ? 'No meetings in the next 7 days.' : 'Connect Google to see meetings.'}</p>}
            <ul className="list">
              {upcoming.map(m => (
                <li key={m.id}>
                  <div>
                    <strong>{m.title}</strong>
                    <div className="muted small">
                      {fmtDate(m.start, true)}
                      {m.company !== 'other' && ` · ${company(m.company)?.name}`}
                    </div>
                  </div>
                  {m.joinUrl && (
                    <button type="button" className="mini primary" onClick={() => hub.openUrl(m.joinUrl!)}>
                      Join
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>Client messages</h2>
            {!recent.length && <p className="muted small">{state.settings.google.connected ? 'No client mail yet.' : 'Connect Google to pull Waveink, MetaZtech and Teams mail.'}</p>}
            <ul className="list">
              {recent.map(e => (
                <li key={e.id} className={e.unread ? 'unread' : ''}>
                  <button type="button" className="link-row" onClick={() => hub.openUrl(e.url)}>
                    <span className="row-top">
                      <CompanyDot color={company(e.company)?.color ?? '#999'} />
                      <strong>{e.fromName}</strong>
                      <span className="muted small push">{relTime(e.date, now)}</span>
                    </span>
                    <span className="small clamp">{mailLine(e)}</span>
                    {needsAction(e, now) && <span className="tag warn">needs reply</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>Renewals (30 days)</h2>
            {!renewals.length && <p className="muted small">Nothing renews in the next 30 days.</p>}
            <ul className="list">
              {renewals.map(({ s, date }) => (
                <li key={s.id}>
                  <div>
                    <strong>{s.name}</strong>
                    <div className="muted small">
                      {s.status === 'cancelling' ? 'ends' : s.status === 'trial' ? 'trial ends' : 'renews'} {fmtDate(date)} ({daysUntil(date!, now) === 0 ? 'today' : `${daysUntil(date!, now)} d`})
                    </div>
                  </div>
                  {s.amount != null && <span className="small">{formatMoney(s.amount, s.currency, s.amount % 1 ? 2 : 0)}</span>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
