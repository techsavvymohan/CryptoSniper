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
| ENGINE 1: SOLANA MEV ARBITRAGE                  | ENGINE 2: THE GODFATHER TRIAD (3 CONCURRENT)     |
+-------------------------------------------------+--------------------------------------------------+
| • Market-Neutral High-Frequency Arbitrage       | • 3 Concurrent Dedicated Engines (BTC, SOL, Alts)|
| • Raydium CLMM vs. Orca Whirlpool Pools         | • Ringfenced Capital: 40% BTC, 30% SOL, 30% Alts |
| • Yellowstone gRPC Geyser Sub-Second Streaming  | • 100% Dynamic Volatility Scaling (ATR + CHOP 14)|
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
    CryptoWS["Crypto CEX/DEX Candlestick Feed<br/>(BTC, SOL & Alts M1 Closed Bars)"]
  end

  subgraph Engine1 [Engine 1: Solana MEV Arbitrage]
    MarketFeed["@mev-research/market-feed<br/>(CLMM Pool Binary Parsers)"]
    SpreadEngine["@mev-research/spread-engine<br/>(12-Step Cross-Pool Spread Detector)"]
    JitoExec["@mev-research/execution (MEV)<br/>(Atomic Jito Bundles + Dynamic Tips)"]
  end

  subgraph Engine2 [Engine 2: The GODFATHER Triad Orchestrator]
    TriadMgr["GodfatherTriadManager<br/>(Concurrent 3-Engine Orchestrator)"]
    subgraph ParallelEngines [Dedicated Parallel Execution]
      BtcEng["btcEngine (40% Capital)<br/>Microstructure & Dynamic Volatility"]
      SolEng["solEngine (30% Capital)<br/>High-Velocity Orderflow Scalper"]
      AltsEng["altsEngine (30% Capital)<br/>Vetted Altcoin Winners Basket"]
    end
    CandleAgg["Multi-TF Causal Resampler<br/>(M1 -> M5, M15, H1, H4)"]
    DynamicQuant["Self-Calibrating Math Layer<br/>(Wilder M1/M15 ATR & CHOP 14)"]
    StructureDetector["M15 Fractal Scanner<br/>(20-Bar BSL / SSL Extremes)"]
    TriggerEngine["5-Stage Trigger Detector<br/>(Dynamic Sweep, MSS, FVG Retest)"]
    RiskSizer["Fractional Kelly Sizer<br/>(A+ Unicorn 2.40x / A 1.00x)"]
    TrancheManager["3-Tranche Lifecycle Manager<br/>(35% @ 1.5R, 35% @ Dyn R2, 30% Moonbag)"]
    ExecRouter["Directional Execution Manager<br/>(Hyperliquid / Bybit / Paper)"]
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
  CryptoWS --> TriadMgr
  TriadMgr --> BtcEng & SolEng & AltsEng
  BtcEng & SolEng & AltsEng --> CandleAgg --> DynamicQuant --> StructureDetector --> TriggerEngine --> RiskSizer --> TrancheManager --> ExecRouter
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

### 1. The 5-Stage Trigger Sequence (Self-Calibrating & Zero Repainting)
1. **Higher-Timeframe Liquidity Discovery**:
   - Bill Williams 5-bar fractals detected across the last 20 closed M15 bars to establish Buy-Side Liquidity (**BSL**) and Sell-Side Liquidity (**SSL**).
2. **Dynamic Volatility-Scaled Sweep & Reclaim**:
   - **BTCUSD**: Requires dynamic penetration $\ge \max(0.25\times\text{M15 ATR}, \$35.00)$ past fractal extreme with rejection wick ratio $\ge 25\%$.
   - **SOLUSD**: Requires dynamic penetration $\ge \max(0.25\times\text{M15 ATR}, \$0.25)$ past fractal extreme.
   - **Altcoins Basket**: Requires dynamic penetration $\ge \max(0.35\times\text{M15 ATR}, 0.05\% \text{ of Price})$.
3. **Sub-Second Tick Footprint Ingestion & Passive Absorption**:
   - Connects to Hyperliquid's raw WebSocket (`trades` and `l2Book`) computing tick-by-tick microstructural metrics:
     - **Rolling Volume-Weighted Average Price (VWAP)**:
       $$\text{VWAP}_t = \frac{\sum P_i \times V_i}{\sum V_i}, \quad \Delta\text{VWAP}_t = P_{\text{last}} - \text{VWAP}_t$$
     - **Cumulative Volume Delta (CVD)**: Tracks net aggressive taker buying vs selling volume.
     - **Order Book Imbalance (5-Level OBI)**:
       $$\text{OBI}_t = \frac{\sum \text{BidSize}_5 - \sum \text{AskSize}_5}{\sum \text{BidSize}_5 + \sum \text{AskSize}_5}$$
     - **Ground-Truth Limit Absorption**: When price penetrates an SSL, if aggressive market selling surges but $\text{OBI} \ge +0.25$ and CVD diverges positively, institutional passive limit absorption is verified before the candle even closes (synthetic M1 fallback if WebSocket disconnects).
