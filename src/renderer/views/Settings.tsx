import { useEffect, useState, type ReactNode } from 'react';
import type { AppState, CompanyConfig, Complexity, Currency } from '../../shared/types';
import { COMPLEXITY_LABELS } from '../../shared/status';
import { ordinal } from '../../shared/money';
import { hub } from '../hub';
import { ConfirmButton, Field, Icon, fmtDate, relTime, useApp } from '../ui';

export function Settings({ state, now }: { state: AppState; now: Date }) {
  const { toast } = useApp();
  const s = state.settings;
  const g = s.google;
  const [clientId, setClientId] = useState(g.clientId);
  const [secret, setSecret] = useState(g.clientSecret);
  useEffect(() => setClientId(g.clientId), [g.clientId]);
  useEffect(() => setSecret(g.clientSecret), [g.clientSecret]);
  const [busy, setBusy] = useState(false);
  const [guide, setGuide] = useState(!g.connected);
  const [info, setInfo] = useState<{ version: string; dataDir: string } | null>(null);
  useEffect(() => {
    hub.appInfo().then(setInfo);
  }, []);

  // Kept as typed so leaving Settings doesn't lose them; while connected they only apply on Reconnect.
  const saveClient = () => {
    const google = { clientId: clientId.trim(), clientSecret: secret.trim() };
    if (!g.connected && (google.clientId !== g.clientId || google.clientSecret !== g.clientSecret)) void hub.patchSettings({ google });
  };
  const connect = async () => {
    if (!clientId.trim() || !secret.trim()) return toast('Paste the client ID and secret, or load the JSON file.', 'error');
    if (!/\.apps\.googleusercontent\.com$/.test(clientId.trim()))
      return toast('That client ID should end in .apps.googleusercontent.com. Copy it from Google Cloud → Clients, or load the downloaded JSON.', 'error');
    setBusy(true);
    toast('Your browser will open for Google sign-in…');
    const r = await hub.googleConnect(clientId, secret);
    setBusy(false);
    if (r.ok) toast(`Connected ${r.email ?? ''}. First sync is running.`);
    else toast(r.error ?? 'Could not connect', 'error');
  };
  const loadJson = async () => {
    const r = await hub.loadGoogleCredentials();
    if (!r) return;
    if ('error' in r) return toast(r.error, 'error');
    setClientId(r.clientId);
    setSecret(r.clientSecret);
    await hub.patchSettings({ google: { clientId: r.clientId, clientSecret: r.clientSecret } });
    toast('Client loaded. Now click Connect.');
  };

  return (
    <div className="page settings">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Everything is stored on this computer{info ? ` in ${info.dataDir}` : ''}.</p>
        </div>
      </header>

      <section className="card">
        <h2>Google account (Gmail, Calendar, Drive)</h2>
        <p className={g.connected ? 'ok-text' : 'muted'}>
          {g.connected ? `Connected as ${g.email ?? 'your account'}${g.lastSync ? ` · last sync ${relTime(g.lastSync, now)}` : ''}` : 'Not connected.'}
        </p>
        {g.lastError && <div className="banner warn small">{g.lastError}</div>}
        <button type="button" className="ghost" onClick={() => setGuide(!guide)}>
          {guide ? 'Hide' : 'Show'} one-time setup steps (about 10 minutes)
        </button>
        {guide && (
          <ol className="guide">
            <li>
              Open <Ext href="https://console.cloud.google.com/projectcreate">console.cloud.google.com/projectcreate</Ext>, name the project <b>Freelance Hub</b>, click Create, and make sure it is selected at the top.
            </li>
            <li>
              Turn on three APIs (open each, click <b>Enable</b>):{' '}
              <Ext href="https://console.cloud.google.com/apis/library/gmail.googleapis.com">Gmail API</Ext>,{' '}
              <Ext href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com">Google Calendar API</Ext>,{' '}
              <Ext href="https://console.cloud.google.com/apis/library/drive.googleapis.com">Google Drive API</Ext>.
            </li>
            <li>
              Open <Ext href="https://console.cloud.google.com/auth/overview">Google Auth Platform</Ext> → <b>Get started</b>. App name: Freelance Hub; support email: your Gmail;
              Audience: <b>External</b>; contact email: your Gmail. Finish.
            </li>
            <li>
              In <Ext href="https://console.cloud.google.com/auth/audience">Audience</Ext>, add <b>s.rohit.261199@gmail.com</b> as a test user, then click <b>Publish app</b> → In production. (Left in
              "Testing", Google signs you out every 7 days.)
            </li>
            <li>
              In <Ext href="https://console.cloud.google.com/auth/clients">Clients</Ext> → <b>Create client</b> → Application type <b>Desktop app</b> → Create → <b>Download JSON</b>.
            </li>
            <li>
              Click <b>Load client JSON</b> below, pick that file, then <b>Connect</b>. Your browser opens; Google will say the app isn't verified (it's your own app): click <b>Advanced → Go to Freelance
              Hub</b> and allow read-only access to Gmail, Calendar and Drive.
            </li>
          </ol>
        )}
        <div className="grid2">
          <Field label="OAuth client ID">
            <input value={clientId} onChange={e => setClientId(e.target.value)} onBlur={saveClient} placeholder="…apps.googleusercontent.com" />
          </Field>
          <Field label="OAuth client secret">
            <input type="password" value={secret} onChange={e => setSecret(e.target.value)} onBlur={saveClient} placeholder="GOCSPX-…" />
          </Field>
        </div>
        <div className="row gap wrap">
          <button type="button" onClick={loadJson}>
            Load client JSON
          </button>
          <button type="button" className="primary" onClick={connect} disabled={busy}>
            {busy ? 'Waiting for Google…' : g.connected ? 'Reconnect' : 'Connect'}
          </button>
          {g.connected && (
            <button type="button" className="ghost danger" onClick={() => hub.googleDisconnect()}>
              Disconnect
            </button>
          )}
          <Field label="Sync every">
            <select value={s.syncMinutes} onChange={e => hub.patchSettings({ syncMinutes: Number(e.target.value) })}>
              {[5, 10, 15, 30, 60].map(m => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="muted small">
          Read-only access. The app looks at mail from the client domains below, Teams notification mails, and receipts; your Calendar for 7 days back and 30 ahead; and the Waveink GLB folder on
          Drive to see which Jasani codes are uploaded. Nothing is sent anywhere else.
        </p>
      </section>

      {state.companies.map(c => (
        <CompanyEditor key={c.id} company={c} />
      ))}

      <section className="card">
        <h2>Money</h2>
        <div className="grid3">
          <Field label="Show totals in">
            <select value={s.baseCurrency} onChange={e => hub.patchSettings({ baseCurrency: e.target.value as Currency })}>
              <option>INR</option>
              <option>AED</option>
              <option>USD</option>
            </select>
          </Field>
          <Field label="1 AED in ₹">
            <NumberInput value={s.rates.AED} onSave={v => hub.patchSettings({ rates: { AED: v } })} />
          </Field>
          <Field label="1 USD in ₹">
            <NumberInput value={s.rates.USD} onSave={v => hub.patchSettings({ rates: { USD: v } })} />
          </Field>
        </div>
      </section>

      <section className="card">
        <h2>Folders and links</h2>
        <div className="grid2">
          <Field label="Skeidar project folder">
            <div className="row gap">
              <TextInput className="grow" value={s.skeidarFolder} onSave={v => hub.patchSettings({ skeidarFolder: v })} />
              <button
                type="button"
                onClick={async () => {
                  const p = await hub.pickFolder(s.skeidarFolder);
                  if (p) hub.patchSettings({ skeidarFolder: p });
                }}
              >
                Browse
              </button>
            </div>
          </Field>
          <Field label="Waveink GLB Drive folder ID" hint="From the folder link: drive.google.com/drive/folders/<ID>">
            <TextInput value={s.waveinkDriveFolderId} onSave={v => hub.patchSettings({ waveinkDriveFolderId: v.replace(/.*folders\//, '').replace(/[?#].*/, '') })} />
          </Field>
          <Field label="MetaZtech portal URL">
            <TextInput value={s.metaztechPortalUrl} onSave={v => hub.patchSettings({ metaztechPortalUrl: v })} />
          </Field>
          <Field label="Portfolio link">
            <TextInput value={s.portfolioUrl} onSave={v => hub.patchSettings({ portfolioUrl: v })} />
          </Field>
        </div>
      </section>

      <section className="card">
        <h2>App</h2>
        <div className="row gap wrap">
          <label className="check">
            <input type="checkbox" checked={s.notifications} onChange={e => hub.patchSettings({ notifications: e.target.checked })} /> Windows notifications (meetings, new client mail,
            renewals, Friday report)
          </label>
          <label className="check">
            <input type="checkbox" checked={s.launchAtStartup} onChange={e => hub.patchSettings({ launchAtStartup: e.target.checked })} /> Start with Windows
          </label>
          <Field label="Theme">
            <select value={s.theme} onChange={e => hub.patchSettings({ theme: e.target.value as AppState['settings']['theme'] })}>
              <option value="system">Match Windows</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </Field>
        </div>
        <div className="row gap wrap">
          <button
            type="button"
            onClick={async () => {
              const p = await hub.backup();
              if (p) toast(`Backup saved to ${p}`);
            }}
          >
            <Icon name="download" /> Back up data
          </button>
          <ConfirmButton
            className=""
            label="Restore backup"
            confirmLabel="Click again: this replaces everything"
            onConfirm={async () => {
              try {
                if (await hub.restore()) toast('Backup restored');
              } catch (err) {
                toast(String(err), 'error');
              }
            }}
          />
          <button type="button" onClick={() => hub.openDataFolder()}>
            <Icon name="folder" /> Open data folder
          </button>
        </div>
        <p className="muted small">
          A copy is kept automatically each day in the data folder (last 14 days). Version {info?.version} · {fmtDate(now.toISOString())}
        </p>
      </section>
    </div>
  );
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      onClick={e => {
        e.preventDefault();
        void hub.openUrl(href);
      }}
    >
      {children}
    </a>
  );
}

function TextInput({ value, onSave, className }: { value: string; onSave(v: string): void; className?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <input className={className} value={v} onChange={e => setV(e.target.value)} onBlur={() => v !== value && onSave(v.trim())} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

function NumberInput({ value, onSave }: { value: number; onSave(v: number): void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <input
      type="number"
      step="0.01"
      value={v}
      onChange={e => setV(e.target.value)}
      onBlur={() => Number(v) > 0 && Number(v) !== value && onSave(Number(v))}
      onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

const list = (s: string) =>
  s
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);

function CompanyEditor({ company: c }: { company: CompanyConfig }) {
  const save = (patch: Partial<CompanyConfig>) => hub.upsert('companies', { ...c, ...patch });
  const pay = c.pay;
  return (
    <section className="card">
      <h2>
        <span className="cdot" style={{ background: c.color }} /> {c.name}: pay and mail matching
      </h2>
      {pay.kind === 'retainer' && (
        <div className="grid3">
          <Field label={`Monthly retainer (${c.currency})`}>
            <NumberInput value={pay.amount} onSave={v => save({ pay: { ...pay, amount: v } })} />
          </Field>
          <Field label="Started">
            <input type="date" value={pay.startDate} onChange={e => save({ pay: { ...pay, startDate: e.target.value } })} />
          </Field>
          <Field label="Paid on day">
            <NumberInput value={pay.payday} onSave={v => save({ pay: { ...pay, payday: Math.min(28, Math.round(v)) } })} />
          </Field>
        </div>
      )}
      {pay.kind === 'tiered' && (
        <>
          <div className="grid3">
            {(Object.keys(COMPLEXITY_LABELS) as Complexity[]).map(k => (
              <Field key={k} label={`${COMPLEXITY_LABELS[k]} (₹)`}>
                <NumberInput value={pay.tiers[k]} onSave={v => save({ pay: { ...pay, tiers: { ...pay.tiers, [k]: v } } })} />
              </Field>
            ))}
            <Field label="TDS %">
              <NumberInput value={pay.tdsPercent} onSave={v => save({ pay: { ...pay, tdsPercent: v } })} />
            </Field>
          </div>
          <p className="muted small">
            Paid between the {ordinal(pay.payoutFrom)} and {ordinal(pay.payoutTo)} of the following month.
          </p>
        </>
      )}
      {pay.kind === 'per-item' && (
        <div className="grid3">
          <Field label={`Rate per ${pay.unit} (${c.currency})`}>
            <NumberInput value={pay.rate} onSave={v => save({ pay: { ...pay, rate: v } })} />
          </Field>
        </div>
      )}
      <div className="grid2">
        <Field label="Mail domains" hint="Comma separated">
          <TextInput value={c.match.domains.join(', ')} onSave={v => save({ match: { ...c.match, domains: list(v) } })} />
        </Field>
        <Field label="Email addresses" hint="People who write from personal addresses">
          <TextInput value={(c.match.emails ?? []).join(', ')} onSave={v => save({ match: { ...c.match, emails: list(v).map(e => e.toLowerCase()) } })} />
        </Field>
        <Field label="People (Teams / mail names)" hint="Teams notification mails are matched by sender name">
          <TextInput value={c.match.names.join(', ')} onSave={v => save({ match: { ...c.match, names: list(v) } })} />
        </Field>
        <Field label="Keywords in subject">
          <TextInput value={c.match.keywords.join(', ')} onSave={v => save({ match: { ...c.match, keywords: list(v) } })} />
        </Field>
      </div>
      <Field label="Brief / notes">
        <textarea rows={3} defaultValue={c.notes} onBlur={e => e.target.value !== c.notes && save({ notes: e.target.value })} />
      </Field>
    </section>
  );
}
