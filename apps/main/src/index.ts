import { config as loadDotenv } from 'dotenv';
import path from 'path';

// Load .env from monorepo root (dist/ → apps/main → apps → root)
loadDotenv({ path: path.resolve(__dirname, '..', '..', '..', '.env') });
import { loadConfig, CHANNELS, heliusRpcUrl, isHeliusConfigured } from '@mev-research/shared';
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
  db,
} from '@mev-research/database';
import {
  WalletManager,
  RaydiumSwapBuilder,
  OrcaSwapBuilder,
  JitoSubmitter,
  RiskEngine,
  ExecutionEngine,
} from '@mev-research/execution';
import { MarketFeedService } from '@mev-research/market-feed';
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

  opportunityManager.onOpportunity(async (opp) => {
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
    marketFeed = new MarketFeedService(config.helius.grpcUrl, config.helius.apiKey);
    marketFeed.onPoolUpdate(snapshot => {
      opportunityManager.updatePool(snapshot);
      poolRepo.insert(snapshot).catch(() => { /* non-critical */ });
      latencyRepo.record('pool_update', 0).catch(() => { /* non-critical */ });
    });
    try {
      await marketFeed.start();
      console.log('[STARTUP] Market feed active');
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
  );
  console.log('[STARTUP] Telegram bot active');

  // ─── API Server ──────────────────────────────────────────────────────────────
  const apiServer = createApiServer(
    executionRepo,
    walletManager,
    riskEngine,
    config.api.port,
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
