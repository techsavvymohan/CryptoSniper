# Setup Guide — We'll Walk Through This Together

This guide assumes you're setting up the bot for the first time. Follow each step in order. Don't skip ahead — later steps depend on earlier ones.

**What we're building:** A bot that watches Solana DEX prices, finds arbitrage opportunities, and either simulates trades (safe) or executes them for real (only when you're ready).

**Important:** This project does **not** use Docker. You install PostgreSQL and Redis directly on your computer, like normal desktop apps.

Need the big-picture architecture? See [README.md](./README.md).

---

## Before you start — the full journey

Here's every step we'll do together:

```
Step 1  → Install the tools you need (Node, database, Redis)
Step 2  → Download the project code
Step 3  → Fill in your .env file (passwords, API keys, wallet)
Step 4  → Create the database tables
Step 5  → Build the code
Step 6  → Start the bot (simulation mode — no real money)
Step 7  → Open the dashboard in your browser
Step 8  → Test that everything works
```

**Time estimate:** 30–60 minutes for first-time setup (not counting waiting for account sign-ups).

**Golden rule:** Keep `SIMULATION_MODE=true` until you've run the bot safely for days and checked the go-live list at the end of this guide.

---

## Step 1 — Install the tools you need

Think of these as the "ingredients" before we cook.

### 1a. Node.js (runs the bot)

