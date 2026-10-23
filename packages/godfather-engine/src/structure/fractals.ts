import type { Candle, FractalLevel } from '@mev-research/shared';

export interface StructuralLiquidity {
  bsl: FractalLevel | null;
  ssl: FractalLevel | null;
}

/**
 * Detects Bill Williams 5-bar fractals on M15 bars across the specified lookback window.
 * Requires 2 bars to the left and 2 bars to the right to be confirmed.
 */
export function detectM15Fractals(
  candles: Candle[],
  lookback = 20,
): StructuralLiquidity {
  const n = candles.length;
  if (n < 5) {
    return { bsl: null, ssl: null };
  }

  const startIdx = Math.max(2, n - lookback);
  // Last index we can confirm as a 5-bar fractal is n - 3 (needs i+1, i+2)
  const endIdx = n - 3;

  let latestBsl: FractalLevel | null = null;
  let latestSsl: FractalLevel | null = null;

  for (let i = startIdx; i <= endIdx; i++) {
    const c = candles[i]!;
    const cMinus2 = candles[i - 2]!;
    const cMinus1 = candles[i - 1]!;
    const cPlus1 = candles[i + 1]!;
    const cPlus2 = candles[i + 2]!;

    // Buy-Side Liquidity (Fractal High)
    if (
      c.high > cMinus1.high &&
      c.high > cMinus2.high &&
      c.high > cPlus1.high &&
      c.high > cPlus2.high
    ) {
      latestBsl = {
        price: c.high,
        barIndex: i,
        timestamp: c.openTime,
        type: 'BSL',
      };
    }

    // Sell-Side Liquidity (Fractal Low)
    if (
      c.low < cMinus1.low &&
      c.low < cMinus2.low &&
      c.low < cPlus1.low &&
      c.low < cPlus2.low
    ) {
      latestSsl = {
        price: c.low,
        barIndex: i,
        timestamp: c.openTime,
        type: 'SSL',
      };
    }
  }

  return { bsl: latestBsl, ssl: latestSsl };
}
