import { formatAmount, formatDateTime } from './format';
import type { RiskReason } from './risk';
import type { TradeReason } from './types';

// Indonesian labels shared by Telegram and the dashboard. Plain text: callers escape it for
// HTML (Telegram) or render it as text (React).

const LOCALE = 'id-ID';

const sol = (lamports: bigint) => `${formatAmount(lamports, 9, 4)} SOL`;

function number(value: string | number, fractionDigits = 0): string {
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: fractionDigits }).format(
    String(value) as Intl.StringNumericLiteral,
  );
}

const usd = (value: string) => `$${number(value)}`;

const TRADE_REASON_LABELS: Record<TradeReason, string> = {
  copy_buy: 'ikut beli',
  follow_sell: 'ikut jual',
  take_profit: 'take-profit',
  stop_loss: 'stop-loss',
  max_hold: 'batas waktu hold',
  unsellable: 'tidak bisa dijual (dihapusbukukan, nilai 0)',
};

/** Label of a trade reason or a close reason (which adds `manual`); unknown values as is. */
export function tradeReasonLabel(reason: string): string {
  return reason in TRADE_REASON_LABELS ? TRADE_REASON_LABELS[reason as TradeReason] : reason;
}

/** One reason in Indonesian as plain text; works without `detail` (for report counts). */
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
  return message;
}
