# Setup Guide — We'll Walk Through This Together

This guide walks you through setting up the institutional dual-engine quantitative fund bot from scratch. Follow each step in order. Don't skip ahead — later steps depend on earlier ones.

**What we're building:** A dual-engine crypto trading fund system:
1. **Engine 1 (Solana MEV Arbitrage)**: Watches Raydium CLMM, Orca Whirlpool, and OpenBook on Solana, detects price mispricings via Yellowstone Geyser gRPC, and executes atomic, zero-capital-risk back-run arbitrage bundles via the Jito Block Engine.
2. **Engine 2 (The GODFATHER Triad Scalper)**: Institutional Price-Action & Microstructure scalping system running 3 dedicated concurrent engines in parallel via `GodfatherTriadManager`: **Bitcoin ($BTCUSD$)** (40% capital anchor), **Solana ($SOLUSD$)** (30% high-beta runner), and **Alts Winners Basket ($ETHUSD$, $AVAXUSD$, $NEARUSD$, $LINKUSD$)** (30% momentum runner), utilizing a 100% self-calibrating dynamic 5-stage confluence trigger with 3-tranche execution across **Hyperliquid L1** (primary native DEX) and **Bybit V5** (secondary CEX fallback).

**Important:** This project does **not** use Docker for native development. You install PostgreSQL and Redis directly on your machine for maximum sub-millisecond execution performance.

Need the big-picture architecture? See [README.md](./README.md) and [CRYPTO_ALGO_BOT_BLUEPRINT.md](./CRYPTO_ALGO_BOT_BLUEPRINT.md). For the complete manual trading playbook in Hinglish, see [strategy.md](./strategy.md).

---

## Before you start — the full journey

Here's every step we'll do together:

```
Step 1  → Install the tools you need (Node v20+, PostgreSQL, Redis)
Step 2  → Download the project code & install pnpm dependencies
Step 3  → Fill in your .env file (Solana RPC, Jito, Hyperliquid/Bybit API, risk limits)
Step 4  → Create the database tables & run migrations (MEV + Godfather schemas)
Step 5  → Build all 13 monorepo packages cleanly
Step 6  → Start the dual-engine bot (simulation mode — no real money at risk)
Step 7  → Open the Next.js 14 dashboard in your browser (/execution, /simulation, /godfather)
Step 8  → Test endpoints, Telegram alerts, and verify execution venues
```

**Time estimate:** 30–60 minutes for first-time setup (not counting waiting for account sign-ups).

**Golden rule:** Keep `SIMULATION_MODE=true` and `DIRECTIONAL_TESTNET=true` (or `DIRECTIONAL_VENUE=paper`) until you've run the bot safely for days and verified all confluence signals.

---

## Step 1 — Install the tools you need

Think of these as the "ingredients" before we cook.

### 1a. Node.js (runs the bot)

