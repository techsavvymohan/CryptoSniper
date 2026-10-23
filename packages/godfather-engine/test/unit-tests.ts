import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { Candle } from '@mev-research/shared';
import {
  calculateEMA,
  calculateWilderATR,
  calculateChoppiness,
  calculateTickDelta,
  checkDeltaAbsorption,
} from '../dist/indicators/quant-indicators.js';
import { detectM15Fractals } from '../dist/structure/fractals.js';
import {
  detectSweepAndReclaim,
  checkDisplacement,
  checkMSS,
  detectFVG,
} from '../dist/triggers/trigger-detector.js';
import { calculateGodfatherPosition } from '../dist/risk/position-sizer.js';
import { createTranches, evaluateTrancheExits } from '../dist/trade/tranche-manager.js';
import { getCurrentSession, isNearFundingReset } from '../dist/filters/session-guards.js';

describe('🎩 GODFATHER Math & Microstructure Layer', () => {

  describe('1. Quantitative Indicators', () => {
    it('Wilders smoothed ATR calculates accurately', () => {
      const candles: Candle[] = [];
      for (let i = 0; i < 20; i++) {
        candles.push({
          symbol: 'BTCUSD',
          timeframe: 'M1',
          openTime: i * 60000,
          open: 100 + i,
          high: 110 + i,
          low: 95 + i,
          close: 105 + i,
          volume: 10,
          closeTime: (i + 1) * 60000,
          isClosed: true,
        });
      }
      const atrSeries = calculateWilderATR(candles, 14);
      assert.strictEqual(atrSeries.length, 20);
      const lastAtr = atrSeries[atrSeries.length - 1]!;
      assert.ok(lastAtr >= 14 && lastAtr <= 16, `ATR should be ~15, got ${lastAtr}`);
    });

    it('Choppiness Index detects consolidation (> 61.8) and trend (< 38.2)', () => {
      // Strong linear trend
      const trendingCandles: Candle[] = [];
      for (let i = 0; i < 20; i++) {
        trendingCandles.push({
          symbol: 'BTCUSD',
          timeframe: 'M15',
          openTime: i * 900000,
          open: 100 + i * 10,
          high: 108 + i * 10,
          low: 99 + i * 10,
          close: 107 + i * 10,
          volume: 50,
          closeTime: (i + 1) * 900000,
          isClosed: true,
        });
      }
      const trendChop = calculateChoppiness(trendingCandles, 14);
      assert.ok(trendChop < 50, `Trending CHOP should be low, got ${trendChop}`);

      // Sideways oscillating
      const choppyCandles: Candle[] = [];
      for (let i = 0; i < 20; i++) {
        const isOdd = i % 2 === 1;
        choppyCandles.push({
          symbol: 'BTCUSD',
          timeframe: 'M15',
          openTime: i * 900000,
          open: isOdd ? 105 : 95,
          high: 110,
          low: 90,
          close: isOdd ? 95 : 105,
          volume: 50,
          closeTime: (i + 1) * 900000,
          isClosed: true,
        });
      }
      const chopChop = calculateChoppiness(choppyCandles, 14);
      assert.ok(chopChop > 60, `Choppy CHOP should be > 60, got ${chopChop}`);
    });

    it('Tick Delta & Absorption detects buyer exhaustion / absorption', () => {
      const sweepCandle: Candle = {
        symbol: 'BTCUSD',
        timeframe: 'M1',
        openTime: 0,
        open: 67100,
        high: 67120,
        low: 66950, // deep sweep low
        close: 66980, // closed near low -> heavy selling delta
        volume: 100,
        closeTime: 60000,
        isClosed: true,
      };

      const reclaimCandle: Candle = {
        symbol: 'BTCUSD',
        timeframe: 'M1',
        openTime: 60000,
        open: 66990,
        high: 67150,
        low: 66980,
        close: 67140, // closed near high -> heavy buying delta
        volume: 120,
        closeTime: 120000,
        isClosed: true,
      };

      const sweepDelta = calculateTickDelta(sweepCandle);
      const reclaimDelta = calculateTickDelta(reclaimCandle);

      assert.ok(sweepDelta < 0, `Sweep delta should be negative: ${sweepDelta}`);
      assert.ok(reclaimDelta > 0, `Reclaim delta should be positive: ${reclaimDelta}`);
      assert.ok(
        checkDeltaAbsorption(sweepCandle, reclaimCandle, 'BUY'),
        'Delta absorption should confirm bullish reversal',
      );
    });
  });

  describe('2. Structure & Fractal Detection', () => {
    it('Detects 5-bar Bill Williams BSL and SSL fractals', () => {
      // 10 candles with a clear swing high at index 4 and swing low at index 7
      const candles: Candle[] = [
        { symbol: 'BTCUSD', timeframe: 'M15', openTime: 0, open: 100, high: 102, low: 98, close: 101, volume: 1, closeTime: 1, isClosed: true },
        { symbol: 'BTCUSD', timeframe: 'M15', openTime: 1, open: 101, high: 105, low: 99, close: 104, volume: 1, closeTime: 2, isClosed: true },
        { symbol: 'BTCUSD', timeframe: 'M15', openTime: 2, open: 104, high: 108, low: 102, close: 107, volume: 1, closeTime: 3, isClosed: true },
        { symbol: 'BTCUSD', timeframe: 'M15', openTime: 3, open: 107, high: 112, low: 105, close: 110, volume: 1, closeTime: 4, isClosed: true },
        // Index 4: Fractal High (120)
        { symbol: 'BTCUSD', timeframe: 'M15', openTime: 4, open: 110, high: 120, low: 109, close: 115, volume: 1, closeTime: 5, isClosed: true },
        { symbol: 'BTCUSD', timeframe: 'M15', openTime: 5, open: 115, high: 114, low: 108, close: 110, volume: 1, closeTime: 6, isClosed: true },
        { symbol: 'BTCUSD', timeframe: 'M15', openTime: 6, open: 110, high: 107, low: 100, close: 102, volume: 1, closeTime: 7, isClosed: true },
        // Index 7: Fractal Low (85)
        { symbol: 'BTCUSD', timeframe: 'M15', openTime: 7, open: 102, high: 103, low: 85, close: 92, volume: 1, closeTime: 8, isClosed: true },
        { symbol: 'BTCUSD', timeframe: 'M15', openTime: 8, open: 92, high: 98, low: 89, close: 95, volume: 1, closeTime: 9, isClosed: true },
        { symbol: 'BTCUSD', timeframe: 'M15', openTime: 9, open: 95, high: 100, low: 91, close: 99, volume: 1, closeTime: 10, isClosed: true },
      ];

      const { bsl, ssl } = detectM15Fractals(candles, 10);
      assert.ok(bsl !== null, 'BSL should be detected');
      assert.strictEqual(bsl?.price, 120);

      assert.ok(ssl !== null, 'SSL should be detected');
      assert.strictEqual(ssl?.price, 85);
    });
  });

  describe('3. Triggers & SMC Invariants', () => {
    it('Validates BTC $50 sweep breach and rejection wick', () => {
      const ssl = { price: 67000, barIndex: 0, timestamp: 0, type: 'SSL' as const };
      const m1Candles: Candle[] = [
        { symbol: 'BTCUSD', timeframe: 'M1', openTime: 0, open: 67050, high: 67060, low: 67010, close: 67020, volume: 10, closeTime: 1, isClosed: true },
        // Sweep bar: Pierces to 66920 ($80 breach >= $50 requirement)
        { symbol: 'BTCUSD', timeframe: 'M1', openTime: 1, open: 67020, high: 67030, low: 66920, close: 66990, volume: 30, closeTime: 2, isClosed: true },
        // Reclaim bar: Closes back above 67000 at 67050
        { symbol: 'BTCUSD', timeframe: 'M1', openTime: 2, open: 66990, high: 67070, low: 66985, close: 67050, volume: 25, closeTime: 3, isClosed: true },
      ];

      const result = detectSweepAndReclaim(m1Candles, ssl, 50.0, 5);
      assert.ok(result.isSweep, 'Sweep should be validated');
      assert.strictEqual(result.sweepBreachUsd, 80);
    });

    it('Displacement validator requires body >= 0.60 ATR and body ratio >= 0.60', () => {
      const candle: Candle = {
        symbol: 'BTCUSD',
        timeframe: 'M1',
        openTime: 0,
        open: 67000,
        high: 67120,
        low: 66990,
        close: 67110, // Body = 110, Range = 130 -> 84.6% body ratio
        volume: 20,
        closeTime: 1,
        isClosed: true,
      };

      const atr = 100; // Body (110) >= 0.60 * 100 = 60
      const isDisplaced = checkDisplacement(candle, atr, 0.60, 0.60);
      assert.ok(isDisplaced, 'Should be institutional displacement');
    });

    it('Fair Value Gap (FVG) detects 3-bar imbalance geometry', () => {
      const m1Candles: Candle[] = [
        { symbol: 'BTCUSD', timeframe: 'M1', openTime: 0, open: 100, high: 105, low: 99, close: 103, volume: 1, closeTime: 1, isClosed: true },
        { symbol: 'BTCUSD', timeframe: 'M1', openTime: 1, open: 103, high: 130, low: 102, close: 128, volume: 5, closeTime: 2, isClosed: true },
        // Candle 3 low (115) > Candle 1 high (105) -> Bullish FVG gap of 10
        { symbol: 'BTCUSD', timeframe: 'M1', openTime: 2, open: 128, high: 135, low: 115, close: 132, volume: 2, closeTime: 3, isClosed: true },
      ];

      const fvg = detectFVG(m1Candles, 'BUY', 5.0);
      assert.ok(fvg !== null, 'Bullish FVG should be detected');
      assert.strictEqual(fvg?.bottom, 105);
      assert.strictEqual(fvg?.top, 115);
      assert.strictEqual(fvg?.midpoint, 110);
    });
  });

  describe('4. Fractional Kelly Position Sizer', () => {
    it('Applies 2.40x multiplier for A+ Unicorn and rejects inverted Stop Loss', () => {
      // Valid A+ trade
      const validSizing = calculateGodfatherPosition({
        symbol: 'BTCUSD',
        accountEquity: 10_000,
        entryPrice: 67000,
        stopLoss: 66900, // Distance $100
        direction: 'BUY',
        grade: 'A_PLUS',
        baseRiskPct: 0.85,
        convictionScaleAPlus: 2.40,
      });

      assert.ok(validSizing.isValid);
      assert.strictEqual(validSizing.convictionMultiplier, 2.40);
      // Base risk = 85 USD. Allocated risk = 85 * 2.40 = 204 USD.
      // Size = 204 / 100 = 2.04 BTC.
      assert.strictEqual(validSizing.allocatedRiskUsd, 204);
      assert.strictEqual(validSizing.positionSize, 2.04);

      // Inverted stop loss test
      const invertedSizing = calculateGodfatherPosition({
        symbol: 'BTCUSD',
        accountEquity: 10_000,
        entryPrice: 67000,
        stopLoss: 67500, // Invalid: SL above entry on a BUY
        direction: 'BUY',
        grade: 'A_PLUS',
      });

      assert.strictEqual(invertedSizing.isValid, false);
      assert.strictEqual(invertedSizing.rejectionReason, 'INVERTED_SL_FOR_BUY');
    });
  });

  describe('5. 3-Tranche Lifecycle & Breakeven Ratchet', () => {
    it('Initializes 35% / 35% / 30% tranches, moves SL to -0.40R on Tranche 1 hit, and locks Breakeven at +2.0R milestone', () => {
      const tranches = createTranches('trade-1', 67000, 66900, 1.0, 'BUY', 3.0);
      assert.strictEqual(tranches.length, 3);
      assert.strictEqual(tranches[0]!.size, 0.35);
      assert.strictEqual(tranches[0]!.targetPrice, 67150); // +1.50R
      assert.strictEqual(tranches[1]!.size, 0.35);
      assert.strictEqual(tranches[1]!.targetPrice, 67300); // +3.00R (expanded targetR2)
      assert.strictEqual(tranches[2]!.size, 0.30);

      const trade = {
        id: 'trade-1',
        signalId: 'sig-1',
        symbol: 'BTCUSD',
        direction: 'BUY' as const,
        entryPrice: 67000,
        stopLoss: 66900,
        breakevenPrice: 67000,
        isBreakevenLocked: false,
        totalSize: 1.0,
        remainingSize: 1.0,
        realizedPnlUsd: 0,
        status: 'OPEN' as const,
        openedAt: 0,
        tranches,
      };

      // Bar reaching 67160 triggers Tranche 1 (+1.50R)
      const hitCandle: Candle = {
        symbol: 'BTCUSD',
        timeframe: 'M1',
        openTime: 60000,
        open: 67050,
        high: 67160,
        low: 67040,
        close: 67155,
        volume: 10,
        closeTime: 120000,
        isClosed: true,
      };

      const result = evaluateTrancheExits(trade, hitCandle, 50, 2);
      assert.strictEqual(result.action, 'TRANCHE_1_HIT');
      // Ratchets SL to reduced risk (-0.40R = 66,960) to provide breathing room against FVG retest wicks
      assert.strictEqual(result.tradeUpdates?.isBreakevenLocked, false);
      assert.strictEqual(
        result.tradeUpdates?.stopLoss,
        66960,
        'Stop Loss should be ratcheted to reduced risk (-0.40R = 66,960)',
      );
      assert.strictEqual(result.realizedPnlDeltaUsd, 52.5); // (67150 - 67000) * 0.35 = 52.5 USD

      // Subsequent candle reaching +2.00R (67200) triggers the Breakeven lock
      const tradeAfterT1 = {
        ...trade,
        ...result.tradeUpdates,
        tranches: trade.tranches.map(t =>
          t.trancheNumber === 1 ? { ...t, status: 'TAKEN' as const } : t
        ),
      };

      const beCandle: Candle = {
        symbol: 'BTCUSD',
        timeframe: 'M1',
        openTime: 120000,
        open: 67155,
        high: 67205,
        low: 67150,
        close: 67200,
        volume: 12,
        closeTime: 180000,
        isClosed: true,
      };

      const beResult = evaluateTrancheExits(tradeAfterT1, beCandle, 50, 3);
      assert.strictEqual(beResult.tradeUpdates?.isBreakevenLocked, true);
      assert.ok(
        beResult.tradeUpdates?.stopLoss! >= 67010,
        'Stop Loss should now be ratcheted to entry (+0.10R buffer) at the +2.00R milestone',
      );
    });
  });

  describe('6. Session & Funding Reset Guards', () => {
    it('Blocks entries within 10 minutes of 00:00, 08:00, 16:00 UTC funding rate resets', () => {
      // 07:55 UTC (5 mins before 08:00 reset)
      const nearReset = new Date(Date.UTC(2026, 9, 23, 7, 55, 0)).getTime();
      assert.strictEqual(isNearFundingReset(nearReset, 10), true);

      // 08:04 UTC (4 mins after 08:00 reset)
      const afterReset = new Date(Date.UTC(2026, 9, 23, 8, 4, 0)).getTime();
      assert.strictEqual(isNearFundingReset(afterReset, 10), true);

      // 10:30 UTC (safe time)
      const safeTime = new Date(Date.UTC(2026, 9, 23, 10, 30, 0)).getTime();
      assert.strictEqual(isNearFundingReset(safeTime, 10), false);
    });
  });
});
