import type { Candle } from '@mev-research/shared';

/**
 * Exponential Moving Average (EMA)
 */
export function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length === 0) return [];
  if (prices.length < period) {
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    return prices.map(() => avg);
  }

  const k = 2 / (period + 1);
  const ema: number[] = new Array(prices.length);

  // Initialize with SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i]!;
  }
  ema[period - 1] = sum / period;

  for (let i = 0; i < period - 1; i++) {
    ema[i] = ema[period - 1]!;
  }

  for (let i = period; i < prices.length; i++) {
    ema[i] = prices[i]! * k + ema[i - 1]! * (1 - k);
  }

  return ema;
}

/**
 * Wilder's Smoothed Average True Range (ATR)
 */
export function calculateWilderATR(candles: Candle[], period = 14): number[] {
  const n = candles.length;
  if (n === 0) return [];
  if (n === 1) return [candles[0]!.high - candles[0]!.low];

  const tr: number[] = new Array(n);
  tr[0] = candles[0]!.high - candles[0]!.low;

  for (let i = 1; i < n; i++) {
    const curr = candles[i]!;
    const prevClose = candles[i - 1]!.close;
    tr[i] = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prevClose),
      Math.abs(curr.low - prevClose),
    );
  }

  const atr: number[] = new Array(n);
  if (n < period) {
    const avg = tr.reduce((a, b) => a + b, 0) / n;
    return tr.map(() => avg);
  }

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += tr[i]!;
  }
  atr[period - 1] = sum / period;

  for (let i = 0; i < period - 1; i++) {
    atr[i] = atr[period - 1]!;
  }

  for (let i = period; i < n; i++) {
    atr[i] = (atr[i - 1]! * (period - 1) + tr[i]!) / period;
  }

  return atr;
}

/**
 * Choppiness Index (CHOP 14)
 * CHOP = 100 * LOG10( SUM(TrueRange, 14) / (MaxHigh(14) - MinLow(14)) ) / LOG10(14)
 * Value > 61.8 indicates choppy/sideways market.
 */
export function calculateChoppiness(candles: Candle[], period = 14): number {
  if (candles.length < period) return 50.0;

  const slice = candles.slice(-period);
  let trSum = 0;
  let maxHigh = -Infinity;
  let minLow = Infinity;

  for (let i = 0; i < slice.length; i++) {
    const c = slice[i]!;
    if (c.high > maxHigh) maxHigh = c.high;
    if (c.low < minLow) minLow = c.low;

    if (i === 0) {
      trSum += c.high - c.low;
    } else {
      const prevClose = slice[i - 1]!.close;
      trSum += Math.max(
        c.high - c.low,
        Math.abs(c.high - prevClose),
        Math.abs(c.low - prevClose),
      );
    }
  }

  const range = maxHigh - minLow;
  if (range <= 0) return 100.0;

  const chop = 100 * (Math.log10(trSum / range) / Math.log10(period));
  return Math.max(0, Math.min(100, chop));
}

/**
 * Approximate intra-candle Tick Delta:
 * Delta = Volume * (2*Close - High - Low) / (High - Low)
 */
export function calculateTickDelta(candle: Candle): number {
  const range = candle.high - candle.low;
  if (range <= 0) return 0;
  return candle.volume * ((2 * candle.close - candle.high - candle.low) / range);
}

/**
 * Absorption Check:
 * When sweeping a low (BUY setup), reclaim candle delta must turn positive or absorb sweep sellers.
 * When sweeping a high (SELL setup), reclaim candle delta must turn negative or absorb sweep buyers.
 */
export function checkDeltaAbsorption(
  sweepCandle: Candle,
  reclaimCandle: Candle,
  direction: 'BUY' | 'SELL',
): boolean {
  const sweepDelta = calculateTickDelta(sweepCandle);
  const reclaimDelta = calculateTickDelta(reclaimCandle);

  if (direction === 'BUY') {
    // Reclaim should have positive delta or significantly less negative than sweep
    return reclaimDelta > 0 || reclaimDelta >= sweepDelta;
  } else {
    // Reclaim should have negative delta or significantly less positive than sweep
    return reclaimDelta < 0 || reclaimDelta <= sweepDelta;
  }
}
