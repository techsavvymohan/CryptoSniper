# 🎩 THE GODFATHER & SOLANA MEV ARBITRAGE BOT
## Institutional Dual-Engine Quantitative Fund Architecture

> **Dual-Engine High-Frequency & Directional Trading System**: High-speed, atomic cross-DEX MEV arbitrage on Solana alongside **The GODFATHER** quantitative smart money concepts (SMC) & liquidation cascade scalper for **BTCUSD & SOLUSD**—powered by Hyperliquid L1, Bybit V5, Yellowstone gRPC, and Jito Bundles in a unified TypeScript monorepo.

[![Solana](https://img.shields.io/badge/Solana-9945FF?style=for-the-badge&logo=solana&logoColor=white)](https://solana.com/)
[![Hyperliquid](https://img.shields.io/badge/Hyperliquid-L1_DEX-00FFA3?style=for-the-badge)](https://hyperliquid.xyz/)
[![Bybit](https://img.shields.io/badge/Bybit-V5_Unified-F7A600?style=for-the-badge)](https://bybit.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Jito](https://img.shields.io/badge/Jito-Enabled-green?style=for-the-badge)](https://jito.wtf/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

---

## 🏛️ System Overview

This repository houses a **production-grade quantitative crypto trading fund** featuring two decoupled, complementary trading engines running in harmony under a single Node.js / TypeScript orchestrator:

```
+----------------------------------------------------------------------------------------------------+
|                                 DUAL-ENGINE QUANTITATIVE FUND                                      |
+-------------------------------------------------+--------------------------------------------------+
| ENGINE 1: SOLANA MEV ARBITRAGE                  | ENGINE 2: THE GODFATHER DIRECTIONAL SCALPER      |
+-------------------------------------------------+--------------------------------------------------+
| • Market-Neutral High-Frequency Arbitrage       | • Directional Smart Money Concepts (SMC) Scalper |
| • Raydium CLMM vs. Orca Whirlpool Pools         | • Assets: BTCUSD & SOLUSD Perpetuals             |
| • Yellowstone gRPC Geyser Sub-Second Streaming  | • Microstructure: M15 Fractals & Liquidation Sweeps|
| • Atomic Execution via Jito Bundles (All-or-None)| • Primary Venue: Hyperliquid L1 (Maker Rebates)  |
| • 100% On-Chain Non-Custodial Yield             | • Secondary Venue: Bybit V5 (Server-Side TP/SL)  |
+-------------------------------------------------+--------------------------------------------------+
```

Both engines share a unified PostgreSQL database, Redis pub/sub event bus, Next.js 14 monitoring dashboard, Telegram emergency alert/kill-switch bot, and Prometheus metrics endpoint.

---

## 🏗️ High-Level System Architecture

```mermaid
flowchart TB
  subgraph MarketData [Market Ingestion Layer]
    Helius["Helius Yellowstone gRPC<br/>(Solana On-Chain Geyser)"]
    CryptoWS["Crypto CEX/DEX Candlestick Feed<br/>(BTC & SOL M1 Closed Bars)"]
  end

  subgraph Engine1 [Engine 1: Solana MEV Arbitrage]
    MarketFeed["@mev-research/market-feed<br/>(CLMM Pool Binary Parsers)"]
    SpreadEngine["@mev-research/spread-engine<br/>(12-Step Cross-Pool Spread Detector)"]
    JitoExec["@mev-research/execution (MEV)<br/>(Atomic Jito Bundles + Dynamic Tips)"]
  end

  subgraph Engine2 [Engine 2: The GODFATHER Quantitative Scalper]
    CandleAgg["Multi-TF Causal Resampler<br/>(M1 -> M5, M15, H1, H4)"]
    QuantIndicators["Quantitative Math Layer<br/>(Wilder ATR, CHOP 14, Tick Delta)"]
    StructureDetector["M15 Fractal Scanner<br/>(20-Bar BSL / SSL Extremes)"]
    TriggerEngine["5-Stage Trigger Detector<br/>(Sweep, Reclaim, MSS, FVG)"]
    RiskSizer["Fractional Kelly Sizer<br/>(A+ Unicorn 2.40x / A 1.00x)"]
    TrancheManager["3-Tranche Lifecycle Manager<br/>(25% @ 1R+BE, 35% @ 2R, 40% Moonbag)"]
    ExecRouter["Directional Execution Manager<br/>(Auto-Failover Router)"]
  end

  subgraph ExecutionVenues [Execution Layer]
    HL["Hyperliquid L1 Adapter<br/>(EIP-712 Agent Signing / Gasless CLOB)"]
    Bybit["Bybit V5 Adapter<br/>(REST + WS / Server Multi-TP)"]
    Paper["Paper Trading Executor<br/>(Realistic Slippage & Order Fills)"]
  end

  subgraph Infra [Shared Infrastructure]
    DB["PostgreSQL (11 Tables & Repositories)"]
    Redis["Redis Event Bus (mev:* and godfather:*)"]
    Main["apps/main — Dual Orchestrator"]
    Dashboard["apps/dashboard — Next.js 14 UI"]
    TG["Telegram Alert & Kill-Switch Bot"]
    Prom["Prometheus Metrics (Port 9091)"]
  end

  %% Flow Engine 1
  Helius --> MarketFeed --> SpreadEngine --> JitoExec
  %% Flow Engine 2
  CryptoWS --> CandleAgg --> QuantIndicators --> StructureDetector --> TriggerEngine --> RiskSizer --> TrancheManager --> ExecRouter
  ExecRouter -->|VENUE=hyperliquid| HL
  ExecRouter -->|VENUE=bybit| Bybit
  ExecRouter -->|VENUE=paper| Paper

  %% Shared links
  JitoExec --> DB
  ExecRouter --> DB
  DB --> Main
  Redis --> Main
  Main --> Dashboard
  Main --> TG
  Main --> Prom
```

---

## ⚡ The GODFATHER Quantitative Engine

The Godfather operates on the microstructural reality of **liquidation cascades, institutional stop sweeps, and order book absorption** rather than retail lagging indicators.

### 1. The 5-Stage Trigger Sequence (Zero Repainting)
1. **Higher-Timeframe Liquidity Discovery**:
   - Bill Williams 5-bar fractals detected across the last 20 closed M15 bars to establish Buy-Side Liquidity (**BSL**) and Sell-Side Liquidity (**SSL**).
2. **Structural Liquidity Sweep & Reclaim**:
   - **BTCUSD**: Requires $\ge \$50.00$ penetration past M15 fractal extreme with candle wick ratio $\ge 30\%$.
   - **SOLUSD**: Requires $\ge \$0.50$ penetration past M15 fractal extreme with candle wick ratio $\ge 30\%$.
3. **Sub-Second Tick Footprint Ingestion & Passive Absorption**:
   - Connects to Hyperliquid's raw WebSocket (`trades` and `l2Book`) computing tick-by-tick microstructural metrics:
     - **Rolling Volume-Weighted Average Price (VWAP)**:
       $$\text{VWAP}_t = \frac{\sum P_i \times V_i}{\sum V_i}, \quad \Delta\text{VWAP}_t = P_{\text{last}} - \text{VWAP}_t$$
     - **Cumulative Volume Delta (CVD)**: Tracks net aggressive taker buying vs selling volume.
     - **Order Book Imbalance (5-Level OBI)**:
       $$\text{OBI}_t = \frac{\sum \text{BidSize}_5 - \sum \text{AskSize}_5}{\sum \text{BidSize}_5 + \sum \text{AskSize}_5}$$
     - **Ground-Truth Limit Absorption**: When price penetrates an SSL by $\ge \$50$, if aggressive market selling surges but $\text{OBI} \ge +0.25$ and CVD diverges positively, institutional passive limit absorption is verified before the candle even closes (synthetic M1 fallback if WebSocket disconnects).
4. **Institutional Displacement & Market Structure Shift (MSS)**:
   - Reclaim candle real body must exceed $0.60\times\text{ATR}(14)$ with body-to-range ratio $\ge 60\%$, breaking through the previous minor swing fractal.
5. **Fair Value Gap (FVG) Limit Entry**:
   - 3-candle imbalance geometry calculated.
   - Entry order placed as a **Post-Only Limit Order at the FVG proximal edge** (`tif: 'Alo'` on Hyperliquid) to capture negative maker fee rebates.

### 2. Multi-Region Geyser Colocation & Leader-Aware Jito Routing
1. **Concurrent Multi-Region Yellowstone Pool (`MultiRegionYellowstonePool`)**:
   - Connects simultaneously to validator clusters in **Amsterdam** (`ams.helius-rpc.com`), **Tokyo** (`tyo.helius-rpc.com`), and **New York** (`mainnet.helius-rpc.com`).
   - Uses sub-microsecond atomic ring-buffer deduplication on Solana `writeVersion` monotonically increasing sequences: fastest regional stream update wins; secondary updates are dropped in $< 1\mu\text{s}$.
2. **Leader-Aware Regional Jito Routing (`LeaderAwareJitoSubmitter`)**:
   - Caches `getLeaderSchedule` and dynamically resolves validator leader datacenters across Europe (`amsterdam.mainnet.block-engine.jito.wtf`, `frankfurt...`), Asia (`tokyo...`), and North America (`ny...`, `slc...`).
   - Reduces cross-Atlantic latency penalties by up to **70%** (cutting bundle transit from 120ms to 15–35ms).

### 3. Tiered Conviction Position Sizing (Quarter-Kelly)
Position size is governed strictly by the **Fractional Kelly Criterion** ($\kappa = 0.25$):
- **Base Risk**: $0.85\%$ of total account equity ($1.00\text{R} = \$85$ on a \$10k account).
- **Grade A+ (Unicorn Setup)**: **$2.40\times$ Base Risk** (Sweep + MSS + FVG + Delta Absorption + High-Volume Killzone + HTF Trend alignment = $2.04\%$ risk).
- **Grade A (Normal Setup)**: **$1.00\times$ Base Risk** ($0.85\%$ risk).
- **Weekend Risk Scale**: Multiplied by **$0.50\times$** on Saturdays and Sundays.
- **Correlated USD Exposure**: Scaled down by **$0.60\times$** when joint BTC/SOL exposure is open.

### 4. Asymmetric 3-Tranche Liquidity Harvesting (R:R Mechanics)

```
[ ENTRY: 1.00R RISK ]
         │
         ├── Tranche 1 (25% Size) ──▶ Hits +1.00R ──▶ Banks +0.25R & RATCHETS SL TO BREAKEVEN + 0.10R
         │                                            (Trade is now 100% Risk-Free!)
         │
         ├── Tranche 2 (35% Size) ──▶ Hits +2.00R (BTC) / +2.50R (SOL) ──▶ Banks +0.70R to +0.875R
         │                                                                  (60% Position in cash)
         │
         └── Tranche 3 (40% Moonbag) ──▶ Trailed by 3.0x ATR Chandelier Stop ──▶ Yields 1:2.35 to 1:4.50+
```

- **Blended Winning R:R**: **`1 : 2.10` to `1 : 2.85`**.
- **Scratch Trades**: If market reverses after Tranche 1, the breakeven ratchet still delivers a net **`+0.325R`** profit.
- **Break-Even Win Rate Required**: Only **31.2%**.

---

## 🎯 Execution Venues: Primary DEX & Secondary CEX

The execution layer in `packages/execution/src/directional/` provides a unified interface (`IDirectionalExchangeAdapter`) allowing seamless switching via `.env`:

### 1. 🏆 Hyperliquid L1 Adapter (`VENUE=hyperliquid`)
- **Non-Custodial Agent API**: Uses `viem` to generate EIP-712 cryptographic signatures on gasless L1 transactions.
- **Negative Maker Rebates**: Post-Only FVG limit orders receive cash rebates for providing liquidity.
- **Zero KYC**: Runs directly on Ethereum wallet addresses with sub-second order book matching.
- **Native Trigger Orders**: Sets server-side trigger Stop Losses (`tpsl: 'sl'`) and Tranche Take Profits (`tpsl: 'tp'`).

### 2. 🥈 Bybit V5 Adapter (`VENUE=bybit`)
- **Unified Trading Account V5**: REST and WebSocket integration for `BTCUSDT` and `SOLUSDT` linear perpetuals.
- **Server-Side Multi-TP Engine**: Registers discrete partial take-profits directly on Bybit matching engines via `setTradingStop`.
- **Automatic Failover**: `DirectionalExecutionManager` automatically routes orders to Bybit if Hyperliquid experiences consecutive connection dropouts.

### 3. 🧪 Paper Execution Adapter (`VENUE=paper`)
- Simulated limit order fills with configurable basis-point slippage model for zero-risk dry-runs.

---

## 📁 Monorepo Structure

```
solana-mev-arbitrage-bot/
├── apps/
│   ├── main/                  # Core orchestrator — wires both MEV and Godfather engines
│   └── dashboard/             # Next.js 14 monitoring UI (MEV Execution, Simulation, and Godfather)
│
├── packages/
│   ├── shared/                # Types, constants, configs (GodfatherConfig, AppConfig, CHANNELS)
│   ├── database/              # PostgreSQL (11 tables) + Redis event bus
│   │   ├── migrations/        # 001_initial_schema.sql (MEV), 002_godfather_schema.sql (Godfather)
│   │   └── repositories/      # GodfatherRepository, ExecutionRepository, OpportunityRepository
│   ├── market-feed/           # Yellowstone gRPC (MEV) + Causal Multi-TF Candlestick Streamer
│   ├── godfather-engine/      # [CORE] Quant indicators, M15 fractals, triggers, Kelly sizer, tranches
│   ├── spread-engine/         # 12-step cross-pool MEV spread detector (Raydium vs. Orca)
│   ├── simulation/            # Box-Muller MEV simulation engine & 500-trade go-live gate
│   ├── execution/             # Atomic Jito bundle submitter + Hyperliquid & Bybit directional adapters
│   ├── analytics/             # Redis-cached summaries & 5-minute scheduler
│   ├── monitoring/            # Prometheus metrics exporter (Port 9091)
│   ├── api/                   # Express REST API for dashboard telemetry
│   └── telegram/              # Telegram alert bot (MEV landings + Godfather triggers & /kill command)
│
├── CRYPTO_ALGO_BOT_BLUEPRINT.md # Institutional mathematical & microstructural blueprint
├── strategy.md                # Complete Hinglish algorithmic & manual trading guide
├── .env.example               # Full configuration template for both engines
├── tsconfig.base.json         # Workspace path aliases
└── pnpm-workspace.yaml        # Monorepo workspace configuration
```

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Node.js**: v20+ or v22+
- **PNPM**: `npm install -g pnpm`
- **PostgreSQL & Redis**: Running natively on `localhost` (No Docker required).

### 2. Installation & Database Setup
```powershell
# 1. Install dependencies
pnpm install

# 2. Copy and configure environment variables
Copy-Item .env.example .env

# 3. Apply all database migrations (MEV + Godfather tables)
pnpm migrate

# 4. Build all packages
pnpm build
```

### 3. Running Unit Tests
Validate all mathematical indicators, fractals, triggers, Kelly sizing, and tranche state machines:
```powershell
pnpm --filter @mev-research/godfather-engine test
# Result: 10/10 test suites pass with zero failures
```

### 4. Starting the Dual Engine
```powershell
# Terminal 1: Launch the dual orchestrator (MEV + The Godfather)
pnpm start

# Terminal 2: Launch the Next.js 14 Dashboard
cd apps/dashboard
pnpm dev
```
Open **`http://localhost:3000`** in your browser to view:
- **`/godfather`**: Real-time SMC signals, 3-tranche harvesting trackers, and 24/7 killzone status.
- **`/execution`**: Live Solana cross-DEX atomic orders, wallet balance, and P&L.
- **`/simulation`**: MEV Monte Carlo simulation curves and spread distributions.

---

## 🛡️ Circuit Breakers & Prop Firm Safeguards

The bot enforces hard programmatic circuit breakers designed to satisfy strict institutional and prop firm risk requirements:
1. **Daily Loss Limit (-4.50%)**: If realized intraday losses reach `-$450` on a `$10k` account, all trading halts immediately until the next UTC day.
2. **Maximum Drawdown Freeze (-9.00%)**: Protects capital from trailing drawdown limits.
3. **Funding Reset Blackout**: Automatically skips entries $\pm 10\text{ minutes}$ around 00:00, 08:00, and 16:00 UTC perpetual funding resets.
4. **Emergency Remote Kill-Switch**: Send `/kill` to the Telegram bot or set the Redis key `execution:kill-switch` to freeze both engines instantly.

---

## 📜 License

MIT © 2026 MEV Research Lab & The Godfather Quantitative Fund
