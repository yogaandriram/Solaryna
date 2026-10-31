import { describe, expect, it } from 'vitest';
import { Decimal } from '../decimal';
import { evaluateExit } from './exits';

const openedAt = new Date('2026-10-31T00:00:00Z');
const minutesLater = (minutes: number) => new Date(openedAt.getTime() + minutes * 60_000);
const base = {
  remainingCostLamports: 50_000_000n,
  openedAt,
  takeProfitPct: new Decimal(100),
  stopLossPct: new Decimal(30),
  maxHoldMinutes: 240,
};

describe('evaluateExit', () => {
  it('takes profit at cost x (1 + TP%)', () => {
    expect(evaluateExit({ ...base, netValueLamports: 100_000_000n, now: minutesLater(5) })).toBe(
      'take_profit',
    );
    expect(
      evaluateExit({ ...base, netValueLamports: 99_999_999n, now: minutesLater(5) }),
    ).toBeNull();
  });

  it('stops the loss at cost x (1 - SL%)', () => {
    expect(evaluateExit({ ...base, netValueLamports: 35_000_000n, now: minutesLater(5) })).toBe(
      'stop_loss',
    );
    expect(
      evaluateExit({ ...base, netValueLamports: 35_000_001n, now: minutesLater(5) }),
    ).toBeNull();
  });

  it('exits after the max hold time', () => {
    expect(evaluateExit({ ...base, netValueLamports: 60_000_000n, now: minutesLater(240) })).toBe(
      'max_hold',
    );
    expect(
      evaluateExit({ ...base, netValueLamports: 60_000_000n, now: minutesLater(239) }),
    ).toBeNull();
  });

  it('keeps an unpriced position until max hold, then marks it unsellable', () => {
    expect(evaluateExit({ ...base, netValueLamports: null, now: minutesLater(10) })).toBeNull();
    expect(evaluateExit({ ...base, netValueLamports: null, now: minutesLater(241) })).toBe(
      'unsellable',
    );
  });
});
