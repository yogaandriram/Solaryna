import { describe, expect, it } from 'vitest';
import { WalletRegistry } from './registry';

describe('WalletRegistry', () => {
  it('finds wallets by address and by id after a refresh', async () => {
    const registry = new WalletRegistry(() =>
      Promise.resolve([
        { id: 1, address: 'B', label: 'beta' },
        { id: 2, address: 'A', label: null },
      ]),
    );
    expect(await registry.refresh()).toBe(true);
    expect(registry.get('B')?.id).toBe(1);
    expect(registry.findById(2)?.address).toBe('A');
    expect(registry.findById(3)).toBeUndefined();
    expect(registry.addresses()).toEqual(['A', 'B']);
    expect(await registry.refresh()).toBe(false);
  });
});
