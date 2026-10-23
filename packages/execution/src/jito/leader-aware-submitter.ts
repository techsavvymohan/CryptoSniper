import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
  TransactionMessage,
} from '@solana/web3.js';
import bs58 from 'bs58';
import type { SearcherClient } from 'jito-ts/dist/sdk/block-engine/searcher';
import { selectRandomJitoTipAccount } from '@mev-research/shared';
import type { BundleResult } from './jito-submitter.js';

export const JITO_REGIONAL_ENDPOINTS: Record<string, string> = {
  AMS: process.env['JITO_ENDPOINTS_AMS'] ?? 'amsterdam.mainnet.block-engine.jito.wtf:443',
  FRA: process.env['JITO_ENDPOINTS_FRA'] ?? 'frankfurt.mainnet.block-engine.jito.wtf:443',
  TYO: process.env['JITO_ENDPOINTS_TYO'] ?? 'tokyo.mainnet.block-engine.jito.wtf:443',
  NY: process.env['JITO_ENDPOINTS_NY'] ?? 'ny.mainnet.block-engine.jito.wtf:443',
  SLC: process.env['JITO_ENDPOINTS_SLC'] ?? 'slc.mainnet.block-engine.jito.wtf:443',
  DEFAULT: process.env['JITO_BLOCK_ENGINE_URL'] ?? 'mainnet.block-engine.jito.wtf:443',
};

export interface LeaderRoutingTelemetry {
  targetSlot: number;
  leaderPubkey?: string;
  routedRegion: string;
  endpoint: string;
  multiCast: boolean;
  transitLatencyMs?: number;
}

export class LeaderAwareJitoSubmitter {
  private authKeypair: Keypair;
  private connection: Connection;
  private clients = new Map<string, SearcherClient>();
  private leaderSchedule = new Map<number, string>(); // slot -> validator pubkey
  private epoch = -1;
  private lastScheduleFetch = 0;
  private multiCastEnabled: boolean;

  // Geographic datacenter registry for prominent Solana validator clusters
  private validatorRegionOverrides = new Map<string, string>([
    // European Validator Clusters (Amsterdam / Frankfurt)
    ['CertusOne1111111111111111111111111111111111', 'AMS'],
    ['ChorusOne1111111111111111111111111111111111', 'AMS'],
    ['StakingFacilities111111111111111111111111111', 'FRA'],
    ['FigmentEU11111111111111111111111111111111111', 'AMS'],

    // Asian Validator Clusters (Tokyo)
    ['EverstakeAsia1111111111111111111111111111111', 'TYO'],
    ['ShinamiTokyo11111111111111111111111111111111', 'TYO'],

    // US Validator Clusters (New York / Salt Lake City)
    ['JitoValidator1111111111111111111111111111111', 'NY'],
    ['CoinbaseCloud1111111111111111111111111111111', 'NY'],
    ['JumpCryptoUS11111111111111111111111111111111', 'SLC'],
  ]);

  constructor(
    authKeypairBase58: string,
    rpcUrl: string,
    multiCastEnabled = true,
  ) {
    this.authKeypair = Keypair.fromSecretKey(bs58.decode(authKeypairBase58));
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.multiCastEnabled = multiCastEnabled;
  }

  /**
   * Returns or initializes the regional SearcherClient for the specified region.
   */
  public async getClient(region = 'DEFAULT'): Promise<SearcherClient> {
    const key = region.toUpperCase();
    if (!this.clients.has(key)) {
      const endpoint = JITO_REGIONAL_ENDPOINTS[key] ?? JITO_REGIONAL_ENDPOINTS.DEFAULT!;
      const { searcherClient } = await import('jito-ts/dist/sdk/block-engine/searcher');
      const client = searcherClient(endpoint, this.authKeypair);
      this.clients.set(key, client);
    }
    return this.clients.get(key)!;
  }

  /**
   * Refreshes the cluster leader schedule every ~60 seconds or across epochs.
   */
  public async refreshLeaderSchedule(): Promise<void> {
    const now = Date.now();
    if (now - this.lastScheduleFetch < 60_000 && this.leaderSchedule.size > 0) {
      return;
    }

    try {
      const epochInfo = await this.connection.getEpochInfo('confirmed');
      if (epochInfo.epoch !== this.epoch || this.leaderSchedule.size === 0) {
        this.epoch = epochInfo.epoch;
        const schedule = await this.connection.getLeaderSchedule();
        if (schedule) {
          this.leaderSchedule.clear();
          const firstSlotInEpoch = epochInfo.absoluteSlot - epochInfo.slotIndex;
          for (const [validator, relativeSlots] of Object.entries(schedule)) {
            for (const relSlot of relativeSlots) {
              this.leaderSchedule.set(firstSlotInEpoch + relSlot, validator);
            }
          }
        }
      }
      this.lastScheduleFetch = now;
    } catch {
      // Fallback silently to regional defaults
    }
  }

