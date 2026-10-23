# 📖 Production Operational Runbooks

> **Document Classification**: Regulated Financial Infrastructure  
> **Target Audience**: Systems Engineers, Quantitative Traders, Operations Team

---

## 🚀 Runbook 1: Cold Startup & Staged Pre-Flight Checklist

Before launching the dual engine in any production environment, execute this verification sequence:

### Step 1: Infrastructure Readiness Check
```powershell
# 1. Verify PostgreSQL is accepting connections
pg_isready -h localhost -p 5432 -U mev_user

# 2. Verify Redis is running and responsive
redis-cli ping
# Expected response: PONG

# 3. Check for any leftover emergency kill-switch keys
redis-cli get "execution:kill-switch"
# Expected response: (nil). If set, investigate before deleting!
```

### Step 2: Database Schema & Migration Verification
```powershell
# Run all 3 migrations to ensure schema is fully up to date:
# - 001_initial_schema.sql (MEV tables)
# - 002_godfather_schema.sql (Godfather SMC tables)
# - 003_audit_trail_schema.sql (Immutable audit logs)
pnpm migrate
```

### Step 3: Local Test Suite & Build Verification (Native CLI)
```powershell
# 1. Verify all 24 automated unit tests pass (100% green) across monorepo packages
pnpm test

# 2. Verify all 13 monorepo packages compile cleanly with zero TypeScript errors
pnpm -r build
```

### Step 4: Secret & Configuration Validation
- Verify that `.env` contains valid credentials and matches the intended venue (`paper` or `hyperliquid` / `bybit`).
- Ensure `SIMULATION_MODE=true` if testing MEV cross-DEX loops.
- Verify wallet address balances (SOL for rent/gas, USDC for capital).

### Step 5: Launch Orchestrator & Dashboard
```powershell
# Terminal 1: Launch Core Orchestrator (Solana MEV + Godfather Triad Manager)
pnpm start

# Terminal 2: Launch Monitoring Dashboard
pnpm dashboard
```

---

## 🚨 Runbook 2: Emergency Kill Switch & Position Unwind

When anomalous market conditions, exchange API degradation, or unexpected drawdowns occur:

### Method A: Instant Telegram Bot Remote Kill
Send the following message to your Telegram bot:
```
/kill EMERGENCY_MARKET_DUMP
```
- **Action**: Immediately sets Redis key `execution:kill-switch`, activates `ExecutionGateway.activateKillSwitch()`, and cancels all working FVG proximal limit orders.

### Method B: Native Redis Key Kill (Zero Dependencies)
If the API or Telegram is unresponsive:
```powershell
redis-cli set "execution:kill-switch" "MANUAL_OPERATOR_HALT" EX 86400
```

### Method C: Manual Position Unwind
To close all open positions across venues:
1. **Hyperliquid**: Navigate to [app.hyperliquid.xyz](https://app.hyperliquid.xyz) → Positions → Click **"Close All"** (Market Reduce-Only).
2. **Bybit**: Navigate to Derivatives → Positions → Click **"Market Close All"**.
3. Reconcile remaining balances in database.

---

## 🔄 Runbook 3: Resuming Operations After Kill Switch

1. Conduct a root-cause analysis of the tripped circuit breaker.
2. Verify exchange balance, working orders, and fill history.
3. Review audit events leading up to the trigger:
   ```sql
   SELECT event_type, status, details, created_at 
   FROM audit_events 
   ORDER BY created_at DESC 
   LIMIT 50;
   ```
4. Release kill switch:
   ```powershell
   redis-cli del "execution:kill-switch"
   ```
5. Restart bot orchestrator (`pnpm start`).

---

## 💾 Runbook 4: Database Disaster Recovery

### Creating a Snapshot Backup
```powershell
pg_dump -U mev_user -d mev_research -F c -b -v -f "backups/mev_research_$(Get-Date -Format 'yyyyMMdd_HHmmss').dump"
```

### Restoring from Backup
```powershell
pg_restore -U mev_user -d mev_research -v "backups/mev_research_YYYYMMDD_HHMMSS.dump"
```
