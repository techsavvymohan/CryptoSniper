import { EventEmitter } from 'events';
import type {
  GodfatherConfig,
  GodfatherSignal,
  GodfatherTrade,
} from '@mev-research/shared';
import type { ResampleResult, CausalMultiTFResampler } from '@mev-research/market-feed';
import {
  GodfatherEngine,
  GodfatherRepositoryInterface,
} from './godfather-engine.js';
import type { TrancheEvaluationResult } from '../trade/tranche-manager.js';

export interface GodfatherTriadOptions {
  baseConfig: GodfatherConfig;
  resampler: CausalMultiTFResampler;
  repository?: GodfatherRepositoryInterface;
  initialEquity?: number;
  executor?: { executeOrder(req: any): Promise<any>; cancelOrder?(orderId: string, symbol?: string): Promise<any> };
  footprintService?: { isSweepAbsorbed(symbol: string, direction: 'BUY' | 'SELL'): boolean; getSnapshot?(symbol: string): any };
  btcSymbols?: string[];
  solSymbols?: string[];
  altsSymbols?: string[];
  btcEquityFraction?: number;
  solEquityFraction?: number;
  altsEquityFraction?: number;
}

export type EngineIdentifier = 'BTC' | 'SOL' | 'ALTS';

export interface TriadSignalEvent extends GodfatherSignal {
  engineType: EngineIdentifier;
}

export interface TriadTradeEvent extends GodfatherTrade {
  engineType: EngineIdentifier;
}

/**
 * 🏛️ GodfatherTriadManager
 * Concurrent 3-Engine Orchestrator:
 * 1. btcEngine: Dedicated solely to BTCUSD microstructure and $15-$50 liquidity dynamics.
 * 2. solEngine: Dedicated solely to SOLUSD high-velocity orderflow.
 * 3. altsEngine: Dedicated to the vetted Altcoin Winners basket (DOGE, INJ, OP, AVAX).
 *
 * All three engines run simultaneously, completely decoupled in memory with unified event aggregation.
 */
export class GodfatherTriadManager extends EventEmitter {
  public readonly btcEngine: GodfatherEngine;
  public readonly solEngine: GodfatherEngine;
  public readonly altsEngine: GodfatherEngine;

  private readonly btcSymbols: Set<string>;
  private readonly solSymbols: Set<string>;
  private readonly altsSymbols: Set<string>;
  private isRunning = false;

  constructor(options: GodfatherTriadOptions) {
    super();

    const {
      baseConfig,
      resampler,
      repository,
      initialEquity = 10_000,
      executor,
      footprintService,
      btcSymbols = ['BTCUSD'],
      solSymbols = ['SOLUSD'],
      altsSymbols,
      btcEquityFraction = 0.40,
      solEquityFraction = 0.30,
      altsEquityFraction = 0.30,
    } = options;

    this.btcSymbols = new Set(btcSymbols.map(s => s.toUpperCase()));
    this.solSymbols = new Set(solSymbols.map(s => s.toUpperCase()));

    // If alts not explicitly supplied, extract all remaining symbols from baseConfig
    const resolvedAlts =
      altsSymbols ??
      baseConfig.symbols.filter(
        s => !this.isBtcSymbol(s) && !this.isSolSymbol(s)
      );
    this.altsSymbols = new Set(resolvedAlts.map(s => s.toUpperCase()));

    // 1. Instantiate BTC Dedicated Engine
    const btcConfig: GodfatherConfig = {
      ...baseConfig,
      symbols: Array.from(this.btcSymbols),
      btcSweepMinBreachUsd: 50.0,
      btcRetestMaxBars: 8,
    };
    this.btcEngine = new GodfatherEngine(
      btcConfig,
      resampler,
      repository,
      initialEquity * btcEquityFraction,
      executor,
      footprintService,
    );

    // 2. Instantiate SOL Dedicated Engine
    const solConfig: GodfatherConfig = {
      ...baseConfig,
      symbols: Array.from(this.solSymbols),
      solSweepMinBreachUsd: 0.35,
      solRetestMaxBars: 12,
    };
    this.solEngine = new GodfatherEngine(
      solConfig,
      resampler,
      repository,
      initialEquity * solEquityFraction,
      executor,
      footprintService,
    );

    // 3. Instantiate Altcoins Basket Dedicated Engine
    const altsConfig: GodfatherConfig = {
      ...baseConfig,
      symbols: Array.from(this.altsSymbols),
      solSweepMinBreachUsd: 0.35,
      solRetestMaxBars: 12,
    };
    this.altsEngine = new GodfatherEngine(
      altsConfig,
      resampler,
      repository,
      initialEquity * altsEquityFraction,
      executor,
      footprintService,
    );

    // Bind event multiplexing
    this.bindEngineEvents('BTC', this.btcEngine);
    this.bindEngineEvents('SOL', this.solEngine);
    this.bindEngineEvents('ALTS', this.altsEngine);
  }

  private isBtcSymbol(symbol: string): boolean {
    const s = symbol.toUpperCase();
    return this.btcSymbols.has(s) || s.includes('BTC');
  }

