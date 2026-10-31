import {
  Decimal,
  WSOL_MINT,
  escapeHtml,
  formatAmount,
  formatDateTime,
  shortAddress,
  type DailySummary,
  type Decomposition,
  type PeriodRange,
  type ReportPosition,
  type RiskReason,
  type SwapEvent,
  type SwapSide,
  type TradeReason,
  type TradingMode,
  type WeeklyReport,
} from '@solaryna/core';
import type { PositionRow } from '@solaryna/db';
import type { SignalOutcome } from '../engine/engine';
import { pendingBuyFeesLamports } from '../engine/sell';
import type { TradeFill } from '../executor/types';
import type { Valuation } from '../exits/monitor';
import type { TokenLabel } from '../tokens/token-info';
import type { TrackedWalletInfo } from '../wallets/registry';
import { formatWallet } from './format';
import { TELEGRAM_MESSAGE_LIMIT } from './commands';

// Telegram HTML for paper trading: decisions, trades, positions and reports. All text that
// comes from on-chain data or the database is escaped. PnL is shown as is, after fees.

const LOCALE = 'id-ID';
const DISCLAIMER = '<i>Hasil simulasi, bukan saran investasi.</i>';

const sol = (lamports: bigint) => `${formatAmount(lamports, 9, 4)} SOL`;
const signedSol = (lamports: bigint) => `${lamports > 0n ? '+' : ''}${sol(lamports)}`;

function number(value: string | number, fractionDigits = 0): string {
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: fractionDigits }).format(
    String(value) as Intl.StringNumericLiteral,
  );
}

function percent(value: Decimal, signed = false): string {
  const text = number(value.toDecimalPlaces(1).toFixed(1), 1);
  return `${signed && value.gt(0) ? '+' : ''}${text}%`;
}

const usd = (value: string) => `$${number(value)}`;

function tokenTitle(token: TokenLabel, mint: string): string {
  return token.symbol === null
    ? `<code>${escapeHtml(shortAddress(mint))}</code>`
    : `<b>${escapeHtml(token.symbol)}</b>`;
}

function dateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

const modeLabel = (mode: TradingMode) => (mode === 'paper' ? 'Paper' : 'Live');

const TRADE_REASON_LABELS: Record<TradeReason, string> = {
  copy_buy: 'ikut beli',
  follow_sell: 'ikut jual',
  take_profit: 'take-profit',
  stop_loss: 'stop-loss',
  max_hold: 'batas waktu hold',
  unsellable: 'tidak bisa dijual (dihapusbukukan, nilai 0)',
};

const reasonLabel = (reason: string) =>
  reason in TRADE_REASON_LABELS
    ? TRADE_REASON_LABELS[reason as TradeReason]
    : reason === 'manual'
      ? 'manual'
      : reason;

