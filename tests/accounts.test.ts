import { describe, expect, it } from 'vitest';
import type { RawMail } from '../src/shared/mail';
import type { SoftwareAccount, Subscription } from '../src/shared/types';
import { initialState } from '../src/main/seed/initial';
import { applySync, ingestMail } from '../src/shared/ingest';
import type { AppState, SyncResult } from '../src/shared/types';
import { matchVendorSub, parsePlansText, parseVendorMail, planToSubscription, readDate, readMoney, vendorMailQuery, vendorOfMail } from '../src/shared/vendors';

const mail = (id: string, from: string, date: string, subject: string, body: string): RawMail => ({ id, threadId: id, from, subject, snippet: body.slice(0, 120), date, labelIds: ['INBOX'], body });

// Rohit's real Chaos mails (trimmed of tracking links).
const ORDER = mail(
  'c1',
  'Chaos <no-reply@chaos.com>',
  '2026-09-28T05:05:26Z',
  'Thanks Rohit, your order #O-06554706 is complete',
  `Hello Rohit, Thank you for choosing Chaos®. Here are your order details plus everything you need to get up and running.
Order information
Order number: O-06554706 Order date: September 28, 2026 Customer number: R8PDZZ297TTX
V-Ray Solo (named, annual)
Total quantity: 1 Expires on: September 28, 2027
Download now
To manage your products, please sign in to your Chaos account. Your login email is s.rohit.261199@gmail.com`,
);
const INVOICE = mail(
  'c2',
  'Chaos <no-reply@chaos.com>',
  '2026-09-28T18:20:31Z',
  'Your invoice #INV12441647 is ready',
  `Hello Rohit,
We wanted to let you know that your invoice INV12441647 is available:
Invoice Due Date: 09/28/2026Account Balance: 540.00 USD
Please remit payment within your payment term.
Your payment term is: Due Upon Receipt`,
);
const CANCEL = mail(
  'c3',
  'Chaos <no-reply@chaos.com>',
  '2026-09-28T19:04:16Z',
  'Your subscription A-S02552315 was canceled',
  `Auto-renewal turned off for A-S02552315 Your subscription will remain active until its expiration date
Hello Rohit, You have successfully canceled your subscription A-S02552315. This will stop it from renewing on 2027-09-28, but your licenses will remain active until then. If you change your mind, you can reactivate the subscription before it expires from your account.`,
);
const TRIAL_END = mail(
  'c4',
  'Chaos <service@email.chaos.com>',
  '2026-09-27T18:46:44Z',
  '👋 Review your Chaos subscription',
  `Your free trial ends tomorrow.
Hi Rohit,
Your Chaos® free trial ends tomorrow!
Please note that your selected subscription will renew automatically, and the payment method you have provided will be charged.`,
);
const TRIAL_START = mail('c5', 'Chaos <no-reply@chaos.com>', '2026-08-29T18:44:34Z', "Rohit, let's get you started with your V-Ray Solo Trial - 30 days", 'Everything you need to know about your trial.');
const ADOBE_PROMO = mail(
  'a1',
  'Adobe <mail@mail.adobe.com>',
  '2026-09-10T10:00:00Z',
  'Finish purchasing Adobe Creative Cloud',
  'You left Creative Cloud All Apps in your cart. Complete your purchase today and save 20% on your first year.',
);
const ADOBE_WELCOME = mail('a2', 'Adobe <mail@e.adobe.com>', '2026-09-11T10:00:00Z', 'Welcome to Creative Cloud', 'Discover what you can make with Photoshop, Illustrator and more.');

describe('readers', () => {
  it('reads dates in the formats vendor pages use', () => {
    expect(readDate('Expires on: September 28, 2027')).toBe('2027-09-28');
    expect(readDate('renews 28 Sep 2027')).toBe('2027-09-28');
    expect(readDate('28-Sep-2027')).toBe('2027-09-28');
    expect(readDate('2027-09-28')).toBe('2027-09-28');
    expect(readDate('09/28/2026')).toBe('2026-09-28');
    expect(readDate('28/09/2026')).toBe('2026-09-28');
    expect(readDate('03/04/2026', 'dmy')).toBe('2026-04-03');
    expect(readDate('Feb 30, 2027')).toBeUndefined();
  });
  it('reads prices with the currencies the app keeps', () => {
    expect(readMoney('Account Balance: 540.00 USD')).toEqual({ amount: 540, currency: 'USD' });
    expect(readMoney('₹ 1,23,456.00 / year')).toEqual({ amount: 123456, currency: 'INR' });
    expect(readMoney('US$59.99/mo')).toEqual({ amount: 59.99, currency: 'USD' });
    expect(readMoney('Rs. 4,999')).toEqual({ amount: 4999, currency: 'INR' });
    expect(readMoney('AED 3000')).toEqual({ amount: 3000, currency: 'AED' });
    // "years 2027" is not rupees, and euros aren't guessed.
    expect(readMoney('for 3 years 2027')).toBeUndefined();
    expect(readMoney('€ 59.00')).toBeUndefined();
  });
});

