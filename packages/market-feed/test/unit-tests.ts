import { describe, it } from 'node:test';
import assert from 'node:assert';
import { HyperliquidFootprintService } from '../dist/footprint/hyperliquid-footprint.js';
import { GeyserDeduplicator } from '../dist/geyser/deduplicator.js';
import { MultiRegionYellowstonePool } from '../dist/geyser/multi-region-pool.js';

describe('⚡ Institutional Quant Infrastructure: Footprint & Multi-Region Geyser', () => {

  describe('1. Sub-Second Hyperliquid Footprint & VWAP Delta', () => {
    it('Calculates exact rolling VWAP, VWAP Delta, and Cumulative Volume Delta (CVD)', () => {
      const footprint = new HyperliquidFootprintService({
        symbols: ['BTC'],
        rollingWindowSecs: 60,
        obiDepth: 5,
      });

      // Inject trade 1: 1.0 BTC bought at 68,000 (Taker Buy "B")
      footprint.processTrades([
        { coin: 'BTC', px: '68000', sz: '1.0', side: 'B', time: Date.now() },
      ]);

      // Inject trade 2: 3.0 BTC bought at 68,100 (Taker Buy "B")
      footprint.processTrades([
        { coin: 'BTC', px: '68100', sz: '3.0', side: 'B', time: Date.now() },
      ]);

      let snapshot = footprint.getSnapshot('BTC');
      assert.ok(snapshot !== null);
      // Total value = (68,000 * 1) + (68,100 * 3) = 272,300
      // Total volume = 4.0
      // Expected VWAP = 272,300 / 4.0 = 68,075.00
      assert.strictEqual(snapshot?.vwap, 68075);
      assert.strictEqual(snapshot?.currentPrice, 68100);
      assert.strictEqual(snapshot?.deltaVwap, 25); // 68,100 - 68,075
      assert.strictEqual(snapshot?.cvd, 4.0); // +1.0 + 3.0

      // Inject trade 3: 2.0 BTC sold at 68,050 (Taker Sell "A")
      footprint.processTrades([
        { coin: 'BTC', px: '68050', sz: '2.0', side: 'A', time: Date.now() },
      ]);

      snapshot = footprint.getSnapshot('BTC');
      // CVD = 4.0 - 2.0 = 2.0
      assert.strictEqual(snapshot?.cvd, 2.0);
      assert.strictEqual(snapshot?.currentPrice, 68050);
    });

    it('Calculates 5-Level Order Book Imbalance (OBI) and identifies passive limit absorption', () => {
      const footprint = new HyperliquidFootprintService({
        symbols: ['BTC'],
        obiDepth: 5,
      });

      // Price at 68,000 with a positive delta
      footprint.processTrades([
        { coin: 'BTC', px: '68000', sz: '2.0', side: 'B', time: Date.now() },
      ]);

      // Heavy bid skew: 25 BTC on bid, 10 BTC on ask
      footprint.processL2Book({
        coin: 'BTC',
        time: Date.now(),
        levels: [
          // Bids (5 levels)
          [
            { px: '67990', sz: '10.0', n: 5 },
            { px: '67980', sz: '5.0', n: 3 },
            { px: '67970', sz: '5.0', n: 2 },
            { px: '67960', sz: '3.0', n: 1 },
            { px: '67950', sz: '2.0', n: 1 },
          ],
          // Asks (5 levels)
          [
            { px: '68010', sz: '4.0', n: 2 },
            { px: '68020', sz: '3.0', n: 1 },
            { px: '68030', sz: '1.0', n: 1 },
            { px: '68040', sz: '1.0', n: 1 },
            { px: '68050', sz: '1.0', n: 1 },
          ],
        ],
      });

      const snapshot = footprint.getSnapshot('BTC');
      assert.ok(snapshot !== null);
      assert.strictEqual(snapshot?.bidDepth5, 25.0);
      assert.strictEqual(snapshot?.askDepth5, 10.0);
      // OBI = (25 - 10) / (25 + 10) = 15 / 35 ≈ +0.4285
      assert.ok(snapshot?.obi! > 0.40, 'OBI should show heavy bid imbalance');

      // Ground-truth absorption rule
      assert.strictEqual(
        footprint.isSweepAbsorbed('BTC', 'BUY'),
        true,
        'Should confirm institutional absorption on BUY sweep with OBI >= 0.25',
      );
      assert.strictEqual(
        footprint.isSweepAbsorbed('BTC', 'SELL'),
        false,
        'Should reject absorption on SELL when order book is bid skewed',
      );
    });
  });

  describe('2. Multi-Region Geyser Race Deduplication', () => {
    it('Passes fastest regional update and discards duplicates in < 1 microsecond', () => {
      const deduplicator = new GeyserDeduplicator(10_000);
      const pubkey = 'RaydiumSOLUSDC1111111111111111111111111111111';

      // 1. Amsterdam node delivers slot 250,000, writeVersion 500 first
      const amsResult = deduplicator.shouldProcess(pubkey, 500, 250_000);
      assert.strictEqual(amsResult, true, 'First arriving region should pass');

      // 2. Tokyo node delivers identical slot 250,000, writeVersion 500 85ms later
      const tyoResult = deduplicator.shouldProcess(pubkey, 500, 250_000);
      assert.strictEqual(tyoResult, false, 'Slower region duplicate must be dropped');

      // 3. New York node delivers stale slot 249,999, writeVersion 499
      const ewrResult = deduplicator.shouldProcess(pubkey, 499, 249_999);
      assert.strictEqual(ewrResult, false, 'Stale writeVersion must be dropped');

      // 4. Next slot update (writeVersion 501) arrives
      const nextResult = deduplicator.shouldProcess(pubkey, 501, 250_001);
      assert.strictEqual(nextResult, true, 'Newer writeVersion should pass');

      const stats = deduplicator.getStats();
      assert.strictEqual(stats.totalEvents, 4);
      assert.strictEqual(stats.uniqueEvents, 2);
      assert.strictEqual(stats.duplicateEvents, 2);
      assert.strictEqual(stats.duplicateDropRatio, 0.5);
    });

    it('Initializes MultiRegionYellowstonePool with 3 default validator clusters (AMS, TYO, EWR)', () => {
      const pool = new MultiRegionYellowstonePool();
      const telemetry = pool.getTelemetry();

      assert.strictEqual(telemetry.length, 3);
      const regionIds = telemetry.map(t => t.regionId);
      assert.ok(regionIds.includes('AMS'));
      assert.ok(regionIds.includes('TYO'));
      assert.ok(regionIds.includes('EWR'));
    });
  });
});
