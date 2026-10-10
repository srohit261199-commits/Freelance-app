import { useState, type CSSProperties } from 'react';
import type { AppState, CompanyConfig, CompanyId, Complexity, Currency, Expectations, PayRule } from '../../shared/types';
import { COMPLEXITY_LABELS } from '../../shared/status';
import { daysUntil, formatMoney, localDate, ordinal } from '../../shared/money';
import { DEFAULT_WORKDAYS, nextDeadlines, paceText, weekProgress, weeksIn, WEEKDAYS, type Deadline, type Target } from '../../shared/pace';
import { hub } from '../hub';
import { CLIENT_ICON, ConfirmButton, Drawer, Field, Icon, Modal, fmtDate, useApp, type IconName } from '../ui';
import { samePath } from '../../shared/assets';
import { AssetsPanel } from './AssetsPanel';
import './JobDetails.css';

/** Pastel colours for clients added by hand; they carry dark text like the built-in ones. */
export const PALETTE = ['#c7b8ff', '#8fd3e8', '#f6d365', '#ffb3b3', '#b5e48c', '#f4a7c4', '#9ad0c2', '#e0c49c'];
const BUILT_IN = new Set(['waveink', 'metaztech', 'skeidar']);
const RESERVED = new Set([...BUILT_IN, 'money', 'portfolio', 'other', 'all', 'open']);
/** Monday first. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const SHORT_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const COUNTS: [Target['counts'], string][] = [
  ['done', 'Finished (done / approved)'],
  ['submitted', 'Submitted for review'],
  ['images', 'Images made'],
];
const COUNT_HINT: Record<Target['counts'], string> = { done: 'counts finished models', submitted: 'counts models sent for review', images: 'counts images ticked off' };

export const isBuiltIn = (c: Pick<CompanyConfig, 'id' | 'builtIn'>) => !!c.builtIn || BUILT_IN.has(c.id);

/** The icon a client shows in tiles and lists: built-ins have their own, added clients a cube or a brush. */
export function clientIcon(c?: Pick<CompanyConfig, 'id' | 'workflow'>): IconName {
  if (!c) return 'cube';
  return (CLIENT_ICON as Record<string, IconName | undefined>)[c.id] ?? (c.workflow === 'variations' ? 'brush' : 'cube');
}

/** "Mon–Fri", "Mon, Wed, Fri", "Every day". */
export function daysText(days: number[]): string {
  const d = WEEK_ORDER.filter(x => days.includes(x));
  if (d.length === 7) return 'Every day';
  const idx = d.map(x => WEEK_ORDER.indexOf(x));
  const run = d.length > 2 && idx.every((v, i) => !i || v === idx[i - 1] + 1);
  return run ? `${SHORT_DAY[d[0]]}–${SHORT_DAY[d[d.length - 1]]}` : d.map(x => SHORT_DAY[x]).join(', ');
}

function payText(c: CompanyConfig): string {
  const p = c.pay;
  if (p.kind === 'retainer') return `${formatMoney(p.amount, c.currency)} a month, paid on the ${ordinal(p.payday)}`;
  if (p.kind === 'per-item') return `${formatMoney(p.rate, c.currency)} per ${p.unit}`;
  const fees = Object.values(p.tiers);
  return `${formatMoney(Math.min(...fees), c.currency)}–${formatMoney(Math.max(...fees), c.currency)} per approved model`;
}
export { payText as jobPayText };

