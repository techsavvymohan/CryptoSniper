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

describe('🛡️ Execution Safety Gateway', async () => {
  const { ExecutionGateway } = await import('../dist/gateway/execution-gateway.js');

  const gateway = new ExecutionGateway({
    maxSingleOrderNotionalUsd: 10_000,
    maxDailyNotionalUsd: 100_000,
    duplicateWindowMs: 2_000,
    maxAllowedSlippageBps: 50,
  });

  it('Approves valid order and increments nonce monotonically', () => {
    const res = gateway.validatePreFlight({
      id: 'ord-01',
      correlationId: 'corr-01',
      symbol: 'BTCUSD',
      venue: 'hyperliquid',
      direction: 'BUY',
      orderType: 'LIMIT',
      price: 65000,
      size: 0.1,
      notionalUsd: 6500,
      timestamp: Date.now(),
    }, 10_000, true);

    assert.strictEqual(res.allowed, true);
    assert.strictEqual(res.nonce, 1);
    assert.ok(res.orderHash.length > 0);
  });

  it('Rejects duplicate orders within time window', () => {
    const req = {
      id: 'ord-02',
      correlationId: 'corr-02',
      symbol: 'BTCUSD',
      venue: 'hyperliquid' as const,
      direction: 'BUY' as const,
      orderType: 'LIMIT' as const,
      price: 65000,
      size: 0.1,
      notionalUsd: 6500,
      timestamp: Date.now(),
    };

    const res = gateway.validatePreFlight(req, 10_000, true);
    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.rejectionReason, 'DUPLICATE_ORDER');
  });

  it('Rejects orders exceeding single order notional cap', () => {
    const res = gateway.validatePreFlight({
      id: 'ord-03',
      correlationId: 'corr-03',
      symbol: 'SOLUSD',
      venue: 'hyperliquid',
      direction: 'BUY',
      orderType: 'LIMIT',
      price: 180,
      size: 100,
      notionalUsd: 18_000, // Exceeds 10,000 cap
      timestamp: Date.now(),
    }, 25_000, true);

    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.rejectionReason, 'EXCEEDS_MAX_NOTIONAL');
  });

  it('Blocks all orders when kill switch is activated', () => {
    gateway.activateKillSwitch('Emergency drill test');

    const res = gateway.validatePreFlight({
      id: 'ord-04',
      correlationId: 'corr-04',
      symbol: 'SOLUSD',
      venue: 'paper',
      direction: 'SELL',
      orderType: 'LIMIT',
      price: 180,
      size: 1,
      notionalUsd: 180,
      timestamp: Date.now(),
    }, 10_000, true);

    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.rejectionReason, 'KILL_SWITCH_ACTIVE');

    gateway.deactivateKillSwitch();
  });
});

describe('⚖️ Institutional Standalone Risk Engine', async () => {
  const { InstitutionalRiskEngine } = await import('../dist/risk/institutional-risk-engine.js');

  const riskEngine = new InstitutionalRiskEngine({
    accountEquityUsd: 10_000,
    dailyLossLimitUsd: 450,
    maxDrawdownPct: 9.0,
    maxSinglePositionNotionalUsd: 25_000,
    maxTotalPortfolioExposureUsd: 50_000,
    consecutiveLossesThrottleThreshold: 2,
    correlatedRiskScale: 0.60,
    staleFeedThresholdMs: 2500,
  });

  it('Approves normal risk and scales down on correlated positions', () => {
    const decision = riskEngine.evaluateOrderRisk({
      symbol: 'SOLUSD',
      direction: 'BUY',
      allocatedRiskUsd: 100,
      positionNotionalUsd: 5_000,
      currentOpenTrades: [
        { symbol: 'BTCUSD', direction: 'BUY', notionalUsd: 10_000 },
      ],
      todayRealizedPnlUsd: 50,
      peakEquityUsd: 10_050,
    });

    assert.strictEqual(decision.approved, true);
    // Correlated risk scale applied: 100 * 0.60 = 60
    assert.strictEqual(decision.adjustedRiskUsd, 60);
  });

  it('Transitions to THROTTLED after consecutive losses and cuts size by 50%', () => {
    riskEngine.recordTradeOutcome(-100);
    riskEngine.recordTradeOutcome(-85); // 2 consecutive losses

    assert.strictEqual(riskEngine.getState().state, 'THROTTLED');

    const decision = riskEngine.evaluateOrderRisk({
      symbol: 'BTCUSD',
      direction: 'BUY',
      allocatedRiskUsd: 100,
      positionNotionalUsd: 5_000,
      currentOpenTrades: [],
      todayRealizedPnlUsd: -185,
      peakEquityUsd: 10_000,
    });

    assert.strictEqual(decision.approved, true);
    // Throttled: 100 * 0.50 = 50
    assert.strictEqual(decision.adjustedRiskUsd, 50);
  });

  it('Trips CIRCUIT_BREAKER when daily loss exceeds -$450', () => {
    const decision = riskEngine.evaluateOrderRisk({
      symbol: 'BTCUSD',
      direction: 'BUY',
      allocatedRiskUsd: 100,
      positionNotionalUsd: 5_000,
      currentOpenTrades: [],
      todayRealizedPnlUsd: -460, // Exceeds -$450
      peakEquityUsd: 10_000,
    });

    assert.strictEqual(decision.approved, false);
    assert.strictEqual(decision.state, 'CIRCUIT_BREAKER_TRIPPED');
    assert.strictEqual(decision.adjustedRiskUsd, 0);
  });
});
