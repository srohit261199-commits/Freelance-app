import { describe, expect, it } from 'vitest';
import { initialState } from '../src/main/seed/initial';
import { companyEarnings, rollRenewal } from '../src/shared/money';
import { attentionMail, dailyLog, nextActions } from '../src/shared/planner';
import { applyStatus, importPortalRows, type PortalRow } from '../src/shared/ops';
import { catalogStatusText, mapComplexity, mapPortalStatus, normaliseCode, setStatus } from '../src/shared/status';
import { classify, meetingFromInviteSubject, parseIcs, parseSubscription, parseWaveinkSalary, teamsSenders, type RawMail } from '../src/shared/mail';
import type { AppState } from '../src/shared/types';

const NOW = '2026-10-09T10:00:00.000Z';
const fresh = (): AppState => initialState(NOW);

describe('seed', () => {
  it('folds the 284 catalog rows into 199 Tech models and adds the apparel PDF', () => {
    const s = fresh();
    const tech = s.models.filter(m => m.group === 'Tech');
    const apparel = s.models.filter(m => m.group === 'Apparel');
    expect(tech).toHaveLength(199);
    expect(tech.reduce((n, m) => n + (m.rows?.length ?? 0), 0)).toBe(284);
    expect(tech.filter(m => m.status === 'done')).toHaveLength(57);
    expect(tech.find(m => m.code === 'ITGL 1272')?.status).toBe('skipped');
    expect(apparel.length).toBeGreaterThan(30);
    expect(new Set(s.models.map(m => m.id)).size).toBe(s.models.length);
  });
});

describe('status', () => {
  it('records history, start and completion', () => {
    const m = fresh().models.find(x => x.status === 'todo')!;
    const a = setStatus(m, 'in_progress', '2026-10-09T08:00:00Z');
    const b = setStatus(a, 'done', '2026-10-09T12:00:00Z');
    expect(b.history.map(h => h.to)).toEqual(['in_progress', 'done']);
    expect(b.startedAt).toBe('2026-10-09T08:00:00Z');
    expect(b.completedAt).toBe('2026-10-09T12:00:00Z');
    expect(b.percent).toBe(100);
    expect(setStatus(b, 'revision', '2026-10-10T00:00:00Z').completedAt).toBeUndefined();
  });

  it('counts MetaZtech rejections', () => {
    const s = fresh();
    importPortalRows(s, [{ name: 'Chair', status: 'review', raw: {} }], NOW);
    const id = s.models.find(m => m.name === 'Chair')!.id;
    applyStatus(s, [id], 'revision', NOW);
    expect(s.models.find(m => m.id === id)!.revisions).toBe(1);
  });

  it('maps portal words', () => {
    expect(mapPortalStatus('Rejected')).toBe('revision');
    expect(mapPortalStatus('Pending Approval')).toBe('review');
    expect(mapPortalStatus('Submitted for QC')).toBe('review');
    expect(mapPortalStatus('Approved')).toBe('done');
    expect(mapPortalStatus('On Hold')).toBe('on_hold');
    expect(mapPortalStatus('WIP')).toBe('in_progress');
    expect(mapPortalStatus('Assigned')).toBe('todo');
    expect(mapComplexity('Super Complex-2')).toBe('super2');
    expect(mapComplexity('Super Complex 1')).toBe('super1');
    expect(mapComplexity('Super Complex')).toBe('super');
    expect(mapComplexity('Complex')).toBe('complex');
    expect(mapComplexity('Retexture')).toBe('simple');
  });

  it('writes the catalog wording back', () => {
    const s = fresh();
    expect(catalogStatusText(s.models.find(m => m.revised)!)).toBe('done (R)');
    expect(normaliseCode('itwc_1203.glb')).toBe('ITWC 1203');
  });
});