/** A client's job details for its screen: start date, this period's pace, next deadlines and notes. */
export function JobDetails({ state, company, now, bare }: { state: AppState; company: CompanyId; now: Date; bare?: boolean }) {
  const [editing, setEditing] = useState(false);
  const cfg = state.companies.find(c => c.id === company);
  if (!cfg) return null;
  const ex = cfg.expectations ?? {};
  const pace = weekProgress(state, company, now);
  const deadlines = nextDeadlines(cfg, now, 13).slice(0, 4);
  const weeks = weeksIn(cfg, now);
  const startsIn = cfg.startDate ? daysUntil(cfg.startDate, now) : undefined;
  const ended = cfg.endDate ? daysUntil(cfg.endDate, now) < 0 : false;
  const blank = !cfg.startDate && !ex.target && !ex.deadlines?.length && !ex.notes?.trim();
  const pct = (n: number) => (pace && pace.target ? Math.min(100, Math.round((n / pace.target) * 100)) : 0);

  return (
    <section className={`jd ${bare ? 'jd-bare' : 'panel'} c-${company}`} aria-labelledby={`jd-${company}`}>
      <div className="jd-head">
        <span className="jd-ic c-soft" aria-hidden="true">
          <Icon name="calendar" size={18} weight="fill" />
        </span>
        <h2 id={`jd-${company}`}>Job details</h2>
        <button type="button" className="mini jd-edit" onClick={() => setEditing(true)}>
          <Icon name="pencil" size={14} /> Edit job details
        </button>
      </div>

      {blank ? (
        <p className="jd-blank">Add the start date, what the client expects each week and any recurring deadlines. The app uses them to decide what's urgent.</p>
      ) : (
        <>
          <ul className="jd-facts">
            {cfg.startDate && (
              <li>
                <Icon name="play" size={15} />
                <span>
                  {startsIn !== undefined && startsIn > 0 ? (
                    <>
                      Starts <b>{fmtDate(cfg.startDate)}</b> · in {startsIn} day{startsIn === 1 ? '' : 's'}
                    </>
                  ) : (
                    <>
                      Started <b>{fmtDate(cfg.startDate)}</b>
                      {weeks !== null && ` · ${weeks === 0 ? 'first week' : `${weeks} week${weeks === 1 ? '' : 's'} in`}`}
                    </>
                  )}
                </span>
              </li>
            )}
            {cfg.endDate && (
              <li>
                <Icon name="flag" size={15} />
                <span>
                  {ended ? 'Ended' : 'Ends'} <b>{fmtDate(cfg.endDate)}</b>
                </span>
              </li>
            )}
            {ex.target && (
              <li>
                <Icon name="clock" size={15} />
                <span>
                  {ex.target.count} {ex.target.unit} a {ex.target.per} · {daysText(ex.workdays?.length ? ex.workdays : DEFAULT_WORKDAYS)}
                </span>
              </li>
            )}
          </ul>

          {pace && (
            <div className="jd-pace">
              <div className="jd-pace-top">
                <span className="jd-label">{pace.per === 'day' ? 'Today' : 'This week'}</span>
                {pace.behind && pace.per === 'week' && <span className="tag warn">{pace.short} behind</span>}
                {!pace.remaining && pace.target > 0 && <span className="tag ok">Target met</span>}
                {pace.per === 'day' && !pace.workday && <span className="tag">Day off</span>}
              </div>
              <div className="jd-pace-num">
                <b className="tabular">{pace.done}</b>
                <span>
                  of {pace.target} {pace.unit}
                </span>
              </div>
              <div
                className="jd-bar"
                role="progressbar"
                aria-label={paceText(pace)}
                aria-valuemin={0}
                aria-valuemax={pace.target}
                aria-valuenow={pace.done}
                style={{ '--done': `${pct(pace.done)}%`, '--due': `${pct(pace.expected)}%` } as CSSProperties}
              >
                <span />
                {pace.per === 'week' && pace.expected > 0 && pace.expected < pace.target && <i title={`${pace.expected} expected by now`} />}
              </div>
              <small>
                {pace.per === 'week' ? `${pace.expected} expected by now · ` : ''}
                {pace.remaining ? `${pace.remaining} to go` : 'Nothing left this ' + (pace.per === 'day' ? 'day' : 'week')} · {COUNT_HINT[pace.counts]}
                {pace.approx ? ' (ticks on open jobs count as this period’s)' : ''}
              </small>
            </div>
          )}

          {deadlines.length > 0 && (
            <div className="jd-sec">
              <span className="jd-label">Next deadlines</span>
              <ul className="jd-dl">
                {deadlines.map(d => (
                  <li key={`${d.id}-${d.date}`}>
                    <span className="jd-date c-soft" aria-hidden="true">
                      <small>{SHORT_DAY[d.at.getDay()].toUpperCase()}</small>
                      <b>{d.at.getDate()}</b>
                    </span>
                    <span className="jd-dl-t">
                      <b>{d.label}</b>
                      <span>
                        {d.days === 0 ? 'Today' : d.days === 1 ? 'Tomorrow' : fmtDate(d.date)}
                        {d.time ? ` · ${d.time}` : ' · end of day'} · every {WEEKDAYS[d.at.getDay()]}
                      </span>
                    </span>
                    {d.days === 0 && <span className={`tag ${d.passed ? '' : 'bad'}`}>{d.passed ? 'Passed' : 'Today'}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {ex.notes?.trim() && (
            <div className="jd-sec">
              <span className="jd-label">Notes</span>
              <p className="jd-notes">{ex.notes}</p>
            </div>
          )}
        </>
      )}
      {editing && <JobEditor state={state} company={company} onClose={() => setEditing(false)} />}
    </section>
  );
}

/** Job details and the client's files, in a side drawer (for the Waveink and MetaZtech screens). */
export function JobDrawer({ state, company, now, onClose }: { state: AppState; company: CompanyId; now: Date; onClose(): void }) {
  const cfg = state.companies.find(c => c.id === company);
  return (
    <Drawer onClose={onClose} title="Job details" subtitle={cfg ? `${cfg.name} · ${cfg.role}` : undefined}>
      <JobDetails state={state} company={company} now={now} bare />
      <AssetsPanel state={state} company={company} />
    </Drawer>
  );
}

/* ---------- editor ---------- */

interface Draft {
  name: string;
  role: string;
  color: string;
  currency: Currency;
  payKind: PayRule['kind'];
  amount: string;
  payday: string;
  payStart: string;
  rate: string;
  unit: string;
  brief: string;
  workflow: 'models' | 'variations';
  startDate: string;
  endDate: string;
  count: string;
  per: 'day' | 'week';
  tunit: string;
  counts: Target['counts'];
  deadlines: Deadline[];
  workdays: number[];
  notes: string;
  domains: string;
  emails: string;
  names: string;
  keywords: string;
  links: { label: string; url: string }[];
  folder: string;
}

const list = (s: string) =>
  s
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
const num = (s: string) => (s.trim() === '' ? NaN : Number(s));

function draftOf(c: CompanyConfig | undefined, state: AppState, today: string): Draft {
  const taken = new Set(state.companies.map(x => x.color.toLowerCase()));
  const pay = c?.pay;
  const ex = c?.expectations;
  return {
    name: c?.name ?? '',
    role: c?.role ?? '',
    color: c?.color ?? PALETTE.find(p => !taken.has(p)) ?? PALETTE[state.companies.length % PALETTE.length],
    currency: c?.currency ?? state.settings.baseCurrency,
    payKind: pay?.kind ?? 'per-item',
    amount: pay?.kind === 'retainer' ? String(pay.amount) : '',
    payday: pay?.kind === 'retainer' ? String(pay.payday) : '1',
    payStart: pay?.kind === 'retainer' ? pay.startDate : (c?.startDate ?? today),
    rate: pay?.kind === 'per-item' ? String(pay.rate) : '',
    unit: pay?.kind === 'per-item' ? pay.unit : 'model',
    brief: c?.notes ?? '',
    workflow: c?.workflow ?? (c?.id === 'skeidar' ? 'variations' : 'models'),
    startDate: c ? (c.startDate ?? '') : today,
    endDate: c?.endDate ?? '',
    count: ex?.target ? String(ex.target.count) : '',
    per: ex?.target?.per ?? 'week',
    tunit: ex?.target?.unit ?? (c?.workflow === 'variations' ? 'images' : 'models'),
    counts: ex?.target?.counts ?? (c?.workflow === 'variations' ? 'images' : 'done'),
    deadlines: ex?.deadlines?.map(d => ({ ...d })) ?? [],
    workdays: ex?.workdays?.length ? ex.workdays : DEFAULT_WORKDAYS,
    notes: ex?.notes ?? '',
    domains: (c?.match.domains ?? []).join(', '),
    emails: (c?.match.emails ?? []).join(', '),
    names: (c?.match.names ?? []).join(', '),
    keywords: (c?.match.keywords ?? []).join(', '),
    links: c?.links.map(l => ({ ...l })) ?? [],
    folder: c?.folder ?? '',
  };
}

function newId(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'client';
  let id = base;
  for (let n = 2; taken.has(id) || RESERVED.has(id); n++) id = `${base}-${n}`;
  return id;
}

function Pills<T extends string | number>({ label, value, options, onPick }: { label: string; value: T; options: [T, string][]; onPick(v: T): void }) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="jd-pills" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={String(v)} type="button" className={value === v ? 'on' : ''} aria-pressed={value === v} onClick={() => onPick(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Edits a client's job details, pay, mail matching, links and folder; with no `company` it adds a new client. */
export function JobEditor({ state, company, onClose, onSaved }: { state: AppState; company?: CompanyId; onClose(): void; onSaved?(c: CompanyConfig): void }) {
  const { toast } = useApp();
  const existing = company ? state.companies.find(c => c.id === company) : undefined;
  const builtIn = !!existing && isBuiltIn(existing);
  const today = localDate(new Date());
  const [d, setD] = useState<Draft>(() => draftOf(existing, state, today));
  const set = (patch: Partial<Draft>) => setD(x => ({ ...x, ...patch }));
  const setRow = (i: number, patch: Partial<Deadline>) => set({ deadlines: d.deadlines.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const setLink = (i: number, patch: Partial<{ label: string; url: string }>) => set({ links: d.links.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const tiers = existing?.pay.kind === 'tiered' ? existing.pay : undefined;

  const save = async () => {
    const fail = (text: string) => toast(text, 'error');
    const name = builtIn ? existing!.name : d.name.trim();
    if (!name) return fail('Give the client a name.');
    if (!existing && state.companies.some(c => c.name.trim().toLowerCase() === name.toLowerCase())) return fail(`There is already a client called ${name}.`);
    let pay: PayRule;
    if (tiers) pay = tiers;
    else if (d.payKind === 'retainer') {
      const amount = num(d.amount);
      const payday = num(d.payday);
      if (!(amount >= 0)) return fail('Enter the monthly retainer as a number.');
      if (!(Number.isInteger(payday) && payday >= 1 && payday <= 28)) return fail('The pay day should be a day of the month from 1 to 28.');
      pay = { kind: 'retainer', amount, payday, startDate: d.payStart || d.startDate || today };
    } else {
      const rate = num(d.rate);
      if (!(rate >= 0)) return fail('Enter the rate per item as a number.');
      if (!d.unit.trim()) return fail('Say what one item is, e.g. model or image.');
      pay = { kind: 'per-item', rate, unit: d.unit.trim() };
    }
    if (d.endDate && d.startDate && d.endDate < d.startDate) return fail('The end date is before the start date.');
    let target: Target | undefined;
    if (d.count.trim()) {
      const count = num(d.count);
      if (!(Number.isInteger(count) && count >= 1)) return fail('The output target should be a whole number, or leave it empty for none.');
      if (!d.tunit.trim()) return fail('Say what the target counts, e.g. models or files.');
      target = { count, per: d.per, unit: d.tunit.trim(), counts: d.counts };
    }
    const deadlines = d.deadlines.map(x => ({ ...x, label: x.label.trim(), time: x.time?.trim() || undefined }));
    if (deadlines.some(x => !x.label)) return fail('Give every recurring deadline a name, or remove the empty row.');
    if (target && !d.workdays.length) return fail('Pick at least one working day.');
    const links = d.links.map(l => ({ label: l.label.trim(), url: l.url.trim() })).filter(l => l.label || l.url);
    if (links.some(l => !l.url)) return fail('Every link needs an address.');
    const sameDays = d.workdays.length === DEFAULT_WORKDAYS.length && DEFAULT_WORKDAYS.every(x => d.workdays.includes(x));
    const expectations: Expectations = {
      ...(target ? { target } : {}),
      ...(deadlines.length ? { deadlines } : {}),
      ...(sameDays ? {} : { workdays: [...d.workdays].sort() }),
      ...(d.notes.trim() ? { notes: d.notes.trim() } : {}),
    };
    const id = existing?.id ?? newId(name, new Set(state.companies.map(c => c.id)));
    const cfg: CompanyConfig = {
      ...(existing ?? { builtIn: false, workflow: d.workflow }),
      id,
      name,
      role: d.role.trim(),
      color: builtIn ? existing!.color : d.color,
      currency: d.currency,
      pay,
      notes: d.brief.trim(),
      match: { domains: list(d.domains).map(x => x.toLowerCase()), emails: list(d.emails).map(x => x.toLowerCase()), names: list(d.names), keywords: list(d.keywords) },
      links: links.map(l => ({ label: l.label || l.url.replace(/^https?:\/\//, '').split('/')[0], url: /^[a-z]+:/i.test(l.url) ? l.url : `https://${l.url}` })),
      startDate: d.startDate || undefined,
      endDate: d.endDate || undefined,
      expectations,
      folder: d.folder.trim() || undefined,
    };
    // A different folder starts its own first sync (see withFolder).
    cfg.folderSince = existing && samePath(existing.folder, cfg.folder) ? existing.folderSince : undefined;
    await hub.upsert('companies', { ...cfg });
    if (id === 'skeidar' && cfg.folder && cfg.folder !== state.settings.skeidarFolder) await hub.patchSettings({ skeidarFolder: cfg.folder });
    toast(existing ? `${name} saved` : `${name} added`);
    onSaved?.(cfg);
    onClose();
  };

  const archive = async (archived: boolean) => {
    if (!existing) return;
    await hub.upsert('companies', { ...existing, archived });
    toast(archived ? `${existing.name} archived. Find it in Settings & import to restore it.` : `${existing.name} restored`);
    onClose();
  };

  return (
    <Modal
      title={existing ? `${existing.name}: job details` : 'Add a client'}
      onClose={onClose}
      footer={
        <>
          {existing && !builtIn && (existing.archived ? (
            <button type="button" className="ghost" onClick={() => void archive(false)}>
              Restore client
            </button>
          ) : (
            <ConfirmButton label="Archive client" confirmLabel="Click again to archive" onConfirm={() => archive(true)} />
          ))}
          <button type="button" className="soft" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => void save()}>
            {existing ? 'Save' : 'Add client'}
          </button>
        </>
      }
    >
      <div className="jd-editor">
        {!existing && <p className="jd-lede">A client or job you work for. It gets its own screen, its own colour, and its weekly target and deadlines feed what's urgent.</p>}

        <div className="jd-row">
          {builtIn ? (
            <div className="field">
              <span>Name</span>
              <div className="jd-static">{existing!.name}</div>
            </div>
          ) : (
            <Field label="Name">
              <input autoFocus value={d.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Studio North" />
            </Field>
          )}
          <Field label="Your role">
            <input value={d.role} onChange={e => set({ role: e.target.value })} placeholder="e.g. 3D artist, contract" />
          </Field>
        </div>

        {builtIn ? (
          <div className="field">
            <span>Colour</span>
            <div className="jd-static">
              <span className={`jd-swatch on c-${existing!.id}`} aria-hidden="true" /> Fixed for {existing!.name}
            </div>
          </div>
        ) : (
          <div className="field">
            <span>Colour</span>
            <div className="jd-swatches" role="radiogroup" aria-label="Colour">
              {PALETTE.map(p => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={d.color === p}
                  aria-label={`Colour ${p}`}
                  className={`jd-swatch ${d.color === p ? 'on' : ''}`}
                  style={{ '--sw': p } as CSSProperties}
                  onClick={() => set({ color: p })}
                >
                  {d.color === p && <Icon name="check" size={14} weight="bold" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {!existing && (
          <Pills
            label="How the work comes in"
            value={d.workflow}
            onPick={workflow => set({ workflow, ...(workflow === 'variations' ? { tunit: 'images', counts: 'images', unit: d.unit === 'model' ? 'image' : d.unit } : { tunit: 'models', counts: 'done', unit: d.unit === 'image' ? 'model' : d.unit }) })}
            options={[
              ['models', 'A list of models'],
              ['variations', 'Image variations (like Skeidar)'],
            ]}
          />
        )}

        <h4 className="jd-h">Pay</h4>
        {tiers ? (
          <div className="jd-tiers">
            <dl>
              {(Object.keys(COMPLEXITY_LABELS) as Complexity[]).map(k => (
                <div key={k}>
                  <dt>{COMPLEXITY_LABELS[k]}</dt>
                  <dd>{formatMoney(tiers.tiers[k], existing!.currency)}</dd>
                </div>
              ))}
            </dl>
            <small>
              {tiers.tdsPercent}% TDS, paid between the {ordinal(tiers.payoutFrom)} and {ordinal(tiers.payoutTo)}. Fee tiers are set on the {existing!.name} card in Settings &amp; import.
            </small>
          </div>
        ) : (
          <>
            {!builtIn && (
              <Pills
                label="Paid"
                value={d.payKind}
                onPick={payKind => set({ payKind })}
                options={[
                  ['per-item', 'Per item'],
                  ['retainer', 'Monthly retainer'],
                ]}
              />
            )}
            {d.payKind === 'retainer' ? (
              <div className="jd-row three">
                <Field label="Each month">
                  <input type="number" min="0" step="1" inputMode="decimal" value={d.amount} onChange={e => set({ amount: e.target.value })} placeholder="0" />
                </Field>
                <Field label="Paid on day">
                  <input type="number" min="1" max="28" step="1" value={d.payday} onChange={e => set({ payday: e.target.value })} />
                </Field>
                <Field label="Retainer from">
                  <input type="date" value={d.payStart} onChange={e => set({ payStart: e.target.value })} />
                </Field>
              </div>
            ) : (
              <div className="jd-row">
                <Field label="Rate">
                  <input type="number" min="0" step="0.01" inputMode="decimal" value={d.rate} onChange={e => set({ rate: e.target.value })} placeholder="0" />
                </Field>
                <Field label="Per">
                  <input value={d.unit} onChange={e => set({ unit: e.target.value })} placeholder="model" />
                </Field>
              </div>
            )}
          </>
        )}
        <div className="jd-row">
          <Field label="Currency">
            <select value={d.currency} onChange={e => set({ currency: e.target.value as Currency })} disabled={!!tiers}>
              <option value="INR">₹ INR</option>
              <option value="AED">AED</option>
              <option value="USD">US$ USD</option>
            </select>
          </Field>
          <div />
        </div>

        <h4 className="jd-h">Dates</h4>
        <div className="jd-row">
          <Field label="Started on">
            <input type="date" value={d.startDate} onChange={e => set({ startDate: e.target.value })} />
          </Field>
          <Field label="Ends on" hint="Leave empty if it's ongoing">
            <input type="date" value={d.endDate} onChange={e => set({ endDate: e.target.value })} />
          </Field>
        </div>

        <h4 className="jd-h">Weekly expectations</h4>
        <div className="jd-target">
          <Field label="Output target" hint="Leave empty for none">
            <input type="number" min="1" step="1" value={d.count} onChange={e => set({ count: e.target.value })} placeholder="None" aria-label="Output target, how many" />
          </Field>
          <Field label="Of">
            <input value={d.tunit} onChange={e => set({ tunit: e.target.value })} placeholder="models" />
          </Field>
          <Pills
            label="Per"
            value={d.per}
            onPick={per => set({ per })}
            options={[
              ['day', 'Day'],
              ['week', 'Week'],
            ]}
          />
        </div>
        <Field label="What counts">
          <select value={d.counts} onChange={e => set({ counts: e.target.value as Target['counts'] })}>
            {COUNTS.map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <div className="field">
          <span>Working days</span>
          <div className="jd-pills jd-days" role="group" aria-label="Working days">
            {WEEK_ORDER.map(w => {
              const on = d.workdays.includes(w);
              return (
                <button key={w} type="button" className={on ? 'on' : ''} aria-pressed={on} aria-label={WEEKDAYS[w]} onClick={() => set({ workdays: on ? d.workdays.filter(x => x !== w) : [...d.workdays, w] })}>
                  {SHORT_DAY[w].slice(0, 2)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <span>Recurring deadlines</span>
          {d.deadlines.length > 0 && (
            <ul className="jd-rows">
              {d.deadlines.map((x, i) => (
                <li key={x.id} className="jd-dl-row">
                  <input aria-label="Deadline" value={x.label} onChange={e => setRow(i, { label: e.target.value })} placeholder="e.g. Weekly report to the lead" />
                  <select aria-label={`Day for ${x.label || 'the deadline'}`} value={x.weekday} onChange={e => setRow(i, { weekday: Number(e.target.value) })}>
                    {WEEK_ORDER.map(w => (
                      <option key={w} value={w}>
                        {WEEKDAYS[w]}
                      </option>
                    ))}
                  </select>
                  <input type="time" aria-label={`Time for ${x.label || 'the deadline'}`} value={x.time ?? ''} onChange={e => setRow(i, { time: e.target.value })} />
                  <button type="button" className="ghost icon-btn" aria-label={`Remove ${x.label || 'this deadline'}`} onClick={() => set({ deadlines: d.deadlines.filter((_, j) => j !== i) })}>
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="mini jd-add" onClick={() => set({ deadlines: [...d.deadlines, { id: `dl-${Date.now().toString(36)}`, label: '', weekday: 5, time: '18:00' }] })}>
            <Icon name="plus" size={14} /> Add a deadline
          </button>
        </div>

        <Field label="Notes" hint="What the client expects: file format, where to upload, who to report to">
          <textarea rows={3} value={d.notes} onChange={e => set({ notes: e.target.value })} />
        </Field>

        <details className="jd-more">
          <summary>
            <Icon name="caretRight" size={14} weight="bold" /> Brief, mail matching, links and folder
          </summary>
          <div className="jd-more-body">
            <Field label="Brief & pay terms">
              <textarea rows={3} value={d.brief} onChange={e => set({ brief: e.target.value })} />
            </Field>
            <div className="jd-row">
              <Field label="Mail domains" hint="Comma separated">
                <input value={d.domains} onChange={e => set({ domains: e.target.value })} placeholder="studio.com" />
              </Field>
              <Field label="Email addresses" hint="People who write from personal addresses">
                <input value={d.emails} onChange={e => set({ emails: e.target.value })} />
              </Field>
              <Field label="People" hint="Teams / mail sender names">
                <input value={d.names} onChange={e => set({ names: e.target.value })} />
              </Field>
              <Field label="Keywords in subject">
                <input value={d.keywords} onChange={e => set({ keywords: e.target.value })} />
              </Field>
            </div>
            <div className="field">
              <span>Links</span>
              {d.links.length > 0 && (
                <ul className="jd-rows">
                  {d.links.map((l, i) => (
                    <li key={i} className="jd-link-row">
                      <input aria-label="Link name" value={l.label} onChange={e => setLink(i, { label: e.target.value })} placeholder="Name" />
                      <input aria-label="Link address" value={l.url} onChange={e => setLink(i, { url: e.target.value })} placeholder="https://…" />
                      <button type="button" className="ghost icon-btn" aria-label={`Remove link ${l.label || l.url}`} onClick={() => set({ links: d.links.filter((_, j) => j !== i) })}>
                        <Icon name="trash" size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" className="mini jd-add" onClick={() => set({ links: [...d.links, { label: '', url: '' }] })}>
                <Icon name="plus" size={14} /> Add a link
              </button>
            </div>
            <div className="field">
              <span>Watched folder</span>
              <div className="jd-folder">
                <input aria-label="Watched folder" value={d.folder} onChange={e => set({ folder: e.target.value })} placeholder="Each subfolder is a job" />
                <button
                  type="button"
                  onClick={async () => {
                    const p = await hub.pickFolder(d.folder || undefined);
                    if (p) set({ folder: p });
                  }}
                >
                  <Icon name="folderOpen" size={16} /> Browse
                </button>
              </div>
            </div>
          </div>
        </details>
      </div>
    </Modal>
  );
}

/** Dialog to add a client ("job") by hand; opens its screen once it's added. */
export function AddClient({ state, onClose }: { state: AppState; onClose(): void }) {
  const { go } = useApp();
  return <JobEditor state={state} onClose={onClose} onSaved={c => go(c.workflow === 'variations' ? { view: 'skeidar', company: c.id } : { view: 'company', company: c.id })} />;
}