describe('vendor mails', () => {
  const acct: SoftwareAccount = { id: 'acc1', vendor: 'chaos', label: 'Chaos', plansUrl: 'https://my.chaos.com/', createdAt: '2026-10-01T00:00:00Z' };

  it('knows the sender, and links the account', () => {
    expect(vendorOfMail(ORDER)?.name).toBe('Chaos');
    expect(vendorOfMail(TRIAL_END, [acct])?.account?.id).toBe('acc1');
    expect(vendorOfMail({ from: 'Someone <a@example.com>' })).toBeNull();
  });

  it('reads the order: product, annual term and the date it runs to', () => {
    const s = parseVendorMail(ORDER, [acct])!;
    expect(s).toMatchObject({ name: 'V-Ray Solo', vendor: 'Chaos', cycle: 'yearly', status: 'active', nextRenewal: '2027-09-28', lastCharged: '2026-09-28', accountId: 'acc1', emailId: 'c1' });
  });

  it('reads the invoice amount without taking its due date as a renewal', () => {
    const s = parseVendorMail(INVOICE)!;
    expect(s).toMatchObject({ name: 'Chaos', amount: 540, currency: 'USD', lastCharged: '2026-09-28' });
    expect(s.nextRenewal).toBeUndefined();
  });

  it('reads auto-renew off as cancelling with access to the renewal date', () => {
    expect(parseVendorMail(CANCEL)).toMatchObject({ status: 'cancelling', endsOn: '2027-09-28' });
  });

  it('reads trials (dates are Rohit’s local days: both mails arrived just after midnight in India)', () => {
    expect(parseVendorMail(TRIAL_END)).toMatchObject({ status: 'trial', nextRenewal: '2026-09-29' });
    expect(parseVendorMail(TRIAL_START)).toMatchObject({ name: 'V-Ray Solo', status: 'trial', nextRenewal: '2026-09-29' });
  });

  it('ignores marketing even when it names a product', () => {
    expect(parseVendorMail(ADOBE_PROMO)).toBeNull();
    expect(parseVendorMail(ADOBE_WELCOME)).toBeNull();
  });

  it('builds one Gmail query over every vendor and added account', () => {
    const q = vendorMailQuery([{ ...acct, id: 'x', vendor: 'foundry', label: 'Foundry', plansUrl: 'https://www.foundry.com/account' }])!;
    expect(q).toContain('from:chaos.com');
    expect(q).toContain('from:autodesk.com');
    expect(q).toContain('from:foundry.com');
    expect(q).toContain('-category:promotions');
  });

  it('matches mails to the vendor subscription they belong to', () => {
    const vray: Subscription = { id: 's1', name: 'V-Ray Solo', vendor: 'Chaos', amount: null, currency: 'USD', cycle: 'yearly', status: 'active', category: 'work', source: 'email' };
    const claude: Subscription = { ...vray, id: 's2', name: 'Claude Pro', vendor: 'Anthropic' };
    expect(matchVendorSub([claude, vray], parseVendorMail(CANCEL)!)?.id).toBe('s1');
    expect(matchVendorSub([claude, vray], parseVendorMail(INVOICE)!)?.id).toBe('s1');
    expect(matchVendorSub([claude, vray, { ...vray, id: 's3', name: 'Chaos Vantage' }], parseVendorMail(INVOICE)!)).toBeUndefined();
    expect(matchVendorSub([claude, vray, { ...vray, id: 's3', name: 'Chaos Vantage' }], parseVendorMail(ORDER)!)?.id).toBe('s1');
  });
});

