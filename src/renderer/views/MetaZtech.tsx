import type { AppState } from '../../shared/types';
import { Models } from './Models';

export function MetaZtech({ state, openId, now }: { state: AppState; openId?: string; now: Date }) {
  return <Models state={state} company="metaztech" openId={openId} now={now} />;
}
