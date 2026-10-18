import { useId, type CSSProperties } from 'react';
import type { AppState, CompanyConfig, Model } from '../../shared/types';
import { isComplete } from '../../shared/status';
import { formatMoney, localDate, tierFee } from '../../shared/money';
import { paceFor, weekProgress, type Target } from '../../shared/pace';
import { Icon } from '../ui';

/** Ritu's ask on Teams: 1–2 files a day. Used when MetaZtech's job details have no output target. */
export const DAILY_TARGET = 2;
const FALLBACK: Target = { count: DAILY_TARGET, per: 'day', unit: 'files', counts: 'submitted' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** "Today 9:12", "Yesterday", "8 Oct" (with the year when it isn't this year). */
export function when(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = localDate(d);
  if (day === localDate(now)) return `Today ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (day === localDate(y)) return 'Yesterday';
  return `${d.getDate()} ${MON[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

/** A pick-one row in a MenuButton menu (project, sort). Like MenuCheck, the menu stays open, so a filter and a sort can be set in one go. */
export function MenuRadio({ label, checked, onPick }: { label: string; checked: boolean; onPick(): void }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} onClick={onPick}>
      <span className="grow">{label}</span>
      <span className="mk">{checked && <Icon name="check" size={14} />}</span>
    </button>
  );
}

/** Work counted today (or this week) against the output target in MetaZtech's job details: a small ring and one line of advice. */
export function DailyTarget({ state, now }: { state: AppState; now: Date }) {
  const id = useId();
  const cfg = state.companies.find(c => c.id === 'metaztech')!;
  const p = weekProgress(state, 'metaztech', now) ?? paceFor(state, cfg, FALLBACK, now);
  const rejected = state.models.filter(m => m.company === 'metaztech' && m.status === 'revision').length;
  const day = p.per === 'day';
  const goal = day && p.target === 2 && p.counts === 'submitted' ? `1–2 ${p.unit} a day` : `${p.target} ${p.unit} a ${p.per}`;
  const verb = p.counts === 'submitted' ? 'Submit' : 'Finish';
  const met = p.done >= p.target;
  const fix = rejected === 1 ? 'Fix the rejection first, it counts toward review.' : `Fix the ${NUM[rejected] ?? rejected} rejections first, they count toward review.`;
  const text = met
    ? `Target met ${day ? 'for today' : 'for the week'}.${rejected ? ` ${rejected === 1 ? 'One rejection is' : `${rejected} rejections are`} still waiting.` : ` Anything more is a head start on ${day ? 'tomorrow' : 'next week'}.`}`
    : day && !p.workday
      ? `Not a working day. ${verb} ${goal}; anything sent today is a head start.`
      : `${verb} ${goal}. ${rejected ? fix : p.behind && !day ? `${p.short} behind where the week should be.` : `${p.target - p.done} more to reach ${day ? "today's" : "this week's"} target.`}`;
  // A small nub at zero marks where the ring starts filling.
  const fill = p.done ? Math.min(100, Math.round((p.done / Math.max(1, p.target)) * 100)) : 4;
  const label = `${p.unit[0].toUpperCase()}${p.unit.slice(1)} ${p.counts === 'submitted' ? 'submitted' : p.counts === 'images' ? 'made' : 'finished'} ${day ? 'today' : 'this week'}`;
  return (
    <section className="mz-target" aria-labelledby={id}>
      <div className="mz-ring" style={{ '--p': `${fill}%` } as CSSProperties} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={p.target} aria-valuenow={p.done}>
        <b className="tabular">
          {p.done}/{p.target}
        </b>
      </div>
      <div className="mz-target-txt">
        <h3 id={id}>{day ? 'Daily target' : 'Weekly target'}</h3>
        <p>{text}</p>
      </div>
    </section>
  );
}

/** The pay rule's tiers, what approved work adds up to, and approved models still missing a complexity. */
export function FeeTiers({ cfg, all, onShowApproved }: { cfg: CompanyConfig; all: Model[]; onShowApproved(): void }) {
  const id = useId();
  if (cfg.pay.kind !== 'tiered') return null;
  const t = cfg.pay.tiers;
  const cur = cfg.currency;
  const approved = all.filter(m => isComplete(m.status));
  const total = approved.reduce((s, m) => s + tierFee(cfg, m.complexity), 0);
  const unpriced = approved.filter(m => !m.complexity).length;
  const tiers: [string, number][] = [
    ['Simple, medium, retexture', t.simple],
    ['Complex', t.complex],
    ['Super complex', t.super],
    ['Super complex-1', t.super1],
    ['Super complex-2+', t.super2],
  ];
  return (
    <section className="mz-fees" aria-labelledby={id}>
      <h3 id={id}>Fee tiers</h3>
      <dl className="mz-tiers">
        {tiers.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{formatMoney(v, cur)}</dd>
          </div>
        ))}
      </dl>
      {approved.length > 0 && (
        <p className="mz-earned">
          <span>
            {approved.length} approved, before {cfg.pay.tdsPercent}% TDS
          </span>
          <b className="tabular">{formatMoney(total, cur)}</b>
        </p>
      )}
      {unpriced > 0 && (
        <p className="mz-note">
          {unpriced} approved model{unpriced > 1 ? 's have' : ' has'} no complexity and {unpriced > 1 ? 'are' : 'is'} counted at the {formatMoney(tierFee(cfg, undefined), cur)} tier.{' '}
          <button type="button" className="link-btn mz-link" onClick={onShowApproved}>
            Set {unpriced > 1 ? 'them' : 'it'}
          </button>
        </p>
      )}
    </section>
  );
}
