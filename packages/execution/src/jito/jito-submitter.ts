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
import { LeaderAwareJitoSubmitter } from './leader-aware-submitter.js';

export {
  LeaderAwareJitoSubmitter,
  JITO_REGIONAL_ENDPOINTS,
  type LeaderRoutingTelemetry,
} from './leader-aware-submitter.js';

const JITO_BLOCK_ENGINE_URL = process.env['JITO_BLOCK_ENGINE_URL'] ?? 'mainnet.block-engine.jito.wtf:443';

export interface BundleResult {
  bundleId: string;
  status: 'landed' | 'failed' | 'timeout';
  landedSlot?: number;
  error?: string;
  routedRegion?: string;
}

export class JitoSubmitter {
  private leaderAware: LeaderAwareJitoSubmitter;
  private connection: Connection;

  constructor(authKeypairBase58: string, rpcUrl: string, enableLeaderRouting = true) {
    this.leaderAware = new LeaderAwareJitoSubmitter(authKeypairBase58, rpcUrl, enableLeaderRouting);
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  async submitBundle(
    transactions: VersionedTransaction[],
    walletKeypair: Keypair,
    tipLamports: number,
    targetSlot?: number,
  ): Promise<BundleResult> {
    return this.leaderAware.submitBundle(transactions, walletKeypair, tipLamports, targetSlot);
  }

  async getRecentBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    return this.connection.getLatestBlockhash('confirmed');
  }

  calculateDynamicTip(expectedProfitLamports: number, competitionLevel: string): number {
    return this.leaderAware.calculateDynamicTip(expectedProfitLamports, competitionLevel);
  }

  public getLeaderAware(): LeaderAwareJitoSubmitter {
    return this.leaderAware;
  }
}

