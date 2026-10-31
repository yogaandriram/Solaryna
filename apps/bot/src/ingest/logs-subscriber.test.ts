import type { AddressInfo } from 'node:net';
import { Secret } from '@solaryna/config';
import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { LogsSubscriber, toWebSocketUrl } from './logs-subscriber';

interface RpcMessage {
  id: number;
  method: string;
  params: unknown[];
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = performance.now();
  while (!condition()) {
    if (performance.now() - start > timeoutMs) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Minimal fake of the Solana logs subscription API. */
async function fakeRpcServer() {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const received: RpcMessage[] = [];
  const subscriptions = new Map<string, number>();
  let nextSubscription = 100;
  let client: WebSocket | undefined;

  server.on('connection', (socket) => {
    client = socket;
    socket.on('message', (data: Buffer) => {
      const message = JSON.parse(data.toString()) as RpcMessage;
      received.push(message);
      if (message.method === 'logsSubscribe') {
        const filter = message.params[0] as { mentions: string[] };
        const id = nextSubscription++;
        subscriptions.set(filter.mentions[0] ?? '', id);
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: id }));
      } else if (message.method === 'logsUnsubscribe') {
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: true }));
      }
    });
  });

  return {
    url: new Secret(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`),
    received,
    subscriptions,
    notify(address: string, signature: string, err: unknown = null) {
      client?.send(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'logsNotification',
          params: {
            subscription: subscriptions.get(address),
            result: { context: { slot: 1 }, value: { signature, err, logs: [] } },
          },
        }),
      );
    },
    dropConnection() {
      client?.terminate();
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('LogsSubscriber', () => {
  const cleanups: (() => unknown)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) {
      await cleanup();
    }
  });

  it('subscribes per address, forwards successful transactions, and follows address changes', async () => {
    const rpc = await fakeRpcServer();
    const signatures: [string, string][] = [];
    const subscriber = new LogsSubscriber({
      url: rpc.url,
      logger: pino({ level: 'silent' }),
      onSignature: (signature, address) => signatures.push([signature, address]),
      reconnectBaseDelayMs: 20,
    });
    cleanups.push(
      () => subscriber.stop(),
      () => rpc.close(),
    );

    subscriber.setAddresses(['WalletA', 'WalletB']);
    subscriber.start();
    await waitFor(() => subscriber.subscribedCount === 2);
    expect(rpc.received.map((m) => m.params[0])).toEqual([
      { mentions: ['WalletA'] },
      { mentions: ['WalletB'] },
    ]);
    expect(rpc.received[0]?.params[1]).toEqual({ commitment: 'confirmed' });

    rpc.notify('WalletA', 'sig-ok');
    rpc.notify('WalletB', 'sig-failed', { InstructionError: [0, 'Custom'] });
    await waitFor(() => signatures.length === 1);
    expect(signatures).toEqual([['sig-ok', 'WalletA']]);

    const subscriptionA = rpc.subscriptions.get('WalletA');
    subscriber.setAddresses(['WalletB']);
    await waitFor(() => rpc.received.some((m) => m.method === 'logsUnsubscribe'));
    expect(rpc.received.at(-1)).toMatchObject({
      method: 'logsUnsubscribe',
      params: [subscriptionA],
    });
    expect(subscriber.subscribedCount).toBe(1);
  });

  it('reconnects and resubscribes after the connection drops', async () => {
    const rpc = await fakeRpcServer();
    const subscriber = new LogsSubscriber({
      url: rpc.url,
      logger: pino({ level: 'silent' }),
      onSignature: () => undefined,
      reconnectBaseDelayMs: 20,
    });
    cleanups.push(
      () => subscriber.stop(),
      () => rpc.close(),
    );

    subscriber.setAddresses(['WalletA']);
    subscriber.start();
    await waitFor(() => subscriber.subscribedCount === 1);

    rpc.dropConnection();
    await waitFor(() => rpc.received.filter((m) => m.method === 'logsSubscribe').length === 2);
    await waitFor(() => subscriber.subscribedCount === 1);
  });
});

describe('toWebSocketUrl', () => {
  it('switches the scheme and keeps the API key query', () => {
    expect(toWebSocketUrl(new Secret('https://mainnet.helius-rpc.com/?api-key=k')).reveal()).toBe(
      'wss://mainnet.helius-rpc.com/?api-key=k',
    );
    expect(toWebSocketUrl(new Secret('http://127.0.0.1:8899')).reveal()).toBe(
      'ws://127.0.0.1:8899/',
    );
  });
});
