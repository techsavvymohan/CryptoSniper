-- Migration 002: Godfather Quantitative Directional Trading Schema (BTCUSD & SOLUSD)
-- Tracks candles, SMC signals, parent trades, and 3-tranche order harvesting.

CREATE TABLE IF NOT EXISTS godfather_candles (
  id            BIGSERIAL PRIMARY KEY,
  symbol        TEXT        NOT NULL,
  timeframe     TEXT        NOT NULL,
  open_time     TIMESTAMPTZ NOT NULL,
  open          NUMERIC(24, 8) NOT NULL,
  high          NUMERIC(24, 8) NOT NULL,
  low           NUMERIC(24, 8) NOT NULL,
  close         NUMERIC(24, 8) NOT NULL,
  volume        NUMERIC(28, 8) NOT NULL,
  close_time    TIMESTAMPTZ NOT NULL,
  is_closed     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_godfather_candle UNIQUE (symbol, timeframe, open_time)
);

CREATE INDEX IF NOT EXISTS idx_godfather_candles_lookup 
  ON godfather_candles (symbol, timeframe, open_time DESC);

CREATE TABLE IF NOT EXISTS godfather_signals (
  id                    TEXT        PRIMARY KEY,
  symbol                TEXT        NOT NULL,
  direction             TEXT        NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  grade                 TEXT        NOT NULL CHECK (grade IN ('A_PLUS', 'A', 'B', 'C')),
  timeframe             TEXT        NOT NULL DEFAULT 'M1',
  sweep_level           NUMERIC(24, 8) NOT NULL,
  sweep_breach_usd      NUMERIC(24, 8) NOT NULL,
  entry_price           NUMERIC(24, 8) NOT NULL,
  stop_loss             NUMERIC(24, 8) NOT NULL,
  fvg_top               NUMERIC(24, 8) NOT NULL,
  fvg_bottom            NUMERIC(24, 8) NOT NULL,
  conviction_multiplier NUMERIC(6, 2)  NOT NULL DEFAULT 1.0,
  allocated_risk_usd    NUMERIC(16, 4) NOT NULL,
  position_size         NUMERIC(24, 8) NOT NULL,
  session               TEXT        NOT NULL,
  h1_trend              TEXT        NOT NULL,
  status                TEXT        NOT NULL CHECK (status IN ('PENDING_FILL', 'FILLED', 'EXPIRED', 'CANCELLED', 'REJECTED')),
  detected_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  filled_at             TIMESTAMPTZ,
  expired_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_godfather_signals_detected_at 
  ON godfather_signals (detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_godfather_signals_symbol_status 
  ON godfather_signals (symbol, status);

CREATE TABLE IF NOT EXISTS godfather_trades (
  id                    TEXT        PRIMARY KEY,
  signal_id             TEXT        NOT NULL REFERENCES godfather_signals(id),
  symbol                TEXT        NOT NULL,
  direction             TEXT        NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  entry_price           NUMERIC(24, 8) NOT NULL,
  stop_loss             NUMERIC(24, 8) NOT NULL,
  breakeven_price       NUMERIC(24, 8) NOT NULL,
  is_breakeven_locked   BOOLEAN     NOT NULL DEFAULT FALSE,
  total_size            NUMERIC(24, 8) NOT NULL,
  remaining_size        NUMERIC(24, 8) NOT NULL,
  realized_pnl_usd      NUMERIC(16, 4) NOT NULL DEFAULT 0,
  status                TEXT        NOT NULL CHECK (status IN ('OPEN', 'CLOSED', 'CANCELLED')),
  opened_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at             TIMESTAMPTZ,
  exit_reason           TEXT
);

CREATE INDEX IF NOT EXISTS idx_godfather_trades_status 
  ON godfather_trades (status, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_godfather_trades_symbol 
  ON godfather_trades (symbol);

CREATE TABLE IF NOT EXISTS godfather_tranches (
  id                 TEXT        PRIMARY KEY,
  trade_id           TEXT        NOT NULL REFERENCES godfather_trades(id),
  tranche_number     INTEGER     NOT NULL CHECK (tranche_number IN (1, 2, 3)),
  target_rr          NUMERIC(6, 2),
  target_price       NUMERIC(24, 8),
  volume_fraction    NUMERIC(6, 2)  NOT NULL,
  size               NUMERIC(24, 8) NOT NULL,
  trailing_stop      NUMERIC(24, 8),
  status             TEXT        NOT NULL CHECK (status IN ('ACTIVE', 'TAKEN', 'STOPPED_OUT', 'CANCELLED')),
  closed_price       NUMERIC(24, 8),
  realized_pnl_usd   NUMERIC(16, 4) NOT NULL DEFAULT 0,
  closed_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_godfather_tranches_trade_id 
  ON godfather_tranches (trade_id, tranche_number);
