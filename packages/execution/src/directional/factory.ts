import { EventEmitter } from 'events';
import type { GodfatherConfig, TradeDirection } from '@mev-research/shared';
import { generateId } from '@mev-research/shared';
import type {
  DirectionalOrderRequest,
  DirectionalOrderResult,
  DirectionalVenue,
  IDirectionalExchangeAdapter,
  IDirectionalExecutor,
} from './types.js';
import { PaperDirectionalExecutor } from './paper-executor.js';
import { HyperliquidAdapter } from './hyperliquid-adapter.js';
import { BybitAdapter } from './bybit-adapter.js';

export class DirectionalExecutionManager extends EventEmitter implements IDirectionalExecutor {
  private primaryAdapter: IDirectionalExchangeAdapter;
  private fallbackAdapter?: IDirectionalExchangeAdapter;
  private activeVenue: DirectionalVenue;
  private consecutiveFailures = 0;
  private tradeSymbols = new Map<string, string>(); // tradeId -> symbol
  private orderSymbols = new Map<string, string>(); // orderId -> symbol

  constructor(config: GodfatherConfig) {
    super();
    this.activeVenue = config.venue ?? 'paper';

    if (this.activeVenue === 'hyperliquid') {
      this.primaryAdapter = new HyperliquidAdapter({
        privateKey: config.hyperliquid?.privateKey,
        vaultAddress: config.hyperliquid?.vaultAddress,
        testnet: config.testnet,
      });

      // Bybit as secondary fallback if API keys provided
      if (config.bybit?.apiKey) {
        this.fallbackAdapter = new BybitAdapter({
          apiKey: config.bybit.apiKey,
          apiSecret: config.bybit.apiSecret,
          testnet: config.testnet,
        });
      }
    } else if (this.activeVenue === 'bybit') {
      this.primaryAdapter = new BybitAdapter({
        apiKey: config.bybit?.apiKey,
        apiSecret: config.bybit?.apiSecret,
        testnet: config.testnet,
      });
    } else {
      // Paper trading
      this.primaryAdapter = new PaperDirectionalExecutor();
    }
  }

  public async initialize(): Promise<void> {
    await this.primaryAdapter.initialize();
    if (this.fallbackAdapter) {
      await this.fallbackAdapter.initialize();
    }
  }

  public getActiveAdapter(): IDirectionalExchangeAdapter {
    return this.primaryAdapter;
  }

  public getActiveVenue(): DirectionalVenue {
    return this.activeVenue;
  }

  /**
   * Executes a complete Godfather trade: FVG limit entry + SL + 3 discrete tranches.
   */
  public async executeOrder(request: DirectionalOrderRequest): Promise<DirectionalOrderResult> {
    const { signalId, symbol, direction, price, size, stopLoss, tranches } = request;

    try {
      // 1. Submit FVG Limit Order (Post-Only for negative maker fee rebates on Hyperliquid)
      const entryResult = await this.primaryAdapter.placeLimitOrder(
        symbol,
        direction,
        price,
        size,
        true, // postOnly
      );

      if (entryResult.orderId) {
        this.orderSymbols.set(entryResult.orderId, symbol);
      }
      if (signalId) {
        this.tradeSymbols.set(signalId, symbol);
      }

      // 2. Set Initial Stop Loss on matching engine
      await this.primaryAdapter.setStopLoss(symbol, direction, stopLoss, size);

      // 3. Set Tranche 1 & Tranche 2 Take-Profit Orders
      for (const t of tranches) {
        if (t.targetPrice) {
          await this.primaryAdapter.setTakeProfit(
            symbol,
            direction,
            t.targetPrice,
            t.size,
            t.trancheNumber,
          );
        }
      }

      this.consecutiveFailures = 0;

      return {
        success: true,
        orderId: entryResult.orderId,
        executedPrice: entryResult.executedPrice ?? price,
        feeUsd: 0,
      };
    } catch (err: any) {
      this.consecutiveFailures += 1;
      console.error(`[ExecutionManager] Order failed on ${this.activeVenue}:`, err.message);

      // If primary Hyperliquid fails 2 times and Bybit fallback is configured, notify failover
      if (this.consecutiveFailures >= 2 && this.fallbackAdapter && this.activeVenue === 'hyperliquid') {
        console.warn(`[ExecutionManager] ⚠️ Triggering automatic failover to Bybit V5!`);
        this.emit('venue_failover', { from: 'hyperliquid', to: 'bybit', reason: err.message });
      }

      return {
        success: false,
        rejectionReason: err.message || 'ORDER_REJECTED',
      };
    }
  }

  public async cancelOrder(orderId: string, symbol?: string): Promise<boolean> {
    const targetSymbol = symbol ?? this.orderSymbols.get(orderId) ?? 'BTCUSD';
    return await this.primaryAdapter.cancelOrder(targetSymbol, orderId);
  }

  public async closePosition(tradeId: string, reason: string, symbol?: string): Promise<boolean> {
    const targetSymbol = symbol ?? this.tradeSymbols.get(tradeId) ?? 'BTCUSD';
    return await this.primaryAdapter.closePosition(targetSymbol);
  }

  public async stop(): Promise<void> {
    await this.primaryAdapter.stop();
    if (this.fallbackAdapter) {
      await this.fallbackAdapter.stop();
    }
  }
}

export function createDirectionalExecutor(config: GodfatherConfig): DirectionalExecutionManager {
  return new DirectionalExecutionManager(config);
}
