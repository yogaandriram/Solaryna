import { Secret } from '@solaryna/config';
import type { Logger } from 'pino';
import WebSocket from 'ws';
import { z } from 'zod';

// Standard Solana `logsSubscribe` (available on every Helius plan). `mentions` accepts a
// single address, so each tracked wallet gets its own subscription on one connection.

const responseSchema = z.object({
  id: z.number(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
});

const notificationSchema = z.object({
  method: z.literal('logsNotification'),
  params: z.object({
    subscription: z.number(),
    result: z.object({ value: z.object({ signature: z.string(), err: z.unknown() }) }),
  }),
});

type Pending = { kind: 'subscribe'; address: string } | { kind: 'unsubscribe' };

export interface LogsSubscriberOptions {
  /** wss:// URL; for Helius it carries the API key, hence a Secret. */
  url: Secret;
  logger: Logger;
  /** Called for each successful transaction mentioning a subscribed address. */
  onSignature(signature: string, address: string): void;
  pingIntervalMs?: number;
  reconnectBaseDelayMs?: number;
  maxReconnectDelayMs?: number;
}

export class LogsSubscriber {
  readonly #options: LogsSubscriberOptions;
  #wanted = new Set<string>();
  #subscriptionByAddress = new Map<string, number>();
  #addressBySubscription = new Map<number, string>();
  #pending = new Map<number, Pending>();
  #nextId = 1;
  #socket: WebSocket | null = null;
  #stopped = true;
  #alive = false;
  #pingTimer: NodeJS.Timeout | undefined;
  #reconnectTimer: NodeJS.Timeout | undefined;
  #reconnectAttempts = 0;

  constructor(options: LogsSubscriberOptions) {
    this.#options = options;
  }

  get subscribedCount(): number {
    return this.#subscriptionByAddress.size;
  }

  start(): void {
    this.#stopped = false;
    this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    clearInterval(this.#pingTimer);
    clearTimeout(this.#reconnectTimer);
    this.#socket?.close();
    this.#socket = null;
  }

  setAddresses(addresses: Iterable<string>): void {
    const next = new Set(addresses);
    for (const address of this.#wanted) {
      if (!next.has(address)) {
        this.#unsubscribe(address);
      }
    }
    const previous = this.#wanted;
    this.#wanted = next;
    for (const address of next) {
      if (!previous.has(address)) {
        this.#subscribe(address);
      }
    }
  }

  #connect(): void {
    const { logger } = this.#options;
    const socket = new WebSocket(this.#options.url.reveal());
    this.#socket = socket;

    socket.on('open', () => {
      this.#reconnectAttempts = 0;
      this.#alive = true;
      logger.info({ addresses: this.#wanted.size }, 'WebSocket connected; subscribing to logs');
      for (const address of this.#wanted) {
        this.#subscribe(address);
      }
      this.#startHeartbeat(socket);
    });
    socket.on('pong', () => {
      this.#alive = true;
    });
    socket.on('message', (data: WebSocket.RawData) => {
      this.#handleMessage(rawDataToString(data));
    });
    socket.on('error', (error) => {
      // ws errors describe the failure (status, ECONNREFUSED), not the URL.
      logger.warn({ err: { message: error.message } }, 'WebSocket error');
    });
    socket.on('close', (code) => {
      clearInterval(this.#pingTimer);
      this.#subscriptionByAddress.clear();
      this.#addressBySubscription.clear();
      this.#pending.clear();
      if (this.#socket === socket) {
        this.#socket = null;
      }
      if (!this.#stopped) {
        const delay = Math.min(
          (this.#options.reconnectBaseDelayMs ?? 1000) * 2 ** this.#reconnectAttempts,
          this.#options.maxReconnectDelayMs ?? 30_000,
        );
        this.#reconnectAttempts++;
        logger.warn({ code, delayMs: delay }, 'WebSocket closed; reconnecting');
        this.#reconnectTimer = setTimeout(() => this.#connect(), delay);
      }
    });
  }

  /** Helius drops idle connections after 10 minutes; protocol pings keep it open. */
  #startHeartbeat(socket: WebSocket): void {
    clearInterval(this.#pingTimer);
    this.#pingTimer = setInterval(() => {
      if (!this.#alive) {
        this.#options.logger.warn('WebSocket missed a pong; terminating');
        socket.terminate();
        return;
      }
      this.#alive = false;
      socket.ping();
    }, this.#options.pingIntervalMs ?? 30_000);
  }

  #send(method: string, params: unknown[], pending: Pending): void {
    const socket = this.#socket;
    if (socket?.readyState !== WebSocket.OPEN) {
      return; // (Re)subscribed on the next 'open'.
    }
    const id = this.#nextId++;
    this.#pending.set(id, pending);
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  }

  #subscribe(address: string): void {
    this.#send('logsSubscribe', [{ mentions: [address] }, { commitment: 'confirmed' }], {
      kind: 'subscribe',
      address,
    });
  }

  #unsubscribe(address: string): void {
    const subscription = this.#subscriptionByAddress.get(address);
    if (subscription === undefined) {
      return;
    }
    this.#subscriptionByAddress.delete(address);
    this.#addressBySubscription.delete(subscription);
    this.#send('logsUnsubscribe', [subscription], { kind: 'unsubscribe' });
  }

  #handleMessage(text: string): void {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      this.#options.logger.warn('Ignoring non-JSON WebSocket message');
      return;
    }

    const notification = notificationSchema.safeParse(message);
    if (notification.success) {
      const { subscription, result } = notification.data.params;
      const address = this.#addressBySubscription.get(subscription);
      if (address !== undefined && result.value.err === null) {
        this.#options.onSignature(result.value.signature, address);
      }
      return;
    }

    const response = responseSchema.safeParse(message);
    if (!response.success) {
      return;
    }
    const pending = this.#pending.get(response.data.id);
    this.#pending.delete(response.data.id);
    if (pending?.kind !== 'subscribe') {
      return;
    }
    const subscription = response.data.result;
    if (response.data.error || typeof subscription !== 'number') {
      this.#options.logger.error(
        { address: pending.address, error: response.data.error?.message },
        'logsSubscribe failed',
      );
      return;
    }
    if (!this.#wanted.has(pending.address)) {
      // Removed while the subscription was in flight.
      this.#send('logsUnsubscribe', [subscription], { kind: 'unsubscribe' });
      return;
    }
    this.#subscriptionByAddress.set(pending.address, subscription);
    this.#addressBySubscription.set(subscription, pending.address);
  }
}

/** https://… → wss://… keeping host, path, and query (where Helius puts the API key). */
function rawDataToString(data: WebSocket.RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }
  return (data instanceof ArrayBuffer ? Buffer.from(data) : data).toString('utf8');
}

export function toWebSocketUrl(rpcUrl: Secret): Secret {
  const url = new URL(rpcUrl.reveal());
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
  return new Secret(url.toString());
}
