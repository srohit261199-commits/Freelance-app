import { useState } from 'react';
import type { AppState } from '../../shared/types';
import { uid } from '../../shared/ops';
import { hub } from '../hub';
import { ConfirmButton, Field, Icon, Progress, fmtDate, useApp } from '../ui';

export function Portfolio({ state, now }: { state: AppState; now: Date }) {
  const { toast } = useApp();
  const [title, setTitle] = useState('');
  const [group, setGroup] = useState('Content');
  const [log, setLog] = useState('');
  const [showDone, setShowDone] = useState(false);
  const tasks = state.portfolioTasks;
  const done = tasks.filter(t => t.done).length;
  const groups = [...new Set(tasks.map(t => t.group))];

  const add = async () => {
    if (!title.trim()) return;
    await hub.upsert('portfolioTasks', { id: uid('pf'), title: title.trim(), group: group.trim() || 'Other', done: false, createdAt: new Date().toISOString() });
    setTitle('');
  };
  const addLog = async () => {
    if (!log.trim()) return;
    await hub.upsert('portfolioLog', { id: uid('log'), date: new Date().toISOString(), text: log.trim() });
    setLog('');
    toast('Logged');
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Portfolio website</h1>
          <p className="muted">
            {done}/{tasks.length} done · built in a Claude chat as an artifact
          </p>
          <Progress value={done} total={tasks.length} color="#16a34a" />
        </div>
        <div className="actions">
          <button type="button" className="primary" onClick={() => hub.openUrl(state.settings.portfolioUrl)}>
            <Icon name="external" /> Open the site
          </button>
        </div>
      </header>

      <div className="cols">
        <div className="grow">
          {groups.map(g => {
            const list = tasks.filter(t => t.group === g && (showDone || !t.done));
            if (!list.length) return null;
            return (
              <section key={g} className="card">
                <h2>{g}</h2>
                <ul className="checklist">
                  {list.map(t => (
                    <li key={t.id} className={t.done ? 'done' : ''}>
                      <label>
                        <input
                          type="checkbox"
                          checked={t.done}
                          onChange={() => hub.upsert('portfolioTasks', { ...t, done: !t.done, doneAt: !t.done ? new Date().toISOString() : undefined })}
                        />
                        <span style={{ overflowWrap: 'anywhere' }}>
                          <strong>{t.title}</strong>
                          {t.detail && <span className="muted small block">{t.detail}</span>}
                          {t.done && t.doneAt && <span className="muted small block">Done {fmtDate(t.doneAt)}</span>}
                        </span>
                      </label>
                      <ConfirmButton className="mini ghost" icon={<Trash label={`Delete ${t.title}`} />} label="" confirmLabel="Delete?" onConfirm={() => hub.remove('portfolioTasks', t.id)} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <label className="check">
            <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> Show finished items
          </label>
          <section className="card">
            <h2>Add pending work</h2>
            <div className="row gap wrap">
              <input className="grow" style={{ flexBasis: 220 }} placeholder="e.g. Add Waveink GLB viewer page" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
              <input list="pf-groups" aria-label="Group" style={{ flex: '0 1 140px' }} value={group} onChange={e => setGroup(e.target.value)} />
              <datalist id="pf-groups">
                {groups.map(g => (
                  <option key={g} value={g} />
                ))}
              </datalist>
              <button type="button" className="primary" onClick={add}>
                Add
              </button>
            </div>
          </section>
        </div>
        <aside className="side-col">
          <section className="card">
            <h2>Update log</h2>
            <p className="muted small">
              Claude chats can't be read by another app, so jot down what changed after each session (or paste Claude's summary). It keeps a dated history of the site.
            </p>
            <Field label="What changed today?">
              <textarea rows={3} value={log} onChange={e => setLog(e.target.value)} />
            </Field>
            <button type="button" className="mini primary" onClick={addLog}>
              Add to log
            </button>
            <ul className="list log">
              {[...state.portfolioLog].reverse().map(l => (
                <li key={l.id}>
                  <div style={{ overflowWrap: 'anywhere' }}>
                    <div className="muted small">{fmtDate(l.date, true)}</div>
                    <div>{l.text}</div>
                  </div>
                  <ConfirmButton className="mini ghost" icon={<Trash label="Delete log entry" />} label="" confirmLabel="Delete?" onConfirm={() => hub.remove('portfolioLog', l.id)} />
                </li>
              ))}
            </ul>
            {!state.portfolioLog.length && <p className="muted small">No entries yet ({fmtDate(now.toISOString())}).</p>}
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
      <Icon name="trash" size={13} />
    </span>
  );
}
