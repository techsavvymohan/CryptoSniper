import type { GodfatherConfig } from './godfather.js';

export interface PoolSnapshot {
  address: string;
  tokenMintA: string;
  tokenMintB: string;
  price: number;
  sqrtPriceX64: bigint;
  liquidityA: number;
  liquidityB: number;
  feeBps: number;
  dex: 'raydium' | 'orca';
  slot: number;
  timestamp: number;
}

export interface ArbitrageOpportunity {
  id: string;
  pair: string;
  tokenMintA: string;
  tokenMintB: string;
  confidenceScore: number;
  netProfitBps: number;
  netProfitUsd: number;
  requiredCapitalUsdc: number;
  grossSpreadBps: number;
  buyFeesBps: number;
  sellFeesBps: number;
  buySlippageBps: number;
  sellSlippageBps: number;
  buyDex: 'raydium' | 'orca';
  sellDex: 'raydium' | 'orca';
  buyPoolAddress: string;
  sellPoolAddress: string;
  buyParams: RaydiumSwapParamsRaw | OrcaSwapParamsRaw;
  sellParams: RaydiumSwapParamsRaw | OrcaSwapParamsRaw;
  detectedAt: number;
  isProfitable?: boolean;
}

export interface RaydiumSwapParamsRaw {
  poolAddress: string;
  inputTokenMint: string;
  outputTokenMint: string;
  inputTokenAccount: string;
  outputTokenAccount: string;
  inputVault: string;
  outputVault: string;
  amountIn: string;
  minimumAmountOut: string;
  sqrtPriceLimitX64: string;
  observationId: string;
  ammConfig: string;
}

export interface OrcaSwapParamsRaw {
  whirlpoolAddress: string;
  tokenOwnerAccountA: string;
  tokenOwnerAccountB: string;
  tokenVaultA: string;
  tokenVaultB: string;
  tokenMintA: string;
  tokenMintB: string;
  tickArray0: string;
  tickArray1: string;
  tickArray2: string;
  oracle: string;
  amount: string;
  otherAmountThreshold: string;
  sqrtPriceLimit: string;
  amountSpecifiedIsInput: boolean;
  aToB: boolean;
}

export interface SimulationTrade {
  id: string;
  opportunityId: string;
  simulatedAt: Date;
  inputBuyPrice: number;
  inputSellPrice: number;
  noisedBuyPrice: number;
  noisedSellPrice: number;
  grossSpreadBps: number;
  netProfitBps: number;
  netProfitUsd: number;
  capitalUsdc: number;
  success: boolean;
  failureReason?: 'SLIPPAGE_EXCEEDED' | 'SPREAD_EVAPORATED' | 'INSUFFICIENT_PROFIT';
  latencyMs: number;
}

export interface ExecutionOrder {
  id: string;
  opportunityId: string;
  status: 'pending' | 'landed' | 'failed';
  capitalUsdc?: number;
  landedAt?: Date;
  bundleId?: string;
  failureReason?: string;
  netProfitUsd?: number;
  tipLamports?: number;
  createdAt?: Date;
}

export interface WalletState {
  solBalance: number;
  usdcBalance: number;
}

export interface ExecutionConfig {
  simulationMode: boolean;
  minNetProfitBps: number;
  dailyLossLimitUsdc: number;
  pauseOnConsecutiveFailures: number;
  maxConcurrentTrades: number;
  maxTradeCapitalUsdc: number;
  competitionLevel: 'low' | 'medium' | 'high';
  jitoAuthKeypair: string;
  jitoBlockEngineUrl: string;
  jitoTipRatio?: number;
}

export interface AppConfig {
  helius: {
    grpcUrl: string;
    apiKey: string;
    multiRegionEnabled?: boolean;
    grpcAms?: string;
    grpcTyo?: string;
    grpcEwr?: string;
  };
  execution: ExecutionConfig & {
    multiRegionJitoEnabled?: boolean;
    jitoEndpointsAms?: string;
    jitoEndpointsTyo?: string;
    jitoEndpointsNy?: string;
  };
  database: {
    url: string;
  };
  redis: {
    url: string;
  };
  telegram: {
    botToken: string;
    adminChatId: string;
  };
  api: {
    port: number;
    nextPublicApiUrl: string;
  };
  monitoring: {
    prometheusPort: number;
  };
  logLevel: string;
  godfather?: GodfatherConfig;
}

export * from './godfather.js';

export type MEVEventType =
  | 'ORDER_SUBMITTED'
  | 'ORDER_LANDED'
  | 'ORDER_FAILED'
  | 'KILL_SWITCH_TRIGGERED'
  | 'KILL_SWITCH_RELEASED'
  | 'OPPORTUNITY_DETECTED'
  | 'SIMULATION_COMPLETE'
  | 'DAILY_LIMIT_REACHED'
  | 'GODFATHER_SIGNAL'
  | 'GODFATHER_TRADE_OPENED'
  | 'GODFATHER_TRANCHE_HIT'
  | 'GODFATHER_TRADE_CLOSED';

export interface MEVEvent {
  type: MEVEventType;
  payload: Record<string, unknown>;
  timestamp: number;
}