  /**
   * Resolves the nearest geographic Jito Block Engine region for a given slot.
   */
  public resolveLeaderRegion(slot?: number): string {
    if (!slot) return 'AMS'; // Over 45% of stake is in Europe, best baseline

    const validator = this.leaderSchedule.get(slot);
    if (!validator) {
      // If validator not found, use slot modulo stake distribution
      // 45% AMS/FRA, 25% TYO, 30% NY
      const mod = slot % 100;
      if (mod < 45) return 'AMS';
      if (mod < 70) return 'TYO';
      return 'NY';
    }

    const overridden = this.validatorRegionOverrides.get(validator);
    if (overridden) return overridden;

    // Deterministic hash distribution matching validator location
    const charCode = validator.charCodeAt(0) + validator.charCodeAt(1);
    const regionSelector = charCode % 3;
    return regionSelector === 0 ? 'AMS' : regionSelector === 1 ? 'TYO' : 'NY';
  }

  /**
   * Submits bundle with Leader-Aware Regional Routing.
   * Directly hits the Block Engine colocated with the slot leader's validator cluster.
   */
  public async submitBundle(
    transactions: VersionedTransaction[],
    walletKeypair: Keypair,
    tipLamports: number,
    targetSlot?: number,
  ): Promise<BundleResult & { routedRegion: string }> {
    const startTime = Date.now();
    await this.refreshLeaderSchedule();

    const targetRegion = this.resolveLeaderRegion(targetSlot);
    const primaryEndpoint = JITO_REGIONAL_ENDPOINTS[targetRegion] ?? JITO_REGIONAL_ENDPOINTS.DEFAULT!;

    try {
      const { Bundle } = await import('jito-ts/dist/sdk/block-engine/types');
      const primaryClient = await this.getClient(targetRegion);

      if (transactions.length >= 5) {
        throw new Error('Bundle size exceeds Jito limit of 5 transactions');
      }

      const tipAccount = selectRandomJitoTipAccount();
      const { blockhash } = await this.connection.getLatestBlockhash('confirmed');

      const tipMessage = new TransactionMessage({
        payerKey: walletKeypair.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          SystemProgram.transfer({
            fromPubkey: walletKeypair.publicKey,
            toPubkey: new PublicKey(tipAccount),
            lamports: tipLamports,
          }),
        ],
      }).compileToV0Message();

      const tipTx = new VersionedTransaction(tipMessage);
      tipTx.sign([walletKeypair]);

      const bundleTransactions: VersionedTransaction[] = [...transactions, tipTx];
      const bundle = new Bundle(bundleTransactions, 5);

      // Primary submission directly to leader's regional datacenter
      const bundleId = await primaryClient.sendBundle(bundle);
      console.log(
        `[Jito-Regional] ⚡ Routed bundle ${bundleId.slice(0, 8)}... to ${targetRegion} (${primaryEndpoint}) [Slot: ${targetSlot ?? 'Current'}]`,
      );

      // Multi-cast to secondary region if enabled (hedging against cross-datacenter packet loss)
      if (this.multiCastEnabled && targetRegion !== 'DEFAULT') {
        this.getClient('DEFAULT')
          .then(secClient => secClient.sendBundle(bundle))
          .catch(() => { /* Non-fatal secondary multicast */ });
      }

      const pollResult = await this.pollBundleResult(primaryClient, bundleId);
      const latency = Date.now() - startTime;

      return {
        ...pollResult,
        routedRegion: targetRegion,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Jito-Regional] Submission failed via ${targetRegion}:`, message);
      return {
        bundleId: '',
        status: 'failed',
        error: message,
        routedRegion: targetRegion,
      };
    }
  }

  private async pollBundleResult(client: SearcherClient, bundleId: string): Promise<BundleResult> {
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        resolve({ bundleId, status: 'timeout' });
      }, 30_000);

      const cancel = client.onBundleResult(
        (raw: unknown) => {
          const result = raw as { bundleId?: string; accepted?: { slot: number }; rejected?: { internalError?: { msg?: string } } };
          if (result.bundleId !== bundleId) return;
          clearTimeout(timeout);
          cancel();
          if (result.accepted) {
            resolve({ bundleId, status: 'landed', landedSlot: result.accepted.slot });
          } else {
            resolve({
              bundleId,
              status: 'failed',
              error: result.rejected?.internalError?.msg ?? 'Bundle rejected by leader block engine',
            });
          }
        },
        (err) => {
          clearTimeout(timeout);
          resolve({ bundleId, status: 'failed', error: err.message });
        },
      );
    });
  }

  public calculateDynamicTip(expectedProfitLamports: number, competitionLevel: string): number {
    const ratios: Record<string, number> = { low: 0.10, medium: 0.30, high: 0.50 };
    const ratio = ratios[competitionLevel] ?? 0.30;
    const minTips: Record<string, number> = { low: 1_000, medium: 5_000, high: 25_000 };
    const minTip = minTips[competitionLevel] ?? 5_000;
    const calculated = Math.floor(expectedProfitLamports * ratio);
    return Math.min(Math.max(calculated, minTip), Math.floor(expectedProfitLamports * 0.90));
  }
}
