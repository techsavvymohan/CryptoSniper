"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}\n` +
            `Please set ${name} in your .env file.`);
    }
    return value;
}
function requireInt(name) {
    const value = requireEnv(name);
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
        throw new Error(`Environment variable ${name} must be a valid integer, got: "${value}"`);
    }
    return parsed;
}
function requireFloat(name) {
    const value = requireEnv(name);
    const parsed = parseFloat(value);
    if (isNaN(parsed)) {
        throw new Error(`Environment variable ${name} must be a valid number, got: "${value}"`);
    }
    return parsed;
}
function requireEnum(name, allowed) {
    const value = requireEnv(name);
    if (!allowed.includes(value)) {
        throw new Error(`Environment variable ${name} must be one of [${allowed.join(', ')}], got: "${value}"`);
    }
    return value;
}
function loadConfig() {
    return {
        helius: {
            grpcUrl: requireEnv('HELIUS_GRPC_URL'),
            apiKey: requireEnv('HELIUS_API_KEY'),
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
        },
        database: {
            url: requireEnv('DATABASE_URL'),
        },
        redis: {
            url: requireEnv('REDIS_URL'),
        },
        telegram: {
            botToken: requireEnv('TELEGRAM_BOT_TOKEN'),
            adminChatId: requireEnv('TELEGRAM_ADMIN_CHAT_ID'),
        },
        api: {
            port: process.env['PORT'] ? requireInt('PORT') : 3001,
            nextPublicApiUrl: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001',
        },
        monitoring: {
            prometheusPort: process.env['PROMETHEUS_PORT'] ? requireInt('PROMETHEUS_PORT') : 9091,
        },
        logLevel: process.env['LOG_LEVEL'] ?? 'info',
    };
}
