import type {
  Candle,
  GodfatherSignal,
  GodfatherTrade,
  GodfatherTranche,
} from '@mev-research/shared';

export interface GodfatherRepositoryInterface {
  insertCandles(candles: Candle[]): Promise<void>;
  insertSignal(signal: GodfatherSignal): Promise<void>;
  updateSignalStatus(
    id: string,
    status: GodfatherSignal['status'],
    metadata?: { filledAt?: Date; expiredAt?: Date },
  ): Promise<void>;
  insertTrade(trade: GodfatherTrade): Promise<void>;
  updateTrade(id: string, updates: Partial<GodfatherTrade>): Promise<void>;
  updateTranche(id: string, updates: Partial<GodfatherTranche>): Promise<void>;
  getOpenTrades(): Promise<GodfatherTrade[]>;
  getDailyPnl(date: Date): Promise<number>;
}

/**
 * 100% In-Memory Repository for The Godfather Engine.
 * Allows the bot to run standalone on local PC or Windows VPS without PostgreSQL.
 */
export class InMemoryGodfatherRepository implements GodfatherRepositoryInterface {
  private candles: Candle[] = [];
  private signals = new Map<string, GodfatherSignal>();
  private trades = new Map<string, GodfatherTrade>();
  private dailyRealizedPnlMap = new Map<string, number>(); // dateStr -> sum

  async insertCandles(candles: Candle[]): Promise<void> {
    this.candles.push(...candles);
    if (this.candles.length > 500) {
      this.candles = this.candles.slice(-500);
    }
  }

  async insertSignal(signal: GodfatherSignal): Promise<void> {
    this.signals.set(signal.id, { ...signal });
  }

  async updateSignalStatus(
    id: string,
    status: GodfatherSignal['status'],
    metadata?: { filledAt?: Date; expiredAt?: Date },
  ): Promise<void> {
    const sig = this.signals.get(id);
    if (sig) {
      sig.status = status;
      if (metadata?.filledAt) sig.filledAt = metadata.filledAt.getTime();
      if (metadata?.expiredAt) sig.expiredAt = metadata.expiredAt.getTime();
    }
  }

  async insertTrade(trade: GodfatherTrade): Promise<void> {
    this.trades.set(trade.id, { ...trade });
  }

  async updateTrade(id: string, updates: Partial<GodfatherTrade>): Promise<void> {
    const t = this.trades.get(id);
    if (t) {
      Object.assign(t, updates);
      if (updates.status === 'CLOSED' && updates.realizedPnlUsd !== undefined) {
        const dateKey = new Date().toISOString().split('T')[0]!;
        const current = this.dailyRealizedPnlMap.get(dateKey) ?? 0;
        this.dailyRealizedPnlMap.set(dateKey, current + updates.realizedPnlUsd);
      }
    }
  }

  async updateTranche(id: string, updates: Partial<GodfatherTranche>): Promise<void> {
    for (const trade of this.trades.values()) {
      const tr = trade.tranches.find(item => item.id === id);
      if (tr) {
        Object.assign(tr, updates);
        break;
      }
    }
  }

  async getOpenTrades(): Promise<GodfatherTrade[]> {
    return Array.from(this.trades.values()).filter(t => t.status === 'OPEN');
  }

  async getDailyPnl(date: Date): Promise<number> {
    const dateKey = date.toISOString().split('T')[0]!;
    return this.dailyRealizedPnlMap.get(dateKey) ?? 0;
  }

  public getRecentSignals(limit = 50): GodfatherSignal[] {
    return Array.from(this.signals.values()).slice(-limit);
  }

  public getRecentTrades(limit = 50): GodfatherTrade[] {
    return Array.from(this.trades.values()).slice(-limit);
  }
}
