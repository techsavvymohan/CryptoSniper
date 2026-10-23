import { EventEmitter } from 'events';

export type RiskState = 'NORMAL' | 'THROTTLED' | 'CIRCUIT_BREAKER_TRIPPED' | 'EMERGENCY_UNWIND';

export interface InstitutionalRiskConfig {
  accountEquityUsd: number;
  dailyLossLimitUsd: number; // e.g. 450.0 (4.5%)
  maxDrawdownPct: number; // e.g. 9.0%
  maxSinglePositionNotionalUsd: number;
  maxTotalPortfolioExposureUsd: number;
  consecutiveLossesThrottleThreshold: number; // e.g. 2
  correlatedRiskScale: number; // e.g. 0.60
  staleFeedThresholdMs: number; // e.g. 2500ms
}

export interface RiskEvaluationRequest {
  symbol: string;
  direction: 'BUY' | 'SELL';
  allocatedRiskUsd: number;
  positionNotionalUsd: number;
  currentOpenTrades: Array<{
    symbol: string;
    direction: 'BUY' | 'SELL';
    notionalUsd: number;
    unrealizedPnlUsd?: number;
  }>;
  todayRealizedPnlUsd: number;
  peakEquityUsd: number;
  lastFeedHeartbeatMs?: number;
}

export interface RiskDecision {
  approved: boolean;
  state: RiskState;
  adjustedRiskUsd: number;
  adjustedNotionalUsd: number;
  reason?: string;
  violations: string[];
}

export class InstitutionalRiskEngine extends EventEmitter {
  private config: InstitutionalRiskConfig;
  private state: RiskState = 'NORMAL';
  private consecutiveLosses = 0;
  private stateReason = 'System initialized in normal state';

  constructor(config: InstitutionalRiskConfig) {
    super();
    this.config = config;
  }

  public getState(): { state: RiskState; reason: string; consecutiveLosses: number } {
    return {
      state: this.state,
      reason: this.stateReason,
      consecutiveLosses: this.consecutiveLosses,
    };
  }

  public recordTradeOutcome(realizedPnlUsd: number): void {
    if (realizedPnlUsd < 0) {
      this.consecutiveLosses++;
      if (
        this.consecutiveLosses >= this.config.consecutiveLossesThrottleThreshold &&
        this.state === 'NORMAL'
      ) {
        this.transitionState(
          'THROTTLED',
          `Throttled after ${this.consecutiveLosses} consecutive realized losses`,
        );
      }
    } else if (realizedPnlUsd > 0) {
      this.consecutiveLosses = 0;
      if (this.state === 'THROTTLED') {
        this.transitionState('NORMAL', 'Consecutive loss streak broken by winning trade');
      }
    }
  }

  public transitionState(newState: RiskState, reason: string): void {
    const oldState = this.state;
    this.state = newState;
    this.stateReason = reason;
    this.emit('stateTransition', { oldState, newState, reason, timestamp: Date.now() });
    console.warn(`[RiskEngine] ⚠️ State transition: ${oldState} ➔ ${newState} (${reason})`);
  }

