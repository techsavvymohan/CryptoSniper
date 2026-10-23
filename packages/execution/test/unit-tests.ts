import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import {
  LeaderAwareJitoSubmitter,
  JITO_REGIONAL_ENDPOINTS,
} from '../dist/jito/leader-aware-submitter.js';
import { JitoSubmitter } from '../dist/jito/jito-submitter.js';

describe('⚡ Leader-Aware Regional Jito Routing', () => {
  const dummyKeypair = Keypair.generate();
  const dummyKeypairBase58 = bs58.encode(dummyKeypair.secretKey);
  const dummyRpcUrl = 'https://api.mainnet-beta.solana.com';

  it('Exposes all strategic regional Jito Block Engine endpoints', () => {
    assert.strictEqual(JITO_REGIONAL_ENDPOINTS.AMS, 'amsterdam.mainnet.block-engine.jito.wtf:443');
    assert.strictEqual(JITO_REGIONAL_ENDPOINTS.FRA, 'frankfurt.mainnet.block-engine.jito.wtf:443');
    assert.strictEqual(JITO_REGIONAL_ENDPOINTS.TYO, 'tokyo.mainnet.block-engine.jito.wtf:443');
    assert.strictEqual(JITO_REGIONAL_ENDPOINTS.NY, 'ny.mainnet.block-engine.jito.wtf:443');
    assert.strictEqual(JITO_REGIONAL_ENDPOINTS.SLC, 'slc.mainnet.block-engine.jito.wtf:443');
    assert.ok(JITO_REGIONAL_ENDPOINTS.DEFAULT.includes('block-engine.jito.wtf'));
  });

  it('Resolves leader region according to validator stake geography distribution', () => {
    const submitter = new LeaderAwareJitoSubmitter(dummyKeypairBase58, dummyRpcUrl);

    // Slot 20: 20 % 100 < 45 -> AMS (Europe ~45% stake)
    assert.strictEqual(submitter.resolveLeaderRegion(20), 'AMS');

    // Slot 55: 55 % 100 in [45, 70) -> TYO (Asia ~25% stake)
    assert.strictEqual(submitter.resolveLeaderRegion(55), 'TYO');

    // Slot 85: 85 % 100 in [70, 100) -> NY (US ~30% stake)
    assert.strictEqual(submitter.resolveLeaderRegion(85), 'NY');

    // Fallback when slot is undefined defaults to European validator cluster (AMS)
    assert.strictEqual(submitter.resolveLeaderRegion(), 'AMS');
  });

  it('Calculates dynamic profit-scaled tips with minimum safety thresholds', () => {
    const submitter = new JitoSubmitter(dummyKeypairBase58, dummyRpcUrl);

    // $100 profit in lamports (~666,666,666 lamports at $150/SOL)
    const profitLamports = 600_000_000;

    // Low competition: 10%
    const lowTip = submitter.calculateDynamicTip(profitLamports, 'low');
    assert.strictEqual(lowTip, 60_000_000);

    // Medium competition: 30%
    const medTip = submitter.calculateDynamicTip(profitLamports, 'medium');
    assert.strictEqual(medTip, 180_000_000);

    // High competition: 50%
    const highTip = submitter.calculateDynamicTip(profitLamports, 'high');
    assert.strictEqual(highTip, 300_000_000);

    // Very small trade: enforces minimum safety floor
    const tinyProfit = 5_000;
    const tinyTip = submitter.calculateDynamicTip(tinyProfit, 'high');
    assert.ok(tinyTip > 0);
  });
});
