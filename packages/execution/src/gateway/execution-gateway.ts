import { EventEmitter } from 'events';
import crypto from 'crypto';

export interface PreFlightOrderRequest {
  id: string;
  correlationId: string;
  symbol: string;
  venue: 'hyperliquid' | 'bybit' | 'jito' | 'paper';
  direction: 'BUY' | 'SELL';
  orderType: 'LIMIT' | 'MARKET' | 'TRIGGER_STOP';
  price: number;
  size: number;
  notionalUsd: number;
  slippageToleranceBps?: number;
  reduceOnly?: boolean;
  timestamp: number;
  postOnly?: boolean;
}

export type GatewayRejectionReason =
  | 'KILL_SWITCH_ACTIVE'
  | 'CIRCUIT_BREAKER_TRIPPED'
  | 'DUPLICATE_ORDER'
  | 'OUT_OF_SEQUENCE_NONCE'
  | 'EXCEEDS_MAX_NOTIONAL'
  | 'INSUFFICIENT_MARGIN'
  | 'SLIPPAGE_TOLERANCE_EXCEEDED'
  | 'INVALID_PRICE_OR_SIZE'
  | 'VENUE_OFFLINE'
  | 'FEED_STALE';

export interface PreFlightValidationResult {
  allowed: boolean;
  rejectionReason?: GatewayRejectionReason;
  message?: string;
  orderHash: string;
  nonce: number;
  timestamp: number;
}

export interface ExecutionGatewayConfig {
  maxSingleOrderNotionalUsd: number;
  maxDailyNotionalUsd: number;
  duplicateWindowMs?: number; // Default 5000ms
  maxAllowedSlippageBps?: number; // Default 50 bps (0.50%)
}

export class ExecutionGateway extends EventEmitter {
  private config: ExecutionGatewayConfig;
  private currentNonce = 0;
  private recentOrderHashes = new Map<string, number>(); // hash -> timestamp
  private dailyNotionalAccumulator = 0;
  private lastResetDay = new Date().toISOString().split('T')[0];
  private isKillSwitchActive = false;
  private killSwitchReason = '';

  constructor(config: ExecutionGatewayConfig) {
    super();
    this.config = {
      ...config,
      duplicateWindowMs: config.duplicateWindowMs ?? 5_000,
      maxAllowedSlippageBps: config.maxAllowedSlippageBps ?? 50,
    };
  }

  /**
   * Generates a deterministic order content hash to detect accidental duplicate order firing.
   */
  public generateOrderHash(req: PreFlightOrderRequest): string {
    const payload = `${req.venue}:${req.symbol}:${req.direction}:${req.price.toFixed(4)}:${req.size.toFixed(4)}:${req.reduceOnly ? '1' : '0'}`;
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
  }

  /**
   * Pre-flight gatekeeper. Every order in the entire system MUST pass through here
   * before reaching any exchange adapter or Jito block engine.
   */
  public validatePreFlight(
    req: PreFlightOrderRequest,
    availableMarginUsd = Infinity,
    isFeedHealthy = true,
  ): PreFlightValidationResult {
    const now = Date.now();
    this.currentNonce++;
    const nonce = this.currentNonce;
    const orderHash = this.generateOrderHash(req);

    // Reset daily accumulator at midnight UTC
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.lastResetDay) {
      this.dailyNotionalAccumulator = 0;
      this.lastResetDay = today;
    }

    // 1. Kill Switch Check
    if (this.isKillSwitchActive) {
      const result: PreFlightValidationResult = {
        allowed: false,
        rejectionReason: 'KILL_SWITCH_ACTIVE',
        message: `Kill switch active: ${this.killSwitchReason}`,
        orderHash,
        nonce,
        timestamp: now,
      };
      this.emit('orderRejected', { req, result });
      return result;
    }

    // 2. Feed Health / Staleness Check
    if (!isFeedHealthy) {
      const result: PreFlightValidationResult = {
        allowed: false,
        rejectionReason: 'FEED_STALE',
        message: 'Market data feed is degraded or stale (> 2500ms)',
        orderHash,
        nonce,
        timestamp: now,
      };
      this.emit('orderRejected', { req, result });
      return result;
    }

