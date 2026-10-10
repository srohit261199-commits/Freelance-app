import { describe, expect, it } from 'vitest';
import { initialState } from '../src/main/seed/initial';
import { nextActions } from '../src/shared/planner';
import { applyStatus, importPortalRows } from '../src/shared/ops';
import { allDeadlines, deadlineDates, nextDeadlines, paceText, weekProgress, weeksIn } from '../src/shared/pace';
import { jobPriority, modelPriority } from '../src/renderer/priority';
import type { AppState, CompanyConfig, Model, StatusEvent } from '../src/shared/types';

// Tests run in Asia/Kolkata; 2026-10-05 is a Monday.
const at = (local: string) => new Date(`${local}+05:30`);
const fresh = (): AppState => initialState('2026-10-01T04:00:00.000Z');

function acme(over: Partial<CompanyConfig> = {}): CompanyConfig {
  return {
    id: 'acme',
    name: 'Acme',
    role: '3D artist',
    color: '#c7b8ff',
    currency: 'USD',
    pay: { kind: 'per-item', rate: 40, unit: 'model' },
    match: { domains: [], names: [], keywords: [] },
    links: [],
    notes: '',
    workflow: 'models',
    startDate: '2026-09-01',
    expectations: {
      target: { count: 10, per: 'week', unit: 'models', counts: 'done' },
      deadlines: [{ id: 'call', label: 'Weekly review call', weekday: 5, time: '16:00' }],
    },
    ...over,
  };
}

function model(id: string, status: Model['status'], history: [string, Model['status'] | null, Model['status']][] = []): Model {
  return {
    id,
    company: 'acme',
    name: `Chair ${id}`,
    status,
    source: 'manual',
    history: history.map(([when, from, to]): StatusEvent => ({ at: at(when).toISOString(), from, to })),
    createdAt: '2026-09-20T04:00:00.000Z',
    updatedAt: '2026-09-20T04:00:00.000Z',
  };
}

function withAcme(over: Partial<CompanyConfig> = {}, models: Model[] = []): AppState {
  const s = fresh();
  // The seed's client list is shared between calls; add to a copy.
  s.companies = [...s.companies, acme(over)];
  s.models.push(...models);
  return s;
}