/** One reason in Indonesian, HTML-escaped; works without `detail` (for report counts). */
export function describeRiskReason(reason: RiskReason, timeZone: string): string {
  const d = reason.detail ?? {};
  const text = (key: string) => {
    const value = d[key];
    return value === undefined || value === null ? null : String(value);
  };
  let message: string;
  switch (reason.code) {
    case 'trading_paused':
      message = 'trading dijeda';
      break;
    case 'max_open_positions':
      message =
        text('open') === null
          ? 'posisi terbuka penuh'
          : `posisi terbuka penuh (${text('open')}/${text('max')})`;
      break;
    case 'already_holding':
      message = 'token sudah dipegang';
      break;
    case 'daily_loss_limit': {
      const realized = text('realizedLamports');
      const limit = text('limitLamports');
      message =
        realized === null || limit === null
          ? 'batas rugi harian tercapai'
          : `batas rugi harian tercapai (${sol(BigInt(realized))}, batas -${sol(BigInt(limit))})`;
      break;
    }
    case 'token_data_unavailable':
      message = 'data token tidak tersedia';
      break;
    case 'liquidity_below_min': {
      const min = text('min');
      const actual = text('actual');
      if (min === null) {
        message = 'likuiditas di bawah minimum';
      } else if (actual === null) {
        message = `likuiditas tidak diketahui (min ${usd(min)})`;
      } else {
        message = `likuiditas ${usd(actual)} < ${usd(min)}`;
      }
      break;
    }
    case 'mint_authority_active':
      message = 'mint authority masih aktif';
      break;
    case 'freeze_authority_active':
      message = 'freeze authority masih aktif';
      break;
    case 'token_flagged_suspicious':
      message = 'token ditandai mencurigakan oleh Jupiter';
      break;
    case 'token_blacklisted':
      message = 'token di blacklist';
      break;
    case 'wallet_cooldown': {
      const until = text('until');
      message =
        until === null
          ? 'wallet sedang cooldown'
          : `wallet cooldown sampai ${formatDateTime(new Date(until), timeZone)}`;
      break;
    }
    case 'signal_too_old':
      message =
        text('ageSeconds') === null
          ? 'sinyal terlambat'
          : `sinyal terlambat ${text('ageSeconds')} dtk (maks ${text('maxSeconds')})`;
      break;
    case 'price_impact_too_high':
      message =
        text('actualPct') === null
          ? 'price impact terlalu tinggi'
          : `price impact ${number(text('actualPct') ?? '0', 2)}% (maks ${number(text('maxPct') ?? '0', 2)}%)`;
      break;
    case 'no_route':
      message = 'tidak ada rute swap';
      break;
    case 'quote_failed':
      message = 'quote Jupiter gagal';
      break;
    case 'not_holding':
      message = 'tidak memegang token ini';
      break;
    case 'sell_amount_zero':
      message = 'porsi jual terlalu kecil';
      break;
  }
  return escapeHtml(message);
}

/** The line appended to a swap alert once the engine has decided. */
export function formatDecisionLine(
  outcome: SignalOutcome,
  timeZone: string,
  mode: TradingMode = 'paper',
): string {
  const prefix = `🧪 ${modeLabel(mode)}:`;
  switch (outcome.decision) {
    case 'accepted':
      return outcome.side === 'buy' || outcome.soldPct === null
        ? `${prefix} diikuti`
        : `${prefix} ikut jual ${number(outcome.soldPct.toFixed(2), 2)}%`;
    case 'rejected': {
      const [only] = outcome.reasons;
      if (outcome.reasons.length === 1 && only?.code === 'not_holding') {
        return `${prefix} ${describeRiskReason(only, timeZone)}`;
      }
      return `${prefix} dilewati — ${outcome.reasons.map((r) => describeRiskReason(r, timeZone)).join('; ')}`;
    }
    case 'failed':
      return `${prefix} gagal dieksekusi`;
  }
}

function feeLine(fees: { network: bigint; priority: bigint; dex: bigint }): string {
  return (
    `Biaya: jaringan ${sol(fees.network)} · priority ${sol(fees.priority)} · ` +
    `DEX ${sol(fees.dex)} (sudah termasuk di harga)`
  );
}

export interface TradeExecutedInput {
  fill: TradeFill;
  token: TokenLabel;
  wallet: TrackedWalletInfo | null;
  walletEvent: SwapEvent | null;
  reason: TradeReason;
  realizedPnlLamports: bigint | null;
  tokenDecimals: number;
  timeZone: string;
  mode?: TradingMode;
}