describe('money', () => {
  it('Waveink: September earned and paid, October accruing', () => {
    const e = companyEarnings(fresh(), 'waveink', new Date(NOW));
    expect(e.earned).toBe(3000);
    expect(e.received).toBe(3000);
    expect(e.outstanding).toBe(0);
    expect(e.thisMonth).toBe(3000);
    expect(e.overdue).toBeUndefined();
  });

  it('Waveink: flags October salary once November 4th passes without a payment', () => {
    const e = companyEarnings(fresh(), 'waveink', new Date('2026-11-06T10:00:00Z'));
    expect(e.outstanding).toBe(3000);
    expect(e.overdue?.month).toBe('2026-10');
  });

  it('MetaZtech: tier fees minus 1% TDS, due by the 10th of next month', () => {
    const s = fresh();
    const rows: PortalRow[] = [
      { code: 'A1', name: 'Sofa', status: 'done', complexity: 'complex', raw: {} },
      { code: 'A2', name: 'Lamp', status: 'done', complexity: 'super2', raw: {} },
      { code: 'A3', name: 'Desk', status: 'review', complexity: 'simple', raw: {} },
    ];
    importPortalRows(s, rows, '2026-10-05T10:00:00Z');
    const e = companyEarnings(s, 'metaztech', new Date(NOW));
    expect(e.months).toHaveLength(1);
    expect(e.months[0].gross).toBe(3600);
    expect(e.months[0].net).toBeCloseTo(3564);
    expect(e.months[0].due).toBe('2026-11-10');
    expect(e.pipeline).toBeCloseTo(891);
  });

  it('Skeidar: 5 AED per finished image', () => {
    const s = fresh();
    s.skeidarJobs.push({ id: 'j', name: 'Sofa', receivedAt: '2026-10-08', images: ['A', 'B'], fabrics: ['Linen', 'Velvet', 'Boucle'], done: { '0:0': true, '0:1': true, '1:0': true }, status: 'open', createdAt: NOW });
    const e = companyEarnings(s, 'skeidar', new Date(NOW));
    expect(e.earned).toBe(15);
    expect(e.pipeline).toBe(15);
  });

  it('rolls renewal dates forward', () => {
    const sub = fresh().subscriptions.find(s => s.name.startsWith('Google AI'))!;
    expect(rollRenewal({ ...sub, nextRenewal: '2026-09-09' }, new Date(NOW))).toBe('2026-10-09');
    expect(rollRenewal({ ...sub, nextRenewal: '2026-01-31' }, new Date(NOW))).toBe('2026-10-31');
  });
});

describe('portal import', () => {
  it('adds once, then updates by code', () => {
    const s = fresh();
    const first = importPortalRows(s, [{ code: 'MZ-7', name: 'Office chair', status: 'todo', complexity: 'complex', raw: {} }], NOW);
    expect(first.added).toBe(1);
    const again = importPortalRows(s, [{ code: 'mz-7', name: 'Office chair v2', status: 'revision', statusText: 'Rejected', raw: {} }], NOW);
    expect(again).toEqual({ added: 0, updated: 1, unchanged: 0 });
    const m = s.models.find(x => x.code === 'MZ-7')!;
    expect(m.status).toBe('revision');
    expect(m.complexity).toBe('complex');
  });
});

const mail = (over: Partial<RawMail>): RawMail => ({ id: 'm1', threadId: 't1', from: '', subject: '', snippet: '', date: NOW, labelIds: ['UNREAD'], ...over });

