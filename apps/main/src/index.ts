import { config as loadDotenv } from 'dotenv';
import path from 'path';
import { EventEmitter } from 'events';

// Load .env from monorepo root (dist/ → apps/main → apps → root)
loadDotenv({ path: path.resolve(__dirname, '..', '..', '..', '.env') });
import { loadConfig, CHANNELS, heliusRpcUrl, isHeliusConfigured, ArbitrageOpportunity } from '@mev-research/shared';
import {
  connect as dbConnect,
  disconnect as dbDisconnect,
  healthCheck as dbHealthCheck,
  connectRedis,
  disconnectRedis,
  redisHealthCheck,
  publish,
  cacheGet,
  cacheSet,
  cacheDel,
  ExecutionRepository,
  OpportunityRepository,
  SimulationRepository,
  StatisticsRepository,
  PoolRepository,
  LatencyRepository,
  GodfatherRepository,
  InMemoryGodfatherRepository,
  AuditRepository,
  db,
} from '@mev-research/database';
import {
  WalletManager,
  RaydiumSwapBuilder,
  OrcaSwapBuilder,
  JitoSubmitter,
  RiskEngine,
  InstitutionalRiskEngine,
  ExecutionGateway,
  ExecutionEngine,
  createDirectionalExecutor,
} from '@mev-research/execution';
import {
  MarketFeedService,
  CryptoCandleFeedService,
  HyperliquidFootprintService,
} from '@mev-research/market-feed';
import { GodfatherEngine } from '@mev-research/godfather-engine';
import { OpportunityManager } from '@mev-research/spread-engine';
import { SimulationRunner } from '@mev-research/simulation';
import { AnalyticsService } from '@mev-research/analytics';
import { TelegramAlertBot } from '@mev-research/telegram';
import { createApiServer } from '@mev-research/api';
import { startMetricsServer, stopMetricsServer } from '@mev-research/monitoring';