export function formatTradeExecuted(input: TradeExecutedInput): string {
  const { fill, walletEvent } = input;
  const mode = (input.mode ?? 'paper').toUpperCase();
  const buy = fill.side === 'buy';
  const unit = escapeHtml(input.token.symbol ?? 'token');
  const lines = [
    `🧪 <b>${mode} ${buy ? 'BELI' : 'JUAL'}</b> · ${tokenTitle(input.token, fill.tokenMint)} (${escapeHtml(reasonLabel(input.reason))})`,
    `Jumlah: ${formatAmount(fill.tokenAmountRaw, input.tokenDecimals, 2)} ${unit}`,
    `Nilai: ${sol(fill.solAmountLamports)}`,
    feeLine({
      network: fill.networkFeeLamports,
      priority: fill.priorityFeeLamports,
      dex: fill.dexFeeLamports,
    }),
  ];
  if (
    walletEvent !== null &&
    walletEvent.quoteMint === WSOL_MINT &&
    walletEvent.tokenAmountRaw > 0n &&
    walletEvent.quoteAmountRaw > 0n &&
    fill.tokenAmountRaw > 0n
  ) {
    const ours = new Decimal(fill.solAmountLamports.toString()).div(fill.tokenAmountRaw.toString());
    const theirs = new Decimal(walletEvent.quoteAmountRaw.toString()).div(
      walletEvent.tokenAmountRaw.toString(),
    );
    const gap = ours.div(theirs).minus(1).mul(100);
    const words = buy
      ? gap.gte(0)
        ? 'lebih mahal dari wallet'
        : 'lebih murah dari wallet'
      : gap.gte(0)
        ? 'lebih tinggi dari harga jual wallet'
        : 'lebih rendah dari harga jual wallet';
    lines.push(`Harga kita ${percent(gap.abs())} ${words}`);
  }
  if (input.realizedPnlLamports !== null) {
    lines.push(`PnL realisasi: ${signedSol(input.realizedPnlLamports)}`);
  }
  if (input.wallet !== null) {
    lines.push(`Wallet: ${formatWallet(input.wallet)}`);
  }
  lines.push(`Waktu: ${escapeHtml(formatDateTime(fill.executedAt, input.timeZone))}`);
  return lines.join('\n');
}

/** An exit or copy trade that was triggered but could not be executed or recorded. */
export function formatExecutionError(input: {
  tokenMint: string;
  side: SwapSide;
  message: string;
  token: TokenLabel;
  mode?: TradingMode;
}): string {
  return [
    `❌ <b>${modeLabel(input.mode ?? 'paper')}: gagal ${input.side === 'buy' ? 'beli' : 'jual'}</b> · ${tokenTitle(input.token, input.tokenMint)}`,
    escapeHtml(input.message),
    'Detail ada di log bot.',
  ].join('\n');
}

export function formatPositionClosed(input: {
  position: PositionRow;
  reason: string;
  token: TokenLabel;
}): string {
  const p = input.position;
  const pnl = p.realizedPnlLamports ?? 0n;
  const pct =
    p.costLamports > 0n
      ? new Decimal(pnl.toString()).div(p.costLamports.toString()).mul(100)
      : null;
  return [
    `🏁 <b>Posisi ${p.mode.toUpperCase()} ditutup</b> · ${tokenTitle(input.token, p.tokenMint)}`,
    `Alasan: ${escapeHtml(reasonLabel(input.reason))}`,
    `Modal: ${sol(p.costLamports)}`,
    `Hasil jual: ${sol(p.proceedsLamports)}`,
    `Biaya: ${sol(p.feesLamports)}`,
    `PnL bersih: ${signedSol(pnl)}${pct === null ? '' : ` (${percent(pct, true)})`}`,
    DISCLAIMER,
  ].join('\n');
}

export function formatStatus(input: {
  mode: TradingMode;
  paused: boolean;
  openCount: number;
  realizedTodayLamports: bigint;
}): string {
  return [
    `Mode: <b>${input.mode.toUpperCase()}</b>`,
    input.paused ? 'Status: ⏸ dijeda (/resume untuk melanjutkan)' : 'Status: ▶️ berjalan',
    `Posisi terbuka: ${input.openCount}`,
    `PnL realisasi hari ini: ${signedSol(input.realizedTodayLamports)}`,
  ].join('\n');
}

