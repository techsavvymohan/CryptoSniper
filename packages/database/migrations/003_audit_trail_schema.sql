-- =============================================================================
-- Migration 003: Institutional Immutable Audit Trail & Event Sourcing Schema
-- =============================================================================

CREATE TABLE IF NOT EXISTS audit_events (
    id BIGSERIAL PRIMARY KEY,
    correlation_id VARCHAR(64) NOT NULL,
    run_id VARCHAR(64),
    event_type VARCHAR(64) NOT NULL,
    symbol VARCHAR(32),
    venue VARCHAR(32),
    status VARCHAR(32) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    latency_us INTEGER,
    operator VARCHAR(64) DEFAULT 'SYSTEM',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_correlation_id ON audit_events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_symbol ON audit_events(symbol);
CREATE INDEX IF NOT EXISTS idx_audit_venue ON audit_events(venue);
