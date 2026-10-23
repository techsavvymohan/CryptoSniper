@echo off
title The Godfather Quantitative Trading Bot
color 0A
cls

echo =============================================================================
echo   THE GODFATHER QUANTITATIVE TRADING BOT (WINDOWS LAUNCHER)
echo   Mode: Standalone In-Memory (Zero PostgreSQL / Zero Redis Required)
echo =============================================================================
echo.

if not exist .env (
    echo [WARNING] .env file not found. Creating default from .env.example...
    copy .env.example .env
    echo [INFO] .env created. Please configure your API keys in .env if needed.
    echo.
)

echo Starting trading bot in standalone mode...
echo Press CTRL+C at any time to stop trading safely.
echo.

call pnpm start

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Bot exited with error code %ERRORLEVEL%.
    pause
)
