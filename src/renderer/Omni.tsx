import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppState } from '../shared/types';
import { statusLabel } from '../shared/status';
import { mailLine } from '../shared/planner';
import { ClientTile, Icon, type IconName, type Route } from './ui';
import type { ClientKey } from './ui';

interface Hit {
  group: string;
  title: string;
  sub?: string;
  client?: ClientKey;
  icon?: IconName;
  route: Route;
}

export interface Screen {
  route: Route;
  label: string;
  icon: IconName;
  client?: ClientKey;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

function search(state: AppState, screens: Screen[], q: string): Hit[] {
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  const hit = (...fields: (string | undefined)[]) => {
    const hay = norm(fields.filter(Boolean).join(' '));
    return words.every(w => hay.includes(w));
  };
  const out: Hit[] = [];
  for (const s of screens) if (hit(s.label)) out.push({ group: 'Screens', title: s.label, icon: s.icon, client: s.client, route: s.route });
  const models = state.models.filter(m => hit(m.name, m.code, m.brand, m.colour, ...(m.subcategories ?? [])));
  for (const m of models.slice(0, 8))
    out.push({
      group: 'Models',
      title: m.name,
      sub: [m.code, statusLabel(m.status, m.company)].filter(Boolean).join(' · '),
      client: m.company,
      route: m.company === 'skeidar' ? { view: 'skeidar' } : { view: 'company', company: m.company, modelId: m.id },
    });
  for (const j of state.skeidarJobs.filter(j => hit(j.name, ...j.fabrics)).slice(0, 4))
    out.push({ group: 'Skeidar jobs', title: j.name, sub: `${j.fabrics.length} fabrics × ${j.images.length} images`, client: 'skeidar', route: { view: 'skeidar', jobId: j.id } });
  for (const s of state.subscriptions.filter(s => hit(s.name, s.vendor)).slice(0, 4))
    out.push({ group: 'Subscriptions', title: s.name, sub: s.vendor, icon: 'repeat', route: { view: 'subscriptions' } });
  for (const e of state.emails.filter(e => hit(e.subject, e.fromName, e.from, e.snippet)).slice(0, 5))
    out.push({ group: 'Mail', title: mailLine(e), sub: e.fromName || e.from, icon: 'mail', route: { view: 'inbox', emailId: e.id } });
  return out;
}

/** The top-bar search: models, jobs, subscriptions, mail and screens. Ctrl K focuses it. */
export function Omni({ state, screens, onGo }: { state: AppState; screens: Screen[]; onGo(r: Route): void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const hits = useMemo(() => search(state, screens, q), [state, screens, q]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', away);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('mousedown', away);
    };
  }, []);
  useEffect(() => setAt(0), [q]);

  const pick = (h: Hit) => {
    onGo(h.route);
    setQ('');
    setOpen(false);
    input.current?.blur();
  };

  let group = '';
  return (
    <div className="omni" ref={box}>
      <div className="omni-box">
        <Icon name="search" size={16} />
        <input
          ref={input}
          value={q}
          placeholder="Search models, clients, mail…"
          aria-label="Search models, clients and mail"
          role="combobox"
          aria-expanded={open && !!q}
          aria-controls="omni-results"
          onChange={e => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              setQ('');
              setOpen(false);
              input.current?.blur();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setAt(i => Math.min(i + 1, hits.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setAt(i => Math.max(i - 1, 0));
            } else if (e.key === 'Enter' && hits[at]) pick(hits[at]);
          }}
        />
        <span className="kbd">Ctrl K</span>
      </div>
      {open && q.trim() && (
        <div className="omni-results" id="omni-results" role="listbox">
          {!hits.length && <div className="none">Nothing matches “{q.trim()}”.</div>}
          {hits.map((h, i) => {
            const head = h.group !== group;
            group = h.group;
            return (
              <div key={`${h.group}-${i}`}>
                {head && <div className="grp">{h.group}</div>}
                <button type="button" role="option" aria-selected={i === at} className={i === at ? 'on' : ''} onMouseEnter={() => setAt(i)} onClick={() => pick(h)}>
                  {h.client ? (
                    <ClientTile client={h.client} size="sm" icon={h.icon} />
                  ) : (
                    <span className="ic-tile sm" style={{ background: 'var(--fill)' }}>
                      <Icon name={h.icon ?? 'arrowRight'} size={17} />
                    </span>
                  )}
                  <span className="t">
                    <b>{h.title}</b>
                    {h.sub && <small>{h.sub}</small>}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