    // 3. Mathematical Sanity Check
    if (req.price <= 0 || req.size <= 0 || isNaN(req.price) || isNaN(req.size)) {
      const result: PreFlightValidationResult = {
        allowed: false,
        rejectionReason: 'INVALID_PRICE_OR_SIZE',
        message: `Invalid order price ($${req.price}) or size (${req.size})`,
        orderHash,
        nonce,
        timestamp: now,
      };
      this.emit('orderRejected', { req, result });
      return result;
    }

    // 4. Duplicate Order Suppression Check
    const lastSeenTime = this.recentOrderHashes.get(orderHash);
    if (lastSeenTime && now - lastSeenTime < this.config.duplicateWindowMs!) {
      const result: PreFlightValidationResult = {
        allowed: false,
        rejectionReason: 'DUPLICATE_ORDER',
        message: `Duplicate order detected within ${this.config.duplicateWindowMs}ms window (hash: ${orderHash})`,
        orderHash,
        nonce,
        timestamp: now,
      };
      this.emit('orderRejected', { req, result });
      return result;
    }

    // 5. Single Order Notional Ceiling Check
    if (req.notionalUsd > this.config.maxSingleOrderNotionalUsd) {
      const result: PreFlightValidationResult = {
        allowed: false,
        rejectionReason: 'EXCEEDS_MAX_NOTIONAL',
        message: `Notional $${req.notionalUsd.toFixed(2)} exceeds single order cap $${this.config.maxSingleOrderNotionalUsd}`,
        orderHash,
        nonce,
        timestamp: now,
      };
      this.emit('orderRejected', { req, result });
      return result;
    }

    // 6. Margin / Balance Check (unless reduceOnly)
    if (!req.reduceOnly && req.notionalUsd > availableMarginUsd) {
      const result: PreFlightValidationResult = {
        allowed: false,
        rejectionReason: 'INSUFFICIENT_MARGIN',
        message: `Required margin $${req.notionalUsd.toFixed(2)} exceeds available $${availableMarginUsd.toFixed(2)}`,
        orderHash,
        nonce,
        timestamp: now,
      };
      this.emit('orderRejected', { req, result });
      return result;
    }

    // 7. Slippage Guardrail Check
    if (
      req.slippageToleranceBps !== undefined &&
      req.slippageToleranceBps > this.config.maxAllowedSlippageBps!
    ) {
      const result: PreFlightValidationResult = {
        allowed: false,
        rejectionReason: 'SLIPPAGE_TOLERANCE_EXCEEDED',
        message: `Requested slippage ${req.slippageToleranceBps} bps exceeds safety cap ${this.config.maxAllowedSlippageBps} bps`,
        orderHash,
        nonce,
        timestamp: now,
      };
      this.emit('orderRejected', { req, result });
      return result;
    }

    // Record order hash to prevent duplicates
    this.recentOrderHashes.set(orderHash, now);
    this.dailyNotionalAccumulator += req.notionalUsd;

    // Clean up stale hashes
    const cutoff = now - this.config.duplicateWindowMs!;
    for (const [h, t] of this.recentOrderHashes.entries()) {
      if (t < cutoff) this.recentOrderHashes.delete(h);
    }

    const passedResult: PreFlightValidationResult = {
      allowed: true,
      orderHash,
      nonce,
      timestamp: now,
    };

    this.emit('orderApproved', { req, result: passedResult });
    return passedResult;
  }

  public activateKillSwitch(reason: string): void {
    this.isKillSwitchActive = true;
    this.killSwitchReason = reason;
    this.emit('killSwitchTriggered', { reason, timestamp: Date.now() });
    console.error(`[ExecutionGateway] 🚨 EMERGENCY KILL SWITCH ACTIVATED: ${reason}`);
  }

  public deactivateKillSwitch(): void {
    this.isKillSwitchActive = false;
    this.killSwitchReason = '';
    this.emit('killSwitchDeactivated', { timestamp: Date.now() });
    console.log('[ExecutionGateway] 🟢 Emergency Kill Switch Released.');
  }

  public getStats() {
    return {
      currentNonce: this.currentNonce,
      dailyNotionalAccumulator: this.dailyNotionalAccumulator,
      isKillSwitchActive: this.isKillSwitchActive,
      killSwitchReason: this.killSwitchReason,
      trackedOrderHashesCount: this.recentOrderHashes.size,
    };
  }
}
