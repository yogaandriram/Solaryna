export interface TrackedWalletInfo {
  id: number;
  address: string;
  label: string | null;
}

/** In-memory view of the active tracked wallets, so ingest doesn't hit the DB per transaction. */
export class WalletRegistry {
  #wallets = new Map<string, TrackedWalletInfo>();

  constructor(private readonly load: () => Promise<TrackedWalletInfo[]>) {}

  /** Reloads from the database. Returns true when the set of addresses changed. */
  async refresh(): Promise<boolean> {
    const wallets = await this.load();
    const previous = this.addresses().join(',');
    this.#wallets = new Map(wallets.map((wallet) => [wallet.address, wallet]));
    return this.addresses().join(',') !== previous;
  }

  get(address: string): TrackedWalletInfo | undefined {
    return this.#wallets.get(address);
  }

  findById(id: number): TrackedWalletInfo | undefined {
    for (const wallet of this.#wallets.values()) {
      if (wallet.id === id) {
        return wallet;
      }
    }
    return undefined;
  }

  /** Sorted, so it can be compared and diffed. */
  addresses(): string[] {
    return [...this.#wallets.keys()].sort();
  }

  get size(): number {
    return this.#wallets.size;
  }
}
