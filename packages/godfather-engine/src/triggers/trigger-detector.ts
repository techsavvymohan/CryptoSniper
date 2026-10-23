import type { Candle, FairValueGap, FractalLevel } from '@mev-research/shared';

export interface SweepValidation {
  isSweep: boolean;
  sweepCandle?: Candle;
  reclaimCandle?: Candle;
  sweepBreachUsd: number;
}

export interface MSSValidation {
  hasMSS: boolean;
  breakLevel?: number;
  mssCandle?: Candle;
}

/**
 * Validates whether an M15 structural level was swept and reclaimed on M1 bars.
 */
export function detectSweepAndReclaim(
  m1Candles: Candle[],
  level: FractalLevel,
  minBreachUsd: number,
  sequenceWindow = 10,
): SweepValidation {
  const n = m1Candles.length;
  if (n < 2) {
    return { isSweep: false, sweepBreachUsd: 0 };
  }

  const lookbackStart = Math.max(0, n - sequenceWindow);
  const current = m1Candles[n - 1]!;

  if (level.type === 'SSL') {
    // Bullish Reclaim Setup: Price pierced below SSL, and current bar closed above SSL
    let minLow = Infinity;
    let sweepCandle: Candle | undefined;

    for (let i = lookbackStart; i < n; i++) {
      const c = m1Candles[i]!;
      if (c.low < minLow) {
        minLow = c.low;
        sweepCandle = c;
      }
    }

    const breachUsd = level.price - minLow;
    if (breachUsd >= minBreachUsd && current.close > level.price && sweepCandle) {
      const range = sweepCandle.high - sweepCandle.low;
      const lowerWick = range > 0 ? (level.price - sweepCandle.low) / range : 0;

      // Ensure rejection wick is at least 30% of sweep candle
      if (lowerWick >= 0.25) {
        return {
          isSweep: true,
          sweepCandle,
          reclaimCandle: current,
          sweepBreachUsd: breachUsd,
        };
      }
    }
  } else if (level.type === 'BSL') {
    // Bearish Reclaim Setup: Price pierced above BSL, and current bar closed below BSL
    let maxHigh = -Infinity;
    let sweepCandle: Candle | undefined;

    for (let i = lookbackStart; i < n; i++) {
      const c = m1Candles[i]!;
      if (c.high > maxHigh) {
        maxHigh = c.high;
        sweepCandle = c;
      }
    }

    const breachUsd = maxHigh - level.price;
    if (breachUsd >= minBreachUsd && current.close < level.price && sweepCandle) {
      const range = sweepCandle.high - sweepCandle.low;
      const upperWick = range > 0 ? (sweepCandle.high - level.price) / range : 0;

      if (upperWick >= 0.25) {
        return {
          isSweep: true,
          sweepCandle,
          reclaimCandle: current,
          sweepBreachUsd: breachUsd,
        };
      }
    }
  }

  return { isSweep: false, sweepBreachUsd: 0 };
}

/**
 * Validates institutional displacement impulse:
 * Real Body >= minAtrRatio * ATR(14) AND Body / Range >= minBodyRatio
 */
export function checkDisplacement(
  candle: Candle,
  atr: number,
  minAtrRatio = 0.60,
  minBodyRatio = 0.60,
): boolean {
  if (atr <= 0) return false;
  const range = candle.high - candle.low;
  if (range <= 0) return false;

  const body = Math.abs(candle.close - candle.open);
  const atrRatio = body / atr;
  const bodyRatio = body / range;

  return atrRatio >= minAtrRatio && bodyRatio >= minBodyRatio;
}

/**
 * Checks for Market Structure Shift (MSS / CHoCH) on M1 bars.
 */
export function checkMSS(
  m1Candles: Candle[],
  direction: 'BUY' | 'SELL',
  scanBars = 5,
): MSSValidation {
  const n = m1Candles.length;
  if (n < 4) return { hasMSS: false };

  const current = m1Candles[n - 1]!;

  if (direction === 'BUY') {
    // Find highest minor swing high in previous bars before current
    let maxSwingHigh = -Infinity;
    for (let i = Math.max(1, n - scanBars - 1); i < n - 1; i++) {
      const c = m1Candles[i]!;
      const prev = m1Candles[i - 1]!;
      const next = m1Candles[i + 1]!;
      if (c.high > prev.high && c.high > next.high) {
        if (c.high > maxSwingHigh) maxSwingHigh = c.high;
      }
    }

    if (maxSwingHigh > -Infinity && current.close > maxSwingHigh) {
      return { hasMSS: true, breakLevel: maxSwingHigh, mssCandle: current };
    }
  } else {
    // Find lowest minor swing low in previous bars before current
    let minSwingLow = Infinity;
    for (let i = Math.max(1, n - scanBars - 1); i < n - 1; i++) {
      const c = m1Candles[i]!;
      const prev = m1Candles[i - 1]!;
      const next = m1Candles[i + 1]!;
      if (c.low < prev.low && c.low < next.low) {
        if (c.low < minSwingLow) minSwingLow = c.low;
      }
    }

    if (minSwingLow < Infinity && current.close < minSwingLow) {
      return { hasMSS: true, breakLevel: minSwingLow, mssCandle: current };
    }
  }

  return { hasMSS: false };
}

/**
 * Detects Fair Value Gap (FVG) across the last 3 closed M1 candles [k-2, k-1, k].
 */
export function detectFVG(
  m1Candles: Candle[],
  direction: 'BUY' | 'SELL',
  minGapUsd: number,
): FairValueGap | null {
  const n = m1Candles.length;
  if (n < 3) return null;

  const c1 = m1Candles[n - 3]!; // k-2
  const c3 = m1Candles[n - 1]!; // k (current)

  if (direction === 'BUY') {
    // Bullish FVG: Low of candle 3 must be strictly above High of candle 1
    const gap = c3.low - c1.high;
    if (gap >= minGapUsd) {
      return {
        top: c3.low,
        bottom: c1.high,
        midpoint: (c3.low + c1.high) / 2,
        type: 'BULLISH',
        barIndex: n - 1,
        timestamp: c3.openTime,
      };
    }
  } else {
    // Bearish FVG: High of candle 3 must be strictly below Low of candle 1
    const gap = c1.low - c3.high;
    if (gap >= minGapUsd) {
      return {
        top: c1.low,
        bottom: c3.high,
        midpoint: (c1.low + c3.high) / 2,
        type: 'BEARISH',
        barIndex: n - 1,
        timestamp: c3.openTime,
      };
    }
  }

  return null;
}
