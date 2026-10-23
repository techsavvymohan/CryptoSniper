import { Pool } from 'pg';

export interface AuditEventRecord {
  id?: number;
  correlationId: string;
  runId?: string;
  eventType: string;
  symbol?: string;
  venue?: string;
  status: 'SUCCESS' | 'REJECTED' | 'FAILED' | 'PENDING';
  details?: Record<string, any>;
  latencyUs?: number;
  operator?: string;
  createdAt?: Date;
}

export class AuditRepository {
  constructor(private pool: Pool) {}

  /**
   * Appends an immutable audit event to the financial audit log.
   */
  async recordEvent(event: AuditEventRecord): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO audit_events
           (correlation_id, run_id, event_type, symbol, venue, status, details, latency_us, operator, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          event.correlationId,
          event.runId ?? null,
          event.eventType,
          event.symbol ?? null,
          event.venue ?? null,
          event.status,
          JSON.stringify(event.details ?? {}),
          event.latencyUs ?? null,
          event.operator ?? 'SYSTEM',
          event.createdAt ?? new Date(),
        ],
      );
    } catch (err) {
      console.error('[AuditRepository] Failed to insert audit event:', err);
    }
  }

  /**
   * Retrieves all correlated lifecycle events for a specific execution window or trade.
   */
  async getEventsByCorrelationId(correlationId: string): Promise<AuditEventRecord[]> {
    const res = await this.pool.query(
      `SELECT id, correlation_id, run_id, event_type, symbol, venue, status, details, latency_us, operator, created_at
       FROM audit_events
       WHERE correlation_id = $1
       ORDER BY created_at ASC`,
      [correlationId],
    );

    return res.rows.map(r => ({
      id: Number(r.id),
      correlationId: r.correlation_id,
      runId: r.run_id,
      eventType: r.event_type,
      symbol: r.symbol,
      venue: r.venue,
      status: r.status,
      details: r.details,
      latencyUs: r.latency_us,
      operator: r.operator,
      createdAt: new Date(r.created_at),
    }));
  }

  /**
   * Returns recent audit events with optional filtering.
   */
  async getRecentEvents(limit = 100, eventType?: string): Promise<AuditEventRecord[]> {
    const query = eventType
      ? `SELECT id, correlation_id, run_id, event_type, symbol, venue, status, details, latency_us, operator, created_at
         FROM audit_events
         WHERE event_type = $1
         ORDER BY created_at DESC
         LIMIT $2`
      : `SELECT id, correlation_id, run_id, event_type, symbol, venue, status, details, latency_us, operator, created_at
         FROM audit_events
         ORDER BY created_at DESC
         LIMIT $1`;

    const params = eventType ? [eventType, limit] : [limit];
    const res = await this.pool.query(query, params);

    return res.rows.map(r => ({
      id: Number(r.id),
      correlationId: r.correlation_id,
      runId: r.run_id,
      eventType: r.event_type,
      symbol: r.symbol,
      venue: r.venue,
      status: r.status,
      details: r.details,
      latencyUs: r.latency_us,
      operator: r.operator,
      createdAt: new Date(r.created_at),
    }));
  }
}