describe('plans pages', () => {
  it('reads an Autodesk subscriptions page', () => {
    const text = `Autodesk Account
Home
Products and services
Billing and orders
Subscriptions and contracts
Maya
Annual subscription · Single-user
Subscription ID 110001234567
Renews on Mar 14, 2027
₹ 1,22,000.00 / year
Auto-renew on
3ds Max
Monthly subscription
Expires Nov 2, 2026
Auto-renew off`;
    const plans = parsePlansText('autodesk', text);
    expect(plans).toHaveLength(2);
    expect(plans[0]).toMatchObject({ product: 'Maya', cycle: 'yearly', status: 'active', renews: '2027-03-14', amount: 122000, currency: 'INR' });
    expect(plans[1]).toMatchObject({ product: '3ds Max', cycle: 'monthly', status: 'cancelling', ends: '2026-11-02' });
  });

  it('reads an Adobe plans page and skips menu entries', () => {
    const text = `Plans
Photoshop
Illustrator
Lightroom
Your plans
Creative Cloud All Apps
Annual, paid monthly
US$59.99/mo
Next billing date: 11/15/2026
Substance 3D Texturing
Free trial
Trial ends Oct 20, 2026`;
    const plans = parsePlansText('adobe', text);
    expect(plans.map(p => p.product)).toEqual(['Creative Cloud All Apps', 'Substance 3D Texturing']);
    expect(plans[0]).toMatchObject({ amount: 59.99, currency: 'USD', renews: '2026-11-15', status: 'active' });
    expect(plans[1]).toMatchObject({ status: 'trial', licence: 'trial', renews: '2026-10-20' });
  });

  it('reads a Chaos page with the cancelled auto-renew', () => {
    const plans = parsePlansText('chaos', `My Chaos\nSubscriptions\nV-Ray Solo\nNamed · Annual\nA-S02552315\nExpiration date: 2027-09-28\nAuto-renewal: Off`);
    expect(plans).toEqual([expect.objectContaining({ product: 'V-Ray Solo', cycle: 'yearly', status: 'cancelling', ends: '2027-09-28' })]);
  });

  it('reads other vendors by the line above a renewal date', () => {
    const plans = parsePlansText('foundry', `Account\nNuke Indie\nRenews 12/05/2027\n£ 499`);
    expect(plans).toEqual([expect.objectContaining({ product: 'Nuke Indie', renews: '2027-05-12' })]);
    expect(plans[0].amount).toBeUndefined();
  });

  it('turns a plan into a subscription and keeps what was already entered', () => {
    const acct: SoftwareAccount = { id: 'acc2', vendor: 'autodesk', label: 'Autodesk', plansUrl: 'https://manage.autodesk.com/', createdAt: '' };
    const [maya] = parsePlansText('autodesk', 'Maya\nAnnual subscription\nRenews on Mar 14, 2027\n₹ 1,22,000.00 / year');
    expect(planToSubscription(maya, acct)).toMatchObject({ name: 'Maya', vendor: 'Autodesk', cycle: 'yearly', amount: 122000, currency: 'INR', nextRenewal: '2027-03-14', source: 'account', accountId: 'acc2' });
    const had: Subscription = { id: 's9', name: 'Maya (work PC)', vendor: 'Autodesk', amount: 120000, currency: 'INR', cycle: 'yearly', status: 'active', category: 'work', source: 'manual', paymentMethod: 'HDFC card' };
    expect(planToSubscription(maya, acct, had)).toMatchObject({ id: 's9', name: 'Maya (work PC)', amount: 122000, paymentMethod: 'HDFC card', source: 'manual', accountId: 'acc2' });
  });
});

describe('vendor mail in a sync', () => {
  const NOW = '2026-10-10T09:00:00.000Z';
  const ALL = [ADOBE_PROMO, ADOBE_WELCOME, CANCEL, INVOICE, ORDER, TRIAL_END, TRIAL_START];
  const sync = (s: AppState, raws: RawMail[]) => {
    const result: SyncResult = { ok: true, newEmails: 0, meetings: 0, driveMatches: 0, newSuggestions: 0, newPayments: 0 };
    applySync(s, ingestMail(s, raws, new Set(raws.map(r => r.id)), new Set(), NOW), [], null, Date.parse(NOW), result);
    return result;
  };

  it('turns five Chaos mails into one proposal and ignores Adobe promotions', () => {
    const s = initialState(NOW);
    s.subscriptions = s.subscriptions.filter(x => x.vendor !== 'Chaos');
    s.suggestions = [];
    expect(sync(s, ALL).newSuggestions).toBe(1);
    expect(s.suggestions[0].subscription).toMatchObject({
      name: 'V-Ray Solo',
      vendor: 'Chaos',
      amount: 540,
      currency: 'USD',
      cycle: 'yearly',
      status: 'cancelling',
      endsOn: '2027-09-28',
      lastCharged: '2026-09-28',
    });
    expect(s.suggestions[0].detail).toMatch(/^5 Chaos mails/);
    expect(s.handledEmails).toEqual(expect.arrayContaining(ALL.map(m => m.id)));
    // Nothing new next time.
    expect(sync(s, ALL).newSuggestions).toBe(0);
    expect(s.suggestions).toHaveLength(1);
  });

  it('updates the subscription already in the list instead of proposing a new one', () => {
    const s = initialState(NOW);
    s.suggestions = [];
    const before = s.subscriptions.find(x => x.vendor === 'Chaos')!;
    expect(sync(s, [ORDER, INVOICE, CANCEL]).newSuggestions).toBe(0);
    expect(s.subscriptions.find(x => x.id === before.id)).toMatchObject({ name: before.name, amount: 540, status: 'cancelling', endsOn: '2027-09-28' });
  });

  it('adds later mail to a proposal still waiting in Mail scan', () => {
    const s = initialState(NOW);
    s.subscriptions = s.subscriptions.filter(x => x.vendor !== 'Chaos');
    s.suggestions = [];
    sync(s, [ORDER]);
    expect(s.suggestions[0].subscription).toMatchObject({ name: 'V-Ray Solo', status: 'active' });
    sync(s, [INVOICE, CANCEL]);
    expect(s.suggestions).toHaveLength(1);
    expect(s.suggestions[0].subscription).toMatchObject({ name: 'V-Ray Solo', amount: 540, status: 'cancelling' });
  });
});
