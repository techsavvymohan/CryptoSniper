// Solana base transaction fee per signature
const BASE_FEE_LAMPORTS = 5_000;
// Conservative priority fee for competitive execution
const PRIORITY_FEE_LAMPORTS = 200_000;

// Protocol swap fees in basis points (conservative, rounded up)
export const DEX_FEES_BPS = {
  raydium: 30,
  orca: 32,
  jupiter: 0,
} as const;

export type DexName = keyof typeof DEX_FEES_BPS;

export function getSwapFeeBps(dex: DexName): number {
  return DEX_FEES_BPS[dex];
}

/**
 * Estimate total network fee for a two-legged arbitrage:
 * baseFee(5000) + priorityFee(200000) = 205000 lamports per transaction × 2 txs.
 */
export function estimateNetworkFee(): number {
  return (BASE_FEE_LAMPORTS + PRIORITY_FEE_LAMPORTS) * 2; // 410_000 lamports for both legs
}

/**
 * Estimate Jito tip in lamports.
 * Never exceeds 90% of expectedProfitLamports.
 */
export function estimateJitoTip(
  expectedProfitLamports: number,
  competitionLevel: 'low' | 'medium' | 'high',
  customRatio?: number,
): number {
  const ratios = { low: 0.10, medium: 0.30, high: 0.50 };
  const ratio = customRatio ?? ratios[competitionLevel];
  const calculated = Math.floor(expectedProfitLamports * ratio);
  const cap = Math.floor(expectedProfitLamports * 0.90);
  return Math.min(calculated, cap);
}

export interface TotalCosts {
  buyFeeBps: number;
  sellFeeBps: number;
  networkFeeLamports: number;
  networkFeeUsd: number;
  jitoTipLamports: number;
  jitoTipUsd: number;
  totalCostBps: number;
}

/**
 * Calculate all costs for an arbitrage leg pair.
 * solPriceUsd is used to convert lamport costs to USD equivalent in bps.
 */
export function calculateTotalCosts(params: {
  buyDex: DexName;
  sellDex: DexName;
  tradeCapitalUsdc: number;
  expectedProfitUsdc: number;
  competitionLevel: 'low' | 'medium' | 'high';
  solPriceUsd?: number;
  jitoTipRatio?: number;
}): TotalCosts {
  const solPrice = params.solPriceUsd ?? 150;
  const buyFeeBps = getSwapFeeBps(params.buyDex);
  const sellFeeBps = getSwapFeeBps(params.sellDex);
  const networkFeeLamports = estimateNetworkFee();
  const networkFeeUsd = (networkFeeLamports / 1e9) * solPrice;
  const networkFeeBps = (networkFeeUsd / params.tradeCapitalUsdc) * 10_000;

  const expectedProfitLamports = (params.expectedProfitUsdc / solPrice) * 1e9;
  const jitoTipLamports = estimateJitoTip(
    expectedProfitLamports,
    params.competitionLevel,
    params.jitoTipRatio,
  );
  const jitoTipUsd = (jitoTipLamports / 1e9) * solPrice;
  const jitoTipBps = (jitoTipUsd / params.tradeCapitalUsdc) * 10_000;

  return {
    buyFeeBps,
    sellFeeBps,
    networkFeeLamports,
    networkFeeUsd,
    jitoTipLamports,
    jitoTipUsd,
    totalCostBps: buyFeeBps + sellFeeBps + networkFeeBps + jitoTipBps,
  };
}
