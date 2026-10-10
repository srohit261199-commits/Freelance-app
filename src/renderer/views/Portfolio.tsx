import { useState } from 'react';
import type { AppState, PortfolioTask } from '../../shared/types';
import { uid } from '../../shared/ops';
import { hub } from '../hub';
import { ConfirmButton, Empty, Field, Icon, Progress, fmtDate, relTime, useApp } from '../ui';
import './Portfolio.css';

const siteLabel = (url: string) => {
  try {
    const u = new URL(url);
    return (u.host + u.pathname).replace(/\/$/, '');
  } catch {
    return url;
  }
};
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function Portfolio({ state, now }: { state: AppState; now: Date }) {
  const { toast, go } = useApp();
  const [title, setTitle] = useState('');
  const [group, setGroup] = useState('Content');
  const [log, setLog] = useState('');
  const [showDone, setShowDone] = useState(false);
  const tasks = state.portfolioTasks;
  const done = tasks.filter(t => t.done).length;
  const groups = [...new Set(tasks.map(t => t.group))];
  const openGroups = groups.filter(g => tasks.some(t => t.group === g && !t.done)).length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const url = state.settings.portfolioUrl;
  const entries = [...state.portfolioLog].reverse();
  const last = entries[0];

  const add = async () => {
    if (!title.trim()) return toast('Write what still needs doing first.', 'error');
    await hub.upsert('portfolioTasks', { id: uid('pf'), title: title.trim(), group: group.trim() || 'Other', done: false, createdAt: new Date().toISOString() });
    setTitle('');
  };
  const addLog = async () => {
    if (!log.trim()) return toast('Write what changed first.', 'error');
    await hub.upsert('portfolioLog', { id: uid('log'), date: new Date().toISOString(), text: log.trim() });
    setLog('');
    toast('Logged');
  };
  const toggle = (t: PortfolioTask) => hub.upsert('portfolioTasks', { ...t, done: !t.done, doneAt: !t.done ? new Date().toISOString() : undefined });

  return (
    <div className="page pf-page c-portfolio">
      <header className="pf-head">
        <span className="client-tile c-fill" aria-hidden="true">
          <Icon name="globe" size={30} weight="fill" />
        </span>
        <div className="pf-title">
          <h1>Portfolio</h1>
          <div className="pf-chips">
            {url ? (
              <button type="button" className="pf-chip c-soft pf-link" onClick={() => hub.openUrl(url)} title={`Open ${url}`}>
                <Icon name="link" size={14} />
                <span className="ellipsis">{siteLabel(url)}</span>
              </button>
            ) : (
              <button type="button" className="pf-chip pf-link" onClick={() => go({ view: 'settings' })}>
                <Icon name="link" size={14} /> Add the site address in Settings &amp; import
              </button>
            )}
            <span className="pf-chip">Built in a Claude chat as an artifact</span>
            {tasks.length > 0 && (
              <span className="pf-chip">
                {plural(tasks.length, 'task')} in {plural(groups.length, 'group')}
              </span>
            )}
          </div>
        </div>
        <div className="pf-actions">
          <button type="button" className="primary lg" disabled={!url} onClick={() => hub.openUrl(url)}>
            <Icon name="external" size={18} /> Open the site
          </button>
        </div>
      </header>

      <section className="kpis three pf-kpis" aria-label="Progress">
        <div className="kpi c-fill pf-kpi prog">
          <div className="kpi-top">Progress</div>
          <div className="kpi-num">{pct}%</div>
          <div className="pf-kpi-sub">
            {done} of {plural(tasks.length, 'task')} done
          </div>
          <Progress value={done} total={tasks.length} />
        </div>
        <div className="kpi pf-kpi todo">
          <div className="kpi-top">Still to do</div>
          <div className="kpi-num">{tasks.length - done}</div>
          <div className="pf-kpi-sub">{groups.length ? `across ${openGroups} of ${plural(groups.length, 'group')}` : 'Nothing listed yet'}</div>
        </div>
        <div className="kpi pf-kpi logged">
          <div className="kpi-top">Last update</div>
          <div className="kpi-num">{last ? relTime(last.date, now) : 'None yet'}</div>
          <div className="pf-kpi-sub ellipsis" title={last?.text}>
            {last ? last.text : 'Log what changed after each Claude session.'}
          </div>
        </div>
      </section>

      <div className="cols">
        <div className="grow pf-main">
          <section className="panel" aria-labelledby="pf-add-h">
            <div className="panel-head">
              <h2 id="pf-add-h">Add pending work</h2>
              {done > 0 && (
                <button type="button" className={`chip end ${showDone ? 'on' : ''}`} aria-pressed={showDone} onClick={() => setShowDone(!showDone)}>
                  Show finished <span className="n">{done}</span>
                </button>
              )}
            </div>
            <div className="pf-add">
              <input
                className="pf-add-title"
                aria-label="What still needs doing"
                placeholder="e.g. Add Waveink GLB viewer page"
                value={title}
                onChange={e => setTitle(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && add()}
              />
              <input className="pf-add-group" list="pf-groups" aria-label="Group" value={group} onChange={e => setGroup(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
              <datalist id="pf-groups">
                {groups.map(g => (
                  <option key={g} value={g} />
                ))}
              </datalist>
              <button type="button" className="primary pf-add-btn" onClick={add}>
                <Icon name="plus" size={16} /> Add
              </button>
            </div>
          </section>

          {!tasks.length && <Empty title="No portfolio work yet">Add what the site still needs above.</Empty>}
          {tasks.length > 0 && done === tasks.length && !showDone && (
            <Empty title="Everything on the list is done">Add the next thing above, or show the finished items.</Empty>
          )}
          {groups.map(g => {
            const all = tasks.filter(t => t.group === g);
            const list = all.filter(t => showDone || !t.done);
            if (!list.length) return null;
            const left = all.filter(t => !t.done).length;
            return (
              <section key={g} className="panel pf-group" aria-label={g}>
                <div className="panel-head">
                  <h2>{g}</h2>
                  <span className={`pill ${left ? 'st-neutral' : 'st-ok'}`}>{left ? `${left} to do` : 'All done'}</span>
                  <span className="pf-group-n end">
                    <span className="tabular">
                      {all.length - left}/{all.length}
                    </span>
                    <Progress value={all.length - left} total={all.length} />
                  </span>
                </div>
                <ul className="pf-tasks">
                  {list.map(t => (
                    <li key={t.id} className={`pf-task ${t.done ? 'done' : ''}`}>
                      <label className="pf-chk">
                        <input type="checkbox" checked={t.done} onChange={() => toggle(t)} aria-label={t.title} />
                        <Icon name="check" size={13} weight="bold" />
                      </label>
                      <div className="pf-task-t">
                        <span className="t">{t.title}</span>
                        {t.detail && <span className="d">{t.detail}</span>}
                        {t.done && t.doneAt && <span className="d">Done {fmtDate(t.doneAt)}</span>}
                      </div>
                      <ConfirmButton
                        className="ghost icon-btn pf-del"
                        icon={<Trash label={`Delete ${t.title}`} />}
                        label=""
                        confirmLabel="Delete?"
                        onConfirm={() => hub.remove('portfolioTasks', t.id)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <aside className="side-col">
          <section className="panel pf-logp" aria-labelledby="pf-log-h">
            <div className="panel-head">
              <h2 id="pf-log-h">Work log</h2>
              {entries.length > 0 && <span className="pill st-neutral end">{entries.length === 1 ? '1 entry' : `${entries.length} entries`}</span>}
            </div>
            <p className="pf-note">Claude chats can’t be read by another app, so jot down what changed after each session (or paste Claude’s summary). It keeps a dated history of the site.</p>
            <Field label="What changed today?">
              <textarea rows={3} value={log} onChange={e => setLog(e.target.value)} placeholder="e.g. Added the Skeidar Room Sets page" />
            </Field>
            <button type="button" className="primary pf-log-btn" onClick={addLog}>
              <Icon name="plus" size={16} /> Add to log
            </button>
            {entries.length ? (
              <ul className="pf-log">
                {entries.map(l => (
                  <li key={l.id}>
                    <span className="pf-log-dot" aria-hidden="true" />
                    <div className="pf-log-t">
                      <span className="when">{fmtDate(l.date, true)}</span>
                      <span>{l.text}</span>
                    </div>
                    <ConfirmButton className="ghost icon-btn pf-del" icon={<Trash label="Delete log entry" />} label="" confirmLabel="Delete?" onConfirm={() => hub.remove('portfolioLog', l.id)} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pf-none">No entries yet.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

/** Trash icon that names the button it sits in (ConfirmButton takes no aria-label). */
function Trash({ label }: { label: string }) {
  return (
    <span className="row" role="img" aria-label={label} title={label}>
      <Icon name="trash" size={16} />
    </span>
  );
}