describe('mail', () => {
  const companies = fresh().companies;
  it('sorts mail and Teams notifications into companies', () => {
    expect(classify(mail({ from: 'Sibi Iype <sibi@waveink.ae>' }), companies)).toBe('waveink');
    expect(classify(mail({ from: 'Sharon (PM) <sharon_pm@metaztech.ai>' }), companies)).toBe('metaztech');
    expect(classify(mail({ from: 'Microsoft Teams <no-reply@teams.mail.microsoft>', subject: 'Ritu Agrawal sent a message' }), companies)).toBe('metaztech');
    expect(classify(mail({ from: 'x@shine.com', subject: 'Recruiter viewed your profile' }), companies)).toBe('other');
    expect(teamsSenders('Ritu Agrawal and Dheeraj Ganesh Gowda sent 2 messages to your chat')).toEqual(['Ritu Agrawal', 'Dheeraj Ganesh Gowda']);
  });

  it('reads the Waveink salary mail', () => {
    const p = parseWaveinkSalary(
      mail({ id: 'x', subject: 'Salary Transfer Reference – Rohit - September 2026', snippet: 'Transfer reference: 33TF068381319 Kindly confirm' }),
      3000,
    );
    expect(p).toMatchObject({ amount: 3000, currency: 'AED', period: '2026-09', reference: '33TF068381319' });
  });

  it('reads Google Play, Stripe and cancellation receipts', () => {
    const play = parseSubscription(
      mail({
        from: 'Google Play <googleplay-noreply@google.com>',
        subject: 'Your Google Play Order Receipt from 6 Oct 2026',
        date: '2026-10-06T10:41:56Z',
        body: 'Your subscription from Anthropic, PBC on Google Play has renewed.\nItem Price\n\nClaude Pro Subscription (Claude by Anthropic) ₹1,999.00/month\n\nPayment method:\n\nUPI: GPay\n',
      }),
    );
    expect(play).toMatchObject({ name: 'Claude Pro Subscription', amount: 1999, currency: 'INR', cycle: 'monthly', nextRenewal: '2026-11-06', paymentMethod: 'UPI: GPay' });
    const tripo = parseSubscription(mail({ from: 'Link <notifications@link.com>', subject: 'Your Tripo AI receipt', body: 'Tripo AI\n₹1,986.60\nManage subscription' }));
    expect(tripo).toMatchObject({ name: 'Tripo AI', amount: 1986.6, currency: 'INR' });
    const chaos = parseSubscription(mail({ from: 'no-reply@chaos.com', subject: 'Your invoice #INV12441647 is ready', body: 'Invoice Due Date: 09/28/2026Account Balance: 540.00 USD\n' }));
    expect(chaos).toMatchObject({ amount: 540, currency: 'USD' });
    const cancel = parseSubscription(
      mail({ from: 'googleplay-noreply@google.com', subject: 'Your ChatGPT subscription will be cancelled', body: 'Your ChatGPT subscription from OpenAI OpCo, LLC on Google Play will be cancelled on 9 Nov 2026.' }),
    );
    expect(cancel).toMatchObject({ status: 'cancelling', endsOn: '2026-11-09' });
  });

  it('reads invites from ICS and from Google invite subjects', () => {
    const ics = parseIcs('BEGIN:VEVENT\r\nSUMMARY:Production Pipeline Training\r\nDTSTART;TZID=India Standard Time:20260922T150000\r\nDTEND;TZID=India Standard Time:20260922T160000\r\nDESCRIPTION:Join: https://teams.microsoft.com/meet/296237542693771?p=abc\r\nEND:VEVENT');
    expect(ics?.title).toBe('Production Pipeline Training');
    expect(new Date(ics!.start).toISOString()).toBe('2026-09-22T09:30:00.000Z');
    expect(ics?.joinUrl).toContain('teams.microsoft.com/meet/');
    const m = meetingFromInviteSubject(
      mail({ subject: 'Invitation: Kickoff call @ Tue Sep 1, 2026 7:30pm - 8:30pm (GMT+5:30) (s.rohit.261199@gmail.com)', body: 'https://meet.google.com/emh-yjnj-xmi' }),
      'waveink',
    );
    expect(m?.start).toBe('2026-09-01T14:00:00.000Z');
    expect(m?.joinUrl).toBe('https://meet.google.com/emh-yjnj-xmi');
  });
});

