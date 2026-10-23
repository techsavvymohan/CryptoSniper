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
}

export class GodfatherEngine extends EventEmitter {
  private config: GodfatherConfig;
  private resampler: CausalMultiTFResampler;
  private repository?: GodfatherRepositoryInterface;
  private executor?: { executeOrder(req: any): Promise<any>; cancelOrder?(orderId: string, symbol?: string): Promise<any> };
  private footprintService?: { isSweepAbsorbed(symbol: string, direction: 'BUY' | 'SELL'): boolean; getSnapshot?(symbol: string): any };
  private activeTrades = new Map<string, { trade: GodfatherTrade; barsInTrade: number }>();
  private pendingSignals = new Map<string, PendingSignal>();
  private accountEquity: number;
  private isRunning = false;

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
          (this.executor as any).cancelOrder(signal.id, signal.symbol).catch(() => {});
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

    const maxStagnationBars = symbol.toUpperCase().includes('BTC')
      ? this.config.btcRetestMaxBars * 3
      : this.config.solRetestMaxBars * 3;

    for (const [tradeId, activeEntry] of this.activeTrades.entries()) {
      const { trade, barsInTrade } = activeEntry;
      if (trade.symbol !== symbol) continue;

      activeEntry.barsInTrade += 1;

      const evalResult = evaluateTrancheExits(
        trade,
        currentCandle,
        m15Atr,
        activeEntry.barsInTrade,
        maxStagnationBars,
      );

      if (evalResult.action !== 'NONE') {
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

    // Check circuit breaker: Daily loss limit
    if (this.repository) {
      try {
        const todayRealizedPnl = await this.repository.getDailyPnl(new Date(currentM1.closeTime));
        if (todayRealizedPnl <= -this.config.dailyLossLimitUsdc) {
          return; // Daily loss limit hit, skip
        }
      } catch {
        // Proceed on DB query failure
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
    const minSweepBreachUsd = isBtc
      ? this.config.btcSweepMinBreachUsd
      : isSol
      ? this.config.solSweepMinBreachUsd
      : Math.max(m15Atr * 0.35, currentM1.close * 0.0005);

    const minFvgGapUsd = isBtc ? 10.0 : isSol ? 0.10 : Math.max(m15Atr * 0.05, currentM1.close * 0.0001);
    const buffer = isBtc ? 15.0 : isSol ? 0.20 : Math.max(m15Atr * 0.10, currentM1.close * 0.0002);

    // ==========================================
    // 1. EVALUATE BULLISH SETUP (Sweep of SSL)
    // ==========================================
    if (ssl) {
      const sweep = detectSweepAndReclaim(m1Bars, ssl, minSweepBreachUsd, 10);
      if (sweep.isSweep && sweep.sweepCandle && sweep.reclaimCandle) {
        const hasDisplacement = checkDisplacement(sweep.reclaimCandle, m1Atr, 0.60, 0.60);
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
          });
          return;
        }
      }
    }

    // ==========================================
    // 2. EVALUATE BEARISH SETUP (Sweep of BSL)
    // ==========================================
    if (bsl) {
      const sweep = detectSweepAndReclaim(m1Bars, bsl, minSweepBreachUsd, 10);
      if (sweep.isSweep && sweep.sweepCandle && sweep.reclaimCandle) {
        const hasDisplacement = checkDisplacement(sweep.reclaimCandle, m1Atr, 0.60, 0.60);
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
    } = params;

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
    });

    if (!sizing.isValid || sizing.positionSize <= 0) {
      return;
    }

    const isBtc = symbol.toUpperCase().includes('BTC');
    const isImmediateFill = currentCandle
      ? (direction === 'BUY'
          ? currentCandle.low <= entryPrice
          : currentCandle.high >= entryPrice)
      : true;

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
      status: isImmediateFill ? 'FILLED' : 'PENDING_FILL',
      detectedAt,
      filledAt: isImmediateFill ? detectedAt : undefined,
    };

    if (this.repository) {
      try {
        await this.repository.insertSignal(signal);
      } catch (err) {
        // Non-fatal logging
      }
    }

    this.emit('signal', signal);

    const targetR2 = isBtc ? 2.0 : 2.5;
    const tranches = createTranches(
      signalId,
      entryPrice,
      stopLoss,
      sizing.positionSize,
      direction,
      targetR2,
    );

    // Send limit order to execution venue
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
      }).catch(err => {
        this.emit('alert', `Order execution failed on venue: ${err}`);
      });
    }

    if (!isImmediateFill) {
      // Register into pendingSignals map for limit retest tracking
      const maxRetestBars = isBtc ? this.config.btcRetestMaxBars : this.config.solRetestMaxBars;
      this.pendingSignals.set(signalId, {
        signal,
        barsElapsed: 0,
        maxRetestBars,
        targetR2,
      });
      this.emit('pending_order', { signal, maxRetestBars });
      return;
    }

    // Immediate fill: instantiate trade with 3-tranche management
    const tradeId = generateId();
    const trade: GodfatherTrade = {
      id: tradeId,
      signalId,
      symbol,
      direction,
      entryPrice,
      stopLoss,
      breakevenPrice: entryPrice,
      isBreakevenLocked: false,
      totalSize: sizing.positionSize,
      remainingSize: sizing.positionSize,
      realizedPnlUsd: 0,
      status: 'OPEN',
      openedAt: detectedAt,
      tranches,
    };

    this.activeTrades.set(tradeId, { trade, barsInTrade: 0 });

    if (this.repository) {
      try {
        await this.repository.insertTrade(trade);
      } catch (err) {
        // Non-fatal logging
      }
    }

    this.emit('trade_opened', trade);
  }
}