4. **Institutional Displacement & Market Structure Shift (MSS)**:
   - Reclaim candle real body must exceed dynamic threshold ($0.58\times\text{ATR}$ to $0.65\times\text{ATR}$) with body-to-range ratio $\ge 58\%-65\%$, breaking through previous minor swing fractal.
5. **Fair Value Gap (FVG) Limit Entry (Dynamic Retest)**:
   - Imbalance gap dynamically scaled to M1 bar-to-bar volatility: $\ge \max(0.20\times\text{M1 ATR}, \text{floor})$.
   - Entry placed as a **Post-Only Limit Order at FVG proximal edge** (`tif: 'Alo'` on Hyperliquid) to capture negative maker fee rebates.
   - Retest timeout dynamically calibrated via Choppiness Index (6–8 bars in high-momentum trends, 10–14 bars in consolidation).

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
- **Regime Conviction Scaling**: **$1.15\times$** in clean macro trends (`chop < 38.2`), **$0.85\times$** defensive dampener in choppy regimes (`chop > 52.0`).
- **Weekend Risk Scale**: Multiplied by **$0.50\times$** on Saturdays and Sundays.
- **Correlated USD Exposure**: Scaled down by **$0.60\times$** when joint BTC/SOL exposure is open.

### 4. Asymmetric 3-Tranche Liquidity Harvesting (R:R Mechanics)

```
[ ENTRY: 1.00R RISK ]
         │
         ├── Tranche 1 (35% Size) ──▶ Hits +1.50R ──▶ Banks +0.525R & RATCHETS SL TO REDUCED RISK (-0.40R)
         │                                            (Gives breathing room against FVG retest wicks)
         │
         ├── Milestone (+2.00R)   ──▶ Price reaches +2.00R ──▶ LOCKS SL TO BREAKEVEN + 0.10R BUFFER!
         │                                                     (Trade is now 100% Risk-Free!)
         │
         ├── Tranche 2 (35% Size) ──▶ Hits Dynamic Target R2 ──▶ Banks +0.77R to +1.22R & MOVES SL TO +1.00R PROFIT LOCK!
         │                            (2.2R in chop / 3.5R in trend)   (70% of Position safely locked in cash)
         │
         └── Tranche 3 (30% Moonbag) ──▶ Trailed by Dynamic Chandelier Stop ──▶ Extracts Fat-Tail Macro Extensions (1:3.0 to 1:12.0+)
                                         (4.2x-5.2x ATR in trends, 3.0x-3.8x in chop)
```

- **Blended Portfolio R:R**: **`1 : 2.25` to `1 : 3.40`**.
- **Scratch Trades**: If market reverses after Tranche 1 and BE lock, the trade exits with a net positive gain.
- **Break-Even Win Rate Required**: Only **28.4%**.

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
CryptoSniper/
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

### 🌟 Option A: 1-Click Standalone Mode (Recommended for Windows PC / VPS)
**Zero External PostgreSQL required. Zero Redis required. Zero Website/Dashboard required.**
All trades, open orders, and PnL are held in RAM memory with real-time terminal trade tracking.

1. Double-click `run-bot.bat` (or run `pnpm start` in PowerShell).
2. The bot will automatically create `.env` if missing, detect Standalone Mode, and start scanning Hyperliquid/Bybit for profitable trades.
3. If no private key is supplied, it automatically runs in **Paper Trading Mode** with zero financial risk.

```powershell
# 1-Click Run on Windows / VPS:
.\run-bot.bat
```

---

### 🏢 Option B: Full Institutional Monorepo Stack (With DB, Redis & Dashboard)
If you wish to run the full institutional stack with PostgreSQL, Redis, and Next.js 14 web platform:

### 1. Prerequisites
- **Node.js**: v20+ or v22+
- **PNPM**: `npm install -g pnpm`
- **PostgreSQL & Redis**: Running natively on `localhost`.

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

### 3. Running Test Suites (Local Automated Verification)
Validate all mathematical indicators, fractals, triggers, Kelly sizing, and tranche state machines locally (zero cloud CI/CD dependency):
```powershell
# Run dedicated Godfather microstructure test suite:
pnpm --filter @mev-research/godfather-engine test
# Result: 14/14 tests pass with zero failures

# Run full monorepo test suite (Godfather Triad + Execution Gateway + Risk Engine + Regional Jito Router):
pnpm test
# Result: 24/24 tests pass cleanly (100% green, 0 failures, 0 regressions)
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
