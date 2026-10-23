import { EventEmitter } from 'events';
import type {
  Candle,
  GodfatherConfig,
  GodfatherSignal,
  GodfatherTrade,
  GodfatherTranche,
  SignalGrade,
  Timeframe,
  TradeDirection,
} from '@mev-research/shared';
import { generateId } from '@mev-research/shared';
import type { ResampleResult, CausalMultiTFResampler } from '@mev-research/market-feed';
import {
  calculateChoppiness,
  calculateEMA,
  calculateWilderATR,
  checkDeltaAbsorption,
} from '../indicators/quant-indicators.js';
import { detectM15Fractals } from '../structure/fractals.js';
import {
  checkDisplacement,
  checkMSS,
  detectFVG,
  detectSweepAndReclaim,
} from '../triggers/trigger-detector.js';
import { getCurrentSession, isNearFundingReset } from '../filters/session-guards.js';
import { calculateGodfatherPosition } from '../risk/position-sizer.js';
import {
  createTranches,
  evaluateTrancheExits,
  TrancheEvaluationResult,
} from '../trade/tranche-manager.js';

export interface GodfatherEngineEvents {
  signal: (signal: GodfatherSignal) => void;
  trade_opened: (trade: GodfatherTrade) => void;
  tranche_exit: (payload: { trade: GodfatherTrade; result: TrancheEvaluationResult }) => void;
  trade_closed: (trade: GodfatherTrade) => void;
  alert: (message: string) => void;
}

export interface GodfatherRepositoryInterface {
  insertCandles(candles: Candle[]): Promise<void>;
  insertSignal(signal: GodfatherSignal): Promise<void>;
  updateSignalStatus(
    id: string,
    status: GodfatherSignal['status'],
    metadata?: { filledAt?: Date; expiredAt?: Date },
  ): Promise<void>;
  insertTrade(trade: GodfatherTrade): Promise<void>;
  updateTrade(id: string, updates: Partial<GodfatherTrade>): Promise<void>;
  updateTranche(id: string, updates: Partial<GodfatherTranche>): Promise<void>;
  getOpenTrades(): Promise<GodfatherTrade[]>;
  getDailyPnl(date: Date): Promise<number>;
}

export interface PendingSignal {
  signal: GodfatherSignal;
  barsElapsed: number;
  maxRetestBars: number;
  targetR2: number;
  venueOrderId?: string;
}

export class GodfatherEngine extends EventEmitter {
  private config: GodfatherConfig;
  private resampler: CausalMultiTFResampler;
  private repository?: GodfatherRepositoryInterface;
  private executor?: { executeOrder(req: any): Promise<any>; cancelOrder?(arg1: string, arg2?: string): Promise<any> };
  private footprintService?: { isSweepAbsorbed(symbol: string, direction: 'BUY' | 'SELL'): boolean; getSnapshot?(symbol: string): any };
  private activeTrades = new Map<string, { trade: GodfatherTrade; barsInTrade: number }>();
  private pendingSignals = new Map<string, PendingSignal>();
  private accountEquity: number;
  private isRunning = false;
  private dailyRealizedPnl = 0;
  private currentPnlDateStr = '';

  constructor(
    config: GodfatherConfig,
    resampler: CausalMultiTFResampler,
    repository?: GodfatherRepositoryInterface,
    initialEquity = 10_000,
    executor?: { executeOrder(req: any): Promise<any>; cancelOrder?(orderId: string, symbol?: string): Promise<any> },
    footprintService?: { isSweepAbsorbed(symbol: string, direction: 'BUY' | 'SELL'): boolean; getSnapshot?(symbol: string): any },
  ) {
    super();
    this.config = config;
    this.resampler = resampler;
    this.repository = repository;
    this.accountEquity = initialEquity;
    this.executor = executor;
    this.footprintService = footprintService;
  }

  public getFootprintSnapshot(symbol: string): any {
    return this.footprintService?.getSnapshot?.(symbol);
  }

  public async start(): Promise<void> {
    this.isRunning = true;
    if (this.repository) {
      try {
        const openTrades = await this.repository.getOpenTrades();
        for (const t of openTrades) {
          this.activeTrades.set(t.id, { trade: t, barsInTrade: 0 });
        }
      } catch (err) {
        this.emit('alert', `Failed to load open trades from DB: ${err}`);
      }
    }
  }

  public stop(): void {
    this.isRunning = false;
  }

  public getActiveTrades(): GodfatherTrade[] {
    return Array.from(this.activeTrades.values()).map(v => v.trade);
  }

