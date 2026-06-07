import { Pool } from 'pg';
import type { SimulationTrade } from '@mev-research/shared';

export class SimulationRepository {
  constructor(private pool: Pool) {}

  async insert(sim: SimulationTrade): Promise<void> {
    await this.pool.query(
      `INSERT INTO simulations
         (id, opportunity_id, simulated_at, input_buy_price, input_sell_price,
          noised_buy_price, noised_sell_price, gross_spread_bps, net_profit_bps,
          net_profit_usd, capital_usdc, success, failure_reason, latency_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        sim.id, sim.opportunityId, sim.simulatedAt,
        sim.inputBuyPrice, sim.inputSellPrice,
        sim.noisedBuyPrice, sim.noisedSellPrice,
        sim.grossSpreadBps, sim.netProfitBps, sim.netProfitUsd,
        sim.capitalUsdc, sim.success, sim.failureReason ?? null, sim.latencyMs,
      ],
    );
  }

  async findByOpportunityId(opportunityId: string): Promise<SimulationTrade[]> {
    const result = await this.pool.query(
      'SELECT * FROM simulations WHERE opportunity_id = $1 ORDER BY simulated_at DESC',
      [opportunityId],
    );
    return result.rows.map(r => this.mapRow(r));
  }

  async getStats(): Promise<{
    total: number;
    successful: number;
    winRate: number;
    avgNetProfitBps: number;
  }> {
    const result = await this.pool.query<{
      total: string; successful: string; avg_profit: string;
    }>(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE success) AS successful,
        AVG(net_profit_bps) AS avg_profit
      FROM simulations
    `);
    const row = result.rows[0];
    const total = parseInt(row?.total ?? '0', 10);
    const successful = parseInt(row?.successful ?? '0', 10);
    return {
      total,
      successful,
      winRate: total > 0 ? (successful / total) * 100 : 0,
      avgNetProfitBps: parseFloat(row?.avg_profit ?? '0'),
    };
  }

  async findRecent(limit: number): Promise<SimulationTrade[]> {
    const result = await this.pool.query(
      'SELECT * FROM simulations ORDER BY simulated_at DESC LIMIT $1',
      [limit],
    );
    return result.rows.map(r => this.mapRow(r));
  }

  async getFailureBreakdown(): Promise<{ reason: string; count: number }[]> {
    const result = await this.pool.query<{ failure_reason: string; count: string }>(`
      SELECT failure_reason, COUNT(*) AS count
      FROM simulations
      WHERE success = FALSE AND failure_reason IS NOT NULL
      GROUP BY failure_reason
      ORDER BY count DESC
    `);
    return result.rows.map(r => ({ reason: r.failure_reason, count: parseInt(r.count, 10) }));
  }

  private mapRow(row: Record<string, unknown>): SimulationTrade {
    return {
      id: row['id'] as string,
      opportunityId: row['opportunity_id'] as string,
      simulatedAt: new Date(row['simulated_at'] as string),
      inputBuyPrice: Number(row['input_buy_price']),
      inputSellPrice: Number(row['input_sell_price']),
      noisedBuyPrice: Number(row['noised_buy_price']),
      noisedSellPrice: Number(row['noised_sell_price']),
      grossSpreadBps: Number(row['gross_spread_bps']),
      netProfitBps: Number(row['net_profit_bps']),
      netProfitUsd: Number(row['net_profit_usd']),
      capitalUsdc: Number(row['capital_usdc']),
      success: row['success'] as boolean,
      failureReason: row['failure_reason'] as SimulationTrade['failureReason'],
      latencyMs: Number(row['latency_ms']),
    };
  }
}