function age(from: Date, to: Date): string {
  const minutes = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} j ${minutes % 60} m` : `${minutes} m`;
}

export interface PositionListItem {
  position: PositionRow;
  token: TokenLabel;
  walletLabel: string | null;
  valuation: Valuation | undefined;
  now: Date;
}

export function formatPositions(items: PositionListItem[]): string {
  if (items.length === 0) {
    return 'Tidak ada posisi terbuka.';
  }
  const blocks = items.map(({ position: p, token, walletLabel, valuation, now }) => {
    const lines = [
      `${tokenTitle(token, p.tokenMint)}${walletLabel === null ? '' : ` · ${escapeHtml(walletLabel)}`}`,
      `Modal: ${sol(p.costLamports)} · umur ${age(p.openedAt, now)}`,
    ];
    if (valuation === undefined) {
      lines.push('Nilai: belum dinilai');
    } else if (valuation.netValueLamports === null) {
      lines.push('Nilai: tidak ada rute jual');
    } else {
      // Buy fees are realized at the first sale; until then they still count against the PnL.
      const estimate =
        valuation.netValueLamports - valuation.remainingCostLamports - pendingBuyFeesLamports(p);
      lines.push(`Nilai: ${sol(valuation.netValueLamports)} · estimasi PnL ${signedSol(estimate)}`);
    }
    return lines.join('\n');
  });
  return [`<b>Posisi terbuka (${items.length})</b>`, ...blocks].join('\n\n');
}

function topReasons(rows: { code: RiskReason['code']; count: number }[], timeZone: string) {
  return rows.map((row) => `• ${describeRiskReason({ code: row.code }, timeZone)}: ${row.count}`);
}

export function formatDailyReport(
  summary: DailySummary,
  range: PeriodRange,
  timeZone: string,
  options: { partial?: boolean } = {},
): string[] {
  const title = options.partial
    ? `📊 <b>Laporan PAPER hari ini</b> (sementara) · ${dateLabel(range.key)}`
    : `📊 <b>Laporan harian PAPER</b> · ${dateLabel(range.key)}`;
  const lines = [
    title,
    `PnL realisasi bersih: <b>${signedSol(summary.realizedPnlLamports)}</b>`,
    `Trade: ${summary.buys} beli · ${summary.sells} jual · posisi ditutup ${summary.wins} untung / ${summary.losses} rugi`,
    feeLine(summary.fees),
  ];
  const open =
    summary.unrealizedPnlLamports === null
      ? `Posisi terbuka: ${summary.openCount}`
      : `Posisi terbuka: ${summary.openCount} · estimasi PnL belum terealisasi ${signedSol(summary.unrealizedPnlLamports)}`;
  lines.push(
    summary.unpricedOpenCount > 0
      ? `${open} (${summary.unpricedOpenCount} belum bisa dinilai)`
      : open,
  );
  lines.push(
    `Sinyal beli: ${summary.acceptedSignals} diikuti · ${summary.rejectedSignals} dilewati`,
  );
  if (summary.topRejections.length > 0) {
    lines.push('Alasan dilewati teratas:', ...topReasons(summary.topRejections, timeZone));
  }
  lines.push('', DISCLAIMER);
  return splitMessage(lines.join('\n'));
}

function decompositionLines(d: Decomposition, indent = ''): string[] {
  if (d.positions === 0) {
    return [];
  }
  if (d.unattributedPositions === d.positions) {
    return [`${indent}Penguraian penyebab: tidak tersedia (data harga wallet kurang)`];
  }
  const lines = [
    `${indent}Hasil wallet itu sendiri: ${signedSol(d.walletLamports)}`,
    `${indent}Selisih masuk (jeda & slippage): ${signedSol(d.entryLamports)}`,
    `${indent}Selisih keluar: ${signedSol(d.exitLamports)}`,
  ];
  if (d.unattributedPositions > 0) {
    lines.push(
      `${indent}Tidak bisa diurai (${d.unattributedPositions} posisi): ${signedSol(d.unattributedLamports)}`,
    );
  }
  lines.push(
    `${indent}Biaya: ${signedSol(-d.feesLamports)}`,
    `${indent}= PnL bersih ${signedSol(d.netLamports)}`,
  );
  if (d.walletStillHoldingPositions > 0) {
    lines.push(
      `${indent}(${d.walletStillHoldingPositions} posisi: wallet masih memegang, selisih keluar dihitung 0)`,
    );
  }
  return lines;
}

const walletName = (w: { walletLabel: string | null; walletAddress: string | null }) =>
  w.walletLabel !== null
    ? `<b>${escapeHtml(w.walletLabel)}</b>`
    : w.walletAddress !== null
      ? `<code>${escapeHtml(shortAddress(w.walletAddress))}</code>`
      : 'tanpa wallet';

const positionName = (p: ReportPosition) =>
  p.tokenSymbol === null
    ? `<code>${escapeHtml(shortAddress(p.tokenMint))}</code>`
    : `<b>${escapeHtml(p.tokenSymbol)}</b>`;

export function formatWeeklyReport(
  report: WeeklyReport,
  range: PeriodRange,
  timeZone: string,
): string[] {
  const lastDay = new Date(range.to.getTime() - 1);
  const t = report.totals;
  const lines = [
    `📈 <b>Laporan mingguan PAPER</b> · ${dateLabel(range.key)} – ${escapeHtml(formatDateTime(lastDay, timeZone).split(',')[0] ?? '')}`,
    '',
    '<b>Total</b>',
    `PnL realisasi bersih: <b>${signedSol(t.realizedPnlLamports)}</b>`,
    `Posisi ditutup: ${report.positions}${report.winRate === null ? '' : ` · win rate ${percent(report.winRate.mul(100))}`}`,
    `Trade: ${t.buys} beli · ${t.sells} jual`,
    feeLine(t.fees),
    '',
    '<b>Penyebab untung/rugi</b> (posisi yang ditutup)',
    ...(report.positions === 0
      ? ['Belum ada posisi yang ditutup.']
      : decompositionLines(report.decomposition)),
  ];

  if (report.perWallet.length > 0) {
    lines.push('', '<b>Per wallet</b> (terburuk dulu)');
    for (const w of report.perWallet) {
      lines.push(
        `• ${walletName(w)}: ${w.buySignals} sinyal beli · ${w.positions} posisi · PnL ${signedSol(w.realizedPnlLamports)}` +
          (w.winRate === null ? '' : ` · win rate ${percent(w.winRate.mul(100))}`),
        ...decompositionLines(w.decomposition, '   '),
      );
    }
  }
  if (report.perExitReason.length > 0) {
    lines.push('', '<b>Per alasan keluar</b>');
    for (const row of report.perExitReason) {
      lines.push(
        `• ${escapeHtml(reasonLabel(row.reason))}: ${row.count} posisi · PnL ${signedSol(row.realizedPnlLamports)}`,
      );
    }
  }
  if (report.rejectedByReason.length > 0) {
    lines.push('', '<b>Sinyal beli dilewati</b>', ...topReasons(report.rejectedByReason, timeZone));
  }
  if (report.best !== null && report.worst !== null) {
    lines.push(
      '',
      `Terbaik: ${positionName(report.best)} ${signedSol(report.best.realizedPnlLamports)}`,
      `Terburuk: ${positionName(report.worst)} ${signedSol(report.worst.realizedPnlLamports)}`,
    );
  }
  lines.push('', DISCLAIMER);
  return splitMessage(lines.join('\n'));
}

/** Splits at line breaks so every part fits one Telegram message. */
export function splitMessage(text: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] {
  const parts: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    const pieces: string[] = [];
    for (let rest = line; ; rest = rest.slice(limit)) {
      pieces.push(rest.slice(0, limit));
      if (rest.length <= limit) {
        break;
      }
    }
    for (const piece of pieces) {
      if (current === '') {
        current = piece;
      } else if (current.length + 1 + piece.length <= limit) {
        current += `\n${piece}`;
      } else {
        parts.push(current);
        current = piece;
      }
    }
  }
  if (current !== '' || parts.length === 0) {
    parts.push(current);
  }
  return parts;
}
