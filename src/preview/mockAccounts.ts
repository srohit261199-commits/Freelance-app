// Preview stand-ins for software account windows (the app signs in to the vendor's site in its own window).
import type { FoundPlan } from '../shared/types';
import type { MockCtx } from './mockAssets';

export async function accountOpen(ctx: MockCtx, id: string): Promise<void> {
  void id;
  ctx.notice('In the app this opens the vendor’s plans page in its own window, where you sign in once.');
}

export async function accountRead(ctx: MockCtx, id: string): Promise<{ plans: FoundPlan[]; url: string }> {
  void ctx;
  throw new Error(`No sample plans for ${id}`);
}
