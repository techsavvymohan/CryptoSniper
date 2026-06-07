/**
 * Atomic Execution Engine for Solana Arbitrage Bot
 * Coordinates wallet, DEX builders, and Jito to execute trades.
 */

import {
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { WalletManager } from '../wallet/wallet-manager.js';
import { RaydiumSwapBuilder, RaydiumSwapParams } from '../builders/raydium-builder.js';
import { OrcaSwapBuilder, OrcaSwapParams } from '../builders/orca-builder.js';
import { JitoSubmitter } from '../jito/jito-submitter.js';
import {
  ArbitrageOpportunity,
  CHANNELS,
  ExecutionConfig,
  ExecutionOrder,
  RaydiumSwapParamsRaw,
  OrcaSwapParamsRaw,
  generateId,
} from '@mev-research/shared';
import { RiskEngine, ExecutionRepository, RedisClient } from '../risk/risk-engine.js';

function toRaydiumParams(raw: RaydiumSwapParamsRaw): RaydiumSwapParams {
  return {
    poolAddress: new PublicKey(raw.poolAddress),
    inputTokenMint: new PublicKey(raw.inputTokenMint),
    outputTokenMint: new PublicKey(raw.outputTokenMint),
    inputTokenAccount: new PublicKey(raw.inputTokenAccount),
    outputTokenAccount: new PublicKey(raw.outputTokenAccount),
    inputVault: new PublicKey(raw.inputVault),
    outputVault: new PublicKey(raw.outputVault),
    amountIn: BigInt(raw.amountIn),
    minimumAmountOut: BigInt(raw.minimumAmountOut),
    sqrtPriceLimitX64: BigInt(raw.sqrtPriceLimitX64),
    observationId: new PublicKey(raw.observationId),
    ammConfig: new PublicKey(raw.ammConfig),
  };
}

function toOrcaParams(raw: OrcaSwapParamsRaw): OrcaSwapParams {
  return {
    whirlpoolAddress: new PublicKey(raw.whirlpoolAddress),
    tokenOwnerAccountA: new PublicKey(raw.tokenOwnerAccountA),
    tokenOwnerAccountB: new PublicKey(raw.tokenOwnerAccountB),
    tokenVaultA: new PublicKey(raw.tokenVaultA),
    tokenVaultB: new PublicKey(raw.tokenVaultB),
    tokenMintA: new PublicKey(raw.tokenMintA),
    tokenMintB: new PublicKey(raw.tokenMintB),
    tickArrays: [
      new PublicKey(raw.tickArray0),
      new PublicKey(raw.tickArray1),
      new PublicKey(raw.tickArray2),
    ],
    oracle: new PublicKey(raw.oracle),
    amount: BigInt(raw.amount),
    otherAmountThreshold: BigInt(raw.otherAmountThreshold),
    sqrtPriceLimit: BigInt(raw.sqrtPriceLimit),
    amountSpecifiedIsInput: raw.amountSpecifiedIsInput,
    aToB: raw.aToB,
  };
}

export class ExecutionEngine {
  private activeTrades = 0;

  constructor(
    private walletManager: WalletManager,
    private raydiumBuilder: RaydiumSwapBuilder,
    private orcaBuilder: OrcaSwapBuilder,
    private jitoSubmitter: JitoSubmitter,
    private riskEngine: RiskEngine,
    private executionRepo: ExecutionRepository,
    private redis: RedisClient,
    private config: ExecutionConfig,
  ) {}

  async executeArbitrage(opportunity: ArbitrageOpportunity): Promise<ExecutionOrder | undefined> {
    try {
      // Step 1: Risk check
      const riskCheck = await this.riskEngine.canExecute(opportunity);
      if (!riskCheck.allowed) {
        console.log('[Execution] Blocked by risk engine:', riskCheck.reason);
        return;
      }

      // Step 2: Concurrency check
      if (this.activeTrades >= this.config.maxConcurrentTrades) {
        console.log('[Execution] Max concurrent trades reached');
        return;
      }
      this.activeTrades++;

      try {
        // Step 3: Check wallet balance
        const hasBalance = await this.walletManager.hasSufficientBalance(
          opportunity.requiredCapitalUsdc,
          0.01,
        );
        if (!hasBalance) throw new Error('Insufficient wallet balance');

        // Step 4: Get recent blockhash
        const { blockhash } = await this.jitoSubmitter.getRecentBlockhash();

        // Step 5 & 6: Build buy and sell instructions
        let buyInstruction;
        let sellInstruction;

        if (opportunity.buyDex === 'raydium') {
          buyInstruction = this.raydiumBuilder.buildSwapInstruction(
            toRaydiumParams(opportunity.buyParams as RaydiumSwapParamsRaw),
            this.walletManager.getPublicKey(),
          );
        } else {
          buyInstruction = this.orcaBuilder.buildSwapInstruction(
            toOrcaParams(opportunity.buyParams as OrcaSwapParamsRaw),
            this.walletManager.getPublicKey(),
          );
        }

        if (opportunity.sellDex === 'orca') {
          sellInstruction = this.orcaBuilder.buildSwapInstruction(
            toOrcaParams(opportunity.sellParams as OrcaSwapParamsRaw),
            this.walletManager.getPublicKey(),
          );
        } else {
          sellInstruction = this.raydiumBuilder.buildSwapInstruction(
            toRaydiumParams(opportunity.sellParams as RaydiumSwapParamsRaw),
            this.walletManager.getPublicKey(),
          );
        }

        // Step 7: Compute budget
        const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 });
        const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 });

        // Step 8: Build VersionedTransactions
        const buildTx = (instructions: typeof buyInstruction[]) => {
          const msg = new TransactionMessage({
            payerKey: this.walletManager.getPublicKey(),
            recentBlockhash: blockhash,
            instructions: [computeLimitIx, computePriceIx, ...instructions],
          }).compileToV0Message();
          const tx = new VersionedTransaction(msg);
          tx.sign([this.walletManager.getKeypair()]);
          return tx;
        };

        const buyTx = buildTx([buyInstruction]);
        const sellTx = buildTx([sellInstruction]);

        // Step 9: Calculate Jito tip (using ~$150 SOL price for lamport estimate)
        const expectedProfitLamports = (opportunity.netProfitUsd / 150) * LAMPORTS_PER_SOL;
        const tipLamports = this.jitoSubmitter.calculateDynamicTip(
          expectedProfitLamports,
          this.config.competitionLevel,
        );

        // Step 10: Create ExecutionOrder record
        const orderId = generateId();
        const order: ExecutionOrder = {
          id: orderId,
          opportunityId: opportunity.id,
          status: 'pending',
          netProfitUsd: opportunity.netProfitUsd,
          tipLamports,
        };

        await this.executionRepo.insert(order);
        await this.redis.publish(CHANNELS.OPPORTUNITIES, { type: 'ORDER_SUBMITTED', payload: order });

        // Step 11: Submit bundle
        const result = await this.jitoSubmitter.submitBundle(
          [buyTx, sellTx],
          this.walletManager.getKeypair(),
          tipLamports,
        );

        // Step 12: Update order based on result
        let finalOrder: ExecutionOrder;
        if (result.status === 'landed') {
          finalOrder = await this.executionRepo.updateStatus(order.id, 'landed', {
            landedAt: new Date(),
            bundleId: result.bundleId,
          });
          await this.redis.publish(CHANNELS.OPPORTUNITIES, { type: 'ORDER_LANDED', payload: finalOrder });
          console.log('[TRADE LANDED] Profit est:', opportunity.netProfitUsd.toFixed(4), 'USDC');
        } else {
          finalOrder = await this.executionRepo.updateStatus(order.id, 'failed', {
            failureReason: result.error ?? result.status,
          });
          await this.redis.publish(CHANNELS.OPPORTUNITIES, { type: 'ORDER_FAILED', payload: finalOrder });
          console.log(`[TRADE FAILED] Reason: ${result.error ?? result.status}`);
        }

        // Step 13: Refresh wallet balance after trade
        await this.walletManager.refreshBalances();
        return finalOrder;
      } finally {
        // Step 14: Decrement active trades
        this.activeTrades--;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Execution] Fatal error during arbitrage:', message);
      throw error;
    }
  }
}
