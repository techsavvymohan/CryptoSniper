import { Pool } from 'pg';
import type { ExecutionOrder } from '@mev-research/shared';

export class ExecutionRepository {
  constructor(private pool: Pool) {}

  async insert(order: ExecutionOrder): Promise<void> {
    await this.pool.query(
      `INSERT INTO execution_orders
         (id, opportunity_id, status, capital_usdc, net_profit_usd, tip_lamports)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        order.id, order.opportunityId, order.status,
        order.capitalUsdc ?? null, order.netProfitUsd ?? null, order.tipLamports ?? null,
      ],
    );
  }

  async updateStatus(
    id: string,
    status: ExecutionOrder['status'],
    metadata?: Partial<ExecutionOrder>,
  ): Promise<ExecutionOrder> {
    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE execution_orders
       SET status         = $2,
           landed_at      = $3,
           bundle_id      = $4,
           failure_reason = $5,
           net_profit_usd = COALESCE($6, net_profit_usd)
       WHERE id = $1
       RETURNING *`,
      [
        id, status,
        metadata?.landedAt ?? null,
        metadata?.bundleId ?? null,
        metadata?.failureReason ?? null,
        metadata?.netProfitUsd ?? null,
      ],
    );
    return this.mapRow(result.rows[0]!);
  }

  async getOrderById(id: string): Promise<ExecutionOrder | null> {
    const result = await this.pool.query(
      'SELECT * FROM execution_orders WHERE id = $1',
      [id],
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async getRecentOrders(limit: number): Promise<ExecutionOrder[]> {
    const result = await this.pool.query(
      'SELECT * FROM execution_orders ORDER BY created_at DESC LIMIT $1',
      [limit],
    );
    return result.rows.map(r => this.mapRow(r));
  }

  async getDailyStats(date: Date): Promise<{ netProfitUsdc: number }> {
    const dateStr = date.toISOString().split('T')[0];
    const result = await this.pool.query<{ net: string }>(
      `SELECT COALESCE(SUM(net_profit_usd), 0) AS net
       FROM execution_orders
       WHERE status = 'landed'
         AND DATE(created_at AT TIME ZONE 'UTC') = $1`,
      [dateStr],
    );
    return { netProfitUsdc: parseFloat(result.rows[0]?.net ?? '0') };
  }

  async getPnL(days: number): Promise<{ date: string; netProfitUsd: number; trades: number }[]> {
    const result = await this.pool.query<{ date: string; net: string; trades: string }>(`
      SELECT
        TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
        COALESCE(SUM(net_profit_usd), 0) AS net,
        COUNT(*) FILTER (WHERE status = 'landed') AS trades
      FROM execution_orders
      WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
      GROUP BY date
      ORDER BY date ASC
    `, [days]);
    return result.rows.map(r => ({
      date: r.date,
      netProfitUsd: parseFloat(r.net),
      trades: parseInt(r.trades, 10),
    }));
  }

  async findRecent(count: number): Promise<{ status: string }[]> {
    const result = await this.pool.query(
      'SELECT status FROM execution_orders ORDER BY created_at DESC LIMIT $1',
      [count],
    );
    return result.rows as { status: string }[];
  }

  private mapRow(row: Record<string, unknown>): ExecutionOrder {
    return {
      id: row['id'] as string,
      opportunityId: row['opportunity_id'] as string,
      status: row['status'] as ExecutionOrder['status'],
      capitalUsdc: row['capital_usdc'] != null ? Number(row['capital_usdc']) : undefined,
      netProfitUsd: row['net_profit_usd'] != null ? Number(row['net_profit_usd']) : undefined,
      tipLamports: row['tip_lamports'] != null ? Number(row['tip_lamports']) : undefined,
      bundleId: row['bundle_id'] as string | undefined,
      failureReason: row['failure_reason'] as string | undefined,
      landedAt: row['landed_at'] ? new Date(row['landed_at'] as string) : undefined,
      createdAt: row['created_at'] ? new Date(row['created_at'] as string) : undefined,
    };
  }
}