  public getPendingSignals(): GodfatherSignal[] {
    return Array.from(this.pendingSignals.values()).map(p => p.signal);
  }

  public setAccountEquity(equity: number): void {
    this.accountEquity = equity;
  }

  /**
   * Main entry point when a new completed candle or resampled packet is available.
   */
  public async onCandleUpdate(resample: ResampleResult): Promise<void> {
    if (!this.isRunning || !this.config.enabled) return;

    const { m1, closedM5, closedM15, closedH1, closedH4 } = resample;
    const symbol = m1.symbol;

    // 1. Optionally persist closed candles
    if (this.repository) {
      const closedBars: Candle[] = [m1];
      if (closedM5) closedBars.push(closedM5);
      if (closedM15) closedBars.push(closedM15);
      if (closedH1) closedBars.push(closedH1);
      if (closedH4) closedBars.push(closedH4);

      try {
        await this.repository.insertCandles(closedBars);
      } catch (err) {
        // Log non-fatal DB write error
      }
    }

    // 2. Evaluate pending limit orders against latest M1 bar
    await this.evaluatePendingOrders(m1);

    // 3. Evaluate active trades on the incoming M1 bar
    await this.evaluateActiveTrades(m1);

    // 4. Scan for new high-probability entries if eligible
    await this.scanForOpportunities(symbol, m1);
  }

  /**
   * Evaluates pending limit orders to verify retest fill or expiration.
   */
  private async evaluatePendingOrders(currentCandle: Candle): Promise<void> {
    const symbol = currentCandle.symbol;

    for (const [signalId, pending] of this.pendingSignals.entries()) {
      if (pending.signal.symbol !== symbol) continue;

      pending.barsElapsed += 1;
      const { signal, targetR2 } = pending;

      // Check if price touched the limit order entry price
      const isFilled = signal.direction === 'BUY'
        ? currentCandle.low <= signal.entryPrice
        : currentCandle.high >= signal.entryPrice;

      if (isFilled) {
        signal.status = 'FILLED';
        signal.filledAt = currentCandle.closeTime;

        if (this.repository) {
          await this.repository.updateSignalStatus(signal.id, 'FILLED', {
            filledAt: new Date(signal.filledAt),
          });
        }

        const tradeId = generateId();
        const tranches = createTranches(
          tradeId,
          signal.entryPrice,
          signal.stopLoss,
          signal.positionSize,
          signal.direction,
          targetR2,
        );

        const trade: GodfatherTrade = {
          id: tradeId,
          signalId: signal.id,
          symbol: signal.symbol,
          direction: signal.direction,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          initialStopLoss: signal.stopLoss,
          breakevenPrice: signal.entryPrice,
          isBreakevenLocked: false,
          totalSize: signal.positionSize,
          remainingSize: signal.positionSize,
          realizedPnlUsd: 0,
          status: 'OPEN',
          openedAt: currentCandle.closeTime,
          tranches,
        };

        this.activeTrades.set(tradeId, { trade, barsInTrade: 0 });

        if (this.repository) {
          try {
            await this.repository.insertTrade(trade);
          } catch {
            // Non-fatal logging
          }
        }

        this.emit('trade_opened', trade);
        this.pendingSignals.delete(signalId);
      } else if (pending.barsElapsed >= pending.maxRetestBars) {
        signal.status = 'EXPIRED';
        signal.expiredAt = currentCandle.closeTime;

        if (this.repository) {
          await this.repository.updateSignalStatus(signal.id, 'EXPIRED', {
            expiredAt: new Date(signal.expiredAt),
          });
        }

        if (this.executor && 'cancelOrder' in this.executor) {
          const orderToCancel = pending.venueOrderId || signal.id;
          try {
            // First attempt: adapter standard (symbol, orderId)
            await (this.executor as any).cancelOrder(signal.symbol, orderToCancel);
          } catch {
            try {
              // Fallback attempt: factory standard (orderId, symbol)
              await (this.executor as any).cancelOrder(orderToCancel, signal.symbol);
            } catch {
              // Non-fatal logging
            }
          }
        }

        this.emit('alert', `[Godfather] Limit order on ${signal.symbol} expired after ${pending.barsElapsed} bars without retest`);
        this.pendingSignals.delete(signalId);
      }
    }
  }

