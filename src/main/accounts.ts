// Software accounts (Autodesk, Adobe, Chaos…): each opens in its own window with a kept session.
import type { FoundPlan, SoftwareAccount } from '../shared/types';

export function openAccount(account: SoftwareAccount): void {
  void account;
}

/** Reads the plans from the account window's current page. */
export async function readAccount(account: SoftwareAccount): Promise<{ plans: FoundPlan[]; url: string }> {
  throw new Error(`Not implemented yet: ${account.vendor}`);
}
