import { describe, expect, it } from 'vitest';
import { dailyPnlSeries } from './daily';

const TZ = 'Asia/Jakarta';
const NOW = new Date('2026-10-31T05:00:00Z'); // 12.00 WIB, 31 Okt

describe('dailyPnlSeries', () => {
  it('buckets realized PnL by WIB date, oldest first, zero-filled', () => {
    const series = dailyPnlSeries(
      [
        { at: new Date('2026-10-17T12:00:00Z'), pnlLamports: 99n }, // 17 Okt: outside 14 days
        { at: new Date('2026-10-30T16:59:00Z'), pnlLamports: -2n }, // 23.59 WIB, 30 Okt
        { at: new Date('2026-10-30T18:00:00Z'), pnlLamports: 5n }, // 01.00 WIB, 31 Okt
        { at: new Date('2026-10-31T01:00:00Z'), pnlLamports: 3n },
      ],
      NOW,
      14,
      TZ,
    );
    expect(series).toHaveLength(14);
    expect(series[0]).toEqual({ key: '2026-10-18', pnlLamports: 0n });
    expect(series.at(-2)).toEqual({ key: '2026-10-30', pnlLamports: -2n });
    expect(series.at(-1)).toEqual({ key: '2026-10-31', pnlLamports: 8n });
    expect(series.filter((day) => day.pnlLamports !== 0n)).toHaveLength(2);
  });

  it('returns only zero days without points', () => {
    const series = dailyPnlSeries([], NOW, 3, TZ);
    expect(series).toEqual([
      { key: '2026-10-29', pnlLamports: 0n },
      { key: '2026-10-30', pnlLamports: 0n },
      { key: '2026-10-31', pnlLamports: 0n },
    ]);
  });
});