  private isSolSymbol(symbol: string): boolean {
    const s = symbol.toUpperCase();
    return this.solSymbols.has(s) || s.includes('SOL');
  }

  private bindEngineEvents(engineType: EngineIdentifier, engine: GodfatherEngine): void {
    engine.on('signal', (signal: GodfatherSignal) => {
      this.emit('signal', { ...signal, engineType });
    });

    engine.on('trade_opened', (trade: GodfatherTrade) => {
      this.emit('trade_opened', { ...trade, engineType });
    });

    engine.on('tranche_exit', (payload: { trade: GodfatherTrade; result: TrancheEvaluationResult }) => {
      this.emit('tranche_exit', {
        trade: { ...payload.trade, engineType },
        result: payload.result,
        engineType,
      });
    });

    engine.on('trade_closed', (trade: GodfatherTrade) => {
      this.emit('trade_closed', { ...trade, engineType });
    });

    engine.on('pending_order', (payload: { signal: GodfatherSignal; maxRetestBars: number }) => {
      this.emit('pending_order', { ...payload, engineType });
    });

    engine.on('alert', (message: string) => {
      this.emit('alert', `[${engineType}_ENGINE] ${message}`);
    });
  }

  /**
   * Starts all 3 engines concurrently and in parallel.
   */
  public async start(): Promise<void> {
    this.isRunning = true;
    await Promise.all([
      this.btcEngine.start(),
      this.solEngine.start(),
      this.altsEngine.start(),
    ]);
  }

  /**
   * Stops all 3 engines simultaneously.
   */
  public stop(): void {
    this.isRunning = false;
    this.btcEngine.stop();
    this.solEngine.stop();
    this.altsEngine.stop();
  }

  /**
   * Concurrent Candle Dispatcher:
   * Directs incoming resampled candles to the dedicated engine immediately.
   */
  public async onCandleUpdate(resample: ResampleResult): Promise<void> {
    if (!this.isRunning) return;

    const symbol = resample.m1.symbol;
    if (this.isBtcSymbol(symbol)) {
      await this.btcEngine.onCandleUpdate(resample);
    } else if (this.isSolSymbol(symbol)) {
      await this.solEngine.onCandleUpdate(resample);
    } else if (this.altsSymbols.has(symbol.toUpperCase())) {
      await this.altsEngine.onCandleUpdate(resample);
    }
  }

  /**
   * Unified Footprint Snapshot delegate.
   */
  public getFootprintSnapshot(symbol: string): any {
    if (this.isBtcSymbol(symbol)) {
      return this.btcEngine.getFootprintSnapshot(symbol);
    } else if (this.isSolSymbol(symbol)) {
      return this.solEngine.getFootprintSnapshot(symbol);
    } else {
      return this.altsEngine.getFootprintSnapshot(symbol);
    }
  }

  /**
   * Aggregates all open trades across all 3 engines.
   */
  public getActiveTrades(): GodfatherTrade[] {
    return [
      ...this.btcEngine.getActiveTrades(),
      ...this.solEngine.getActiveTrades(),
      ...this.altsEngine.getActiveTrades(),
    ];
  }

  /**
   * Aggregates all pending limit retest orders across all 3 engines.
   */
  public getPendingSignals(): GodfatherSignal[] {
    return [
      ...this.btcEngine.getPendingSignals(),
      ...this.solEngine.getPendingSignals(),
      ...this.altsEngine.getPendingSignals(),
    ];
  }

  /**
   * Access individual specialized engines directly.
   */
  public getEngines(): {
    btc: GodfatherEngine;
    sol: GodfatherEngine;
    alts: GodfatherEngine;
  } {
    return {
      btc: this.btcEngine,
      sol: this.solEngine,
      alts: this.altsEngine,
    };
  }

  /**
   * Returns current multi-engine runtime metrics.
   */
  public getStatus(): {
    isRunning: boolean;
    engines: {
      btc: { symbols: string[]; activeTrades: number; pendingOrders: number };
      sol: { symbols: string[]; activeTrades: number; pendingOrders: number };
      alts: { symbols: string[]; activeTrades: number; pendingOrders: number };
    };
    totalActiveTrades: number;
    totalPendingOrders: number;
  } {
    const btcTrades = this.btcEngine.getActiveTrades().length;
    const solTrades = this.solEngine.getActiveTrades().length;
    const altsTrades = this.altsEngine.getActiveTrades().length;

    const btcPending = this.btcEngine.getPendingSignals().length;
    const solPending = this.solEngine.getPendingSignals().length;
    const altsPending = this.altsEngine.getPendingSignals().length;

    return {
      isRunning: this.isRunning,
      engines: {
        btc: {
          symbols: Array.from(this.btcSymbols),
          activeTrades: btcTrades,
          pendingOrders: btcPending,
        },
        sol: {
          symbols: Array.from(this.solSymbols),
          activeTrades: solTrades,
          pendingOrders: solPending,
        },
        alts: {
          symbols: Array.from(this.altsSymbols),
          activeTrades: altsTrades,
          pendingOrders: altsPending,
        },
      },
      totalActiveTrades: btcTrades + solTrades + altsTrades,
      totalPendingOrders: btcPending + solPending + altsPending,
    };
  }
}
