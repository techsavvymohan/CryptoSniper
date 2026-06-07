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

const JITO_BLOCK_ENGINE_URL = process.env['JITO_BLOCK_ENGINE_URL'] ?? 'mainnet.block-engine.jito.wtf:443';

export interface BundleResult {
  bundleId: string;
  status: 'landed' | 'failed' | 'timeout';
  landedSlot?: number;
  error?: string;
}

export class JitoSubmitter {
  private authKeypair: Keypair;
  private client?: SearcherClient;
  private connection: Connection;

  constructor(authKeypairBase58: string, rpcUrl: string) {
    this.authKeypair = Keypair.fromSecretKey(bs58.decode(authKeypairBase58));
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /** Lazy-load jito-ts to avoid pulling an old @solana/web3.js at startup */
  private async getClient(): Promise<SearcherClient> {
    if (!this.client) {
      const { searcherClient } = await import('jito-ts/dist/sdk/block-engine/searcher');
      this.client = searcherClient(JITO_BLOCK_ENGINE_URL, this.authKeypair);
    }
    return this.client!;
  }

  async submitBundle(
    transactions: VersionedTransaction[],
    walletKeypair: Keypair,
    tipLamports: number,
  ): Promise<BundleResult> {
    try {
      const { Bundle } = await import('jito-ts/dist/sdk/block-engine/types');
      const client = await this.getClient();

      if (transactions.length >= 5) {
        throw new Error('Bundle size exceeds Jito limit of 5 transactions');
      }

      const tipAccount = selectRandomJitoTipAccount();
      const { blockhash } = await this.getRecentBlockhash();

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
      const bundleId = await client.sendBundle(bundle);
      console.log(`[Jito] Bundle submitted: ${bundleId}`);

      return await this.pollBundleResult(client, bundleId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Jito] Bundle submission failed:', message);
      return { bundleId: '', status: 'failed', error: message };
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
              error: result.rejected?.internalError?.msg ?? 'Bundle rejected',
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

  async getRecentBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    return this.connection.getLatestBlockhash('confirmed');
  }

  calculateDynamicTip(expectedProfitLamports: number, competitionLevel: string): number {
    const ratios: Record<string, number> = { low: 0.10, medium: 0.30, high: 0.50 };
    const ratio = ratios[competitionLevel] ?? 0.30;
    const minTips: Record<string, number> = { low: 1_000, medium: 5_000, high: 25_000 };
    const minTip = minTips[competitionLevel] ?? 5_000;
    const calculated = Math.floor(expectedProfitLamports * ratio);
    return Math.min(Math.max(calculated, minTip), Math.floor(expectedProfitLamports * 0.90));
  }
}
