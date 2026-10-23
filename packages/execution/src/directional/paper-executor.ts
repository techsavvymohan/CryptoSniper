import { EventEmitter } from 'events';
import { generateId } from '@mev-research/shared';
import type {
  GodfatherTrade,
  GodfatherTranche,
  TradeDirection,
  DirectionalVenue,
} from '@mev-research/shared';
import type {
  DirectionalOrderRequest,
  DirectionalOrderResult,
  IDirectionalExchangeAdapter,
  IDirectionalExecutor,
  PositionInfo,
} from './types.js';

export interface PaperExecutorConfig {
  slippageBps?: number; // e.g. 2 bps = 0.02%
  makerFeeBps?: number; // -0.01% or 0.02%
  takerFeeBps?: number; // 0.04%
  initialEquity?: number;
}

export class PaperDirectionalExecutor extends EventEmitter implements IDirectionalExchangeAdapter {
  public readonly venue: DirectionalVenue = 'paper';
  private slippageBps: number;
  private takerFeeBps: number;
  private equity: number;
  private trades = new Map<string, GodfatherTrade>();
  private activePositions = new Map<string, PositionInfo>();

  constructor(config: PaperExecutorConfig = {}) {
    super();
    this.slippageBps = config.slippageBps ?? 2;
    this.takerFeeBps = config.takerFeeBps ?? 4;
    this.equity = config.initialEquity ?? 10_000;
  }

  public async initialize(): Promise<void> {
    console.log('[PaperExecutor] Initialized with $10,000 simulated equity');
  }

  public async stop(): Promise<void> {
    // no-op
  }

  public async placeLimitOrder(
    symbol: string,
    direction: TradeDirection,
    price: number,
    size: number,
    _postOnly = true,
  ): Promise<{ orderId: string; executedPrice: number }> {
    const orderId = `paper-lmt-${generateId()}`;
    // Simulate limit fill at exact limit price (Post-Only)
    this.activePositions.set(symbol, {
      symbol,
      direction,
      size,
      entryPrice: price,
      unrealizedPnlUsd: 0,
      leverage: 10,
    });
    return { orderId, executedPrice: price };
  }

  public async placeMarketOrder(
    symbol: string,
    direction: TradeDirection,
    size: number,
  ): Promise<{ orderId: string; executedPrice: number }> {
    const orderId = `paper-mkt-${generateId()}`;
    const mid = symbol.includes('BTC') ? 67000 : 175;
    const slip = direction === 'BUY' ? 1 + (this.slippageBps / 10000) : 1 - (this.slippageBps / 10000);
    const executedPrice = parseFloat((mid * slip).toFixed(2));

    this.activePositions.set(symbol, {
      symbol,
      direction,
      size,
      entryPrice: executedPrice,
      unrealizedPnlUsd: 0,
      leverage: 10,
    });

    return { orderId, executedPrice };
  }

  public async setStopLoss(
    _symbol: string,
    _direction: TradeDirection,
    _stopPrice: number,
    _size: number,
  ): Promise<{ orderId: string }> {
    return { orderId: `paper-sl-${generateId()}` };
  }

  public async setTakeProfit(
    _symbol: string,
    _direction: TradeDirection,
    _targetPrice: number,
    _size: number,
    trancheNumber: 1 | 2 | 3,
  ): Promise<{ orderId: string }> {
    return { orderId: `paper-tp${trancheNumber}-${generateId()}` };
  }

  public async updateStopLoss(
    _symbol: string,
    _direction: TradeDirection,
    _newStopPrice: number,
    _orderId?: string,
  ): Promise<boolean> {
    return true;
  }

  public async cancelOrder(_symbol: string, _orderId: string): Promise<boolean> {
    return true;
  }

  public async closePosition(symbol: string, _size?: number): Promise<boolean> {
    this.activePositions.delete(symbol);
    return true;
  }

  public async getPosition(symbol: string): Promise<PositionInfo | null> {
    return this.activePositions.get(symbol) ?? null;
  }

  public async getAccountEquity(): Promise<number> {
    return this.equity;
  }

  public async executeOrder(request: DirectionalOrderRequest): Promise<DirectionalOrderResult> {
    const { signalId, symbol, direction, price, size, stopLoss, tranches } = request;

    if (size <= 0) {
      return { success: false, rejectionReason: 'SIZE_NON_POSITIVE' };
    }

    const slippageMultiplier =
      direction === 'BUY'
        ? 1 + (this.slippageBps / 10_000)
        : 1 - (this.slippageBps / 10_000);
    const executedPrice = parseFloat((price * slippageMultiplier).toFixed(symbol.includes('BTC') ? 2 : 4));

    const notionalUsd = executedPrice * size;
    const feeUsd = parseFloat((notionalUsd * (this.takerFeeBps / 10_000)).toFixed(4));

    const tradeId = generateId();
    const tradeTranches: GodfatherTranche[] = tranches.map(t => ({
      id: generateId(),
      tradeId,
      trancheNumber: t.trancheNumber,
      targetPrice: t.targetPrice,
      volumeFraction: t.trancheNumber === 1 ? 0.25 : t.trancheNumber === 2 ? 0.35 : 0.40,
      size: t.size,
      status: 'ACTIVE',
      realizedPnlUsd: 0,
    }));

    const trade: GodfatherTrade = {
      id: tradeId,
      signalId,
      symbol,
      direction,
      entryPrice: executedPrice,
      stopLoss,
      breakevenPrice: executedPrice,
      isBreakevenLocked: false,
      totalSize: size,
      remainingSize: size,
      realizedPnlUsd: -feeUsd,
      status: 'OPEN',
      openedAt: Date.now(),
      tranches: tradeTranches,
    };

    this.trades.set(tradeId, trade);
    this.activePositions.set(symbol, {
      symbol,
      direction,
      size,
      entryPrice: executedPrice,
      unrealizedPnlUsd: 0,
      leverage: 10,
    });

    this.emit('trade_executed', { trade, executedPrice, feeUsd });

    return {
      success: true,
      orderId: tradeId,
      trade,
      executedPrice,
      feeUsd,
    };
  }
}
