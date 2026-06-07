import type { PoolSnapshot, ArbitrageOpportunity } from '@mev-research/shared';
import { generateId } from '@mev-research/shared';
import { getSwapFeeBps } from '../fees/fee-calculator.js';
import { estimateSlippageBps, isTradeViableForLiquidity } from '../slippage/slippage-estimator.js';

const SPREAD_OVERHEAD_BPS = 5; // Reserved overhead for execution uncertainty

/**
 * Compare two pools for the same token pair and return a profitable
 * ArbitrageOpportunity or null if not viable.
 *
 * Steps 1–12 (per spec):
 *  1.  Normalize mints to lowercase for matching
 *  2.  Confirm pools share the same token pair
 *  3.  Determine buy pool (lower price) and sell pool (higher price)
 *  4.  Calculate gross spread in bps
 *  5.  Early exit if grossSpreadBps < 5
 *  6.  Estimate buy-side fee
 *  7.  Estimate sell-side fee
 *  8.  Estimate buy-side slippage
 *  9.  Estimate sell-side slippage
 *  10. Calculate netProfitBps = grossSpread - buyFee - sellFee - buySlippage - sellSlippage - 5
 *  11. Return null if netProfitBps <= minNetProfitBps
 *  12. Build and return ArbitrageOpportunity with confidence score (0–100)
 */
export function comparePoolPair(
  poolA: PoolSnapshot,
  poolB: PoolSnapshot,
  tradeCapitalUsdc: number,
  minNetProfitBps: number,
): ArbitrageOpportunity | null {
  // Step 1: Normalize mints to lowercase
  const aTokenA = poolA.tokenMintA.toLowerCase();
  const aTokenB = poolA.tokenMintB.toLowerCase();
  const bTokenA = poolB.tokenMintA.toLowerCase();
  const bTokenB = poolB.tokenMintB.toLowerCase();

  // Step 2: Confirm the two pools share the same token pair
  const pairMatch =
    (aTokenA === bTokenA && aTokenB === bTokenB) ||
    (aTokenA === bTokenB && aTokenB === bTokenA);
  if (!pairMatch) return null;

  // Step 3: Determine buy pool (lower price) and sell pool (higher price)
  const [buyPool, sellPool] = poolA.price <= poolB.price
    ? [poolA, poolB]
    : [poolB, poolA];

  const buyPrice = buyPool.price;
  const sellPrice = sellPool.price;
  if (buyPrice <= 0) return null;

  // Step 4: Gross spread in bps
  const grossSpreadBps = ((sellPrice - buyPrice) / buyPrice) * 10_000;

  // Step 5: Early exit if grossSpreadBps < 5
  if (grossSpreadBps < 5) return null;

  // Step 6: Buy-side fee
  const buyFeeBps = getSwapFeeBps(buyPool.dex);

  // Step 7: Sell-side fee
  const sellFeeBps = getSwapFeeBps(sellPool.dex);

  // Step 8: Buy-side slippage
  const buySlippageBps = estimateSlippageBps(buyPool, tradeCapitalUsdc);

  // Step 9: Sell-side slippage
  const sellSlippageBps = estimateSlippageBps(sellPool, tradeCapitalUsdc);

  // Step 10: Net profit in bps
  const netProfitBps =
    grossSpreadBps - buyFeeBps - sellFeeBps - buySlippageBps - sellSlippageBps - SPREAD_OVERHEAD_BPS;

  // Step 11: Return null if not sufficiently profitable
  if (netProfitBps <= minNetProfitBps) return null;

  // Reject if trade size exceeds liquidity threshold on either leg
  if (
    !isTradeViableForLiquidity(buyPool, tradeCapitalUsdc) ||
    !isTradeViableForLiquidity(sellPool, tradeCapitalUsdc)
  ) {
    return null;
  }

  // Step 12: Build ArbitrageOpportunity
  const netProfitUsd = (netProfitBps / 10_000) * tradeCapitalUsdc;

  // Confidence score: higher spread relative to costs → higher confidence, clamped 0–100
  const rawConfidence = Math.min(100, (netProfitBps / Math.max(grossSpreadBps, 1)) * 100);
  const confidenceScore = Math.max(0, Math.min(100, Math.round(rawConfidence)));

  const pair = [buyPool.tokenMintA, buyPool.tokenMintB]
    .map(m => m.slice(0, 6))
    .join('/');

  return {
    id: generateId(),
    pair,
    tokenMintA: buyPool.tokenMintA,
    tokenMintB: buyPool.tokenMintB,
    confidenceScore,
    netProfitBps,
    netProfitUsd,
    requiredCapitalUsdc: tradeCapitalUsdc,
    grossSpreadBps,
    buyFeesBps: buyFeeBps,
    sellFeesBps: sellFeeBps,
    buySlippageBps,
    sellSlippageBps,
    buyDex: buyPool.dex,
    sellDex: sellPool.dex,
    buyPoolAddress: buyPool.address,
    sellPoolAddress: sellPool.address,
    buyParams: {} as never,
    sellParams: {} as never,
    detectedAt: Date.now(),
    isProfitable: true,
  };
}
