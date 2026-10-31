import type { TradingMode } from '@solaryna/core';
import bs58 from 'bs58';
import { Secret } from './secret';

export interface TradingModeRequest {
  requestedMode: TradingMode;
  liveAcknowledged: boolean;
  botWalletPrivateKey: Secret | null;
}

export interface TradingModeResolution {
  mode: TradingMode;
  /** Why live was requested but not activated (user-facing, Indonesian). Empty otherwise. */
  fallbackReasons: string[];
  /** Decoded 64-byte secret key; only present when mode is live. */
  botWalletSecretKey: Secret<Uint8Array> | null;
}

const SECRET_KEY_LENGTH = 64;

/**
 * Live trading requires TRADING_MODE=live, LIVE_TRADING_ACKNOWLEDGED=true, a valid private
 * key, and a live executor. If any is missing the bot runs in paper mode and says why.
 */
export function resolveTradingMode(
  request: TradingModeRequest,
  options: { liveExecutorAvailable: boolean },
): TradingModeResolution {
  if (request.requestedMode === 'paper') {
    return { mode: 'paper', fallbackReasons: [], botWalletSecretKey: null };
  }

  const reasons: string[] = [];
  if (!request.liveAcknowledged) {
    reasons.push('LIVE_TRADING_ACKNOWLEDGED belum "true"');
  }

  const secretKey = request.botWalletPrivateKey
    ? decodeSecretKey(request.botWalletPrivateKey)
    : null;
  if (request.botWalletPrivateKey === null) {
    reasons.push('BOT_WALLET_PRIVATE_KEY kosong');
  } else if (secretKey === null) {
    reasons.push('BOT_WALLET_PRIVATE_KEY bukan secret key base58 64 byte yang valid');
  }

  if (!options.liveExecutorAvailable) {
    reasons.push('executor live belum tersedia (Milestone M5)');
  }

  if (reasons.length > 0 || secretKey === null) {
    return { mode: 'paper', fallbackReasons: reasons, botWalletSecretKey: null };
  }
  return { mode: 'live', fallbackReasons: [], botWalletSecretKey: secretKey };
}

function decodeSecretKey(privateKey: Secret): Secret<Uint8Array> | null {
  try {
    const bytes = bs58.decode(privateKey.reveal());
    return bytes.length === SECRET_KEY_LENGTH ? new Secret(bytes) : null;
  } catch {
    return null;
  }
}
