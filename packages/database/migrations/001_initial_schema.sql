-- Initial schema for Solana MEV Research Bot
-- Runs via migrate.ts which tracks applied migrations in _migrations table.
-- All plain SQL — no Docker-specific extensions required.

CREATE TABLE IF NOT EXISTS pool_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  address       TEXT        NOT NULL,
  dex           TEXT        NOT NULL CHECK (dex IN ('raydium', 'orca')),
  token_mint_a  TEXT        NOT NULL,
  token_mint_b  TEXT        NOT NULL,
  price         NUMERIC(30, 10) NOT NULL,
  liquidity_a   NUMERIC(30, 6)  NOT NULL DEFAULT 0,
  liquidity_b   NUMERIC(30, 6)  NOT NULL DEFAULT 0,
  fee_bps       INTEGER     NOT NULL DEFAULT 0,
  slot          BIGINT      NOT NULL,
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pool_snapshots_address ON pool_snapshots (address);
CREATE INDEX IF NOT EXISTS idx_pool_snapshots_captured_at ON pool_snapshots (captured_at DESC);

CREATE TABLE IF NOT EXISTS opportunities (
  id                    TEXT        PRIMARY KEY,
  pair                  TEXT        NOT NULL,
  token_mint_a          TEXT        NOT NULL,
  token_mint_b          TEXT        NOT NULL,
  buy_dex               TEXT        NOT NULL,
  sell_dex              TEXT        NOT NULL,
  buy_pool_address      TEXT        NOT NULL,
  sell_pool_address     TEXT        NOT NULL,
  gross_spread_bps      NUMERIC(10, 2) NOT NULL,
  net_profit_bps        NUMERIC(10, 2) NOT NULL,
  net_profit_usd        NUMERIC(14, 6) NOT NULL,
  required_capital_usdc NUMERIC(14, 2) NOT NULL,
  confidence_score      INTEGER     NOT NULL,
  is_profitable         BOOLEAN     NOT NULL DEFAULT FALSE,
  detected_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opportunities_detected_at ON opportunities (detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_pair ON opportunities (pair);

CREATE TABLE IF NOT EXISTS simulations (
  id                 TEXT        PRIMARY KEY,
  opportunity_id     TEXT        NOT NULL REFERENCES opportunities(id),
  simulated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  input_buy_price    NUMERIC(30, 10) NOT NULL,
  input_sell_price   NUMERIC(30, 10) NOT NULL,
  noised_buy_price   NUMERIC(30, 10) NOT NULL,
  noised_sell_price  NUMERIC(30, 10) NOT NULL,
  gross_spread_bps   NUMERIC(10, 2)  NOT NULL,
  net_profit_bps     NUMERIC(10, 2)  NOT NULL,
  net_profit_usd     NUMERIC(14, 6)  NOT NULL,
  capital_usdc       NUMERIC(14, 2)  NOT NULL,
  success            BOOLEAN     NOT NULL,
  failure_reason     TEXT,
  latency_ms         INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_simulations_opportunity_id ON simulations (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_simulations_simulated_at  ON simulations (simulated_at DESC);
CREATE INDEX IF NOT EXISTS idx_simulations_success       ON simulations (success);

CREATE TABLE IF NOT EXISTS execution_orders (
  id              TEXT        PRIMARY KEY,
  opportunity_id  TEXT        NOT NULL REFERENCES opportunities(id),
  status          TEXT        NOT NULL CHECK (status IN ('pending', 'landed', 'failed')),
  capital_usdc    NUMERIC(14, 2),
  net_profit_usd  NUMERIC(14, 6),
  tip_lamports    BIGINT,
  bundle_id       TEXT,
  failure_reason  TEXT,
  landed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_execution_orders_status     ON execution_orders (status);
CREATE INDEX IF NOT EXISTS idx_execution_orders_created_at ON execution_orders (created_at DESC);

CREATE TABLE IF NOT EXISTS daily_pnl (
  date             DATE        PRIMARY KEY,
  total_trades     INTEGER     NOT NULL DEFAULT 0,
  landed_trades    INTEGER     NOT NULL DEFAULT 0,
  failed_trades    INTEGER     NOT NULL DEFAULT 0,
  gross_profit_usd NUMERIC(14, 6) NOT NULL DEFAULT 0,
  net_profit_usd   NUMERIC(14, 6) NOT NULL DEFAULT 0,
  total_tips_usd   NUMERIC(14, 6) NOT NULL DEFAULT 0,
  win_rate         NUMERIC(5, 2)  NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS latency_metrics (
  id               BIGSERIAL   PRIMARY KEY,
  event_type       TEXT        NOT NULL,
  latency_ms       INTEGER     NOT NULL,
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_latency_metrics_event_type  ON latency_metrics (event_type);
CREATE INDEX IF NOT EXISTS idx_latency_metrics_recorded_at ON latency_metrics (recorded_at DESC);

CREATE TABLE IF NOT EXISTS system_health (
  id            BIGSERIAL   PRIMARY KEY,
  component     TEXT        NOT NULL,
  status        TEXT        NOT NULL CHECK (status IN ('healthy', 'degraded', 'down')),
  message       TEXT,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_health_component ON system_health (component, checked_at DESC);
