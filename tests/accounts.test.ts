import { describe, expect, it } from 'vitest';
import type { SoftwareAccount, Subscription } from '../src/shared/types';
import { matchVendorSub, parsePlansText, planToSubscription, readCycle, readDate, readMoney, siteOf } from '../src/shared/vendors';

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

  it('matches a plan to the vendor subscription it belongs to', () => {
    const vray: Subscription = { id: 's1', name: 'V-Ray Solo', vendor: 'Chaos', amount: null, currency: 'USD', cycle: 'yearly', status: 'active', category: 'work', source: 'manual' };
    const claude: Subscription = { ...vray, id: 's2', name: 'Claude Pro', vendor: 'Anthropic' };
    const vantage: Subscription = { ...vray, id: 's3', name: 'Chaos Vantage' };
    expect(matchVendorSub([claude, vray], { product: 'V-Ray Solo', vendor: 'Chaos' })?.id).toBe('s1');
    // A plan that names no product matches only the vendor's one live subscription.
    expect(matchVendorSub([claude, vray], { vendor: 'Chaos' })?.id).toBe('s1');
    expect(matchVendorSub([claude, vray, vantage], { vendor: 'Chaos' })).toBeUndefined();
    expect(matchVendorSub([claude, vray, vantage], { product: 'V-Ray Solo', vendor: 'Chaos' })?.id).toBe('s1');
  });
});

describe('fixes from review', () => {
  const sub = (id: string, name: string, vendor: string, extra: Partial<Subscription> = {}): Subscription => ({ id, name, vendor, amount: null, currency: 'USD', cycle: 'yearly', status: 'active', category: 'work', source: 'manual', ...extra });

  it('bills "Annual, paid monthly" monthly', () => {
    expect(readCycle('Annual, paid monthly\nUS$59.99/mo')).toBe('monthly');
    expect(readCycle('Annual plan, billed annually ₹ 23,000')).toBe('yearly');
    expect(readCycle('Annual subscription\n₹ 1,22,000.00 / year')).toBe('yearly');
    expect(parsePlansText('adobe', 'Creative Cloud All Apps\nAnnual, paid monthly\nUS$59.99/mo')[0].cycle).toBe('monthly');
  });

  it('does not start a plan at a product named inside a description', () => {
    const adobe = parsePlansText('adobe', 'Creative Cloud All Apps\n20+ apps including Photoshop, Illustrator and more\nUS$59.99/mo\nNext billing date: 11/15/2026');
    expect(adobe.map(p => p.product)).toEqual(['Creative Cloud All Apps']);
    expect(adobe[0]).toMatchObject({ amount: 59.99, renews: '2026-11-15' });
    const adsk = parsePlansText('autodesk', 'Media & Entertainment Collection\nIncludes Maya, 3ds Max, Arnold\n₹ 3,10,000 / year\nRenews on Jan 5, 2027');
    expect(adsk.map(p => p.product)).toEqual(['Media & Entertainment Collection']);
    expect(parsePlansText('autodesk', 'Autodesk Maya 2026\nAnnual subscription\nRenews on Mar 14, 2027')[0].product).toBe('Maya');
  });

  it('does not match plans on edition words alone', () => {
    const subs = [sub('a', 'Maya Indie', 'Autodesk'), sub('b', 'Creative Cloud Pro', 'Adobe'), sub('c', 'V-Ray Solo', 'Chaos')];
    expect(matchVendorSub(subs, { product: '3ds Max Indie', vendor: 'Autodesk' })).toBeUndefined();
    expect(matchVendorSub(subs, { product: 'Acrobat Pro', vendor: 'Adobe' })).toBeUndefined();
    expect(matchVendorSub(subs, { product: 'Corona Solo', vendor: 'Chaos' })).toBeUndefined();
    expect(matchVendorSub(subs, { product: 'Maya', vendor: 'Autodesk' })?.id).toBe('a');
    expect(matchVendorSub(subs, { product: 'Creative Cloud Pro', vendor: 'Adobe' })?.id).toBe('b');
  });

  it('reads an added vendor’s site from its plans page, keeping shared hosts whole', () => {
    expect(siteOf('https://portal.foundry.co.in/plans')).toBe('foundry.co.in');
    expect(siteOf('https://manage.autodesk.com/billing')).toBe('autodesk.com');
    expect(siteOf('https://someone.github.io/plans')).toBe('someone.github.io');
    expect(siteOf('https://www.foundry.com/account')).toBe('foundry.com');
  });

  it('reads the renewal date below an "Auto-renewal: On" line', () => {
    expect(parsePlansText('chaos', 'V-Ray Solo\nNamed · Annual\nAuto-renewal: On\nRenewal date: 2027-09-28')[0]).toMatchObject({ status: 'active', renews: '2027-09-28' });
  });

  it('drops the trial licence once the plan is paid', () => {
    const acct: SoftwareAccount = { id: 'a', vendor: 'chaos', label: 'Chaos', plansUrl: 'https://my.chaos.com/', createdAt: '' };
    const [p] = parsePlansText('chaos', 'V-Ray Solo\nAnnual\nRenewal date: 2027-09-28');
    expect(planToSubscription(p, acct, sub('x', 'V-Ray Solo', 'Chaos', { status: 'trial', licence: 'trial' })).licence).toBeUndefined();
  });
});
