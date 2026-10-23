export type Timeframe = 'M1' | 'M5' | 'M15' | 'H1' | 'H4';
export type TradeDirection = 'BUY' | 'SELL';
export type SignalGrade = 'A_PLUS' | 'A' | 'B' | 'C';

export interface Candle {
  symbol: string;
  timeframe: Timeframe;
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  isClosed: boolean;
}

export interface FractalLevel {
  price: number;
  barIndex: number;
  timestamp: number;
  type: 'BSL' | 'SSL';
}

export interface FairValueGap {
  top: number;
  bottom: number;
  midpoint: number;
  type: 'BULLISH' | 'BEARISH';
  barIndex: number;
  timestamp: number;
}

export interface GodfatherSignal {
  id: string;
  symbol: string;
  direction: TradeDirection;
  grade: SignalGrade;
  timeframe: Timeframe;
  sweepLevel: number;
  sweepBreachUsd: number;
  entryPrice: number;
  stopLoss: number;
  fvgTop: number;
  fvgBottom: number;
  convictionMultiplier: number;
  allocatedRiskUsd: number;
  positionSize: number;
  session: string;
  h1Trend: string;
  status: 'PENDING_FILL' | 'FILLED' | 'EXPIRED' | 'CANCELLED' | 'REJECTED';
  detectedAt: number;
  filledAt?: number;
  expiredAt?: number;
}

export interface GodfatherTranche {
  id: string;
  tradeId: string;
  trancheNumber: 1 | 2 | 3;
  targetRr?: number;
  targetPrice?: number;
  volumeFraction: number;
  size: number;
  trailingStop?: number;
  status: 'ACTIVE' | 'TAKEN' | 'STOPPED_OUT' | 'CANCELLED';
  closedPrice?: number;
  realizedPnlUsd: number;
  closedAt?: number;
}

export interface GodfatherTrade {
  id: string;
  signalId: string;
  symbol: string;
  direction: TradeDirection;
  entryPrice: number;
  stopLoss: number;
  initialStopLoss?: number;
  breakevenPrice: number;
  isBreakevenLocked: boolean;
  totalSize: number;
  remainingSize: number;
  realizedPnlUsd: number;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  openedAt: number;
  closedAt?: number;
  exitReason?: string;
  tranches: GodfatherTranche[];
}

export type DirectionalVenue = 'hyperliquid' | 'bybit' | 'paper';

export interface GodfatherConfig {
  enabled: boolean;
  symbols: string[];
  venue: DirectionalVenue;
  testnet: boolean;
  hyperliquid?: {
    privateKey?: string;
    vaultAddress?: string;
  };
  bybit?: {
    apiKey?: string;
    apiSecret?: string;
  };
  btcSweepMinBreachUsd: number;
  solSweepMinBreachUsd: number;
  btcRetestMaxBars: number;
  solRetestMaxBars: number;
  convictionScaleAPlus: number;
  convictionScaleA: number;
  convictionScaleB: number;
  weekendRiskScale: number;
  weekendBreakevenTriggerR: number;
  dailyLossLimitUsdc: number;
  maxAccountDdPct: number;
  correlatedUsdRiskScale: number;
  baseRiskPct: number;
  footprintEnabled?: boolean;
  hyperliquidWsUrl?: string;
  footprintRollingWindowSecs?: number;
  obiDepth?: number;
}