async function main() {
  const config = loadConfig();

  // ─── 1. Database & Redis Auto-Detection (Zero-Dependency Standalone Mode) ──
  const isStandalone =
    process.env['STANDALONE_MODE'] === 'true' ||
    !config.database.url ||
    config.database.url.trim() === '';

  let isDbHealthy = false;
  let isRedisHealthy = false;

  if (!isStandalone) {
    try {
      await Promise.race([
        dbConnect().then(() => dbHealthCheck()),
        new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000)),
      ]);
      isDbHealthy = true;
    } catch {
      isDbHealthy = false;
    }

    try {
      await Promise.race([
        connectRedis().then(() => redisHealthCheck()),
        new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000)),
      ]);
      isRedisHealthy = true;
    } catch {
      isRedisHealthy = false;
    }
  }

  // ─── 2. In-Memory Microsecond Cache & Event Bus ────────────────────────────
  const inMemoryCache = new Map<string, string>();
  const inMemoryBus = new EventEmitter();

  const redisClient = {
    get: async (key: string) => (isRedisHealthy ? cacheGet(key) : (inMemoryCache.get(key) ?? null)),
    set: async (key: string, value: string, _mode?: string, ttl?: number) => {
      if (isRedisHealthy) await cacheSet(key, value, ttl);
      else inMemoryCache.set(key, value);
    },
    del: async (key: string) => {
      if (isRedisHealthy) await cacheDel(key);
      else inMemoryCache.delete(key);
    },
    publish: async (channel: string, data: unknown) => {
      if (isRedisHealthy) {
        await publish(channel as typeof CHANNELS[keyof typeof CHANNELS], data);
      } else {
        inMemoryBus.emit(channel, data);
      }
    },
  };

  const publishEvent = async (channel: string, data: unknown) => {
    await redisClient.publish(channel, data);
  };

  // ─── 3. Repositories (Auto In-Memory vs. PostgreSQL) ────────────────────────
  let executionRepo: any = null;
  let opportunityRepo: any = null;
  let simulationRepo: any = null;
  let statisticsRepo: any = null;
  let poolRepo: any = null;
  let latencyRepo: any = null;
  let godfatherRepo: any = null;
  let auditRepo: any = null;

  if (isDbHealthy) {
    console.log('[STARTUP] ✅ PostgreSQL & Redis connected (Full Archive Mode)');
    const pool = db.pool;
    executionRepo = new ExecutionRepository(pool);
    opportunityRepo = new OpportunityRepository(pool);
    simulationRepo = new SimulationRepository(pool);
    statisticsRepo = new StatisticsRepository(pool);
    poolRepo = new PoolRepository(pool);
    latencyRepo = new LatencyRepository(pool);
    godfatherRepo = new GodfatherRepository(pool);
    auditRepo = new AuditRepository(pool);
  } else {
    console.log('=============================================================================');
    console.log('⚡ STANDALONE ULTRA-LIGHTWEIGHT MODE ACTIVE');
    console.log('• Zero External Database Required (RAM In-Memory Trades & PnL Tracking)');
    console.log('• Zero Redis Required (Direct In-Memory Event Bus)');
    console.log('• 100% Plug-and-Play execution for Windows / VPS');
    console.log('=============================================================================');
    godfatherRepo = new InMemoryGodfatherRepository();
    auditRepo = {
      recordEvent: async () => {},
      getEventsByCorrelationId: async () => [],
      getRecentEvents: async () => [],
    };
  }

  // ─── 4. Execution Safety Gateway & Institutional Risk Engine ───────────────
  const executionGateway = new ExecutionGateway({
    maxSingleOrderNotionalUsd: 15_000,
    maxDailyNotionalUsd: 150_000,
    duplicateWindowMs: 5_000,
    maxAllowedSlippageBps: 50,
  });

  const institutionalRiskEngine = new InstitutionalRiskEngine({
    accountEquityUsd: 10_000,
    dailyLossLimitUsd: config.godfather?.dailyLossLimitUsdc ?? 450,
    maxDrawdownPct: config.godfather?.maxAccountDdPct ?? 9.0,
    maxSinglePositionNotionalUsd: 25_000,
    maxTotalPortfolioExposureUsd: 50_000,
    consecutiveLossesThrottleThreshold: 2,
    correlatedRiskScale: config.godfather?.correlatedUsdRiskScale ?? 0.60,
    staleFeedThresholdMs: 2500,
  });

  // ─── 5. Optional Solana MEV Engine ─────────────────────────────────────────
  let marketFeed: MarketFeedService | null = null;
  let opportunityManager: OpportunityManager | null = null;
  let walletManager: WalletManager | null = null;
  let executionEngine: ExecutionEngine | null = null;

  if (isHeliusConfigured(config.helius.apiKey)) {
    const rpcUrl = heliusRpcUrl(config.helius.grpcUrl, config.helius.apiKey);
    walletManager = new WalletManager(rpcUrl);
    await walletManager.initialize();

    const raydiumBuilder = new RaydiumSwapBuilder();
    const orcaBuilder = new OrcaSwapBuilder();
    const jitoSubmitter = new JitoSubmitter(config.execution.jitoAuthKeypair, rpcUrl);

    const mockExecutionRepo = executionRepo ?? {
      getDailyStats: async () => ({ netProfitUsdc: 0 }),
      findRecent: async () => [],
      insert: async () => {},
      updateStatus: async () => {},
    };

    const riskEngine = new RiskEngine(config.execution, mockExecutionRepo, redisClient);
    executionEngine = new ExecutionEngine(
      walletManager,
      raydiumBuilder,
      orcaBuilder,
      jitoSubmitter,
      riskEngine,
      mockExecutionRepo,
      redisClient,
      config.execution,
    );

    opportunityManager = new OpportunityManager(
      config.execution.maxTradeCapitalUsdc,
      config.execution.minNetProfitBps,
    );

    opportunityManager.onOpportunity(async (opp: ArbitrageOpportunity) => {
      await publishEvent(CHANNELS.OPPORTUNITIES, { type: 'OPPORTUNITY_DETECTED', payload: opp });
      if (!config.execution.simulationMode && executionEngine) {
        executionEngine.executeArbitrage(opp).catch(err => {
          console.error('[MEV] Trade error:', err.message);
        });
      }
    });

    const multiRegionConfig = config.helius.multiRegionEnabled
      ? {
          enabled: true,
          regions: [
            { id: 'AMS', name: 'Amsterdam (Europe)', endpoint: config.helius.grpcAms ?? 'amsterdam.helius-rpc.com:443' },
            { id: 'TYO', name: 'Tokyo (Asia)', endpoint: config.helius.grpcTyo ?? 'tokyo.helius-rpc.com:443' },
            { id: 'EWR', name: 'New York (US East)', endpoint: config.helius.grpcEwr ?? 'mainnet.helius-rpc.com:443' },
          ],
        }
      : undefined;

    marketFeed = new MarketFeedService(config.helius.grpcUrl, config.helius.apiKey, [], multiRegionConfig);
    marketFeed.onPoolUpdate(snapshot => {
      opportunityManager?.updatePool(snapshot);
      if (poolRepo) poolRepo.insert(snapshot).catch(() => {});
      if (latencyRepo) latencyRepo.record('pool_update', 0).catch(() => {});
    });

    try {
      await marketFeed.start();
      console.log(`[STARTUP] ⚡ Solana MEV Feed active (${config.helius.multiRegionEnabled ? 'Multi-Region Geyser' : 'Single Region'})`);
    } catch (err: any) {
      console.warn('[STARTUP] Solana market feed unavailable:', err.message);
      marketFeed = null;
    }
  }

  // ─── 6. The GODFATHER Quantitative Directional Scalper (Core Profit Engine) 
  let godfatherEngine: GodfatherEngine | null = null;
  let candleFeed: CryptoCandleFeedService | null = null;
  let footprintService: HyperliquidFootprintService | null = null;
  let directionalExecutor: ReturnType<typeof createDirectionalExecutor> | null = null;

  if (config.godfather && config.godfather.enabled) {
    const gfConfig = config.godfather;
    directionalExecutor = createDirectionalExecutor(gfConfig);
    await directionalExecutor.initialize();

    if (gfConfig.footprintEnabled) {
      footprintService = new HyperliquidFootprintService({
        wsUrl: gfConfig.hyperliquidWsUrl,
        symbols: gfConfig.symbols,
        rollingWindowSecs: gfConfig.footprintRollingWindowSecs,
        obiDepth: gfConfig.obiDepth,
      });
      await footprintService.start();
      console.log(`[STARTUP] 👣 Sub-Second Hyperliquid Footprint active on: ${gfConfig.symbols.join(', ')}`);
    }

    candleFeed = new CryptoCandleFeedService(gfConfig.symbols);
    godfatherEngine = new GodfatherEngine(
      gfConfig,
      candleFeed.getResampler(),
      godfatherRepo,
      config.execution.maxTradeCapitalUsdc,
      directionalExecutor,
      footprintService ?? undefined,
    );

    candleFeed.on('candle', (resample) => {
      godfatherEngine?.onCandleUpdate(resample).catch(err => {
        console.error('[Godfather] Candle processing error:', err.message);
      });
    });

    // ─── Terminal Execution Displays (Zero Browser Needed) ────────────────────
    godfatherEngine.on('signal', async (signal) => {
      console.log(`\n=============================================================================`);
      console.log(`🎯 [SIGNAL] ${signal.grade} ${signal.direction} on ${signal.symbol}`);
      console.log(`   Entry Price: $${signal.entryPrice.toFixed(2)} | Stop Loss: $${signal.stopLoss.toFixed(2)}`);
      console.log(`   Risk Allocated: $${signal.allocatedRiskUsd.toFixed(2)} | Session: ${signal.session}`);
      console.log(`=============================================================================\n`);

      await publishEvent(CHANNELS.GODFATHER_SIGNALS, signal);
      auditRepo?.recordEvent({
        correlationId: signal.id,
        eventType: 'SIGNAL_DETECTED',
        symbol: signal.symbol,
        venue: gfConfig.venue,
        status: 'SUCCESS',
        details: { grade: signal.grade, direction: signal.direction, entry: signal.entryPrice, stopLoss: signal.stopLoss, riskUsd: signal.allocatedRiskUsd },
      }).catch(() => {});
    });

    godfatherEngine.on('trade_opened', async (trade) => {
      console.log(`\n🚀 [TRADE OPENED] ${trade.direction} ${trade.symbol}`);
      console.log(`   Size: ${trade.totalSize} | Entry: $${trade.entryPrice.toFixed(2)} | SL: $${trade.stopLoss.toFixed(2)}`);
      console.log(`   Tranche 1 TP: +1.00R | Tranche 2 TP: +2.00R | Tranche 3: Trailing ATR`);
      console.log(`-----------------------------------------------------------------------------\n`);

      await publishEvent(CHANNELS.GODFATHER_TRADES, { type: 'TRADE_OPENED', payload: trade });
      auditRepo?.recordEvent({
        correlationId: trade.id,
        eventType: 'ORDER_SUBMITTED',
        symbol: trade.symbol,
        venue: gfConfig.venue,
        status: 'SUCCESS',
        details: { size: trade.totalSize, entry: trade.entryPrice, stopLoss: trade.stopLoss },
      }).catch(() => {});
    });

    godfatherEngine.on('tranche_exit', async ({ trade, result }) => {
      console.log(`\n🎯 [TRANCHE UPDATE] ${trade.symbol} ${result.action}: ${result.message}`);
      console.log(`   Realized Profit Banked: +$${result.realizedPnlDeltaUsd.toFixed(2)}`);
      if (trade.isBreakevenLocked) {
        console.log(`   🛡️ BREAKEVEN RATCHET LOCKED: Trade is now 100% Risk-Free (SL at entry + 0.10R)!`);
      }
      console.log(`-----------------------------------------------------------------------------\n`);

      await publishEvent(CHANNELS.GODFATHER_TRADES, { type: 'TRANCHE_EXIT', payload: { trade, result } });
      auditRepo?.recordEvent({
        correlationId: trade.id,
        eventType: 'TRANCHE_EXIT',
        symbol: trade.symbol,
        venue: gfConfig.venue,
        status: 'SUCCESS',
        details: { action: result.action, message: result.message, pnlDelta: result.realizedPnlDeltaUsd },
      }).catch(() => {});
    });

    godfatherEngine.on('trade_closed', async (trade) => {
      const isWin = trade.realizedPnlUsd >= 0;
      console.log(`\n🏁 [TRADE CLOSED] ${trade.symbol} ${trade.direction}`);
      console.log(`   Exit Reason: ${trade.exitReason}`);
      console.log(`   Total Realized P&L: ${isWin ? '🟢 +$' : '🔴 -$'}${Math.abs(trade.realizedPnlUsd).toFixed(2)}`);
      console.log(`=============================================================================\n`);

      await publishEvent(CHANNELS.GODFATHER_TRADES, { type: 'TRADE_CLOSED', payload: trade });
      institutionalRiskEngine.recordTradeOutcome(trade.realizedPnlUsd);
      auditRepo?.recordEvent({
        correlationId: trade.id,
        eventType: 'FILL_RECONCILED',
        symbol: trade.symbol,
        venue: gfConfig.venue,
        status: isWin ? 'SUCCESS' : 'FAILED',
        details: { exitReason: trade.exitReason, realizedPnlUsd: trade.realizedPnlUsd },
      }).catch(() => {});
    });

    godfatherEngine.on('alert', (msg) => {
      console.warn('[Godfather] Alert:', msg);
    });

    try {
      await godfatherEngine.start();
      await candleFeed.start();
      console.log(`[STARTUP] 🎩 The Godfather active on [${gfConfig.symbols.join(', ')}] | Venue: ${gfConfig.venue.toUpperCase()}`);
    } catch (err) {
      console.error('[STARTUP] Failed to start Godfather Engine:', err);
    }
  }

  // ─── 7. Background Services (Only if PostgreSQL is available) ───────────────
  if (isDbHealthy && isRedisHealthy && simulationRepo) {
    try {
      const simRunner = new SimulationRunner(simulationRepo, config.redis.url, config.execution.maxTradeCapitalUsdc);
      await simRunner.start();
    } catch { /* optional */ }
  }

  if (isDbHealthy && opportunityRepo && simulationRepo && statisticsRepo) {
    try {
      const analyticsService = new AnalyticsService({
        opportunity: opportunityRepo,
        simulation: simulationRepo,
        statistics: statisticsRepo,
      });
      analyticsService.startScheduler();
    } catch { /* optional */ }
  }

  // ─── 8. Optional Telegram Bot ───────────────────────────────────────────────
  let telegramBot: TelegramAlertBot | null = null;
  if (config.telegram?.botToken && config.telegram.botToken !== 'your_telegram_bot_token_here' && walletManager && executionEngine) {
    try {
      telegramBot = new TelegramAlertBot(
        config.telegram.botToken,
        walletManager,
        executionEngine['riskEngine'],
        executionRepo,
        config.redis.url,
        godfatherRepo,
      );
      console.log('[STARTUP] 📱 Telegram remote alert bot active');
    } catch {
      console.warn('[STARTUP] Telegram bot skipped (configured token unreachable)');
    }
  }

  // ─── 9. API Server & Metrics ────────────────────────────────────────────────
  let apiServer: { start: () => void; stop: () => void } | null = null;
  try {
    apiServer = createApiServer(
      executionRepo ?? { getRecentTrades: async () => [] },
      walletManager ?? ({} as any),
      executionEngine ? executionEngine['riskEngine'] : ({} as any),
      config.api.port,
      godfatherRepo,
      godfatherEngine,
    );
  } catch { /* optional */ }

  try {
    startMetricsServer(config.monitoring.prometheusPort);
  } catch { /* optional */ }

  console.log('\n=============================================================================');
  console.log('🚀 SYSTEM RUNNING & SCANNING FOR PROFITABLE TRADES');
  console.log(`• Mode: ${config.godfather?.venue.toUpperCase() ?? 'HYPERLIQUID'} | Directional Scalper: ACTIVE`);
  console.log('• To exit safely, press CTRL + C');
  console.log('=============================================================================\n');

  // ─── 10. Graceful Shutdown ──────────────────────────────────────────────────
  const shutdown = async () => {
    console.log('\n[SHUTDOWN] Stopping bot...');
    godfatherEngine?.stop();
    candleFeed?.stop();
    footprintService?.stop();
    await directionalExecutor?.stop();
    marketFeed?.stop();
    apiServer?.stop();
    stopMetricsServer();

    if (isDbHealthy) {
      try { await dbDisconnect(); } catch {}
    }
    if (isRedisHealthy) {
      try { await disconnectRedis(); } catch {}
    }
    console.log('[SHUTDOWN] Clean exit complete.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  void telegramBot;
  void poolRepo;
  void executionGateway;
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