describe('planner', () => {
  it('puts rejections, meetings and Friday reporting first', () => {
    const s = fresh();
    importPortalRows(s, [{ code: 'R1', name: 'Bed frame', status: 'revision', raw: {} }], NOW);
    s.meetings.push({ id: 'm', company: 'waveink', title: 'Review call', start: '2026-10-09T13:00:00Z', source: 'calendar' });
    const friday = new Date('2026-10-09T09:00:00Z');
    const acts = nextActions(s, friday);
    const titles = acts.filter(a => a.priority === 1).map(a => a.title);
    expect(titles.some(t => t.startsWith('Fix rejection: Bed frame'))).toBe(true);
    expect(titles.some(t => t.includes('Review call'))).toBe(true);
    expect(titles.some(t => /daily update log/i.test(t))).toBe(true);
    expect(acts.some(a => a.title.startsWith('Next Waveink model'))).toBe(true);
  });

  it('builds the Waveink daily log from status changes', () => {
    const s = fresh();
    const ids = s.models.filter(m => m.status === 'todo' && m.group === 'Tech').slice(0, 2).map(m => m.id);
    applyStatus(s, ids, 'in_progress', '2026-10-09T05:00:00Z');
    applyStatus(s, [ids[0]], 'review', '2026-10-09T09:00:00Z', 'GLB uploaded');
    const log = dailyLog(s.models, 'waveink');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ started: 2, inReview: 1, completed: 0 });
    expect(log[0].notes).toContain('GLB uploaded');
  });

  it('only flags recent client mail that asks for something', () => {
    const s = fresh();
    s.emails = [
      { id: 'a', threadId: 'a', company: 'metaztech', from: 'x', fromName: 'Ritu', subject: 'please work on rejections', snippet: '', date: '2026-10-08T15:00:00Z', unread: true, url: '', kind: 'teams', attention: ['rejections'] },
      { id: 'b', threadId: 'b', company: 'other', from: 'x', fromName: 'Shine', subject: 'urgent', snippet: '', date: '2026-10-08T15:00:00Z', unread: true, url: '', kind: 'mail', attention: ['urgent'] },
      { id: 'c', threadId: 'c', company: 'waveink', from: 'x', fromName: 'Sibi', subject: 'please confirm', snippet: '', date: '2026-09-01T15:00:00Z', unread: false, url: '', kind: 'mail', attention: ['please'] },
    ];
    expect(attentionMail(s.emails, new Date(NOW)).map(e => e.id)).toEqual(['a']);
  });
});

describe('excel export', () => {
  it('rebuilds the catalog in its original 284-row order with statuses', async () => {
    const { buildWorkbook } = await import('../src/main/exporter');
    const s = fresh();
    const id = s.models.find(m => m.code === 'ITCC 701')!.id;
    applyStatus(s, [id], 'in_progress', NOW);
    const wb = await buildWorkbook(s, 'all');
    expect(wb.worksheets.map(w => w.name)).toEqual([
      'Tech catalog (updated)',
      'GLB Task Tracker',
      'Daily Update Log',
      'MetaZtech models',
      'Skeidar jobs',
      'Earnings summary',
      'Payments received',
      'Subscriptions',
    ]);
    const cat = wb.getWorksheet('Tech catalog (updated)')!;
    expect(cat.rowCount).toBe(285);
    expect(cat.getRow(2).getCell(2).value).toBe('ITCC 701');
    expect(cat.getRow(2).getCell(4).value).toBe('in progress');
    expect(cat.getRow(3).getCell(4).value).toBe('done (R)');
    expect(cat.getRow(4).getCell(4).value).toBe('done');
    expect(wb.getWorksheet('Daily Update Log')!.rowCount).toBe(2);
  });
});

describe('subscription matching', () => {
  it('matches renewal receipts to the right existing plan', async () => {
    const { findSubscription } = await import('../src/shared/ingest');
    const subs = fresh().subscriptions;
    const pick = (name: string, vendor: string) => findSubscription(subs, { name, vendor })?.name;
    expect(pick('Google AI Pro (5 TB) (Google One)', 'Google Ireland')).toBe('Google AI Pro (5 TB)');
    expect(pick('Claude Pro Subscription', 'Anthropic')).toBe('Claude Pro');
    expect(pick('LinkedIn: Job Search & Network', 'LinkedIn')).toBe('LinkedIn Premium');
    expect(pick('Tripo AI', 'Tripo AI')).toBe('Tripo AI Starter (annual)');
    expect(pick('Substance 3D Painter', 'Adobe')).toBeUndefined();
  });
});

describe('calendar', () => {
  it('files the Waveink Weekly Demo under Waveink even though it comes from personal Gmail addresses', async () => {
    const { calendarMeetings } = await import('../src/shared/ingest');
    const [m] = calendarMeetings(
      [
        {
          id: 'wd',
          summary: 'Weekly Demo',
          start: { dateTime: '2026-10-14T19:30:00+05:30' },
          end: { dateTime: '2026-10-14T20:30:00+05:30' },
          organizer: { email: 'danial.aftab.01@gmail.com' },
          attendees: [{ email: 'sibiabin92@gmail.com' }, { email: 's.rohit.261199@gmail.com' }],
          conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/emh-yjnj-xmi' }] },
        },
      ],
      fresh(),
    );
    expect(m).toMatchObject({ company: 'waveink', start: '2026-10-14T14:00:00.000Z', joinUrl: 'https://meet.google.com/emh-yjnj-xmi' });
  });
});
