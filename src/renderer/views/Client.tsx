import type { AppState, CompanyId } from '../../shared/types';

/** Screen for a client added by hand that works with a list of models. */
export function Client({ state, company, openId, now }: { state: AppState; company: CompanyId; openId?: string; now: Date }) {
  void openId;
  void now;
  const cfg = state.companies.find(c => c.id === company);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{cfg?.name ?? 'Client'}</h1>
        </div>
      </div>
    </div>
  );
}
