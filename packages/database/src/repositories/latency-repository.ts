import { Pool } from 'pg';

export class LatencyRepository {
  constructor(private pool: Pool) {}

  async record(eventType: string, latencyMs: number): Promise<void> {
    await this.pool.query(
      'INSERT INTO latency_metrics (event_type, latency_ms) VALUES ($1, $2)',
      [eventType, latencyMs],
    );
  }

  async getAverage(eventType: string, windowMs: number = 3_600_000): Promise<number> {
    const result = await this.pool.query<{ avg: string }>(
      `SELECT AVG(latency_ms) AS avg
       FROM latency_metrics
       WHERE event_type = $1
         AND recorded_at >= NOW() - ($2 || ' milliseconds')::INTERVAL`,
      [eventType, windowMs],
    );
    return parseFloat(result.rows[0]?.avg ?? '0');
  }

  async getPercentile(
    eventType: string,
    percentile: number,
    windowMs: number = 3_600_000,
  ): Promise<number> {
    const result = await this.pool.query<{ p: string }>(
      `SELECT PERCENTILE_CONT($1) WITHIN GROUP (ORDER BY latency_ms) AS p
       FROM latency_metrics
       WHERE event_type = $2
         AND recorded_at >= NOW() - ($3 || ' milliseconds')::INTERVAL`,
      [percentile / 100, eventType, windowMs],
    );
    return parseFloat(result.rows[0]?.p ?? '0');
  }
}