describe('pace', () => {
  it('MetaZtech: 2 files a day, counted as submitted on the local day', () => {
    const s = fresh();
    importPortalRows(
      s,
      [
        { code: 'A1', name: 'Sofa', status: 'in_progress', raw: {} },
        { code: 'A2', name: 'Lamp', status: 'in_progress', raw: {} },
        { code: 'A3', name: 'Desk', status: 'in_progress', raw: {} },
      ],
      '2026-10-01T04:00:00Z',
    );
    const [a, b, c] = s.models.filter(m => m.company === 'metaztech').map(m => m.id);
    applyStatus(s, [a], 'review', at('2026-10-08T23:30:00').toISOString()); // Thursday night: yesterday
    applyStatus(s, [b], 'review', at('2026-10-09T00:30:00').toISOString()); // Friday just after midnight (still Thursday in UTC)
    applyStatus(s, [b], 'done', at('2026-10-09T09:00:00').toISOString()); // approved the same day still counts as submitted
    const fri = weekProgress(s, 'metaztech', at('2026-10-09T15:00:00'))!;
    expect(fri).toMatchObject({ per: 'day', from: '2026-10-09', done: 1, target: 2, expected: 2, behind: true, remaining: 1, workday: true });
    expect(paceText(fri)).toBe('1 of 2 files today');

    applyStatus(s, [c], 'review', at('2026-10-09T16:00:00').toISOString());
    const met = weekProgress(s, 'metaztech', at('2026-10-09T17:00:00'))!;
    expect(met).toMatchObject({ done: 2, behind: false, remaining: 0 });
    expect(paceText(met)).toBe('2 of 2 files today · target met');

    // Saturday is not a working day: nothing expected.
    const sat = weekProgress(s, 'metaztech', at('2026-10-10T11:00:00'))!;
    expect(sat).toMatchObject({ done: 0, expected: 0, behind: false, workday: false });
    expect(paceText(sat)).toBe('Day off · 0 files today');
  });

  it('paces a weekly target over the working days before today', () => {
    const s = withAcme({}, [
      model('1', 'done', [['2026-10-02T12:00:00', 'in_progress', 'done']]), // last Friday
      model('2', 'done', [['2026-10-05T12:00:00', 'in_progress', 'done']]), // Monday
      model('3', 'live', [['2026-10-06T12:00:00', 'in_progress', 'done'], ['2026-10-06T13:00:00', 'done', 'live']]), // done then live: once
      model('4', 'review', [['2026-10-06T14:00:00', 'in_progress', 'review']]),
    ]);
    const wed = weekProgress(s, 'acme', at('2026-10-07T12:00:00'))!;
    expect(wed).toMatchObject({ per: 'week', from: '2026-10-05', to: '2026-10-11', done: 2, target: 10, expected: 4, short: 2, behind: true, remaining: 8 });
    expect(paceText(wed)).toBe('2 of 10 models this week · 2 behind');
    // Monday morning: today is still yours.
    expect(weekProgress(s, 'acme', at('2026-10-05T09:00:00'))).toMatchObject({ expected: 0, behind: false });
    // Saturday: all five working days have passed.
    expect(weekProgress(s, 'acme', at('2026-10-10T09:00:00'))).toMatchObject({ expected: 10, short: 8 });
  });

  it('scales the weekly target in the week the job starts, and has none when archived or unset', () => {
    const s = withAcme({ startDate: '2026-10-07' });
    expect(weekProgress(s, 'acme', at('2026-10-08T12:00:00'))).toMatchObject({ target: 6, expected: 2 });
    expect(weekProgress(withAcme({ archived: true }), 'acme', at('2026-10-08T12:00:00'))).toBeNull();
    expect(weekProgress(fresh(), 'waveink', at('2026-10-08T12:00:00'))).toBeNull();
    expect(weeksIn({ startDate: '2026-09-01' }, at('2026-10-10T12:00:00'))).toBe(5);
    expect(weeksIn({ startDate: '2026-11-01' }, at('2026-10-10T12:00:00'))).toBeNull();
  });

  it('counts images ticked on open jobs and on jobs delivered this period', () => {
    const s = withAcme({ workflow: 'variations', expectations: { target: { count: 20, per: 'week', unit: 'images', counts: 'images' } } });
    const job = { name: 'Stol', receivedAt: '2026-10-01', images: ['Front', 'Back'], fabrics: ['A', 'B', 'C'], createdAt: '2026-10-01T04:00:00Z', company: 'acme' };
    s.skeidarJobs.push(
      { ...job, id: 'j1', done: { '0:0': true, '0:1': true, '1:0': true }, status: 'open' },
      { ...job, id: 'j2', done: { '0:0': true, '1:1': true }, status: 'delivered', deliveredAt: at('2026-10-06T10:00:00').toISOString() },
      { ...job, id: 'j3', done: { '0:0': true }, status: 'delivered', deliveredAt: at('2026-10-02T10:00:00').toISOString() },
      { ...job, id: 'j4', company: undefined, done: { '0:0': true }, status: 'open' },
    );
    expect(weekProgress(s, 'acme', at('2026-10-07T12:00:00'))).toMatchObject({ done: 5, approx: true });
  });
});