1. Go to [nodejs.org](https://nodejs.org/)
2. Download the **LTS** version (Node.js 20 or higher)
3. Run the installer — click Next through everything
4. Open PowerShell and check it worked:

```powershell
node --version
```

**You should see:** something like `v20.x.x` or `v22.x.x`

---

### 1b. PNPM (installs project packages)

PNPM is required for monorepo workspace package resolution:

```powershell
npm install -g pnpm
pnpm --version
```

**You should see:** a version number like `9.x.x` or `10.x.x`

---

### 1c. PostgreSQL (saves trade history)

PostgreSQL is a database — it stores every opportunity, simulation, and trade the bot finds.

#### On Windows

1. Download from [postgresql.org/download/windows](https://www.postgresql.org/download/windows/)
2. Run the installer
3. When it asks for a password, pick one and **write it down** — you'll need it for the `postgres` user
4. Keep port **5432** (the default)
5. Say **yes** when it offers to add PostgreSQL to your PATH

Check if it's running:

```powershell
Get-Service -Name "postgresql*"
```

If `Status` says `Stopped`, start it:

```powershell
Start-Service postgresql-x64-16
```

*(The number `16` might be different on your machine — use whatever name `Get-Service` shows.)*

#### On Mac (optional)

```bash
brew install postgresql@16
brew services start postgresql@16
```

---

### 1d. Create your database (one-time setup)

Now we create a dedicated user and database for the bot. Open PowerShell:

```powershell
psql -U postgres
```

It may ask for the password you set during install. You'll see a prompt like `postgres=#`.

Copy and paste these lines **one at a time**, pressing Enter after each:

```sql
CREATE USER mev_user WITH PASSWORD 'mev_pass';
CREATE DATABASE mev_research OWNER mev_user;
GRANT ALL PRIVILEGES ON DATABASE mev_research TO mev_user;
\q
```

The `\q` command exits PostgreSQL.

**Test that it worked:**

```powershell
psql -U mev_user -d mev_research -h localhost -c "SELECT NOW();"
```

**You should see:** today's date and time in a table. If you get an error, double-check the password and that PostgreSQL is running.

> **Tip:** You can change `mev_pass` to any password you like — just remember to use the same one in your `.env` file later.

---

### 1e. Redis (fast message passing between bot parts)

Redis lets different parts of the bot talk to each other instantly (like a walkie-talkie for code).

#### On Windows

Redis doesn't have an official Windows app. The easiest options:

**Option A — Memurai (recommended for Windows)**

1. Go to [memurai.com](https://www.memurai.com/)
2. Download and install it (it's Redis-compatible)
3. It starts automatically as a Windows service

**Option B — WSL2 (if you already use Linux on Windows)**

```bash
sudo apt install redis-server
sudo service redis-server start
```

#### On Mac

```bash
brew install redis
brew services start redis
```

**Test that Redis works:**

```powershell
redis-cli ping
```

**You should see:** `PONG`

If you see `Could not connect`, Redis isn't running yet — go back and start the service.

---

### 1f. Accounts you'll need (sign up now if you haven't)

You don't need all of these on day one, but it's good to start sign-ups while installing software:

| What | Why you need it | Engine | Where to sign up |
|---|---|---|---|
| **Helius** | Live Solana market data (Geyser gRPC) | Engine 1 (Solana MEV) | [helius.dev](https://helius.dev/) |
| **Telegram bot** | Mobile alerts & instant `/kill` emergency stop | Both Engines | [@BotFather](https://t.me/BotFather) on Telegram |
| **Solana wallet** | Holds SOL/USDC trading funds & pays Jito tips | Engine 1 (Solana MEV) | Phantom, Solflare, etc. |
| **Jito** | Sends atomic MEV bundles directly to validators | Engine 1 (Solana MEV) | [jito.wtf/searcher](https://jito.wtf/searcher) |
| **Hyperliquid** | Primary native DEX venue for BTC/SOL perps (L1 orderbook, maker rebates) | Engine 2 (GODFATHER) | [app.hyperliquid.xyz](https://app.hyperliquid.xyz) (Testnet: [app.hyperliquid-testnet.xyz](https://app.hyperliquid-testnet.xyz)) |
| **Bybit V5** | Secondary CEX fallback for BTC/SOL perps (Unified Trading Account) | Engine 2 (GODFATHER) | [bybit.com](https://bybit.com) (Testnet: [testnet.bybit.com](https://testnet.bybit.com)) |

> **Note on Godfather Venues:** You can start immediately with `DIRECTIONAL_VENUE=paper` (zero capital, zero API keys required). When moving to testnet, Hyperliquid Testnet requires zero KYC and provides free testnet USDC!

---

## Step 2 — Download the project

Open PowerShell in the folder where you keep projects:

```powershell
git clone <your-repo-url>
cd solana-mev-arbitrage-bot
```

Now install all the monorepo packages:

```powershell
pnpm install
```

This takes 1–3 minutes. **You should see** a progress bar and then `Done`.

**If you see a warning about "ignored build scripts":**

```powershell
pnpm install --dangerously-allow-all-builds
```

Don't worry — the name sounds scary, but it just lets native Solana and cryptographic libraries compile. The project `.npmrc` is already configured for this.

---

## Step 3 — Fill in your `.env` file

The `.env` file is where all your secrets, API keys, and trading settings live. The bot reads this file on startup.

### 3a. Create the file

```powershell
Copy-Item .env.example .env
```

Now open `.env` in any text editor (VS Code, Notepad, Cursor).

### 3b. Fill in each section

Work through the file section by section:

---

#### 1. Solana Connectivity (Engine 1 - MEV Arbitrage)

```env
HELIUS_GRPC_URL=mainnet.helius-rpc.com:443
HELIUS_API_KEY=your_helius_api_key_here
```

| Setting | What to put | Common mistake |
|---|---|---|
| `HELIUS_GRPC_URL` | `mainnet.helius-rpc.com:443` | Don't add `https://` at the start |
| `HELIUS_API_KEY` | Your key from [Helius dashboard](https://dashboard.helius.dev/) | Leaving the placeholder text |

---

#### 2. Database and Redis (Storage & Event Bus)

```env
DATABASE_URL=postgresql://mev_user:mev_pass@localhost:5432/mev_research
REDIS_URL=redis://localhost:6379
```

**These should match what you created in Step 1d.** If you changed the password from `mev_pass`, update it here too.

---

#### 3. Solana Wallet & Jito (Engine 1 Real Trades)

```env
BOT_WALLET_PRIVATE_KEY=your_trading_wallet_private_key_base58
JITO_AUTH_KEYPAIR=your_jito_searcher_keypair_base58
JITO_BLOCK_ENGINE_URL=mainnet.block-engine.jito.wtf:443
```

- `BOT_WALLET_PRIVATE_KEY`: Private key in base58 format (export from Phantom: Settings → Security → Export Private Key).
- `JITO_AUTH_KEYPAIR`: Keypair generated with `node -e "const {Keypair}=require('@solana/web3.js'); const bs58=require('bs58'); const kp=Keypair.generate(); console.log(bs58.encode(kp.secretKey));"`

---

#### 4. Solana MEV Execution Settings

```env
SIMULATION_MODE=true
MIN_NET_PROFIT_BPS=20
DAILY_LOSS_LIMIT_USDC=100
MAX_TRADE_CAPITAL_USDC=50
JITO_TIP_RATIO=0.30
COMPETITION_LEVEL=medium
```

| Setting | Plain English | Default |
|---|---|---|
| `SIMULATION_MODE=true` | Paper trading only for Solana MEV | **Keep true for now** |
| `MIN_NET_PROFIT_BPS=20` | Only trigger arbitrage if spread $\ge 0.20\%$ after fees | 20 |
| `DAILY_LOSS_LIMIT_USDC=100` | Max daily loss for Solana MEV engine | 100 |

---

#### 5. THE GODFATHER Directional Engine Settings (Engine 2)

```env
DIRECTIONAL_ENABLED=true
DIRECTIONAL_VENUE=hyperliquid
DIRECTIONAL_TESTNET=true

# Hyperliquid Configuration (Primary Native Venue)
HYPERLIQUID_WALLET_PRIVATE_KEY=0x...
HYPERLIQUID_VAULT_ADDRESS=

# Bybit V5 Configuration (Secondary CEX Fallback)
BYBIT_API_KEY=your_bybit_api_key
BYBIT_API_SECRET=your_bybit_api_secret

# Triad Engine Activations & Capital Allocations
GODFATHER_BTC_ENABLED=true
GODFATHER_SOL_ENABLED=true
GODFATHER_ALTS_ENABLED=true
GODFATHER_ALTS_SYMBOLS=ETHUSD,AVAXUSD,NEARUSD,LINKUSD
GODFATHER_BTC_ALLOCATION_PCT=40.0
GODFATHER_SOL_ALLOCATION_PCT=30.0
GODFATHER_ALTS_ALLOCATION_PCT=30.0

# Dynamic Indicators & Confluence Baseline
GODFATHER_BTC_SWEEP_MIN_USD=50.0
GODFATHER_SOL_SWEEP_MIN_USD=0.50

# Risk Management & Fractional Kelly
GODFATHER_MAX_ACCOUNT_RISK_PCT=0.85
GODFATHER_DAILY_LOSS_LIMIT_USD=450
GODFATHER_MAX_CONSECUTIVE_LOSSES=2

# Dynamic 3-Tranche Execution Mechanics
GODFATHER_TRANCHE1_PCT=35.0
GODFATHER_TRANCHE2_PCT=35.0
GODFATHER_TRANCHE3_PCT=30.0
GODFATHER_CHANDELIER_ATR_MULT=4.2
```

| Setting | Options / Value | Meaning |
|---|---|---|
| `DIRECTIONAL_VENUE` | `hyperliquid` \| `bybit` \| `paper` | Which execution adapter routes trades |
| `DIRECTIONAL_TESTNET` | `true` \| `false` | When `true`, uses Hyperliquid testnet or Bybit testnet |
| `HYPERLIQUID_WALLET_PRIVATE_KEY` | Hex Ethereum private key | EIP-712 Agent wallet used to sign orders without gas |
| `GODFATHER_BTC_ALLOCATION_PCT` | `40.0` | 40% capital allocated to BTC macro anchor engine |
| `GODFATHER_SOL_ALLOCATION_PCT` | `30.0` | 30% capital allocated to SOL high-beta engine |
| `GODFATHER_ALTS_ALLOCATION_PCT` | `30.0` | 30% capital allocated to Alts basket engine |
| `GODFATHER_MAX_ACCOUNT_RISK_PCT` | `0.85` | 0.85% base equity risk per trade (Prop Firm mode) |
| `GODFATHER_DAILY_LOSS_LIMIT_USD` | `450` | $450 daily loss ceiling on a $10,000 account (4.5% rule) |

---

#### 6. API, Dashboard, and Telegram Alerts

```env
PORT=3001
NEXT_PUBLIC_API_URL=http://localhost:3001
LOG_LEVEL=info
PROMETHEUS_PORT=9091
TELEGRAM_BOT_TOKEN=123456789:ABCDefGHiJklMnOpQrStUvWxYz
TELEGRAM_ADMIN_CHAT_ID=123456789
```

- **Telegram setup:** Search `@BotFather` on Telegram, send `/newbot`, get token. Then message `@userinfobot` to get your numeric chat ID. Remember to message your new bot `Hello` once created!

---

### 3c. Save the file

Save `.env` and close the editor. You're done with configuration.

---

## Step 4 — Create the database tables & run migrations

The bot requires PostgreSQL tables to store Solana arbitrage opportunities, paper simulations, Godfather multi-TF candles, SMC signals, trade tranches, and trailing stops.

One command executes all pending migrations:

```powershell
pnpm migrate
```

**You should see:**

```
[migrate] Connecting to PostgreSQL...
[migrate] Applied migration: 001_initial_schema.sql (Solana MEV tables)
[migrate] Applied migration: 002_godfather_schema.sql (Godfather candles, signals, trades, tranches)
[migrate] All migrations applied successfully!
```

**What just happened?** The migration runner applied:
1. `001_initial_schema.sql`: Created `pools`, `opportunities`, `simulations`, `execution_orders`, `daily_stats`, `simulation_stats`, and `bot_state`.
2. `002_godfather_schema.sql`: Created `candles` (time-series with hypertable-ready indexes), `godfather_signals` (5-stage confluence records), `godfather_trades` (trade lifecycle), and `godfather_tranches` (individual tranche fills, breakeven tracking, and Chandelier trailing stop state).

**Optional verification:**

```powershell
psql -U mev_user -d mev_research -h localhost -c "\dt"
```

You should see all 11 tables listed.

---

## Step 5 — Build the project

Compile all 13 monorepo packages (TypeScript $\rightarrow$ JavaScript):

```powershell
pnpm build
```

Takes 1–2 minutes. **You should see:** all 13 packages compiling cleanly with zero errors:
- `@mev-research/shared`
- `@mev-research/market-feed`
- `@mev-research/spread-engine`
- `@mev-research/execution` (including Hyperliquid & Bybit directional adapters)
- `@mev-research/simulation`
- `@mev-research/godfather-engine` (Indicators, Resamplers, SMC Detection, Risk Engine)
- `@mev-research/database`
- `@mev-research/analytics`
- `@mev-research/monitoring`
- `@mev-research/api`
- `@mev-research/telegram`
- `@mev-research/main`
- `@mev-research/dashboard`

**Run full workspace test suite (verified locally without cloud CI dependency):**

```powershell
pnpm test
```

**You should see:** `24/24 tests pass (100% green)` across all packages (14/14 tests in `@mev-research/godfather-engine` covering Causal Resampling, M1/M15 Wilder's ATR/CHOP indicators, Dynamic Fractal Sweeps, MSS/FVG triggers, Kelly sizing, and the 3-Tranche Lifecycle Manager, plus execution and spread-engine test suites)!

---

## Step 6 — Start the dual-engine bot

### First time? Use simulation mode & testnet.

Verify your `.env` has:
```env
SIMULATION_MODE=true
DIRECTIONAL_TESTNET=true
```

### Start the bot

From the project root folder:

```powershell
pnpm start
```

**Or in development mode** (hot reloading):

```powershell
pnpm dev
```

### What a healthy dual-engine startup looks like

You should see both engines initializing cleanly in your terminal:

```
[STARTUP] Dual-Engine Quantitative Fund Initializing...
[DB] Connection pool ready (PostgreSQL 11 tables verified)
[STARTUP] DB and Redis healthy
[Wallet] Solana Keypair: Abc123... (Simulation: true)
[STARTUP] Engine 1 (Solana MEV Arbitrage): ACTIVE
[STARTUP] Market feed active (Yellowstone Geyser gRPC)
[SimRunner] MEV Simulation engine running

[Godfather] ========================================
[Godfather] THE GODFATHER Triad Concurrent Engine v2.0
[Godfather] Primary Venue: Hyperliquid L1 (Testnet: true)
[Godfather] Secondary Venue: Bybit V5 (UTA Fallback)
[Godfather] Concurrent Triad:
[Godfather]   ├── btcEngine (40% Capital): BTCUSD
[Godfather]   ├── solEngine (30% Capital): SOLUSD
[Godfather]   └── altsEngine (30% Capital): ETHUSD, AVAXUSD, NEARUSD, LINKUSD
[Godfather] Multi-TF Causal Resampler: M1 -> M5, M15, H1, H4
[Godfather] 100% Dynamic Math: M1/M15 Wilder's ATR + Choppiness Index
[Godfather] Sizing: Tiered Conviction (Unicorn 2.4x / Normal 1.0x)
[Godfather] Execution: 3-Tranche (35% @ 1.5R, 35% @ Dyn R2, 30% Moonbag)
[Godfather] ========================================

[API] Server listening on http://localhost:3001
[Monitoring] Prometheus metrics at http://localhost:9091/metrics
[Telegram] Bot active & listening for commands
[STARTUP] All systems go — NO REAL CAPITAL AT RISK
```

### How to stop the bot safely

Press **Ctrl+C** once. The bot will cleanly close database connections, persist all trade states to PostgreSQL, and shutdown without dropping orders.

---

## Step 7 — Open the dashboard

The dashboard provides a Next.js 14 real-time interface with dark-mode institutional UI.

Open a **new** PowerShell window (Terminal 2):

```powershell
cd apps/dashboard
pnpm dev
```

Open your browser and navigate to: **http://localhost:3000**

| Route | What you'll see |
|---|---|
| **Overview (`/`)** | Fund overview, dual-engine status, aggregate PnL, system health |
| **MEV Execution (`/execution`)** | Solana live orders, DEX pool spreads, wallet balances, kill switch |
| **MEV Simulation (`/simulation`)** | Paper-trading stats, win rate, Gaussian latency distributions |
| **GODFATHER (`/godfather`)** | Live BTCUSD & SOLUSD multi-TF candle charts, real-time 5-stage confluence scanner, active 3-tranche trades, Chandelier trailing stop levels, and execution logs |

**If the page says "Loading..." forever:**
- Make sure the bot is still running in Terminal 1
- Check `http://localhost:3001/health` in your browser — you should see `{"status":"ok",...}`

---

## Step 8 — Test that everything works

Work through this checklist to verify that all systems are healthy.

### On your computer

```powershell
# 1. Database is alive and both migrations applied
psql -U mev_user -d mev_research -h localhost -c "SELECT name FROM _migrations ORDER BY id;"
# ✓ Should show: 001_initial_schema.sql AND 002_godfather_schema.sql (count = 2)

# 2. Redis is alive
redis-cli ping
# ✓ Should show: PONG

# 3. Master API is alive
curl http://localhost:3001/health
# ✓ Should show: {"status":"ok",...}

# 4. Engine 1 MEV status (wallet + simulation mode)
curl http://localhost:3001/api/v1/execution/status
# ✓ Should show: killSwitchActive: false, simulationMode: true, wallet balances

# 5. Engine 2 GODFATHER directional status & signals
curl http://localhost:3001/api/v1/godfather/signals
# ✓ Should return recent BTCUSD/SOLUSD confluence signals array []

# 6. Run automated test suite across entire workspace
pnpm test
# ✓ Should show: 24/24 tests passed across all packages (100% green)
```

### On Telegram

Open your bot and try these commands one by one:

| Send this | What should happen |
|---|---|
| `/wallet` | Bot replies with your Solana balance (SOL/USDC) and Hyperliquid margin |
| `/orders` | Bot replies with recent MEV orders |
| `/godfather` | Bot replies with active BTCUSD & SOLUSD positions and trailing stop levels |
| `/pnl` | Bot replies with aggregate fund profit/loss summary |
| `/kill` | Bot sets Redis kill switch ON (pauses both MEV and Godfather trading instantly) |
| `/resume` | Bot sets kill switch OFF (trading resumed) |

**If the bot doesn't reply:** Did you send it a message first to start the chat? Is `TELEGRAM_BOT_TOKEN` correct?

### Watch the bot work (dual-engine simulation)

With the bot running, stare at Terminal 1 for a few minutes. You will see both engines generating intelligence:

**Engine 1 (MEV Arbitrage):**
```
[SpreadEngine] Opportunity: SOL/USDC | net 25.3bps | confidence 72 | latency 2ms
```

**Engine 2 (The GODFATHER Directional Scalper):**
```
[Godfather] [BTCUSD] M15 Liquidity Sweep: Breach +$62.40 > $50.00 min threshold!
[Godfather] [BTCUSD] Delta Absorption detected: Reclaim delta +42.1 BTC > Sweep delta -38.5 BTC
[Godfather] [BTCUSD] Displacement Candle validated (Body $142.00 >= 0.60 ATR)
[Godfather] [BTCUSD] MSS confirmed! Bullish FVG formed [$68,420.00 - $68,455.00]
[Godfather] [BTCUSD] Grade A+ Unicorn Setup! Kelly Multiplier: 2.40x
[Godfather] [BTCUSD] Placed Post-Only Buy Limit on Hyperliquid @ $68,455.00
```

After running for a while, check simulation and performance stats:

```powershell
# Solana MEV paper stats
redis-cli GET mev:simulation:stats

# Godfather live signals and trades via API
curl http://localhost:3001/api/v1/godfather/trades
```

---

## When you're ready for real trading (go-live)

**Stop. Read this entire section before changing anything.**

Simulation mode and testnet exist so you can prove both engines work before risking money.

### Checklist — every box must be ticked

- [ ] Dual-engine ran in simulation / testnet for **at least 72 hours** (3 full days)
- [ ] **500+ MEV simulations** completed (`mev:simulation:stats`) with win rate $\ge 60\%$
- [ ] **20+ Godfather testnet trades** executed with positive net expectancy
- [ ] Solana wallet has **at least $50 USDC** and **0.1 SOL** for gas/tips
- [ ] Hyperliquid or Bybit account funded with intended risk capital
- [ ] `DAILY_LOSS_LIMIT_USDC` and `GODFATHER_DAILY_LOSS_LIMIT_USD` set to amounts you can afford to lose
- [ ] You tested `/kill` on Telegram and verified both engines halted trading
- [ ] Dashboard shows correct wallet and margin balances on both `/execution` and `/godfather`
- [ ] Jito keypair is registered at [jito.wtf/searcher](https://jito.wtf/searcher)

### Flip the switch (only when ready)

In `.env`, update to production settings:

```env
# Engine 1 Live MEV
SIMULATION_MODE=false

# Engine 2 Live Godfather
DIRECTIONAL_TESTNET=false
DIRECTIONAL_VENUE=hyperliquid  # or bybit
```

Save and restart the bot (`Ctrl+C`, then `pnpm start` again).

**You should now see:**

```
[STARTUP] ⚠️  LIVE TRADING MODE — real capital at risk on Solana & Hyperliquid
```

Real money is now at stake. Keep Telegram open and know how to `/kill`.

---

## Your daily routine (once everything is set up)

Every time you want to run the bot:

**Terminal 1 — the dual-engine bot:**
```powershell
pnpm start
```

**Terminal 2 — the Next.js dashboard:**
```powershell
cd apps/dashboard
pnpm dev
```

**Then open:**
- Main Dashboard: http://localhost:3000
- MEV Engine: http://localhost:3000/execution
- Godfather Engine: http://localhost:3000/godfather

### How to check on things

| I want to know... | Do this |
|---|---|
| Is the bot running OK? | Look at Terminal 1 for logs |
| What's my wallet / margin balance? | Telegram `/wallet` or dashboard |
| Recent MEV & Godfather trades | Telegram `/orders`, `/godfather`, or dashboard |
| Profit today | Telegram `/pnl` |
| MEV simulation stats | `redis-cli GET mev:simulation:stats` |
| Prometheus metrics | Open http://localhost:9091/metrics |

### Emergency — stop everything NOW

Pick the fastest option available:

1. **Telegram** → send `/kill` to your bot (pauses all trading on both engines instantly)
2. **Keyboard** → press `Ctrl+C` in Terminal 1 (cleanly closes all connections and exits)

---

## Troubleshooting — when something goes wrong

Don't panic. Most problems are a missing setting or a service that isn't running.

---

### "Missing required environment variable: XXXXX"

**Fix:** Open `.env`, check `.env.example` for the missing variable, fill it in, save, and restart.

---

### "PostgreSQL health check failed"

```powershell
# Is PostgreSQL service running?
Get-Service -Name "postgresql*"
# If Stopped: Start-Service postgresql-x64-16

# Can you connect manually?
psql -U mev_user -d mev_research -h localhost -c "SELECT 1;"
```

---

### "Redis health check failed"

```powershell
redis-cli ping
```
- If it fails, start Memurai (Windows) or `brew services start redis` (Mac).
- Ensure `.env` has `REDIS_URL=redis://localhost:6379`.

---

### "Migration error: relation already exists or migration failed"

```powershell
# Check applied migrations
psql -U mev_user -d mev_research -h localhost -c "SELECT * FROM _migrations;"
# Run migrations again (safe and idempotent)
pnpm migrate
```

---

### Telegram bot ignores me

1. Did you start the conversation first by sending `Hello` to the bot?
2. Did you set both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_ID`?
3. Check Terminal 1 logs for `[Telegram] Bot active`.

---

### Dashboard stuck on "Loading..."

1. Is the backend API running on port 3001? Check `http://localhost:3001/health`.
2. Ensure `NEXT_PUBLIC_API_URL=http://localhost:3001` in your `.env`.

---

## Quick cheat sheet

Copy this block — everything you need in one place:

```powershell
# === FIRST TIME SETUP ===
pnpm install
Copy-Item .env.example .env     # fill in your API keys & wallets
pnpm migrate                    # create all 11 PostgreSQL tables (MEV + Godfather)
pnpm build                      # compile all 13 monorepo packages
pnpm test                       # verify 24/24 tests pass across all packages (100% green)

# === EVERY TIME YOU RUN ===
pnpm start                      # Terminal 1: start dual-engine fund bot
cd apps/dashboard; pnpm dev     # Terminal 2: start Next.js 14 dashboard

# === OPEN IN BROWSER ===
# Overview:     http://localhost:3000
# Godfather:    http://localhost:3000/godfather
# Execution:    http://localhost:3000/execution
# Health:       http://localhost:3001/health
# Metrics:      http://localhost:9091/metrics
```

---

## Keep your setup safe

- **Never** commit `.env` to GitHub or share it with anyone.
- **Never** share `BOT_WALLET_PRIVATE_KEY` or `HYPERLIQUID_WALLET_PRIVATE_KEY`.
- **Always** start with `SIMULATION_MODE=true` and `DIRECTIONAL_TESTNET=true`.
- Use **dedicated wallets/accounts** with only funds allocated to trading.
- Always maintain daily loss limits (`DAILY_LOSS_LIMIT_USDC`, `GODFATHER_DAILY_LOSS_LIMIT_USD`).
- Test `/kill` on Telegram before live trading — it is your immediate emergency brake.

---

## What's next?

- **Architecture deep-dive:** [README.md](./README.md)
- **Questions about a specific error?** Check the Troubleshooting section above
- **Ready to go live?** Complete the go-live checklist in Step 8's second half

You've got this. Take it one step at a time.