  /**
   * Evaluates active trades against the latest closed M1 candle.
   */
  private async evaluateActiveTrades(currentCandle: Candle): Promise<void> {
    const symbol = currentCandle.symbol;
    const m15Bars = this.resampler.getCandles(symbol, 'M15', 30);
    const m15AtrSeries = calculateWilderATR(m15Bars, 14);
    const m15Atr = m15AtrSeries.length > 0 ? m15AtrSeries[m15AtrSeries.length - 1]! : 0;
    const m15Chop = m15Bars.length >= 14 ? calculateChoppiness(m15Bars, 14) : 50;

    const isBtc = symbol.toUpperCase().includes('BTC');
    const baseStagnation = isBtc
      ? Math.max(this.config.btcRetestMaxBars * 4, 32)
      : Math.max(this.config.solRetestMaxBars * 3, 36);

    // Dynamic Stagnation Window:
    // Fast momentum / clean trend (chop < 42): fail-fast on stagnant trades (26-28 bars);
    // Ranging / consolidation regime (chop >= 55): allow more breathing room (40-44 bars)
    const dynamicStagnationBars = m15Chop < 42.0
      ? Math.max(baseStagnation - 6, 26)
      : (m15Chop > 55.0 ? baseStagnation + 8 : baseStagnation);

    for (const [tradeId, activeEntry] of this.activeTrades.entries()) {
      const { trade, barsInTrade } = activeEntry;
      if (trade.symbol !== symbol) continue;

      activeEntry.barsInTrade += 1;

      const evalResult = evaluateTrancheExits(
        trade,
        currentCandle,
        m15Atr,
        activeEntry.barsInTrade,
        dynamicStagnationBars,
        m15Chop,
      );

      if (evalResult.action !== 'NONE') {
        const todayUtc = new Date(currentCandle.closeTime).toISOString().split('T')[0]!;
        if (this.currentPnlDateStr !== todayUtc) {
          this.currentPnlDateStr = todayUtc;
          this.dailyRealizedPnl = 0;
        }
        this.dailyRealizedPnl += evalResult.realizedPnlDeltaUsd;

        // Apply trade updates
        if (evalResult.tradeUpdates) {
          Object.assign(trade, evalResult.tradeUpdates);
          if (this.repository) {
            await this.repository.updateTrade(trade.id, evalResult.tradeUpdates);
          }
        }

        // Apply tranche updates
        if (evalResult.trancheUpdates) {
          for (const tu of evalResult.trancheUpdates) {
            const tranche = trade.tranches.find(t => t.id === tu.id);
            if (tranche) {
              Object.assign(tranche, tu.updates);
              if (this.repository) {
                await this.repository.updateTranche(tu.id, tu.updates);
              }
            }
          }
        }

        // Emit tranche exit event
        this.emit('tranche_exit', { trade, result: evalResult });

        // If trade is closed, remove from active trades and emit 'trade_closed'
        if (trade.status === 'CLOSED') {
          this.activeTrades.delete(tradeId);
          this.emit('trade_closed', trade);
        }
      }
    }
  }

