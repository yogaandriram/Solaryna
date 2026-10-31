import { Decimal as BaseDecimal } from 'decimal.js';

/**
 * Decimal used for prices and PnL. High precision so ratios of raw token amounts
 * (up to u64 and beyond) don't round, and no exponential notation in toString()
 * so values can be written to MySQL DECIMAL columns as-is.
 */
export const Decimal = BaseDecimal.clone({
  precision: 80,
  rounding: BaseDecimal.ROUND_HALF_EVEN,
  toExpNeg: -1000,
  toExpPos: 1000,
});
export type Decimal = BaseDecimal;
