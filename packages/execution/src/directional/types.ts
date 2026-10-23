import type {
  GodfatherSignal,
  GodfatherTrade,
  GodfatherTranche,
  TradeDirection,
  DirectionalVenue,
} from '@mev-research/shared';

export type { DirectionalVenue };

export interface DirectionalOrderRequest {
  signalId: string;
  symbol: string;
  direction: TradeDirection;
  orderType: 'LIMIT' | 'MARKET';
  price: number;
  size: number;
  stopLoss: number;
  tranches: Array<{
    trancheNumber: 1 | 2 | 3;
    targetPrice?: number;
    size: number;
  }>;
}

export interface DirectionalOrderResult {
  success: boolean;
  orderId?: string;
  trade?: GodfatherTrade;
  rejectionReason?: string;
  executedPrice?: number;
  feeUsd?: number;
}

export interface PositionInfo {
  symbol: string;
  direction: TradeDirection;
  size: number;
  entryPrice: number;
  unrealizedPnlUsd: number;
  leverage: number;
  liquidationPrice?: number;
}

export interface IDirectionalExchangeAdapter {
  readonly venue: DirectionalVenue;
  initialize(): Promise<void>;
  placeLimitOrder(
    symbol: string,
    direction: TradeDirection,
    price: number,
    size: number,
    postOnly?: boolean,
  ): Promise<{ orderId: string; executedPrice?: number }>;
  placeMarketOrder(
    symbol: string,
    direction: TradeDirection,
    size: number,
  ): Promise<{ orderId: string; executedPrice: number }>;
  setStopLoss(
    symbol: string,
    direction: TradeDirection,
    stopPrice: number,
    size: number,
  ): Promise<{ orderId: string }>;
  setTakeProfit(
    symbol: string,
    direction: TradeDirection,
    targetPrice: number,
    size: number,
    trancheNumber: 1 | 2 | 3,
  ): Promise<{ orderId: string }>;
  updateStopLoss(
    symbol: string,
    direction: TradeDirection,
    newStopPrice: number,
    orderId?: string,
  ): Promise<boolean>;
  cancelOrder(symbol: string, orderId: string): Promise<boolean>;
  closePosition(symbol: string, size?: number): Promise<boolean>;
  getPosition(symbol: string): Promise<PositionInfo | null>;
  getAccountEquity(): Promise<number>;
  stop(): Promise<void>;
}

export interface IDirectionalExecutor {
  executeOrder(request: DirectionalOrderRequest): Promise<DirectionalOrderResult>;
  cancelOrder(orderId: string, symbol?: string): Promise<boolean>;
  closePosition(tradeId: string, reason: string, symbol?: string): Promise<boolean>;
}
