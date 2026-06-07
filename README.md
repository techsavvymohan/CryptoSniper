# Solana MEV Arbitrage Bot

> High-speed, atomic cross-DEX arbitrage on Solana — powered by Yellowstone gRPC, Jito Bundles, and a TypeScript monorepo.

[![Solana](https://img.shields.io/badge/Solana-9945FF?style=for-the-badge&logo=solana&logoColor=white)](https://solana.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Jito](https://img.shields.io/badge/Jito-Enabled-green?style=for-the-badge)](https://jito.wtf/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

---

## Overview

This project is a **production-oriented MEV arbitrage research system** for Solana. It streams on-chain pool state via **Yellowstone gRPC (Geyser)**, detects price spreads between **Raydium CLMM** and **Orca Whirlpool** pools, simulates or executes trades atomically through **Jito Bundles**, and exposes monitoring through a **Next.js dashboard**, **REST API**, **Telegram bot**, and **Prometheus metrics**.

The system is designed to run **without Docker** — PostgreSQL and Redis run natively on localhost.

### Key capabilities

| Capability | Implementation |
|---|---|
| Ultra-low-latency market data | Yellowstone gRPC with exponential-backoff reconnect |
| Cross-DEX spread detection | `spread-engine` — fee, slippage, and net-profit calculation |
| Atomic execution | Jito Bundles (buy + sell + tip, all-or-nothing) |
| SDK-free DEX builders | Manual Raydium CLMM and Orca Whirlpool swap instructions |
| Risk controls | Kill switch, daily loss limit, confidence filter, concurrency cap |
| Simulation mode | Box-Muller noise model, 500-trade go-live gate |
| Persistence | PostgreSQL with 7 tables and 6 repositories |
| Event bus | Dual-connection Redis (`mev:*` channels) |
| Observability | Prometheus metrics on port 9091 |

---

## Architecture

### High-level system diagram

```mermaid
flowchart TB
  subgraph external [External Services]
    Helius["Helius Yellowstone gRPC"]
    Jito["Jito Block Engine"]
    Solana["Solana RPC"]
    Jupiter["Jupiter Price API"]
  end

  subgraph apps [Applications]
    Main["apps/main — Orchestrator"]
    Dashboard["apps/dashboard — Next.js UI"]
  end

  subgraph pipeline [Data Pipeline]
    MF["market-feed"]
    SE["spread-engine"]
    SIM["simulation"]
  end

  subgraph execution [Execution Layer]
    EE["execution-engine"]
    RE["risk-engine"]
    WM["wallet-manager"]
    JB["jito-submitter"]
    RB["raydium-builder"]
    OB["orca-builder"]
  end

  subgraph infra [Infrastructure]
    DB["PostgreSQL"]
    Redis["Redis"]
    API["api — Express"]
    TG["telegram"]
    MON["monitoring — Prometheus"]
    AN["analytics"]
  end

  Helius --> MF
  MF --> SE
  SE -->|mev:opportunities| Redis
  Redis --> SIM
  Redis --> TG
  SE -->|live mode| EE
  EE --> RE
  EE --> WM
  EE --> JB
  EE --> RB
  EE --> OB
  JB --> Jito
  WM --> Solana
  MF -.-> Jupiter

  Main --> MF
  Main --> SE
  Main --> EE
  Main --> SIM
  Main --> AN
  Main --> API
  Main --> TG
  Main --> MON
  Main --> DB
  Main --> Redis

  Dashboard --> API
  API --> DB
  API --> EE
  AN --> DB
  AN --> Redis
  SIM --> DB
```

### Data pipeline (hot path)

The critical path from market update to trade execution:

```mermaid
sequenceDiagram
  participant Geyser as Yellowstone gRPC
  participant MF as MarketFeedService
  participant Parser as Raydium/Orca Parser
  participant OM as OpportunityManager
  participant Redis as Redis (mev:opportunities)
  participant Sim as SimulationRunner
  participant Risk as RiskEngine
  participant Exec as ExecutionEngine
  participant Jito as Jito Block Engine
  participant PG as PostgreSQL

  Geyser->>MF: accountUpdate (pool state)
  MF->>Parser: parseRaydiumClmmPool / parseOrcaWhirlpool
  Parser-->>MF: PoolSnapshot
  MF->>OM: updatePool(snapshot)
  OM->>OM: comparePoolPair (12-step detection)
  OM->>Redis: publish OPPORTUNITY_DETECTED
  OM->>PG: insert opportunity (async)

  alt SIMULATION_MODE=true
    Redis->>Sim: subscribe mev:opportunities
    Sim->>Sim: gaussianRandom noise model
    Sim->>PG: insert simulation result
  else SIMULATION_MODE=false
    OM->>Risk: canExecute(opportunity)
    Risk-->>OM: allowed / blocked
    OM->>Exec: executeArbitrage(opportunity)
    Exec->>Exec: build buy + sell VersionedTransactions
    Exec->>Jito: submitBundle([buyTx, sellTx, tipTx])
    Jito-->>Exec: landed / failed
    Exec->>PG: update execution_orders
    Exec->>Redis: publish ORDER_LANDED / ORDER_FAILED
  end
```

### Package dependency graph

```mermaid
flowchart LR
  shared["@mev-research/shared"]
  database["@mev-research/database"]
  marketfeed["@mev-research/market-feed"]
  spread["@mev-research/spread-engine"]
  simulation["@mev-research/simulation"]
  analytics["@mev-research/analytics"]
  execution["@mev-research/execution"]
  api["@mev-research/api"]
  telegram["@mev-research/telegram"]
  monitoring["@mev-research/monitoring"]
  main["@mev-research/main"]
  dashboard["dashboard"]

  shared --> database
  shared --> marketfeed
  shared --> spread
  shared --> simulation
  shared --> analytics
  shared --> execution
  shared --> monitoring

  database --> execution
  database --> simulation
  database --> analytics
  database --> api
  database --> telegram

  execution --> api
  execution --> telegram

  marketfeed --> main
  spread --> main
  simulation --> main
  analytics --> main
  execution --> main
  api --> main
  telegram --> main
  monitoring --> main
  database --> main

  api --> dashboard
```

---

## Monorepo structure

```
solana-arbitrage-bot/
├── apps/
│   ├── main/                  # Core orchestrator — wires all packages, event loop, graceful shutdown
│   └── dashboard/             # Next.js 14 monitoring UI (execution, simulation, P&L)
│
├── packages/
│   ├── shared/                # Types, constants, utils, loadConfig()
│   │   ├── src/types/         # PoolSnapshot, ArbitrageOpportunity, ExecutionOrder, AppConfig, MEVEvent
│   │   ├── src/constants/     # DEX program IDs, JITO_TIP_ACCOUNTS, KNOWN_TOKENS, CHANNELS
│   │   ├── src/utils/         # generateId(), retry(), selectRandomJitoTipAccount()
│   │   └── src/config/        # loadConfig() — throws on missing env vars
│   │
│   ├── market-feed/           # Yellowstone gRPC client + pool parsers + Jupiter price provider
│   │   ├── grpc/              # YellowstoneClient (EventEmitter, exponential backoff)
│   │   ├── parsers/           # Raydium CLMM + Orca Whirlpool binary parsers
│   │   └── providers/         # Jupiter Price API v4 (5s cache, 10 req/s limit)
│   │
│   ├── spread-engine/         # Arbitrage opportunity detection
│   │   ├── fees/              # DEX fee + network fee + Jito tip estimation
│   │   ├── slippage/          # Liquidity-based slippage model (0–300 bps cap)
│   │   ├── detection/         # comparePoolPair() — 12-step spread comparison
│   │   └── opportunity/       # OpportunityManager — ring buffer, latency tracking
│   │
│   ├── simulation/            # Paper trading engine
│   │   ├── engine/            # Box-Muller noise, failure reasons, 10-concurrent semaphore
│   │   └── runner/            # Redis subscriber, 60s stats, generateReport() go-live gate
│   │
│   ├── execution/             # Live trade execution
│   │   ├── wallet/            # WalletManager — SOL/USDC balance tracking
│   │   ├── builders/          # Raydium CLMM + Orca Whirlpool manual swap instructions
│   │   ├── jito/              # JitoSubmitter — bundle construction, dynamic tip, 30s poll
│   │   ├── risk/              # RiskEngine — kill switch, daily loss, confidence, failures
│   │   └── engine/            # ExecutionEngine — 14-step atomic arbitrage flow
│   │
│   ├── database/              # PostgreSQL + Redis
│   │   ├── migrations/        # 001_initial_schema.sql (7 tables)
│   │   ├── repositories/      # 6 parameterized-SQL repositories
│   │   └── cache/             # Dual ioredis client, rate limiter, mev:* channels
│   │
│   ├── analytics/             # AnalyticsService — Redis-cached summaries, 5-min scheduler
│   ├── monitoring/            # Prometheus counters, gauges, histograms
│   ├── api/                   # Express REST API for dashboard
│   └── telegram/              # Telegram bot — commands + Redis event alerts
│
├── .env.example               # All 19 required environment variables
├── tsconfig.base.json         # 10 explicit @mev-research/* path aliases
└── pnpm-workspace.yaml        # packages/* + apps/*
```

---

## Package reference

### `@mev-research/shared`

Central type system and configuration. All packages import from here.

- **`loadConfig()`** — reads every required env var; throws a named error if any is missing (no silent fallbacks)
- **`CHANNELS`** — Redis pub/sub namespace: `mev:opportunities`, `mev:pools`, `mev:alerts`
- **`generateId()`** — `crypto.randomUUID()` for order and simulation IDs
- **`retry()`** — exponential backoff utility (`min(delay * 2^attempt, 30000ms)`)

### `@mev-research/market-feed`

Streams on-chain pool account updates and normalizes them into `PoolSnapshot` objects.

| Module | Responsibility |
|---|---|
| `YellowstoneClient` | gRPC connection to Helius Geyser; TLS + `x-token` auth; auto-reconnect |
| `parseRaydiumClmmPool()` | Reads `sqrtPriceX64` at offset 252; 400-byte minimum; returns `null` on error |
| `parseOrcaWhirlpool()` | Reads `sqrtPrice` at offset 65, `feeRate` at 45–46; 300-byte minimum |
| `getJupiterPrice()` | USD reference price; 500ms timeout; 5s TTL cache; 10 req/s rate limit |
| `MarketFeedService` | Orchestrates client + parsers; exposes `onPoolUpdate()`, `start()`, `stop()` |

### `@mev-research/spread-engine`

Detects profitable cross-DEX arbitrage when two pools share the same token pair.

**Spread detection formula:**

```
grossSpreadBps  = ((sellPrice - buyPrice) / buyPrice) * 10000
netProfitBps    = grossSpread - buyFee - sellFee - buySlippage - sellSlippage - 5
```

| Constant | Value |
|---|---|
| Raydium fee | 30 bps (conservative) |
| Orca fee | 32 bps (conservative) |
| Network fee | 205,000 lamports per tx × 2 legs |
| Slippage cap | 0–300 bps |
| Liquidity gate | Reject if trade > 5% of pool |
| Early exit | `grossSpreadBps < 5` |

### `@mev-research/execution`

Executes atomic two-legged arbitrage via Jito Bundles.

**14-step execution flow:**

1. Risk check (`canExecute`)
2. Concurrency check (`maxConcurrentTrades`)
3. Wallet balance verification (USDC + SOL for fees)
4. Fetch recent blockhash
5. Build buy-leg swap instruction (Raydium or Orca)
6. Build sell-leg swap instruction (Orca or Raydium)
7. Add compute budget instructions (300k units, 1000 microLamports)
8. Sign two `VersionedTransaction`s
9. Calculate dynamic Jito tip (capped at 90% of expected profit)
10. Insert `execution_orders` record (status: `pending`)
11. Submit bundle `[buyTx, sellTx, tipTx]` to Jito Block Engine
12. Poll bundle result (30s timeout)
13. Update order status (`landed` / `failed`)
14. Refresh wallet balances

**Risk engine checks:**

- Kill switch (Redis key: `execution:kill-switch`)
- Simulation mode guard
- Daily loss limit (UTC day, from `execution_orders`)
- Minimum net profit (`MIN_NET_PROFIT_BPS`)
- Confidence score threshold
- Consecutive failure circuit breaker

### `@mev-research/simulation`

Paper-trades every detected opportunity before going live.

- **Noise model:** Box-Muller transform; `buyPrice * (1 + noise)`, `sellPrice * (1 - |noise|)`
- **Failure reasons:** `SLIPPAGE_EXCEEDED`, `SPREAD_EVAPORATED`, `INSUFFICIENT_PROFIT`
- **Batch concurrency:** max 10 simultaneous simulations (semaphore)
- **Go-live gate:** `generateReport()` returns `GO_LIVE` when win rate ≥ 60% over ≥ 500 trades

### `@mev-research/database`

| Table | Purpose |
|---|---|
| `pool_snapshots` | Historical pool price/liquidity snapshots |
| `opportunities` | Detected arbitrage opportunities |
| `simulations` | Paper trade results |
| `execution_orders` | Live trade orders and outcomes |
| `daily_pnl` | Aggregated daily P&L (upserted every 5 min) |
| `latency_metrics` | Detection and execution latency tracking |
| `system_health` | Component health status log |

**Repositories:** `OpportunityRepository`, `SimulationRepository`, `ExecutionRepository`, `LatencyRepository`, `StatisticsRepository`, `PoolRepository` — all use parameterized `$1, $2` SQL.

**Redis client:** two separate `ioredis` instances (publisher + subscriber); `checkRateLimit()` uses a sorted-set sliding window.

### `@mev-research/analytics`

- `getOpportunitySummary()` — cached 60s in Redis
- `getSpreadDistribution()` — 6 buckets: `<5`, `5-10`, `10-20`, `20-50`, `50-100`, `100+`
- `getDailyTimeSeries()` — `YYYY-MM-DD` format
- Scheduler: `upsertDailyStats()` every 5 minutes

### `@mev-research/monitoring`

Prometheus metrics exposed at `http://localhost:9091/metrics`:

| Metric | Type | Description |
|---|---|---|
| `mev_opportunities_detected_total` | Counter | Opportunities by pair/DEX |
| `mev_trades_executed_total` | Counter | Trades by status |
| `mev_simulations_total` | Counter | Simulations by result |
| `mev_wallet_sol_balance` | Gauge | Current SOL balance |
| `mev_wallet_usdc_balance` | Gauge | Current USDC balance |
| `mev_daily_pnl_usdc` | Gauge | Running daily P&L |
| `mev_kill_switch_active` | Gauge | 1 = kill switch on |
| `mev_detection_latency_ms` | Histogram | Pool update → detection latency |
| `mev_bundle_submission_duration_ms` | Histogram | Jito bundle submit → confirm |

---

## Redis event bus

All inter-service communication uses the `mev:*` channel namespace:

| Channel | Publisher | Subscribers | Payload |
|---|---|---|---|
| `mev:opportunities` | `spread-engine` / `execution-engine` | `simulation-runner`, `telegram` | `{ type, payload }` MEVEvent |
| `mev:pools` | `market-feed` | (future consumers) | `PoolSnapshot` |
| `mev:alerts` | `risk-engine`, `execution-engine` | `telegram` | Alert messages |

**Event types:** `OPPORTUNITY_DETECTED`, `ORDER_SUBMITTED`, `ORDER_LANDED`, `ORDER_FAILED`, `KILL_SWITCH_TRIGGERED`, `KILL_SWITCH_RELEASED`, `SIMULATION_COMPLETE`, `DAILY_LIMIT_REACHED`

---

## REST API

Served by `@mev-research/api` on `PORT` (default `3001`).

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Service health check |
| `GET` | `/api/v1/execution/status` | Kill switch, simulation mode, wallet state |
| `GET` | `/api/v1/execution/orders` | Recent execution orders |
| `GET` | `/api/v1/execution/orders/:id` | Single order by ID |
| `GET` | `/api/v1/execution/pnl` | Daily P&L time series |
| `GET` | `/api/v1/execution/wallet` | Current SOL/USDC balances |
| `POST` | `/api/v1/execution/kill-switch` | Activate kill switch (requires `X-Admin-Key`) |
| `DELETE` | `/api/v1/execution/kill-switch` | Release kill switch (requires `X-Admin-Key`) |

The Next.js dashboard proxies `/api/v1/*` to the API server via `next.config.js` rewrites using `NEXT_PUBLIC_API_URL`.

---

## Telegram bot

| Command | Action |
|---|---|
| `/wallet` | Show SOL and USDC balances |
| `/orders` | List recent execution orders |
| `/pnl` | Show daily P&L summary |
| `/kill` | Activate kill switch |
| `/resume` | Release kill switch |
| `/alerts` | Toggle real-time trade alerts |

The bot subscribes to `mev:opportunities` and pushes `ORDER_LANDED`, `ORDER_FAILED`, and kill-switch events to the admin chat.

---

## Setup and installation

> **Full step-by-step guide:** [SETUP.md](./SETUP.md) — PostgreSQL, Redis, `.env`, migrations, verification, and go-live checklist.

### Prerequisites

| Requirement | Version / Notes |
|---|---|
| Node.js | v20+ |
| PNPM | `npm install -g pnpm` |
| PostgreSQL | Native on localhost (no Docker) |
| Redis | Native on localhost (no Docker) |
| Helius API key | Yellowstone gRPC access |
| Jito Searcher account | Registered at [jito.wtf/searcher](https://jito.wtf/searcher) |

### 1. Clone and install

```bash
git clone <repo-url>
cd solana-arbitrage-bot
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your actual credentials
```

All 19 required variables (see `.env.example`):

| Variable | Example | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://mev_user:mev_pass@localhost:5432/mev_research` | PostgreSQL connection |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |
| `HELIUS_API_KEY` | `your_key` | Helius API token |
| `HELIUS_GRPC_URL` | `mainnet.helius-rpc.com:443` | gRPC endpoint (domain:port, no `https://`) |
| `TELEGRAM_BOT_TOKEN` | `123456:ABC...` | Telegram bot token |
| `TELEGRAM_ADMIN_CHAT_ID` | `123456789` | Admin chat ID |
| `SIMULATION_MODE` | `true` | Paper trading mode |
| `LOG_LEVEL` | `info` | Logging verbosity |
| `PORT` | `3001` | API server port |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | Dashboard API base URL |
| `BOT_WALLET_PRIVATE_KEY` | `base58...` | Trading wallet private key |
| `JITO_BLOCK_ENGINE_URL` | `mainnet.block-engine.jito.wtf:443` | Jito endpoint (domain:port) |
| `JITO_AUTH_KEYPAIR` | `base58...` | Jito searcher auth keypair |
| `MAX_TRADE_CAPITAL_USDC` | `50` | Max capital per trade |
| `DAILY_LOSS_LIMIT_USDC` | `100` | Daily loss circuit breaker |
| `MIN_NET_PROFIT_BPS` | `20` | Minimum net profit threshold |
| `JITO_TIP_RATIO` | `0.30` | Fraction of profit tipped to Jito |
| `COMPETITION_LEVEL` | `medium` | `low` / `medium` / `high` tip presets |
| `PROMETHEUS_PORT` | `9091` | Prometheus metrics port |

### 3. Initialize database

```bash
# Create the database and user in PostgreSQL
psql -U postgres -c "CREATE USER mev_user WITH PASSWORD 'mev_pass';"
psql -U postgres -c "CREATE DATABASE mev_research OWNER mev_user;"

# Run migrations
pnpm migrate
```

### 4. Build and run

```bash
# Build all packages
pnpm build

# Start the orchestrator (simulation mode by default)
pnpm start

# Or run in dev mode with ts-node
pnpm dev

# Start the dashboard (separate terminal)
cd apps/dashboard
pnpm dev
```

### Available scripts

| Script | Command | Description |
|---|---|---|
| `pnpm build` | `pnpm -r build` | Compile all packages |
| `pnpm start` | `apps/main` | Start orchestrator (compiled) |
| `pnpm dev` | `apps/main` | Start orchestrator (ts-node) |
| `pnpm migrate` | `database` | Run PostgreSQL migrations |

---

## Execution safety checklist

**Do not set `SIMULATION_MODE=false` until every item is complete:**

- [ ] Run simulation for ≥ 72 hours with ≥ 500 trades
- [ ] `generateReport()` returns `GO_LIVE` (win rate ≥ 60%, avg profit > 0)
- [ ] Bot wallet funded with test capital ($50 USDC + 0.1 SOL minimum)
- [ ] `DAILY_LOSS_LIMIT_USDC` set to ≤ 5% of total capital
- [ ] `/kill` command verified in Telegram
- [ ] Dashboard shows correct live wallet balance at `/api/v1/execution/wallet`
- [ ] Jito auth keypair registered at [jito.wtf/searcher](https://jito.wtf/searcher)
- [ ] Prometheus metrics reachable at `http://localhost:9091/metrics`
- [ ] PostgreSQL migrations applied (`pnpm migrate`)

---

## Money flow

```
[ YOUR WALLET ]
       │
       ├── USDC (Capital) ──▶ [ DEX A: Buy Leg ] ──▶ [ TOKEN ]
       │                                                │
       │                                                ▼
       └── USDC (Profit)  ◀── [ DEX B: Sell Leg ] ◀── [ TOKEN ]

[ GAS / TIPS ]
       └── SOL ──────────────▶ [ Jito Tip Account ] ──▶ [ Validator ]
```

All funds remain in your wallet. Jito Bundles guarantee atomic execution — if either leg fails, the entire bundle is discarded and no tokens are left in a half-swapped state.

**Tip calculation:**

```
tipLamports = min(max(expectedProfit * ratio, minTip), expectedProfit * 0.90)
```

Where `ratio` is `JITO_TIP_RATIO` or the `COMPETITION_LEVEL` preset (`low=10%`, `medium=30%`, `high=50%`).

---

## Development

### Type-checking

```bash
# Check a single package
npx tsc --noEmit --project packages/shared/tsconfig.json

# All packages pass with zero errors when run individually
```

### Adding a new DEX

1. Add program ID to `packages/shared/src/constants/index.ts`
2. Create parser in `packages/market-feed/src/parsers/`
3. Add fee constant in `packages/spread-engine/src/fees/fee-calculator.ts`
4. Create builder in `packages/execution/src/builders/`
5. Wire builder selection in `packages/execution/src/engine/execution-engine.ts`

### Path aliases

All packages resolve via `tsconfig.base.json`:

```
@mev-research/shared        → packages/shared/src
@mev-research/database      → packages/database/src
@mev-research/market-feed   → packages/market-feed/src
@mev-research/spread-engine → packages/spread-engine/src
@mev-research/simulation    → packages/simulation/src
@mev-research/execution     → packages/execution/src
@mev-research/analytics     → packages/analytics/src
@mev-research/monitoring    → packages/monitoring/src
@mev-research/telegram      → packages/telegram/src
@mev-research/api           → packages/api/src
```

---

## License

MIT © 2026 MEV Research Lab

---

**Disclaimer:** Trading MEV involves significant financial risk including total loss of capital. This software is provided "as is" without warranty. You are solely responsible for your funds, configuration, and compliance with applicable laws.