1. Go to [nodejs.org](https://nodejs.org/)
2. Download the **LTS** version (20 or higher)
3. Run the installer — click Next through everything
4. Open PowerShell and check it worked:

```powershell
node --version
```

**You should see:** something like `v20.x.x` or `v22.x.x`

---

### 1b. PNPM (installs project packages)

PNPM is like npm, but faster for this type of project.

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

| What | Why you need it | Where to sign up |
|---|---|---|
| **Helius** | Live market data from Solana | [helius.dev](https://helius.dev/) |
| **Telegram bot** | Get alerts on your phone, emergency stop | [@BotFather](https://t.me/BotFather) on Telegram |
| **Solana wallet** | Holds your trading money (later) | Phantom, Solflare, etc. |
| **Jito** | Sends real trades (only for live mode) | [jito.wtf/searcher](https://jito.wtf/searcher) |

---

## Step 2 — Download the project

Open PowerShell in the folder where you keep projects:

```powershell
git clone <your-repo-url>
cd solana-arbitrage-bot
```

Now install all the code libraries the project needs:

```powershell
pnpm install
```

This takes 1–3 minutes. **You should see** a progress bar and then `Done`.

**If you see a warning about "ignored build scripts":**

```powershell
pnpm install --dangerously-allow-all-builds
```

Don't worry — the name sounds scary, but it just lets some native Solana libraries compile. The project `.npmrc` is already set up for this.

---

## Step 3 — Fill in your `.env` file

The `.env` file is where all your secrets and settings live. The bot reads this file on startup.

### 3a. Create the file

```powershell
Copy-Item .env.example .env
```

Now open `.env` in any text editor (Notepad, VS Code, Cursor — whatever you use).

### 3b. Fill in each section

Work through the file top to bottom. I'll explain each part in plain English.

---

#### Connectivity — how the bot talks to Solana

```env
HELIUS_GRPC_URL=mainnet.helius-rpc.com:443
HELIUS_API_KEY=your_helius_api_key_here
```

| Setting | What to put | Common mistake |
|---|---|---|
| `HELIUS_GRPC_URL` | `mainnet.helius-rpc.com:443` | Don't add `https://` at the start |
| `HELIUS_API_KEY` | Your key from [Helius dashboard](https://dashboard.helius.dev/) | Leaving the placeholder text |

**How to get your Helius key:**
1. Log in to [dashboard.helius.dev](https://dashboard.helius.dev/)
2. Create a new API key
3. Copy it and paste into `.env`

---

#### Database and Redis — connect to what we installed in Step 1

```env
DATABASE_URL=postgresql://mev_user:mev_pass@localhost:5432/mev_research
REDIS_URL=redis://localhost:6379
```

**These should match what you created in Step 1d.** If you changed the password from `mev_pass`, update it here too.

Think of `DATABASE_URL` as: `postgresql://USERNAME:PASSWORD@WHERE:PORT/DATABASE_NAME`

---

#### Wallet — your trading account

```env
BOT_WALLET_PRIVATE_KEY=your_trading_wallet_private_key_base58
```

This is the private key of the Solana wallet the bot will trade from.

**How to get it:**
- Export from Phantom: Settings → Security & Privacy → Export Private Key
- It will be a long string of letters and numbers (base58 format)

**Never share this. Never commit it to GitHub.** Treat it like your bank password.

> For simulation mode, the wallet doesn't need money yet — but the key still must be valid so the bot can read balances.

---

#### Jito — for real trades only (you can set this up later)

```env
JITO_AUTH_KEYPAIR=your_jito_searcher_keypair_base58
JITO_BLOCK_ENGINE_URL=mainnet.block-engine.jito.wtf:443
```

Jito is how the bot sends "all-or-nothing" trade bundles on Solana. You only need this working before live trading.

**Generate a Jito keypair** (run from the project folder):

```powershell
node -e "const {Keypair}=require('@solana/web3.js'); const bs58=require('bs58'); const kp=Keypair.generate(); console.log('Private (put in .env):', bs58.encode(kp.secretKey)); console.log('Public (register on jito.wtf):', kp.publicKey.toBase58());"
```

Copy the **Private** line into `JITO_AUTH_KEYPAIR`.  
Copy the **Public** line and register it at [jito.wtf/searcher](https://jito.wtf/searcher).

---

#### Execution settings — how aggressive the bot trades

```env
SIMULATION_MODE=true
MIN_NET_PROFIT_BPS=20
DAILY_LOSS_LIMIT_USDC=100
MAX_TRADE_CAPITAL_USDC=50
JITO_TIP_RATIO=0.30
COMPETITION_LEVEL=medium
```

| Setting | Plain English | Keep as default? |
|---|---|---|
| `SIMULATION_MODE=true` | **Fake money only** — no real trades | **Yes — keep true for now** |
| `MIN_NET_PROFIT_BPS=20` | Only trade if profit is at least 0.20% after fees | Yes to start |
| `DAILY_LOSS_LIMIT_USDC=100` | Stop trading if you lose $100 in one day | Adjust to your comfort |
| `MAX_TRADE_CAPITAL_USDC=50` | Never use more than $50 per trade | Yes to start |
| `JITO_TIP_RATIO=0.30` | Tip Jito 30% of expected profit | Yes to start |
| `COMPETITION_LEVEL=medium` | How hard to compete for block space | `low`, `medium`, or `high` |

**Basis points (bps) explained:** 20 bps = 0.20%. So the bot ignores tiny spreads that wouldn't cover fees.

---

#### API and dashboard — where you view the bot in a browser

```env
PORT=3001
NEXT_PUBLIC_API_URL=http://localhost:3001
LOG_LEVEL=info
PROMETHEUS_PORT=9091
```

You can leave all of these as-is unless something else on your computer already uses port 3001 or 9091.

---

#### Telegram — get alerts on your phone

```env
TELEGRAM_BOT_TOKEN=123456789:ABCDefGHiJklMnOpQrStUvWxYz
TELEGRAM_ADMIN_CHAT_ID=123456789
```

**Create your bot (5 minutes):**

1. Open Telegram and search for **@BotFather**
2. Send: `/newbot`
3. Pick a name (e.g. "My MEV Bot")
4. Pick a username (must end in `bot`, e.g. `my_mev_bot`)
5. BotFather gives you a token like `7123456789:AAH...` — paste it as `TELEGRAM_BOT_TOKEN`

**Get your chat ID:**

1. Search for **@userinfobot** on Telegram
2. Send it any message
3. It replies with your ID number — paste that as `TELEGRAM_ADMIN_CHAT_ID`

**One more thing:** Open your new bot in Telegram and send it `Hello`. Bots can't message you until you've started the chat first.

---

### 3c. Save the file

Save `.env` and close the editor. You're done with configuration.

**If you miss a required setting**, the bot will tell you exactly which one:

```
Missing required environment variable: HELIUS_API_KEY
Please set HELIUS_API_KEY in your .env file.
```

Just add it and restart.

---

## Step 4 — Create the database tables

The bot needs tables to store opportunities, simulations, and trades. One command does it all:

```powershell
pnpm migrate
```

**You should see:**

```
[migrate] Applied: 001_initial_schema.sql
[migrate] All migrations applied
```

**What just happened?** The bot created 7 tables in PostgreSQL. Running this again is safe — it won't duplicate anything.

**Optional check** — see the tables yourself:

```powershell
psql -U mev_user -d mev_research -h localhost -c "\dt"
```

You should see names like `opportunities`, `simulations`, `execution_orders`.

**If migration fails:**
- Is PostgreSQL running? (`Get-Service -Name "postgresql*"`)
- Is `DATABASE_URL` in `.env` correct?
- Did you create `mev_user` and `mev_research` in Step 1d?

---

## Step 5 — Build the project

This compiles all the TypeScript code into JavaScript the computer can run:

```powershell
pnpm build
```

Takes 1–2 minutes. **You should see** each package build without red error text.

**If build fails**, run this to find which package broke:

```powershell
npx tsc --noEmit --project packages/shared/tsconfig.json
```

Fix that package's error, then try `pnpm build` again.

---

## Step 6 — Start the bot

### First time? Always use simulation mode.

Check your `.env` has:

```env
SIMULATION_MODE=true
```

This means the bot **watches real prices** but **doesn't spend real money**. Perfect for learning and testing.

### Start the bot

From the project root folder:

```powershell
pnpm start
```

**Or for development** (easier to debug, runs TypeScript directly):

```powershell
pnpm dev
```

### What a healthy startup looks like

Read through your terminal output. You want to see ALL of these lines:

```
[STARTUP] Simulation mode: true          ← Good! No real money at risk
[DB] Connection pool ready               ← Database connected
[STARTUP] DB and Redis healthy           ← Both storage systems OK
[Wallet] Address: Abc123...              ← Your wallet loaded
[STARTUP] Market feed active             ← Getting live Solana data
[SimRunner] Started — listening on ...   ← Simulation engine running
[API] Server listening on http://localhost:3001
[Monitoring] Prometheus metrics at http://localhost:9091/metrics
[STARTUP] All systems go
[STARTUP] SIMULATION MODE — no real capital at risk
```

**If anything is missing or red**, jump to [Troubleshooting](#troubleshooting--when-something-goes-wrong) at the bottom.

### How to stop the bot safely

Press **Ctrl+C** once in the terminal. Wait for:

```
[SHUTDOWN] Clean exit
```

Don't force-close the window — let it shut down cleanly.

---

## Step 7 — Open the dashboard

The dashboard is a website on your computer where you can see wallet balance, orders, and simulation results.

**Leave the bot running** in Terminal 1. Open a **new** PowerShell window (Terminal 2):

```powershell
cd solana-arbitrage-bot\apps\dashboard
pnpm dev
```

**You should see:**

```
▲ Next.js 14.x.x
- Local: http://localhost:3000
```

Open your browser and go to: **http://localhost:3000**

| Page | What you'll see |
|---|---|
| Home (`/`) | Links to Execution and Simulation |
| Execution (`/execution`) | Live orders, wallet, kill switch status |
| Simulation (`/simulation`) | Paper trading results |

**If the page says "Loading..." forever:**
- Make sure the bot is still running in Terminal 1
- Check `http://localhost:3001/health` in your browser — you should see `{"status":"ok",...}`

---

## Step 8 — Test that everything works

Work through this list like a checklist. Put a ✓ next to each one as you go.

### On your computer

```powershell
# 1. Database is alive
psql -U mev_user -d mev_research -h localhost -c "SELECT COUNT(*) FROM _migrations;"
# ✓ Should show: count = 1

# 2. Redis is alive
redis-cli ping
# ✓ Should show: PONG

# 3. API is alive
curl http://localhost:3001/health
# ✓ Should show: {"status":"ok",...}

# 4. Bot status (wallet + simulation mode)
curl http://localhost:3001/api/v1/execution/status
# ✓ Should show: killSwitchActive, simulationMode, wallet balances
```

### On Telegram

Open your bot and try these commands one by one:

| Send this | What should happen |
|---|---|
| `/wallet` | Bot replies with your SOL and USDC balance |
| `/orders` | Bot replies with recent orders (may be empty — that's OK) |
| `/pnl` | Bot replies with profit/loss summary |
| `/kill` | Bot says kill switch is ON (trading paused) |
| `/resume` | Bot says kill switch is OFF (trading allowed) |

**If the bot doesn't reply:** Did you send it a message first to start the chat? Is `TELEGRAM_BOT_TOKEN` correct?

### Watch the bot work (simulation)

With the bot running, stare at Terminal 1 for a few minutes. When market prices diverge between DEXs, you'll see lines like:

```
[SpreadEngine] Opportunity: SOL/USDC | net 25.3bps | confidence 72 | latency 2ms
```

That means the bot found a price difference and is paper-trading it. No real money moves.

After about 60 seconds, check simulation stats:

```powershell
redis-cli GET mev:simulation:stats
```

You'll see JSON with `totalSimulated`, `winRate`, etc.

**No opportunities showing up?** That's normal during quiet markets. As long as startup logs look healthy, the bot is working — it's just waiting for spreads.

---

## When you're ready for real trading (go-live)

**Stop. Read this entire section before changing anything.**

Simulation mode exists so you can prove the bot works before risking money. The bot itself will recommend when to go live based on results.

### Checklist — every box must be ticked

- [ ] Bot ran in simulation for **at least 72 hours** (3 full days)
- [ ] **500+ simulations** completed (check `totalSimulated` in Redis stats)
- [ ] **Win rate is 60% or higher**
- [ ] **Average profit is positive** after fees
- [ ] Wallet has **at least $50 USDC** for trading
- [ ] Wallet has **at least 0.1 SOL** for transaction fees
- [ ] `DAILY_LOSS_LIMIT_USDC` is set to something you can afford to lose
- [ ] You tested `/kill` on Telegram and it worked
- [ ] Dashboard shows the correct wallet balance
- [ ] Jito keypair is registered at [jito.wtf/searcher](https://jito.wtf/searcher)

### Flip the switch (only when ready)

In `.env`, change one line:

```env
SIMULATION_MODE=false
```

Save, restart the bot (`Ctrl+C`, then `pnpm start` again).

**You should now see:**

```
[STARTUP] ⚠️  LIVE TRADING MODE — real capital at risk
```

Real money is now at stake. Keep Telegram open and know how to `/kill`.

---

## Your daily routine (once everything is set up)

Every time you want to run the bot:

**Terminal 1 — the bot:**
```powershell
cd solana-arbitrage-bot
pnpm start
```

**Terminal 2 — the dashboard:**
```powershell
cd solana-arbitrage-bot\apps\dashboard
pnpm dev
```

**Then open:** http://localhost:3000

### How to check on things

| I want to know... | Do this |
|---|---|
| Is the bot running OK? | Look at Terminal 1 for errors |
| What's my wallet balance? | Telegram `/wallet` or dashboard |
| Recent trades | Telegram `/orders` or dashboard |
| Profit today | Telegram `/pnl` |
| Simulation performance | `redis-cli GET mev:simulation:stats` |
| Technical metrics | Open http://localhost:9091/metrics |

### Emergency — stop everything NOW

Pick the fastest option available:

1. **Telegram** → send `/kill` to your bot (pauses trading instantly)
2. **Keyboard** → press `Ctrl+C` in the bot terminal (stops everything)

---

## Troubleshooting — when something goes wrong

Don't panic. Most problems are a missing setting or a service that isn't running.

---

### "Missing required environment variable: XXXXX"

**What it means:** Your `.env` file is missing a setting.

**Fix:**
1. Open `.env`
2. Find the variable named in the error (e.g. `HELIUS_API_KEY`)
3. Fill it in
4. Save and restart the bot

---

### "PostgreSQL health check failed"

**What it means:** The bot can't reach your database.

**Fix — try each until one works:**

```powershell
# Is PostgreSQL running?
Get-Service -Name "postgresql*"
# If Stopped → Start-Service postgresql-x64-16

# Can you connect manually?
psql -U mev_user -d mev_research -h localhost -c "SELECT 1;"

# Is DATABASE_URL correct in .env?
# Should look like: postgresql://mev_user:mev_pass@localhost:5432/mev_research
```

---

### "Redis health check failed"

**What it means:** Redis isn't running or the URL is wrong.

**Fix:**

```powershell
redis-cli ping
```

- If it fails → start Memurai (Windows) or `brew services start redis` (Mac)
- Check `.env` has `REDIS_URL=redis://localhost:6379`

---

### "pnpm install" warnings about build scripts

**Fix:**

```powershell
pnpm install --dangerously-allow-all-builds
```

---

### Wallet shows 0 SOL and 0 USDC

**Possible reasons:**
1. `BOT_WALLET_PRIVATE_KEY` is wrong — re-export from your wallet
2. The wallet genuinely has no funds — send some SOL/USDC to the address shown in startup logs
3. Helius RPC isn't responding — check your API key and plan

---

### Telegram bot ignores me

1. **Did you message the bot first?** Open it in Telegram and send `Hello` before expecting replies
2. **Is the token correct?** Copy fresh from @BotFather — no extra spaces
3. **Is the chat ID correct?** Get it again from @userinfobot
4. **Is the bot process running?** Look for `[STARTUP] Telegram bot active` in Terminal 1

---

### Dashboard stuck on "Loading..."

1. Is the bot running? (`pnpm start` in Terminal 1)
2. Does http://localhost:3001/health work in your browser?
3. Is `NEXT_PUBLIC_API_URL=http://localhost:3001` in `.env`?
4. Restart the dashboard after changing `.env`

---

### No opportunities appearing

This is **usually normal**, not a bug. Arbitrage opportunities come and go with market volatility.

**The bot IS working if you see:**
- `[STARTUP] Market feed active`
- No constant error/reconnect messages
- `[SimRunner] Started`

**Check if gRPC is configured correctly:**
- `HELIUS_GRPC_URL` must be `domain:port` with **no** `https://`
- Example: `mainnet.helius-rpc.com:443`

---

## Quick cheat sheet

Copy this block — it's everything in one place:

```powershell
# === FIRST TIME SETUP ===
pnpm install
Copy-Item .env.example .env     # then fill in every value
pnpm migrate                    # create database tables
pnpm build                      # compile the code

# === EVERY TIME YOU RUN ===
pnpm start                      # Terminal 1: start the bot
cd apps/dashboard; pnpm dev     # Terminal 2: start the dashboard

# === USEFUL CHECKS ===
redis-cli ping
redis-cli GET mev:simulation:stats
curl http://localhost:3001/api/v1/execution/status

# === OPEN IN BROWSER ===
# Dashboard:    http://localhost:3000
# API health:   http://localhost:3001/health
# Metrics:      http://localhost:9091/metrics
```

---

## Keep your setup safe

- **Never** put `.env` on GitHub or share it with anyone
- **Never** share `BOT_WALLET_PRIVATE_KEY` — anyone with it can steal your funds
- **Always** start with `SIMULATION_MODE=true`
- Use a **dedicated wallet** with only the money you're willing to risk
- Set `DAILY_LOSS_LIMIT_USDC` to an amount you can afford to lose
- Test `/kill` on Telegram before going live — it's your emergency brake

---

## What's next?

- **Architecture deep-dive:** [README.md](./README.md)
- **Questions about a specific error?** Check the Troubleshooting section above
- **Ready to go live?** Complete the go-live checklist in Step 8's second half

You've got this. Take it one step at a time.