  /**
   * Scans for 5-stage Godfather institutional setups on M1 / M15.
   */
  private async scanForOpportunities(symbol: string, currentM1: Candle): Promise<void> {
    // Check if an active trade or pending signal already exists for this symbol (1 active setup per asset)
    const hasActiveTrade = Array.from(this.activeTrades.values()).some(
      v => v.trade.symbol === symbol && v.trade.status === 'OPEN',
    );
    const hasPendingSignal = Array.from(this.pendingSignals.values()).some(
      v => v.signal.symbol === symbol && v.signal.status === 'PENDING_FILL',
    );
    if (hasActiveTrade || hasPendingSignal) return;

    // Portfolio Risk Guard: Max 5 concurrent open positions across universe
    const activeCount = Array.from(this.activeTrades.values()).filter(
      v => v.trade.status === 'OPEN',
    ).length;
    if (activeCount >= 5) return;

    // Check circuit breaker: Daily loss limit (both in-memory and database verified)
    if (this.dailyRealizedPnl <= -this.config.dailyLossLimitUsdc) {
      return; // In-memory daily loss limit hit, skip
    }

    if (this.repository) {
      try {
        const todayRealizedPnl = await this.repository.getDailyPnl(new Date(currentM1.closeTime));
        if (todayRealizedPnl <= -this.config.dailyLossLimitUsdc) {
          return; // Daily loss limit hit, skip
        }
      } catch {
        // Fallback to in-memory check
      }
    }

    // Check Funding Reset Blackout (10 minutes before and after 00:00, 08:00, 16:00 UTC)
    if (isNearFundingReset(currentM1.closeTime, 10)) {
      return;
    }

    const sessionInfo = getCurrentSession(currentM1.closeTime);
    if (sessionInfo.sessionName === 'OFF_SESSION') {
      return; // Strict ICT Rule: Never trade outside London, NY/US ETF, or Asia Killzones
    }

    // Fetch necessary candles
    const m15Bars = this.resampler.getCandles(symbol, 'M15', 40);
    if (m15Bars.length < 20) return;

    const m1Bars = this.resampler.getCandles(symbol, 'M1', 30);
    if (m1Bars.length < 10) return;

    // Choppiness check: Skip if market is in consolidation (CHOP > 61.8)
    const chop = calculateChoppiness(m15Bars, 14);
    if (chop > 61.8) {
      return;
    }

    // ATR calculation for displacement
    const m15AtrSeries = calculateWilderATR(m15Bars, 14);
    const m15Atr = m15AtrSeries.length > 0 ? m15AtrSeries[m15AtrSeries.length - 1]! : 0;

    const m1AtrSeries = calculateWilderATR(m1Bars, 14);
    const m1Atr = m1AtrSeries.length > 0 ? m1AtrSeries[m1AtrSeries.length - 1]! : 0;
    if (m1Atr <= 0) return;

    // Higher Timeframe (H1) Trend
    const h1Bars = this.resampler.getCandles(symbol, 'H1', 60);
    let h1Trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    if (h1Bars.length >= 20) {
      const h1Closes = h1Bars.map(b => b.close);
      const ema9 = calculateEMA(h1Closes, 9);
      const ema21 = calculateEMA(h1Closes, 21);
      const lastEma9 = ema9[ema9.length - 1]!;
      const lastEma21 = ema21[ema21.length - 1]!;
      if (lastEma9 > lastEma21) h1Trend = 'BULLISH';
      else if (lastEma9 < lastEma21) h1Trend = 'BEARISH';
    }

    // Detect M15 Fractals (BSL & SSL)
    const { bsl, ssl } = detectM15Fractals(m15Bars, 20);

    const isBtc = symbol.toUpperCase().includes('BTC');
    const isSol = symbol.toUpperCase().includes('SOL');

    // 1. Dynamic Volatility-Scaled Sweep Breach
    // Calibrates automatically with real-time M15 ATR:
    // BTC: 0.25x M15 ATR (floored at $35 to prevent micro-noise in dead zones)
    // SOL: 0.25x M15 ATR (floored at $0.25)
    // Alts: 0.35x M15 ATR or 0.05% of asset price
    const minSweepBreachUsd = isBtc
      ? Math.max(m15Atr * 0.25, 35.0)
      : isSol
      ? Math.max(m15Atr * 0.25, 0.25)
      : Math.max(m15Atr * 0.35, currentM1.close * 0.0005);

    // 2. Dynamic FVG Gap Imbalance Threshold
    // Calibrated directly to M1 ATR (20% of M1 ATR), dynamically adapting to explosive expansions
    const minFvgGapUsd = isBtc
      ? Math.max(m1Atr * 0.20, 8.0)
      : isSol
      ? Math.max(m1Atr * 0.20, 0.08)
      : Math.max(m1Atr * 0.20, currentM1.close * 0.0001);

    // 3. Dynamic Stop Loss Buffer
    // Calibrated off M15 ATR to give liquidity wicks breathing room without overexposing risk
    const buffer = isBtc
      ? Math.max(m15Atr * 0.15, 12.0)
      : isSol
      ? Math.max(m15Atr * 0.25, 0.15)
      : Math.max(m15Atr * 0.40, currentM1.close * 0.0003);

    // 4. Dynamic Retest Window based on Regime Choppiness
    // In strong momentum (chop < 42.0), limit retests must occur quickly (6-8 bars).
    // In slower consolidation (chop >= 42.0), allow 10-14 bars.
    const dynamicRetestBars = isBtc
      ? (chop < 42.0 ? 6 : (chop > 55.0 ? 12 : this.config.btcRetestMaxBars))
      : isSol
      ? (chop < 42.0 ? 8 : (chop > 55.0 ? 14 : this.config.solRetestMaxBars))
      : (chop < 42.0 ? 8 : 12);

    // 5. Dynamic Harvesting Target R2
    // In clean directional trends (chop < 38.2), stretch runner target to 3.0R (BTC) / 3.5R (Alts).
    // In choppy regimes (chop > 52.0), secure target early at 2.2R (BTC) / 2.5R (Alts).
    const dynamicTargetR2 = chop < 38.2
      ? (isBtc ? 3.0 : 3.5)
      : chop > 52.0
      ? (isBtc ? 2.2 : 2.5)
      : (isBtc ? 2.5 : 3.0);

    // 6. Dynamic Sweep Lookback & Displacement
    const sweepWindow = chop < 42.0 ? 8 : (chop > 55.0 ? 14 : 10);
    const minBodyFraction = chop < 42.0 ? 0.65 : 0.58;
    const minRangeMultiplier = chop < 42.0 ? 0.65 : 0.58;

    // ==========================================
    // 1. EVALUATE BULLISH SETUP (Sweep of SSL)
    // ==========================================
    if (ssl) {
      const sweep = detectSweepAndReclaim(m1Bars, ssl, minSweepBreachUsd, sweepWindow);
      if (sweep.isSweep && sweep.sweepCandle && sweep.reclaimCandle) {
        const hasDisplacement = checkDisplacement(sweep.reclaimCandle, m1Atr, minBodyFraction, minRangeMultiplier);
        const mss = checkMSS(m1Bars, 'BUY', 5);
        const fvg = detectFVG(m1Bars, 'BUY', minFvgGapUsd);
        const deltaAbsorbed = this.footprintService
          ? this.footprintService.isSweepAbsorbed(symbol, 'BUY')
          : checkDeltaAbsorption(sweep.sweepCandle, sweep.reclaimCandle, 'BUY');

        if (hasDisplacement && mss.hasMSS && fvg) {
          // Unicorn A+ Setup: Sweep + Displacement + MSS + FVG + Delta Absorption + High Volume Killzone
          const isAPlus = deltaAbsorbed && sessionInfo.isHighVolumeWindow && h1Trend !== 'BEARISH';
          const grade: SignalGrade = isAPlus ? 'A_PLUS' : 'A';

          const stopLoss = sweep.sweepCandle.low - buffer;
          const entryPrice = fvg.top; // Enter at FVG proximal edge

          await this.triggerGodfatherSignal({
            symbol,
            direction: 'BUY',
            grade,
            sweepLevel: ssl.price,
            sweepBreachUsd: sweep.sweepBreachUsd,
            entryPrice,
            stopLoss,
            fvgTop: fvg.top,
            fvgBottom: fvg.bottom,
            session: sessionInfo.sessionName,
            isWeekend: sessionInfo.isWeekend,
            h1Trend,
            detectedAt: currentM1.closeTime,
            currentCandle: currentM1,
            chop,
            maxRetestBars: dynamicRetestBars,
            targetR2: dynamicTargetR2,
          });
          return;
        }
      }
    }

    // ==========================================
    // 2. EVALUATE BEARISH SETUP (Sweep of BSL)
    // ==========================================
    if (bsl) {
      const sweep = detectSweepAndReclaim(m1Bars, bsl, minSweepBreachUsd, sweepWindow);
      if (sweep.isSweep && sweep.sweepCandle && sweep.reclaimCandle) {
        const hasDisplacement = checkDisplacement(sweep.reclaimCandle, m1Atr, minBodyFraction, minRangeMultiplier);
        const mss = checkMSS(m1Bars, 'SELL', 5);
        const fvg = detectFVG(m1Bars, 'SELL', minFvgGapUsd);
        const deltaAbsorbed = this.footprintService
          ? this.footprintService.isSweepAbsorbed(symbol, 'SELL')
          : checkDeltaAbsorption(sweep.sweepCandle, sweep.reclaimCandle, 'SELL');

        if (hasDisplacement && mss.hasMSS && fvg) {
          const isAPlus = deltaAbsorbed && sessionInfo.isHighVolumeWindow && h1Trend !== 'BULLISH';
          const grade: SignalGrade = isAPlus ? 'A_PLUS' : 'A';

          const stopLoss = sweep.sweepCandle.high + buffer;
          const entryPrice = fvg.bottom; // Enter at FVG proximal edge

          await this.triggerGodfatherSignal({
            symbol,
            direction: 'SELL',
            grade,
            sweepLevel: bsl.price,
            sweepBreachUsd: sweep.sweepBreachUsd,
            entryPrice,
            stopLoss,
            fvgTop: fvg.top,
            fvgBottom: fvg.bottom,
            session: sessionInfo.sessionName,
            isWeekend: sessionInfo.isWeekend,
            h1Trend,
            detectedAt: currentM1.closeTime,
            currentCandle: currentM1,
            chop,
            maxRetestBars: dynamicRetestBars,
            targetR2: dynamicTargetR2,
          });
          return;
        }
      }
    }
  }

