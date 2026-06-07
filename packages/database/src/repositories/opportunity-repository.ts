import { Pool } from 'pg';
import type { ArbitrageOpportunity } from '@mev-research/shared';

export class OpportunityRepository {
  constructor(private pool: Pool) {}

  async insert(opp: ArbitrageOpportunity): Promise<void> {
    await this.pool.query(
      `INSERT INTO opportunities
         (id, pair, token_mint_a, token_mint_b, buy_dex, sell_dex,
          buy_pool_address, sell_pool_address, gross_spread_bps, net_profit_bps,
          net_profit_usd, required_capital_usdc, confidence_score, is_profitable)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO NOTHING`,
      [
        opp.id, opp.pair, opp.tokenMintA, opp.tokenMintB,
        opp.buyDex, opp.sellDex, opp.buyPoolAddress, opp.sellPoolAddress,
        opp.grossSpreadBps, opp.netProfitBps, opp.netProfitUsd,
        opp.requiredCapitalUsdc, opp.confidenceScore, opp.isProfitable ?? false,
      ],
    );
  }

  async findById(id: string): Promise<ArbitrageOpportunity | null> {
    const result = await this.pool.query(
      'SELECT * FROM opportunities WHERE id = $1',
      [id],
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async findRecent(limit: number): Promise<ArbitrageOpportunity[]> {
    const result = await this.pool.query(
      'SELECT * FROM opportunities ORDER BY detected_at DESC LIMIT $1',
      [limit],
    );
    return result.rows.map(r => this.mapRow(r));
  }

  async countByPair(pair: string, sinceMs: number): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM opportunities
       WHERE pair = $1 AND detected_at >= NOW() - ($2 || ' milliseconds')::INTERVAL`,
      [pair, sinceMs],
    );
    return parseInt(result.rows[0]?.count ?? '0', 10);
  }

  async getSpreadDistribution(): Promise<{ bucket: string; count: number }[]> {
    const result = await this.pool.query<{ bucket: string; count: string }>(`
      SELECT
        CASE
          WHEN net_profit_bps < 5   THEN '<5'
          WHEN net_profit_bps < 10  THEN '5-10'
          WHEN net_profit_bps < 20  THEN '10-20'
          WHEN net_profit_bps < 50  THEN '20-50'
          WHEN net_profit_bps < 100 THEN '50-100'
          ELSE '100+'
        END AS bucket,
        COUNT(*) AS count
      FROM opportunities
      GROUP BY bucket
      ORDER BY MIN(net_profit_bps)
    `);
    return result.rows.map(r => ({ bucket: r.bucket, count: parseInt(r.count, 10) }));
  }

  async getDailyTimeSeries(days: number): Promise<{ date: string; count: number; avgProfit: number }[]> {
    const result = await this.pool.query<{ date: string; count: string; avg_profit: string }>(`
      SELECT
        TO_CHAR(detected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
        COUNT(*)                   AS count,
        AVG(net_profit_usd)        AS avg_profit
      FROM opportunities
      WHERE detected_at >= NOW() - ($1 || ' days')::INTERVAL
      GROUP BY date
      ORDER BY date ASC
    `, [days]);
    return result.rows.map(r => ({
      date: r.date,
      count: parseInt(r.count, 10),
      avgProfit: parseFloat(r.avg_profit ?? '0'),
    }));
  }

  async getSummary(): Promise<{ total: number; profitable: number; avgNetProfitBps: number }> {
    const result = await this.pool.query<{ total: string; profitable: string; avg: string }>(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE is_profitable) AS profitable,
        AVG(net_profit_bps) AS avg
      FROM opportunities
    `);
    const row = result.rows[0];
    return {
      total: parseInt(row?.total ?? '0', 10),
      profitable: parseInt(row?.profitable ?? '0', 10),
      avgNetProfitBps: parseFloat(row?.avg ?? '0'),
    };
  }

  private mapRow(row: Record<string, unknown>): ArbitrageOpportunity {
    return {
      id: row['id'] as string,
      pair: row['pair'] as string,
      tokenMintA: row['token_mint_a'] as string,
      tokenMintB: row['token_mint_b'] as string,
      buyDex: row['buy_dex'] as 'raydium' | 'orca',
      sellDex: row['sell_dex'] as 'raydium' | 'orca',
      buyPoolAddress: row['buy_pool_address'] as string,
      sellPoolAddress: row['sell_pool_address'] as string,
      grossSpreadBps: Number(row['gross_spread_bps']),
      netProfitBps: Number(row['net_profit_bps']),
      netProfitUsd: Number(row['net_profit_usd']),
      requiredCapitalUsdc: Number(row['required_capital_usdc']),
      confidenceScore: Number(row['confidence_score']),
      isProfitable: row['is_profitable'] as boolean,
      buyFeesBps: 0,
      sellFeesBps: 0,
      buySlippageBps: 0,
      sellSlippageBps: 0,
      buyParams: {} as never,
      sellParams: {} as never,
      detectedAt: new Date(row['detected_at'] as string).getTime(),
    };
  }
}
