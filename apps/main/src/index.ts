import { config as loadDotenv } from 'dotenv';
import path from 'path';

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
  db,
} from '@mev-research/database';
import {
  WalletManager,
  RaydiumSwapBuilder,
  OrcaSwapBuilder,
  JitoSubmitter,
  RiskEngine,
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
import { SimulationEngine, SimulationRunner } from '@mev-research/simulation';
import { AnalyticsService } from '@mev-research/analytics';
import { TelegramAlertBot } from '@mev-research/telegram';
import { createApiServer } from '@mev-research/api';
import { startMetricsServer, stopMetricsServer } from '@mev-research/monitoring';

async function main() {
  // ─── Config ─────────────────────────────────────────────────────────────────
  const config = loadConfig();
  console.log(`[STARTUP] Simulation mode: ${config.execution.simulationMode}`);
  console.log(`[STARTUP] Log level: ${config.logLevel}`);

  // ─── Database & Redis ────────────────────────────────────────────────────────
  await dbConnect();
  await connectRedis();

  const dbOk = await dbHealthCheck();
  const redisOk = await redisHealthCheck();
  if (!dbOk) throw new Error('[STARTUP] PostgreSQL health check failed');
  if (!redisOk) throw new Error('[STARTUP] Redis health check failed');
  console.log('[STARTUP] DB and Redis healthy');

  // ─── Repositories ────────────────────────────────────────────────────────────
  const pool = db.pool;
  const executionRepo = new ExecutionRepository(pool);
  const opportunityRepo = new OpportunityRepository(pool);
  const simulationRepo = new SimulationRepository(pool);
  const statisticsRepo = new StatisticsRepository(pool);
  const poolRepo = new PoolRepository(pool);
  const latencyRepo = new LatencyRepository(pool);
  const godfatherRepo = new GodfatherRepository(pool);

  // ─── Execution Layer ─────────────────────────────────────────────────────────
  const rpcUrl = isHeliusConfigured(config.helius.apiKey)
    ? heliusRpcUrl(config.helius.grpcUrl, config.helius.apiKey)
    : `https://${config.helius.grpcUrl.replace(':443', '')}`;

  const walletManager = new WalletManager(rpcUrl);
  await walletManager.initialize();

  const raydiumBuilder = new RaydiumSwapBuilder();
  const orcaBuilder = new OrcaSwapBuilder();
  const jitoSubmitter = new JitoSubmitter(
    config.execution.jitoAuthKeypair,
    rpcUrl,
  );

  const redisClient = {
    get: (key: string) => cacheGet(key),
    set: (key: string, value: string, _mode?: string, ttl?: number) => cacheSet(key, value, ttl),
    del: (key: string) => cacheDel(key),
    publish: async (channel: string, data: unknown) => {
      await publish(channel as typeof CHANNELS[keyof typeof CHANNELS], data);
    },
  };

  const riskEngine = new RiskEngine(config.execution, executionRepo, redisClient);
  const executionEngine = new ExecutionEngine(
    walletManager,
    raydiumBuilder,
    orcaBuilder,
    jitoSubmitter,
    riskEngine,
    executionRepo,
    redisClient,
    config.execution,
  );

  // ─── Spread Engine ───────────────────────────────────────────────────────────
  const opportunityManager = new OpportunityManager(
    config.execution.maxTradeCapitalUsdc,
    config.execution.minNetProfitBps,
  );

  opportunityManager.onOpportunity(async (opp: ArbitrageOpportunity) => {
    // Publish to Redis for simulation runner and other consumers
    await publish(CHANNELS.OPPORTUNITIES, { type: 'OPPORTUNITY_DETECTED', payload: opp });

    if (!config.execution.simulationMode) {
      executionEngine.executeArbitrage(opp).catch(err => {
        console.error('[Execution] Trade error:', err.message);
      });
    }
  });

  // ─── Market Feed ─────────────────────────────────────────────────────────────
  let marketFeed: MarketFeedService | null = null;

  if (isHeliusConfigured(config.helius.apiKey)) {
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

    marketFeed = new MarketFeedService(
      config.helius.grpcUrl,
      config.helius.apiKey,
      [],
      multiRegionConfig,
    );
    marketFeed.onPoolUpdate(snapshot => {
      opportunityManager.updatePool(snapshot);
      poolRepo.insert(snapshot).catch(() => { /* non-critical */ });
      latencyRepo.record('pool_update', 0).catch(() => { /* non-critical */ });
    });
    try {
      await marketFeed.start();
      console.log(
        `[STARTUP] Market feed active (${config.helius.multiRegionEnabled ? 'Multi-Region Geyser: AMS, TYO, EWR' : 'Single Region'})`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[STARTUP] Market feed failed to start:', message);
      marketFeed = null;
    }
  } else {
    console.warn('[STARTUP] Market feed skipped — set HELIUS_API_KEY in .env');
  }

  // ─── Simulation Runner ────────────────────────────────────────────────────────
  const simRunner = new SimulationRunner(simulationRepo, config.redis.url, config.execution.maxTradeCapitalUsdc);
  await simRunner.start();

  // ─── Engine 2: The GODFATHER Directional Scalper ─────────────────────────────
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
      console.log(
        `[STARTUP] 👣 Sub-Second Hyperliquid Footprint Service active on symbols: ${gfConfig.symbols.join(', ')}`,
      );
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

    godfatherEngine.on('signal', async (signal) => {
      console.log(`[Godfather] 🎩 Signal: ${signal.grade} ${signal.direction} on ${signal.symbol} at $${signal.entryPrice} (Risk: $${signal.allocatedRiskUsd.toFixed(2)})`);
      await publish(CHANNELS.GODFATHER_SIGNALS, signal);
    });

    godfatherEngine.on('trade_opened', async (trade) => {
      console.log(`[Godfather] 🚀 Trade Opened: ${trade.direction} ${trade.symbol} | Size: ${trade.totalSize} | Entry: $${trade.entryPrice} | SL: $${trade.stopLoss}`);
      await publish(CHANNELS.GODFATHER_TRADES, { type: 'TRADE_OPENED', payload: trade });
    });

    godfatherEngine.on('tranche_exit', async ({ trade, result }) => {
      console.log(`[Godfather] 🎯 Tranche Update: ${trade.symbol} ${result.action} (${result.message}) | PnL: +$${result.realizedPnlDeltaUsd.toFixed(2)}`);
      await publish(CHANNELS.GODFATHER_TRADES, { type: 'TRANCHE_EXIT', payload: { trade, result } });
    });

    godfatherEngine.on('trade_closed', async (trade) => {
      console.log(`[Godfather] 🏁 Trade Closed: ${trade.symbol} ${trade.direction} | Exit: ${trade.exitReason} | Realized PnL: $${trade.realizedPnlUsd.toFixed(2)}`);
      await publish(CHANNELS.GODFATHER_TRADES, { type: 'TRADE_CLOSED', payload: trade });
    });

    godfatherEngine.on('alert', (msg) => {
      console.warn('[Godfather] Alert:', msg);
    });

    try {
      await godfatherEngine.start();
      await candleFeed.start();
      console.log(`[STARTUP] 🎩 Godfather Directional Scalper active on symbols: ${gfConfig.symbols.join(', ')} [Venue: ${gfConfig.venue.toUpperCase()}]`);
    } catch (err) {
      console.error('[STARTUP] Failed to start Godfather Engine:', err);
    }
  } else {
    console.log('[STARTUP] Godfather Engine disabled in config');
  }

  // ─── Analytics ───────────────────────────────────────────────────────────────
  const analyticsService = new AnalyticsService({
    opportunity: opportunityRepo,
    simulation: simulationRepo,
    statistics: statisticsRepo,
  });
  analyticsService.startScheduler();

  // ─── Telegram Bot ─────────────────────────────────────────────────────────────
  const telegramBot = new TelegramAlertBot(
    config.telegram.botToken,
    walletManager,
    riskEngine,
    executionRepo,
    config.redis.url,
    godfatherRepo,
  );
  console.log('[STARTUP] Telegram bot active');

  // ─── API Server ──────────────────────────────────────────────────────────────
  const apiServer = createApiServer(
    executionRepo,
    walletManager,
    riskEngine,
    config.api.port,
    godfatherRepo,
    godfatherEngine,
  );

  // ─── Prometheus Metrics ──────────────────────────────────────────────────────
  startMetricsServer(config.monitoring.prometheusPort);

  console.log('[STARTUP] All systems go');
  if (config.execution.simulationMode) {
    console.log('[STARTUP] SIMULATION MODE — no real capital at risk');
  } else {
    console.log('[STARTUP] ⚠️  LIVE TRADING MODE — real capital at risk');
  }

  // ─── Graceful Shutdown ───────────────────────────────────────────────────────
  const shutdown = async () => {
    console.log('[SHUTDOWN] Stopping...');
    godfatherEngine?.stop();
    candleFeed?.stop();
    footprintService?.stop();
    await directionalExecutor?.stop();
    simRunner.stop();
    analyticsService.stopScheduler();
    marketFeed?.stop();
    apiServer.stop();
    stopMetricsServer();
    await dbDisconnect();
    await disconnectRedis();
    console.log('[SHUTDOWN] Clean exit');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Suppress unused variable warning
  void telegramBot;
  void poolRepo;
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
