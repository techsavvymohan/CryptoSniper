import { Pool } from 'pg';
import type {
  Candle,
  Timeframe,
  GodfatherSignal,
  GodfatherTrade,
  GodfatherTranche,
} from '@mev-research/shared';

export class GodfatherRepository {
  constructor(private pool: Pool) {}

  async insertCandles(candles: Candle[]): Promise<void> {
    if (candles.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const c of candles) {
        await client.query(
          `INSERT INTO godfather_candles
             (symbol, timeframe, open_time, open, high, low, close, volume, close_time, is_closed)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (symbol, timeframe, open_time)
           DO UPDATE SET
             open = EXCLUDED.open,
             high = EXCLUDED.high,
             low = EXCLUDED.low,
             close = EXCLUDED.close,
             volume = EXCLUDED.volume,
             close_time = EXCLUDED.close_time,
             is_closed = EXCLUDED.is_closed`,
          [
            c.symbol,
            c.timeframe,
            new Date(c.openTime),
            c.open,
            c.high,
            c.low,
            c.close,
            c.volume,
            new Date(c.closeTime),
            c.isClosed,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getRecentCandles(symbol: string, timeframe: Timeframe, count: number): Promise<Candle[]> {
    const result = await this.pool.query(
      `SELECT * FROM godfather_candles
       WHERE symbol = $1 AND timeframe = $2
       ORDER BY open_time DESC
       LIMIT $3`,
      [symbol, timeframe, count],
    );

    return result.rows.reverse().map(r => ({
      symbol: r.symbol,
      timeframe: r.timeframe as Timeframe,
      openTime: new Date(r.open_time).getTime(),
      open: parseFloat(r.open),
      high: parseFloat(r.high),
      low: parseFloat(r.low),
      close: parseFloat(r.close),
      volume: parseFloat(r.volume),
      closeTime: new Date(r.close_time).getTime(),
      isClosed: r.is_closed,
    }));
  }

  async insertSignal(signal: GodfatherSignal): Promise<void> {
    await this.pool.query(
      `INSERT INTO godfather_signals
         (id, symbol, direction, grade, timeframe, sweep_level, sweep_breach_usd,
          entry_price, stop_loss, fvg_top, fvg_bottom, conviction_multiplier,
          allocated_risk_usd, position_size, session, h1_trend, status, detected_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        signal.id,
        signal.symbol,
        signal.direction,
        signal.grade,
        signal.timeframe,
        signal.sweepLevel,
        signal.sweepBreachUsd,
        signal.entryPrice,
        signal.stopLoss,
        signal.fvgTop,
        signal.fvgBottom,
        signal.convictionMultiplier,
        signal.allocatedRiskUsd,
        signal.positionSize,
        signal.session,
        signal.h1Trend,
        signal.status,
        new Date(signal.detectedAt),
      ],
    );
  }

  async updateSignalStatus(
    id: string,
    status: GodfatherSignal['status'],
    metadata?: { filledAt?: Date; expiredAt?: Date },
  ): Promise<void> {
    await this.pool.query(
      `UPDATE godfather_signals
       SET status = $2,
           filled_at = COALESCE($3, filled_at),
           expired_at = COALESCE($4, expired_at)
       WHERE id = $1`,
      [id, status, metadata?.filledAt ?? null, metadata?.expiredAt ?? null],
    );
  }

  async getRecentSignals(limit: number): Promise<GodfatherSignal[]> {
    const result = await this.pool.query(
      `SELECT * FROM godfather_signals ORDER BY detected_at DESC LIMIT $1`,
      [limit],
    );

    return result.rows.map(r => ({
      id: r.id,
      symbol: r.symbol,
      direction: r.direction,
      grade: r.grade,
      timeframe: r.timeframe,
      sweepLevel: parseFloat(r.sweep_level),
      sweepBreachUsd: parseFloat(r.sweep_breach_usd),
      entryPrice: parseFloat(r.entry_price),
      stopLoss: parseFloat(r.stop_loss),
      fvgTop: parseFloat(r.fvg_top),
      fvgBottom: parseFloat(r.fvg_bottom),
      convictionMultiplier: parseFloat(r.conviction_multiplier),
      allocatedRiskUsd: parseFloat(r.allocated_risk_usd),
      positionSize: parseFloat(r.position_size),
      session: r.session,
      h1Trend: r.h1_trend,
      status: r.status,
      detectedAt: new Date(r.detected_at).getTime(),
      filledAt: r.filled_at ? new Date(r.filled_at).getTime() : undefined,
      expiredAt: r.expired_at ? new Date(r.expired_at).getTime() : undefined,
    }));
  }

  async insertTrade(trade: GodfatherTrade): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO godfather_trades
           (id, signal_id, symbol, direction, entry_price, stop_loss,
            breakeven_price, is_breakeven_locked, total_size, remaining_size,
            realized_pnl_usd, status, opened_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          trade.id,
          trade.signalId,
          trade.symbol,
          trade.direction,
          trade.entryPrice,
          trade.stopLoss,
          trade.breakevenPrice,
          trade.isBreakevenLocked,
          trade.totalSize,
          trade.remainingSize,
          trade.realizedPnlUsd,
          trade.status,
          new Date(trade.openedAt),
        ],
      );

      for (const t of trade.tranches) {
        await client.query(
          `INSERT INTO godfather_tranches
             (id, trade_id, tranche_number, target_rr, target_price,
              volume_fraction, size, trailing_stop, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            t.id,
            t.tradeId,
            t.trancheNumber,
            t.targetRr ?? null,
            t.targetPrice ?? null,
            t.volumeFraction,
            t.size,
            t.trailingStop ?? null,
            t.status,
          ],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async updateTrade(id: string, updates: Partial<GodfatherTrade>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [id];
    let idx = 2;

    if (updates.stopLoss !== undefined) {
      fields.push(`stop_loss = $${idx++}`);
      values.push(updates.stopLoss);
    }
    if (updates.isBreakevenLocked !== undefined) {
      fields.push(`is_breakeven_locked = $${idx++}`);
      values.push(updates.isBreakevenLocked);
    }
    if (updates.remainingSize !== undefined) {
      fields.push(`remaining_size = $${idx++}`);
      values.push(updates.remainingSize);
    }
    if (updates.realizedPnlUsd !== undefined) {
      fields.push(`realized_pnl_usd = $${idx++}`);
      values.push(updates.realizedPnlUsd);
    }
    if (updates.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(updates.status);
    }
    if (updates.closedAt !== undefined) {
      fields.push(`closed_at = $${idx++}`);
      values.push(new Date(updates.closedAt));
    }
    if (updates.exitReason !== undefined) {
      fields.push(`exit_reason = $${idx++}`);
      values.push(updates.exitReason);
    }

    if (fields.length > 0) {
      await this.pool.query(
        `UPDATE godfather_trades SET ${fields.join(', ')} WHERE id = $1`,
        values,
      );
    }
  }

  async updateTranche(id: string, updates: Partial<GodfatherTranche>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [id];
    let idx = 2;

    if (updates.trailingStop !== undefined) {
      fields.push(`trailing_stop = $${idx++}`);
      values.push(updates.trailingStop);
    }
    if (updates.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(updates.status);
    }
    if (updates.closedPrice !== undefined) {
      fields.push(`closed_price = $${idx++}`);
      values.push(updates.closedPrice);
    }
    if (updates.realizedPnlUsd !== undefined) {
      fields.push(`realized_pnl_usd = $${idx++}`);
      values.push(updates.realizedPnlUsd);
    }
    if (updates.closedAt !== undefined) {
      fields.push(`closed_at = $${idx++}`);
      values.push(new Date(updates.closedAt));
    }

    if (fields.length > 0) {
      await this.pool.query(
        `UPDATE godfather_tranches SET ${fields.join(', ')} WHERE id = $1`,
        values,
      );
    }
  }

  async getOpenTrades(): Promise<GodfatherTrade[]> {
    const tradesRes = await this.pool.query(
      `SELECT * FROM godfather_trades WHERE status = 'OPEN' ORDER BY opened_at DESC`,
    );

    const trades: GodfatherTrade[] = [];
    for (const r of tradesRes.rows) {
      const tranchesRes = await this.pool.query(
        `SELECT * FROM godfather_tranches WHERE trade_id = $1 ORDER BY tranche_number ASC`,
        [r.id],
      );

      trades.push({
        id: r.id,
        signalId: r.signal_id,
        symbol: r.symbol,
        direction: r.direction,
        entryPrice: parseFloat(r.entry_price),
        stopLoss: parseFloat(r.stop_loss),
        breakevenPrice: parseFloat(r.breakeven_price),
        isBreakevenLocked: r.is_breakeven_locked,
        totalSize: parseFloat(r.total_size),
        remainingSize: parseFloat(r.remaining_size),
        realizedPnlUsd: parseFloat(r.realized_pnl_usd),
        status: r.status,
        openedAt: new Date(r.opened_at).getTime(),
        closedAt: r.closed_at ? new Date(r.closed_at).getTime() : undefined,
        exitReason: r.exit_reason ?? undefined,
        tranches: tranchesRes.rows.map(t => ({
          id: t.id,
          tradeId: t.trade_id,
          trancheNumber: t.tranche_number,
          targetRr: t.target_rr ? parseFloat(t.target_rr) : undefined,
          targetPrice: t.target_price ? parseFloat(t.target_price) : undefined,
          volumeFraction: parseFloat(t.volume_fraction),
          size: parseFloat(t.size),
          trailingStop: t.trailing_stop ? parseFloat(t.trailing_stop) : undefined,
          status: t.status,
          closedPrice: t.closed_price ? parseFloat(t.closed_price) : undefined,
          realizedPnlUsd: parseFloat(t.realized_pnl_usd),
          closedAt: t.closed_at ? new Date(t.closed_at).getTime() : undefined,
        })),
      });
    }

    return trades;
  }

  async getRecentTrades(limit: number = 50): Promise<GodfatherTrade[]> {
    const tradesRes = await this.pool.query(
      `SELECT * FROM godfather_trades ORDER BY opened_at DESC LIMIT $1`,
      [limit],
    );

    const trades: GodfatherTrade[] = [];
    for (const r of tradesRes.rows) {
      const tranchesRes = await this.pool.query(
        `SELECT * FROM godfather_tranches WHERE trade_id = $1 ORDER BY tranche_number ASC`,
        [r.id],
      );

      trades.push({
        id: r.id,
        signalId: r.signal_id,
        symbol: r.symbol,
        direction: r.direction,
        entryPrice: parseFloat(r.entry_price),
        stopLoss: parseFloat(r.stop_loss),
        breakevenPrice: parseFloat(r.breakeven_price),
        isBreakevenLocked: r.is_breakeven_locked,
        totalSize: parseFloat(r.total_size),
        remainingSize: parseFloat(r.remaining_size),
        realizedPnlUsd: parseFloat(r.realized_pnl_usd),
        status: r.status,
        openedAt: new Date(r.opened_at).getTime(),
        closedAt: r.closed_at ? new Date(r.closed_at).getTime() : undefined,
        exitReason: r.exit_reason ?? undefined,
        tranches: tranchesRes.rows.map(t => ({
          id: t.id,
          tradeId: t.trade_id,
          trancheNumber: t.tranche_number,
          targetRr: t.target_rr ? parseFloat(t.target_rr) : undefined,
          targetPrice: t.target_price ? parseFloat(t.target_price) : undefined,
          volumeFraction: parseFloat(t.volume_fraction),
          size: parseFloat(t.size),
          trailingStop: t.trailing_stop ? parseFloat(t.trailing_stop) : undefined,
          status: t.status,
          closedPrice: t.closed_price ? parseFloat(t.closed_price) : undefined,
          realizedPnlUsd: parseFloat(t.realized_pnl_usd),
          closedAt: t.closed_at ? new Date(t.closed_at).getTime() : undefined,
        })),
      });
    }

    return trades;
  }

  async getDailyPnl(date: Date): Promise<number> {
    const dateStr = date.toISOString().split('T')[0];
    const result = await this.pool.query<{ net_pnl: string }>(
      `SELECT COALESCE(SUM(realized_pnl_usd), 0) AS net_pnl
       FROM godfather_trades
       WHERE opened_at::date = $1::date AND status = 'CLOSED'`,
      [dateStr],
    );
    return parseFloat(result.rows[0]?.net_pnl ?? '0');
  }
}
