import type { AppState, CompanyId } from '../../shared/types';

/** A client's job details: start date, weekly target, recurring deadlines and notes, with an editor. */
export function JobDetails({ state, company, now }: { state: AppState; company: CompanyId; now: Date }) {
  void state;
  void company;
  void now;
  return null;
}

/** Dialog to add a client ("job") by hand. */
export function AddClient({ state, onClose }: { state: AppState; onClose(): void }) {
  void state;
  void onClose;
  return null;
}
