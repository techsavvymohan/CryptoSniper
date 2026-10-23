import type { AppConfig } from '../types/index.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
        `Please set ${name} in your .env file.`,
    );
  }
  return value;
}

function requireInt(name: string): number {
  const value = requireEnv(name);
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a valid integer, got: "${value}"`);
  }
  return parsed;
}

function requireFloat(name: string): number {
  const value = requireEnv(name);
  const parsed = parseFloat(value);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a valid number, got: "${value}"`);
  }
  return parsed;
}

function requireEnum<T extends string>(name: string, allowed: readonly T[]): T {
  const value = requireEnv(name) as T;
  if (!allowed.includes(value)) {
    throw new Error(
      `Environment variable ${name} must be one of [${allowed.join(', ')}], got: "${value}"`,
    );
  }
  return value;
}

export function loadConfig(): AppConfig {
  return {
    helius: {
      grpcUrl: requireEnv('HELIUS_GRPC_URL'),
      apiKey: requireEnv('HELIUS_API_KEY'),
      multiRegionEnabled: process.env['GEYSER_REGIONS_ENABLED'] === 'true',
      grpcAms: process.env['HELIUS_GRPC_AMS'] ?? 'amsterdam.helius-rpc.com:443',
      grpcTyo: process.env['HELIUS_GRPC_TYO'] ?? 'tokyo.helius-rpc.com:443',
      grpcEwr: process.env['HELIUS_GRPC_EWR'] ?? 'mainnet.helius-rpc.com:443',
    },
    execution: {
      simulationMode: process.env['SIMULATION_MODE'] === 'true',
      minNetProfitBps: requireInt('MIN_NET_PROFIT_BPS'),
      dailyLossLimitUsdc: requireFloat('DAILY_LOSS_LIMIT_USDC'),
      maxTradeCapitalUsdc: requireFloat('MAX_TRADE_CAPITAL_USDC'),
      pauseOnConsecutiveFailures: 3,
      maxConcurrentTrades: 2,
      competitionLevel: requireEnum('COMPETITION_LEVEL', ['low', 'medium', 'high']),
      jitoAuthKeypair: requireEnv('JITO_AUTH_KEYPAIR'),
      jitoBlockEngineUrl: requireEnv('JITO_BLOCK_ENGINE_URL'),
      jitoTipRatio: process.env['JITO_TIP_RATIO'] ? requireFloat('JITO_TIP_RATIO') : undefined,
      multiRegionJitoEnabled: process.env['JITO_MULTI_REGION_ROUTING'] !== 'false',
      jitoEndpointsAms: process.env['JITO_ENDPOINTS_AMS'],
      jitoEndpointsTyo: process.env['JITO_ENDPOINTS_TYO'],
      jitoEndpointsNy: process.env['JITO_ENDPOINTS_NY'],
    },
    database: {
      url: process.env['DATABASE_URL'] ?? '',
    },
    redis: {
      url: process.env['REDIS_URL'] ?? '',
    },
    telegram: {
      botToken: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
      adminChatId: process.env['TELEGRAM_ADMIN_CHAT_ID'] ?? '',
    },
    api: {
      port: process.env['PORT'] ? requireInt('PORT') : 3001,
      nextPublicApiUrl: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001',
    },
    monitoring: {
      prometheusPort: process.env['PROMETHEUS_PORT'] ? requireInt('PROMETHEUS_PORT') : 9091,
    },
    logLevel: process.env['LOG_LEVEL'] ?? 'info',
    godfather: {
      enabled: process.env['GODFATHER_ENABLED'] !== 'false',
      symbols: process.env['GODFATHER_SYMBOLS']
        ? process.env['GODFATHER_SYMBOLS'].split(',')
        : ['BTCUSD', 'ETHUSD', 'SOLUSD', 'DOGEUSD', 'SUIUSD', 'AVAXUSD', 'NEARUSD', 'LINKUSD', 'APTUSD', 'ARBUSD', 'OPUSD', 'WIFUSD', 'PEPEUSD', 'TIAUSD', 'INJUSD'],
      venue: (process.env['DIRECTIONAL_VENUE'] as 'hyperliquid' | 'bybit' | 'paper') ?? 'paper',
      testnet: process.env['DIRECTIONAL_TESTNET'] !== 'false',
      hyperliquid: {
        privateKey: process.env['HYPERLIQUID_WALLET_PRIVATE_KEY'],
        vaultAddress: process.env['HYPERLIQUID_VAULT_ADDRESS'],
      },
      bybit: {
        apiKey: process.env['BYBIT_API_KEY'],
        apiSecret: process.env['BYBIT_API_SECRET'],
      },
      btcSweepMinBreachUsd: process.env['BTC_SWEEP_MIN_BREACH_USD'] ? parseFloat(process.env['BTC_SWEEP_MIN_BREACH_USD']) : 50.0,
      solSweepMinBreachUsd: process.env['SOL_SWEEP_MIN_BREACH_USD'] ? parseFloat(process.env['SOL_SWEEP_MIN_BREACH_USD']) : 0.35,
      btcRetestMaxBars: process.env['BTC_RETEST_MAX_BARS'] ? parseInt(process.env['BTC_RETEST_MAX_BARS'], 10) : 8,
      solRetestMaxBars: process.env['SOL_RETEST_MAX_BARS'] ? parseInt(process.env['SOL_RETEST_MAX_BARS'], 10) : 15,
      convictionScaleAPlus: process.env['CONVICTION_SCALE_A_PLUS'] ? parseFloat(process.env['CONVICTION_SCALE_A_PLUS']) : 1.25,
      convictionScaleA: process.env['CONVICTION_SCALE_A'] ? parseFloat(process.env['CONVICTION_SCALE_A']) : 1.00,
      convictionScaleB: process.env['CONVICTION_SCALE_B'] ? parseFloat(process.env['CONVICTION_SCALE_B']) : 0.50,
      weekendRiskScale: process.env['WEEKEND_RISK_SCALE'] ? parseFloat(process.env['WEEKEND_RISK_SCALE']) : 0.50,
      weekendBreakevenTriggerR: process.env['WEEKEND_BREAKEVEN_TRIGGER_R'] ? parseFloat(process.env['WEEKEND_BREAKEVEN_TRIGGER_R']) : 1.40,
      dailyLossLimitUsdc: (process.env['GODFATHER_DAILY_LOSS_LIMIT_USDC'] || process.env['GODFATHER_DAILY_LOSS_LIMIT_USD'])
        ? parseFloat(process.env['GODFATHER_DAILY_LOSS_LIMIT_USDC'] || process.env['GODFATHER_DAILY_LOSS_LIMIT_USD']!)
        : 450.0,
      maxAccountDdPct: process.env['MAX_ACCOUNT_DD_PCT'] ? parseFloat(process.env['MAX_ACCOUNT_DD_PCT']) : 9.0,
      correlatedUsdRiskScale: process.env['CORRELATED_USD_RISK_SCALE'] ? parseFloat(process.env['CORRELATED_USD_RISK_SCALE']) : 0.60,
      baseRiskPct: process.env['BASE_RISK_PCT'] ? parseFloat(process.env['BASE_RISK_PCT']) : 0.85,
      footprintEnabled: process.env['HYPERLIQUID_FOOTPRINT_ENABLED'] !== 'false',
      hyperliquidWsUrl: process.env['HYPERLIQUID_WS_URL'] ?? 'wss://api.hyperliquid.xyz/ws',
      footprintRollingWindowSecs: process.env['FOOTPRINT_ROLLING_WINDOW_SECS'] ? parseInt(process.env['FOOTPRINT_ROLLING_WINDOW_SECS'], 10) : 60,
      obiDepth: process.env['OBI_LEVEL_DEPTH'] ? parseInt(process.env['OBI_LEVEL_DEPTH'], 10) : 5,
    },
  };
}
