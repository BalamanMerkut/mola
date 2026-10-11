import { money } from './api';
import { commissionExample, HIGH_COMMISSION_BPS, parseCommissionRate, rateText } from '../packages/domain/commission';

/** Under a POS rate box: what the rate means on ₺100 ("%2,5 · ₺100 kart satışında ₺2,50"), a word when it is unusually high. */
export function CommissionHint({ text }: { text: string }) {
  const bps = parseCommissionRate(text);
  if (bps === null || !Number.isFinite(bps)) return null;
  return <small className="muted commission-hint" data-testid="commission-hint">%{rateText(bps)} · {commissionExample(bps, money)}{bps > HIGH_COMMISSION_BPS ? ' Bu oran yüksek görünüyor; bankanızın gün sonu fişinden kontrol edin.' : ''}</small>;
}