describe('recurring deadlines', () => {
  const cfg = acme({
    expectations: {
      deadlines: [
        { id: 'mon', label: 'Monday handoff', weekday: 1, time: '10:00' },
        { id: 'fri', label: 'Friday report', weekday: 5, time: '18:00' },
        { id: 'sun', label: 'Sunday upload', weekday: 0 },
      ],
    },
  });

  it('finds the next occurrence across the week boundary', () => {
    const sat = nextDeadlines(cfg, at('2026-10-10T11:00:00'), 7);
    expect(sat.map(d => [d.id, d.date, d.days])).toEqual([
      ['sun', '2026-10-11', 1],
      ['mon', '2026-10-12', 2],
      ['fri', '2026-10-16', 6],
    ]);
    expect(sat[1].at.getHours()).toBe(10);
    expect(sat[0].time).toBeUndefined();
    expect(sat[0].at.getHours()).toBe(23);
  });

  it("keeps today's deadline listed once its time has gone, marked passed", () => {
    const fri = nextDeadlines(cfg, at('2026-10-09T19:00:00'), 3);
    expect(fri[0]).toMatchObject({ id: 'fri', date: '2026-10-09', days: 0, passed: true });
    expect(nextDeadlines(cfg, at('2026-10-09T17:00:00'), 0)).toMatchObject([{ id: 'fri', passed: false }]);
  });

  it('skips days outside the job and archived clients', () => {
    expect(deadlineDates({ ...cfg, startDate: '2026-10-13' }, '2026-10-10', '2026-10-17').map(d => d.date)).toEqual(['2026-10-16']);
    expect(deadlineDates({ ...cfg, endDate: '2026-10-11' }, '2026-10-10', '2026-10-17').map(d => d.date)).toEqual(['2026-10-11']);
    expect(deadlineDates({ ...cfg, archived: true }, '2026-10-10', '2026-10-17')).toEqual([]);
  });

  it("reads the built-in Waveink deadlines from the seed", () => {
    const list = allDeadlines(fresh(), at('2026-10-10T11:00:00'), 7);
    expect(list.map(d => `${d.company}:${d.id}:${d.date}`)).toEqual(['waveink:wi-demo:2026-10-14', 'waveink:wi-report:2026-10-16']);
  });
});

describe('planner with job details', () => {
  const titles = (s: AppState, now: Date) => nextActions(s, now).map(a => `${a.priority} ${a.title}`);

  it('flags an added client that is behind pace, and its deadline today', () => {
    const s = withAcme({}, [model('1', 'todo'), model('2', 'in_progress', [['2026-10-05T10:00:00', 'todo', 'in_progress']])]);
    const fri = nextActions(s, at('2026-10-09T09:00:00'));
    expect(fri.find(a => a.id === 'pace-acme-2026-10-05')).toMatchObject({ priority: 2, company: 'acme', title: 'Behind pace on Acme: 0 of 10 models this week', target: { view: 'company', company: 'acme' } });
    expect(fri.find(a => a.id === 'dl-acme-call-2026-10-09')).toMatchObject({ priority: 1, title: 'Weekly review call · today 16:00', detail: 'Every Friday at 16:00' });
    expect(fri.find(a => a.id === 'cont-2')).toMatchObject({ priority: 2, company: 'acme' });
    // Behind pace moves the next model up from the queue.
    expect(fri.find(a => a.id === 'next-1')).toMatchObject({ priority: 2, title: 'Start: Chair 1' });
    const thu = nextActions(s, at('2026-10-08T09:00:00'));
    expect(thu.find(a => a.id === 'dl-acme-call-2026-10-09')).toMatchObject({ priority: 2, title: 'Weekly review call · tomorrow 16:00' });
    // A calendar meeting at the same time already has its own row.
    s.meetings.push({ id: 'm1', company: 'acme', title: 'Acme review call', start: at('2026-10-09T16:00:00').toISOString(), source: 'calendar' });
    expect(nextActions(s, at('2026-10-09T09:00:00')).some(a => a.id.startsWith('dl-acme-'))).toBe(false);
  });

  it('lists added clients’ revisions first and a start date coming up, and ignores archived clients', () => {
    const s = withAcme({ startDate: '2026-10-09' }, [model('r', 'revision')]);
    const acts = nextActions(s, at('2026-10-09T09:00:00'));
    expect(acts.find(a => a.id === 'fix-r')).toMatchObject({ priority: 1, title: 'Fix revision: Chair r', company: 'acme' });
    expect(acts.find(a => a.id === 'start-acme-2026-10-09')).toMatchObject({ priority: 1, title: 'Acme starts today' });
    expect(nextActions(withAcme({ startDate: '2026-10-12' }), at('2026-10-09T09:00:00')).find(a => a.id.startsWith('start-acme'))?.title).toBe('Acme starts in 3 days');

    const gone = withAcme({ archived: true }, [model('r', 'revision'), model('p', 'in_progress'), model('t', 'todo')]);
    expect(nextActions(gone, at('2026-10-09T09:00:00')).some(a => a.company === 'acme')).toBe(false);
  });

  it('keeps the built-in wording: Friday report, MetaZtech daily target', () => {
    const s = fresh();
    importPortalRows(s, [{ code: 'Q1', name: 'Bed', status: 'todo', raw: {} }], '2026-10-01T04:00:00Z');
    expect(titles(s, at('2026-10-09T10:00:00'))).toEqual(
      expect.arrayContaining(['1 Send the Waveink daily update log to Sibi today (Friday EOD)', '2 MetaZtech daily target: submit 1–2 files (0 today)']),
    );
    expect(titles(s, at('2026-10-08T10:00:00'))).toContain('2 Waveink update log is due tomorrow (Friday EOD)');
    const fri = nextActions(s, at('2026-10-09T10:00:00'));
    expect(fri.find(a => a.title.startsWith('Send the Waveink'))?.detail).toBe('Export Excel on the Waveink page builds the Daily Update Log sheet from your status changes.');
    expect(fri.find(a => a.title.startsWith('MetaZtech daily target'))?.detail).toBe('Ritu asked for 1–2 files per day if you skip weekends.');
    // The Wednesday demo shows as a deadline until the calendar brings in the meeting.
    expect(titles(s, at('2026-10-14T10:00:00'))).toContain('1 Weekly Demo on Google Meet · today 19:30');
    s.meetings.push({ id: 'demo', company: 'waveink', title: 'Weekly Demo', start: at('2026-10-14T19:30:00').toISOString(), source: 'calendar' });
    expect(titles(s, at('2026-10-14T10:00:00')).some(t => t.includes('Weekly Demo on Google Meet'))).toBe(false);
    // No Waveink reminder mid-week, and no MetaZtech target once two files went in.
    expect(titles(s, at('2026-10-06T10:00:00')).some(t => /update log/i.test(t))).toBe(false);
  });
});

