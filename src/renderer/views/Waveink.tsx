import type { AppState } from '../../shared/types';
import { Models } from './Models';

export function Waveink({ state, openId, now }: { state: AppState; openId?: string; now: Date }) {
  return <Models state={state} company="waveink" openId={openId} now={now} />;
}
