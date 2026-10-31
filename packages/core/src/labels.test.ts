import { describe, expect, it } from 'vitest';
import { describeRiskReason, tradeReasonLabel } from './labels';

const TZ = 'Asia/Jakarta';

describe('describeRiskReason', () => {
  it('explains reasons in Indonesian with their numbers, as plain text', () => {
    expect(
      describeRiskReason(
        { code: 'liquidity_below_min', detail: { actual: '12300', min: '20000' } },
        TZ,
      ),
    ).toBe('likuiditas $12.300 < $20.000');
    expect(
      describeRiskReason(
        { code: 'liquidity_below_min', detail: { actual: null, min: '20000' } },
        TZ,
      ),
    ).toBe('likuiditas tidak diketahui (min $20.000)');
    expect(
      describeRiskReason(
        { code: 'signal_too_old', detail: { ageSeconds: 45, maxSeconds: 30 } },
        TZ,
      ),
    ).toBe('sinyal terlambat 45 dtk (maks 30)');
    expect(describeRiskReason({ code: 'liquidity_below_min' }, TZ)).toBe(
      'likuiditas di bawah minimum',
    );
    expect(
      describeRiskReason(
        {
          code: 'daily_loss_limit',
          detail: { realizedLamports: '-250000000', limitLamports: '200000000' },
        },
        TZ,
      ),
    ).toBe('batas rugi harian tercapai (-0,25 SOL, batas -0,2 SOL)');
  });
});

describe('tradeReasonLabel', () => {
  it('labels trade and close reasons, falling back to the raw value', () => {
    expect(tradeReasonLabel('follow_sell')).toBe('ikut jual');
    expect(tradeReasonLabel('stop_loss')).toBe('stop-loss');
    expect(tradeReasonLabel('manual')).toBe('manual');
    expect(tradeReasonLabel('something_new')).toBe('something_new');
  });
});
