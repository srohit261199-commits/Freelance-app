// Preview stand-ins for software account windows. The app signs in to the vendor's site in its own window and reads the
// plans page; the preview reads a labelled sample page instead, through the same parser.
import type { FoundPlan, VendorId } from '../shared/types';
import { parsePlansText, vendorById } from '../shared/vendors';
import type { MockCtx } from './mockAssets';

/** Sample page text in each vendor's layout. Chaos follows Rohit's real order mails; the others are made up. */
const SAMPLE_PAGES: Partial<Record<VendorId, string>> = {
  autodesk: `Autodesk Account
Products and services
Billing and orders
Subscriptions and contracts
Maya
Annual subscription · Single-user
Subscription ID 110000000000 (sample)
Renews on Mar 14, 2027
₹ 1,22,000.00 / year
Auto-renew on`,
  adobe: `Plans and payment
Photoshop
Illustrator
Your plans
Substance 3D Texturing
Free trial
Trial ends Oct 20, 2026
US$49.99/mo after the trial`,
  chaos: `My Chaos
Subscriptions
V-Ray Solo
Named · Annual
A-S02552315
Expiration date: 2027-09-28
Auto-renewal: Off`,
};

export async function accountOpen(ctx: MockCtx, id: string): Promise<void> {
  const a = ctx.state().accounts.find(x => x.id === id);
  ctx.notice(`In the app this opens ${a?.plansUrl ?? 'the vendor’s plans page'} in its own window. Sign in there once and the app remembers it.`);
}

export async function accountRead(ctx: MockCtx, id: string): Promise<{ plans: FoundPlan[]; url: string }> {
  const a = ctx.state().accounts.find(x => x.id === id);
  if (!a) throw new Error('That account is no longer in the list.');
  const page = SAMPLE_PAGES[a.vendor];
  if (!page) throw new Error(`The preview only has sample pages for Autodesk, Adobe and Chaos. In the app this reads ${a.plansUrl} after you sign in.`);
  ctx.notice(`Preview: these plans come from a sample ${vendorById(a.vendor)?.name ?? a.label} page, not your account.`);
  return { plans: parsePlansText(a.vendor, page), url: `${a.plansUrl} (sample page)` };
}
