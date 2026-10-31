// Layout math for the daily PnL column chart. Values here are plain numbers because they only
// position marks on screen; every amount shown as text is formatted from the bigint instead.

const MINUS = '−';
const TARGET_TICKS = 4;

export interface ColumnScale {
  step: number;
  /** Tick values, top first. */
  ticks: number[];
  /** Distance of a value from the top of the plot, in percent. */
  position(value: number): number;
}

export const lamportsToSol = (lamports: bigint): number => Number(lamports) / 1e9;

function niceStep(rough: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

/** A zero-anchored scale with clean ticks; null when every value is zero. */
export function columnScale(values: readonly number[]): ColumnScale | null {
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  if (max === min) {
    return null;
  }
  const step = niceStep((max - min) / TARGET_TICKS);
  // Integer multiples of the step keep the ticks free of accumulated float error.
  const topK = Math.ceil(max / step - 1e-9);
  const bottomK = Math.floor(min / step + 1e-9);
  const top = topK * step;
  const span = (topK - bottomK) * step;
  const ticks = Array.from({ length: topK - bottomK + 1 }, (_, i) => (topK - i) * step);
  return { step, ticks, position: (value) => ((top - value) / span) * 100 };
}

/** "0,06", "−0,02", "2.000": as many decimals as the step needs. */
export function formatSolTick(value: number, step: number): string {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
  const rounded = Number(value.toFixed(decimals));
  const text = new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: rounded === 0 ? 0 : decimals,
    maximumFractionDigits: decimals,
  }).format(Math.abs(rounded));
  return rounded < 0 ? `${MINUS}${text}` : text;
}
