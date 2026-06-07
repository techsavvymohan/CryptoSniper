import type { PoolSnapshot } from '@mev-research/shared';

const DEX_SLIPPAGE_MULTIPLIERS: Record<string, number> = {
  raydium: 0.85,
  orca: 1.0,
};

const MAX_SLIPPAGE_BPS = 300;
const MAX_TRADE_POOL_FRACTION = 0.05; // Reject if trade > 5% of pool liquidity

/**
 * Estimate slippage in basis points for a given trade on a pool.
 * Formula: (tradeAmount / (2 * liquidity)) * 10000
 * Multiplied by a DEX-specific coefficient, clamped to 0–300 bps.
 */
export function estimateSlippageBps(
  pool: PoolSnapshot,
  tradeAmountUsdc: number,
): number {
  const liquidity = pool.liquidityA + pool.liquidityB;
  if (liquidity <= 0) return MAX_SLIPPAGE_BPS;

  const multiplier = DEX_SLIPPAGE_MULTIPLIERS[pool.dex] ?? 1.0;
  const rawSlippage = (tradeAmountUsdc / (2 * liquidity)) * 10_000 * multiplier;
  return Math.max(0, Math.min(MAX_SLIPPAGE_BPS, rawSlippage));
}

/**
 * Reject trade if tradeAmount exceeds 5% of total pool liquidity.
 */
export function isTradeViableForLiquidity(
  pool: PoolSnapshot,
  tradeAmountUsdc: number,
): boolean {
  const liquidity = pool.liquidityA + pool.liquidityB;
  if (liquidity <= 0) return false;
  return tradeAmountUsdc / liquidity <= MAX_TRADE_POOL_FRACTION;
}
