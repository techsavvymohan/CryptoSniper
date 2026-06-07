import { EventEmitter } from 'events';
import { YellowstoneClient, AccountUpdate } from './grpc/yellowstone-client.js';
import { parseRaydiumClmmPool } from './parsers/raydium-parser.js';
import { parseOrcaWhirlpool } from './parsers/orca-parser.js';
import { RAYDIUM_CLMM_PROGRAM, ORCA_WHIRLPOOL_PROGRAM } from '@mev-research/shared';
import type { PoolSnapshot } from '@mev-research/shared';

export type { PoolSnapshot };
export { getJupiterPrice, clearPriceCache } from './providers/jupiter-provider.js';
export { parseRaydiumClmmPool } from './parsers/raydium-parser.js';
export { parseOrcaWhirlpool } from './parsers/orca-parser.js';
export { YellowstoneClient } from './grpc/yellowstone-client.js';
export type { AccountUpdate } from './grpc/yellowstone-client.js';

export type PoolUpdateCallback = (snapshot: PoolSnapshot) => void;

// Known Raydium CLMM and Orca Whirlpool program owners used to route parsing
const RAYDIUM_OWNER = RAYDIUM_CLMM_PROGRAM;
const ORCA_OWNER = ORCA_WHIRLPOOL_PROGRAM;

export class MarketFeedService extends EventEmitter {
  private yellowstone: YellowstoneClient;
  private callbacks: PoolUpdateCallback[] = [];

  constructor(
    private readonly grpcEndpoint: string,
    private readonly apiToken: string,
    private readonly watchedAccounts: string[] = [],
  ) {
    super();
    this.yellowstone = new YellowstoneClient(grpcEndpoint, apiToken);

    this.yellowstone.on('connected', () => this.emit('connected'));
    this.yellowstone.on('disconnected', () => this.emit('disconnected'));
    this.yellowstone.on('error', (err) => this.emit('error', err));
    this.yellowstone.on('accountUpdate', (update: AccountUpdate) => {
      this.handleAccountUpdate(update);
    });
  }

  onPoolUpdate(callback: PoolUpdateCallback): void {
    this.callbacks.push(callback);
  }

  async start(): Promise<void> {
    await this.yellowstone.start(this.watchedAccounts);
  }

  stop(): void {
    this.yellowstone.stop();
  }

  private handleAccountUpdate(update: AccountUpdate): void {
    const { pubkey, data, slot } = update;

    // Try Raydium first, then Orca
    let snapshot: PoolSnapshot | null =
      parseRaydiumClmmPool(pubkey, data, slot) ??
      parseOrcaWhirlpool(pubkey, data, slot);

    if (!snapshot) return;

    for (const cb of this.callbacks) {
      try {
        cb(snapshot);
      } catch {
        // Callback errors must not crash the feed
      }
    }
  }
}

// Suppress unused variable warnings for program IDs used purely for routing documentation
void RAYDIUM_OWNER;
void ORCA_OWNER;
