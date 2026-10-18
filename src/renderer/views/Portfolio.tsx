import { useState } from 'react';
import type { AppState, PortfolioTask } from '../../shared/types';
import { uid } from '../../shared/ops';
import { hub } from '../hub';
import { ConfirmButton, Empty, Icon, PageHead, Progress, fmtDate, relTime, useApp } from '../ui';
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
      <PageHead
        title="Portfolio"
        icon="globe"
        meta={
          <>
            <span>
              {url ? (
                <button type="button" className="link-btn" onClick={() => hub.openUrl(url)} title={`Open ${url}`}>
                  <Icon name="link" size={14} />
                  {siteLabel(url)}
                </button>
              ) : (
                <button type="button" className="link-btn" onClick={() => go({ view: 'settings' })}>
                  <Icon name="link" size={14} /> Add the site address in Settings &amp; import
                </button>
              )}
            </span>
            <span>Built in a Claude chat as an artifact</span>
            {tasks.length > 0 && <span>{`${tasks.length - done} to do across ${openGroups} of ${plural(groups.length, 'group')}`}</span>}
          </>
        }
      >
        <button type="button" className="primary" disabled={!url} onClick={() => hub.openUrl(url)}>
          <Icon name="external" /> Open the site
        </button>
      </PageHead>

      <div className="cols">
        <section className="panel grow" aria-labelledby="pf-tasks-h">
          <div className="panel-head pf-tasks-head">
            <h2 id="pf-tasks-h">Pending work</h2>
            {tasks.length > 0 && (
              <span className="pf-prog">
                <span className="tabular">
                  {pct}% · {done} of {plural(tasks.length, 'task')} done
                </span>
                <Progress value={done} total={tasks.length} />
              </span>
            )}
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
              placeholder="Add pending work, e.g. Add Waveink GLB viewer page"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && add()}
            />
            <input className="pf-add-group" list="pf-groups" aria-label="Group" title="Group" value={group} onChange={e => setGroup(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
            <datalist id="pf-groups">
              {groups.map(g => (
                <option key={g} value={g} />
              ))}
            </datalist>
            <button type="button" onClick={add}>
              <Icon name="plus" /> Add
            </button>
          </div>

          {!tasks.length && <Empty title="No portfolio work yet">Add what the site still needs above.</Empty>}
          {tasks.length > 0 && done === tasks.length && !showDone && <Empty title="Everything on the list is done">Add the next thing above, or show the finished items.</Empty>}
          {groups.map((g, gi) => {
            const all = tasks.filter(t => t.group === g);
            const list = all.filter(t => showDone || !t.done);
            if (!list.length) return null;
            const left = all.filter(t => !t.done).length;
            return (
              <section key={g} className="pf-group" aria-labelledby={`pf-g-${gi}`}>
                <div className="pf-group-head">
                  <h3 id={`pf-g-${gi}`}>{g}</h3>
                  {left ? <span className="muted small">{left} to do</span> : <span className="pill st-ok">All done</span>}
                  <span className="pf-group-n end tabular">
                    {all.length - left}/{all.length}
                  </span>
                </div>
                <ul className="pf-tasks">
                  {list.map(t => (
                    <li key={t.id} className={`pf-task ${t.done ? 'done' : ''}`}>
                      <label className="pf-chk">
                        <input type="checkbox" checked={t.done} onChange={() => toggle(t)} aria-label={t.title} />
                        <Icon name="check" size={12} weight="bold" />
                      </label>
                      <div className="pf-task-t">
                        <span className="t">{t.title}</span>
                        {t.detail && <span className="d">{t.detail}</span>}
                        {t.done && t.doneAt && <span className="d">Done {fmtDate(t.doneAt)}</span>}
                      </div>
                      <ConfirmButton className="ghost icon-btn mini pf-del" icon={<Trash label={`Delete ${t.title}`} />} label="" confirmLabel="Delete?" onConfirm={() => hub.remove('portfolioTasks', t.id)} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </section>

        <aside className="side-col">
          <section className="panel" aria-labelledby="pf-log-h">
            <div className="panel-head">
              <h2 id="pf-log-h">Work log</h2>
              {last && (
                <span className="muted small end" title={last.text}>
                  {entries.length === 1 ? '1 entry' : `${entries.length} entries`} · last {relTime(last.date, now)}
                </span>
              )}
            </div>
            <p className="pf-note">Claude chats can’t be read by another app, so note what changed after each session (or paste Claude’s summary) to keep a dated history of the site.</p>
            <textarea rows={2} aria-label="What changed today?" value={log} onChange={e => setLog(e.target.value)} placeholder="What changed today? e.g. Added the Skeidar Room Sets page" />
            <button type="button" className="pf-log-btn" onClick={addLog}>
              <Icon name="plus" /> Add to log
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
                    <ConfirmButton className="ghost icon-btn mini pf-del" icon={<Trash label="Delete log entry" />} label="" confirmLabel="Delete?" onConfirm={() => hub.remove('portfolioLog', l.id)} />
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
      <Icon name="trash" size={15} />
    </span>
  );
}