describe('priority from job details', () => {
  it('raises the next model while behind and in-progress work on a deadline day', () => {
    const s = withAcme({}, [model('1', 'todo'), model('2', 'in_progress'), model('3', 'review')]);
    const get = (id: string) => s.models.find(m => m.id === id)!;
    const wed = at('2026-10-07T09:00:00');
    expect(modelPriority(get('1'), s, wed)).toBe('high');
    expect(modelPriority(get('3'), s, wed)).toBe('normal');
    const fri = at('2026-10-09T09:00:00');
    expect(modelPriority(get('2'), s, fri)).toBe('urgent');
    expect(modelPriority(get('3'), s, fri)).toBe('urgent');
    // Not behind on Monday morning, no deadline: the queue as before.
    const mon = at('2026-10-05T09:00:00');
    expect(modelPriority(get('1'), s, mon)).toBe('normal');
    expect(modelPriority(get('2'), s, mon)).toBe('high');
  });

  it('raises an open variation job on its client’s deadline day', () => {
    const s = withAcme({ workflow: 'variations', expectations: { deadlines: [{ id: 'd', label: 'Delivery', weekday: 5 }] } });
    const job = { id: 'j', company: 'acme', name: 'Stol', receivedAt: '2026-10-08', images: ['A'], fabrics: ['x', 'y'], done: {}, status: 'open' as const, createdAt: '2026-10-08T04:00:00Z' };
    expect(jobPriority(job, at('2026-10-09T09:00:00'))).toBe('high');
    expect(jobPriority(job, at('2026-10-09T09:00:00'), s)).toBe('urgent');
    expect(jobPriority(job, at('2026-10-08T09:00:00'), s)).toBe('high');
  });
});