  public evaluateOrderRisk(req: RiskEvaluationRequest): RiskDecision {
    const violations: string[] = [];
    const now = Date.now();

    // 1. Feed Staleness Check
    if (req.lastFeedHeartbeatMs && now - req.lastFeedHeartbeatMs > this.config.staleFeedThresholdMs) {
      violations.push(`STALE_FEED: Heartbeat delayed by ${now - req.lastFeedHeartbeatMs}ms (> ${this.config.staleFeedThresholdMs}ms limit)`);
    }

    // 2. Daily Loss Limit Check
    if (req.todayRealizedPnlUsd <= -this.config.dailyLossLimitUsd) {
      if (this.state !== 'CIRCUIT_BREAKER_TRIPPED') {
        this.transitionState(
          'CIRCUIT_BREAKER_TRIPPED',
          `Daily loss limit breached: -$${Math.abs(req.todayRealizedPnlUsd).toFixed(2)} (cap: -$${this.config.dailyLossLimitUsd})`,
        );
      }
      violations.push(`DAILY_LOSS_LIMIT: Realized daily loss exceeds -$${this.config.dailyLossLimitUsd}`);
    }

    // 3. Peak Drawdown Check
    const currentTotalEquity = this.config.accountEquityUsd + req.todayRealizedPnlUsd;
    const peakEquity = Math.max(req.peakEquityUsd, this.config.accountEquityUsd);
    const drawdownPct = ((peakEquity - currentTotalEquity) / peakEquity) * 100;
    if (drawdownPct >= this.config.maxDrawdownPct) {
      if (this.state !== 'CIRCUIT_BREAKER_TRIPPED') {
        this.transitionState(
          'CIRCUIT_BREAKER_TRIPPED',
          `Max portfolio drawdown breached: ${drawdownPct.toFixed(2)}% (cap: ${this.config.maxDrawdownPct}%)`,
        );
      }
      violations.push(`MAX_DRAWDOWN: Drawdown ${drawdownPct.toFixed(2)}% exceeds ${this.config.maxDrawdownPct}% cap`);
    }

    // If circuit breaker is tripped or emergency unwind, reject all new risk
    if (this.state === 'CIRCUIT_BREAKER_TRIPPED' || this.state === 'EMERGENCY_UNWIND') {
      return {
        approved: false,
        state: this.state,
        adjustedRiskUsd: 0,
        adjustedNotionalUsd: 0,
        reason: this.stateReason,
        violations,
      };
    }

    // 4. Single Position Notional Cap
    if (req.positionNotionalUsd > this.config.maxSinglePositionNotionalUsd) {
      violations.push(`SINGLE_NOTIONAL_EXCEEDED: $${req.positionNotionalUsd} > $${this.config.maxSinglePositionNotionalUsd}`);
    }

    // 5. Total Portfolio Exposure Cap
    const currentOpenNotional = req.currentOpenTrades.reduce((acc, t) => acc + t.notionalUsd, 0);
    if (currentOpenNotional + req.positionNotionalUsd > this.config.maxTotalPortfolioExposureUsd) {
      violations.push(`TOTAL_EXPOSURE_EXCEEDED: $${(currentOpenNotional + req.positionNotionalUsd).toFixed(2)} > $${this.config.maxTotalPortfolioExposureUsd}`);
    }

    if (violations.length > 0) {
      return {
        approved: false,
        state: this.state,
        adjustedRiskUsd: 0,
        adjustedNotionalUsd: 0,
        reason: violations.join('; '),
        violations,
      };
    }

    // Dynamic Sizing Adjustment based on state & correlation
    let riskMultiplier = 1.0;

    // A. Throttled state reduces sizing by 50%
    if (this.state === 'THROTTLED') {
      riskMultiplier *= 0.50;
    }

    // B. Correlation Limiter: If existing position is open in same direction on correlated asset (BTC/SOL)
    const hasCorrelatedPosition = req.currentOpenTrades.some(
      t => t.direction === req.direction && t.symbol !== req.symbol,
    );
    if (hasCorrelatedPosition) {
      riskMultiplier *= this.config.correlatedRiskScale; // Scale down by 0.60x
    }

    const adjustedRiskUsd = req.allocatedRiskUsd * riskMultiplier;
    const adjustedNotionalUsd = req.positionNotionalUsd * riskMultiplier;

    return {
      approved: true,
      state: this.state,
      adjustedRiskUsd,
      adjustedNotionalUsd,
      violations: [],
    };
  }

  public triggerEmergencyUnwind(reason: string): void {
    this.transitionState('EMERGENCY_UNWIND', reason);
    this.emit('emergencyUnwindTriggered', { reason, timestamp: Date.now() });
    console.error(`[RiskEngine] 🚨 EMERGENCY UNWIND TRIGGERED: ${reason}`);
  }

  public resetCircuitBreaker(): void {
    this.consecutiveLosses = 0;
    this.transitionState('NORMAL', 'Operator manual reset');
  }
}