  private async triggerGodfatherSignal(params: {
    symbol: string;
    direction: TradeDirection;
    grade: SignalGrade;
    sweepLevel: number;
    sweepBreachUsd: number;
    entryPrice: number;
    stopLoss: number;
    fvgTop: number;
    fvgBottom: number;
    session: string;
    isWeekend: boolean;
    h1Trend: string;
    detectedAt: number;
    currentCandle?: Candle;
    chop?: number;
    maxRetestBars?: number;
    targetR2?: number;
  }): Promise<void> {
    const {
      symbol,
      direction,
      grade,
      sweepLevel,
      sweepBreachUsd,
      entryPrice,
      stopLoss,
      fvgTop,
      fvgBottom,
      session,
      isWeekend,
      h1Trend,
      detectedAt,
      currentCandle,
      chop,
      maxRetestBars,
      targetR2,
    } = params;

    let sessionMultiplier = 1.00;
    if (session.startsWith('LONDON')) {
      sessionMultiplier = 1.35;
    } else if (session.startsWith('US_')) {
      sessionMultiplier = 0.75;
    }

    // Dynamic regime multiplier: scale conviction dynamically with Choppiness Index
    if (chop !== undefined) {
      if (chop > 52.0) {
        sessionMultiplier *= 0.85; // dial back risk when chop rises
      } else if (chop < 38.2) {
        sessionMultiplier *= 1.15; // boost conviction during clean trending regimes
      }
    }

    const sizing = calculateGodfatherPosition({
      symbol,
      accountEquity: this.accountEquity,
      entryPrice,
      stopLoss,
      direction,
      grade,
      isWeekend,
      hasCorrelatedUsdExposure: false,
      baseRiskPct: this.config.baseRiskPct,
      convictionScaleAPlus: this.config.convictionScaleAPlus,
      convictionScaleA: this.config.convictionScaleA,
      convictionScaleB: this.config.convictionScaleB,
      sessionMultiplier,
    });

    if (!sizing.isValid || sizing.positionSize <= 0) {
      return;
    }

    const isBtc = symbol.toUpperCase().includes('BTC');
    const signalId = generateId();
    const signal: GodfatherSignal = {
      id: signalId,
      symbol,
      direction,
      grade,
      timeframe: 'M1',
      sweepLevel,
      sweepBreachUsd,
      entryPrice,
      stopLoss,
      fvgTop,
      fvgBottom,
      convictionMultiplier: sizing.convictionMultiplier,
      allocatedRiskUsd: sizing.allocatedRiskUsd,
      positionSize: sizing.positionSize,
      session,
      h1Trend,
      status: 'PENDING_FILL',
      detectedAt,
    };

    if (this.repository) {
      try {
        await this.repository.insertSignal(signal);
      } catch (err) {
        // Non-fatal logging
      }
    }

    this.emit('signal', signal);

    const resolvedTargetR2 = targetR2 ?? (isBtc ? 2.5 : 3.0);
    const resolvedMaxRetestBars = maxRetestBars ?? (isBtc ? this.config.btcRetestMaxBars : this.config.solRetestMaxBars);

    const tranches = createTranches(
      signalId,
      entryPrice,
      stopLoss,
      sizing.positionSize,
      direction,
      resolvedTargetR2,
    );

    const pendingEntry: PendingSignal = {
      signal,
      barsElapsed: 0,
      maxRetestBars: resolvedMaxRetestBars,
      targetR2: resolvedTargetR2,
    };

    // Register into pendingSignals map for limit retest tracking
    this.pendingSignals.set(signalId, pendingEntry);

    // Send limit order to execution venue and capture venueOrderId
    if (this.executor) {
      this.executor.executeOrder({
        signalId,
        symbol,
        direction,
        orderType: 'LIMIT',
        price: entryPrice,
        size: sizing.positionSize,
        stopLoss,
        tranches: tranches.map(t => ({
          trancheNumber: t.trancheNumber,
          targetPrice: t.targetPrice,
          size: t.size,
        })),
      }).then(res => {
        if (res?.orderId) {
          pendingEntry.venueOrderId = res.orderId;
        }
      }).catch(err => {
        this.emit('alert', `Order execution failed on venue: ${err}`);
      });
    }

    this.emit('pending_order', { signal, maxRetestBars: resolvedMaxRetestBars });
  }
}
