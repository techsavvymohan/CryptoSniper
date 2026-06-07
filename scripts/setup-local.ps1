# Non-credential local setup (SETUP.md Steps 1-5)
# Run from project root: .\scripts\setup-local.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

Write-Host "=== Step 1: Check prerequisites ===" -ForegroundColor Cyan
node --version
pnpm --version

$pg = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue
if (-not $pg -or $pg.Status -ne "Running") {
    Write-Error "PostgreSQL is not running. Install and start it (SETUP.md Step 1c)."
}
Write-Host "PostgreSQL: $($pg.Name) - $($pg.Status)"

& "$PSScriptRoot\start-redis.ps1"

Write-Host "`n=== Step 2: Install dependencies ===" -ForegroundColor Cyan
pnpm install

Write-Host "`n=== Step 3: Ensure database exists ===" -ForegroundColor Cyan
$psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"
if (Test-Path $psql) {
    $env:PGPASSWORD = "postgres"
    & $psql -U postgres -h localhost -tc "SELECT 1 FROM pg_roles WHERE rolname='mev_user'" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Create mev_user manually if needed (see SETUP.md Step 1d)"
    }
}

Write-Host "`n=== Step 4: Migrate database ===" -ForegroundColor Cyan
pnpm migrate

Write-Host "`n=== Step 5: Build project ===" -ForegroundColor Cyan
pnpm build

Write-Host "`n=== Setup complete (non-credential steps) ===" -ForegroundColor Green
Write-Host @"

Before starting the bot, add these to .env:
  HELIUS_API_KEY          -> https://dashboard.helius.dev/
  TELEGRAM_BOT_TOKEN      -> @BotFather on Telegram
  TELEGRAM_ADMIN_CHAT_ID  -> @userinfobot on Telegram
  BOT_WALLET_PRIVATE_KEY  -> your real wallet (optional for sim with generated key)

Then run:
  pnpm start

Dashboard (second terminal):
  cd apps\dashboard
  pnpm dev
"@
