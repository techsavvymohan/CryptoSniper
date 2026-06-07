import { Pool } from 'pg';

export interface DailyPnLRow {
  date: string;
  totalTrades: number;
  landedTrades: number;
  failedTrades: number;
  grossProfitUsd: number;
  netProfitUsd: number;
  totalTipsUsd: number;
  winRate: number;
}

export class StatisticsRepository {
  constructor(private pool: Pool) {}

  async upsertDailyStats(date: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO daily_pnl
         (date, total_trades, landed_trades, failed_trades,
          gross_profit_usd, net_profit_usd, total_tips_usd, win_rate)
       SELECT
         $1::DATE,
         COUNT(*),
         COUNT(*) FILTER (WHERE status = 'landed'),
         COUNT(*) FILTER (WHERE status = 'failed'),
         COALESCE(SUM(net_profit_usd) FILTER (WHERE status = 'landed' AND net_profit_usd > 0), 0),
         COALESCE(SUM(net_profit_usd) FILTER (WHERE status = 'landed'), 0),
         COALESCE(SUM(tip_lamports) FILTER (WHERE status = 'landed') / 1e9 * 150, 0),
         CASE WHEN COUNT(*) > 0
              THEN (COUNT(*) FILTER (WHERE status = 'landed'))::NUMERIC / COUNT(*) * 100
              ELSE 0
         END
       FROM execution_orders
       WHERE DATE(created_at AT TIME ZONE 'UTC') = $1::DATE
       ON CONFLICT (date) DO UPDATE
         SET total_trades     = EXCLUDED.total_trades,
             landed_trades    = EXCLUDED.landed_trades,
             failed_trades    = EXCLUDED.failed_trades,
             gross_profit_usd = EXCLUDED.gross_profit_usd,
             net_profit_usd   = EXCLUDED.net_profit_usd,
             total_tips_usd   = EXCLUDED.total_tips_usd,
             win_rate         = EXCLUDED.win_rate,
             updated_at       = NOW()`,
      [date],
    );
  }

  async getDailyPnL(days: number): Promise<DailyPnLRow[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM daily_pnl
       WHERE date >= CURRENT_DATE - ($1 || ' days')::INTERVAL
       ORDER BY date ASC`,
      [days],
    );
    return result.rows.map(r => ({
      date: r['date'] as string,
      totalTrades: Number(r['total_trades']),
      landedTrades: Number(r['landed_trades']),
      failedTrades: Number(r['failed_trades']),
      grossProfitUsd: Number(r['gross_profit_usd']),
      netProfitUsd: Number(r['net_profit_usd']),
      totalTipsUsd: Number(r['total_tips_usd']),
      winRate: Number(r['win_rate']),
    }));
  }

  async getCumulativePnL(): Promise<{ totalNetProfitUsd: number; totalTrades: number }> {
    const result = await this.pool.query<{ net: string; trades: string }>(`
      SELECT COALESCE(SUM(net_profit_usd), 0) AS net,
             COALESCE(SUM(total_trades), 0) AS trades
      FROM daily_pnl
    `);
    return {
      totalNetProfitUsd: parseFloat(result.rows[0]?.net ?? '0'),
      totalTrades: parseInt(result.rows[0]?.trades ?? '0', 10),
    };
  }

  async getBestDay(): Promise<DailyPnLRow | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT * FROM daily_pnl ORDER BY net_profit_usd DESC LIMIT 1',
    );
    if (!result.rows[0]) return null;
    const r = result.rows[0];
    return {
      date: r['date'] as string,
      totalTrades: Number(r['total_trades']),
      landedTrades: Number(r['landed_trades']),
      failedTrades: Number(r['failed_trades']),
      grossProfitUsd: Number(r['gross_profit_usd']),
      netProfitUsd: Number(r['net_profit_usd']),
      totalTipsUsd: Number(r['total_tips_usd']),
      winRate: Number(r['win_rate']),
    };
  }
}
