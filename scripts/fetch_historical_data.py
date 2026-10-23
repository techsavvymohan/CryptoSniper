#!/usr/bin/env python3
"""
Institutional Historical Futures Data Downloader for Quantitative Backtesting.
Downloads Binance USDT-M Perpetual Futures OHLCV + Order Flow Delta for BTCUSDT and SOLUSDT.
Date Range: January 1, 2026 to September 30, 2026.
"""

import os
import sys
import time
from datetime import datetime, timezone
import requests
import pandas as pd

# Fix Windows cp1252 stdout encoding
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

API_ENDPOINT = "https://fapi.binance.com/fapi/v1/klines"
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "historical")

# Target Date Range: 2026-01-01 00:00:00 UTC to 2026-09-30 23:59:59 UTC
START_DT = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
END_DT = datetime(2026, 9, 30, 23, 59, 59, tzinfo=timezone.utc)
START_MS = int(START_DT.timestamp() * 1000)
END_MS = int(END_DT.timestamp() * 1000)

SYMBOLS = [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "DOGEUSDT",
    "SUIUSDT",
    "AVAXUSDT",
    "NEARUSDT",
    "LINKUSDT",
    "APTUSDT",
    "ARBUSDT",
    "OPUSDT",
    "WIFUSDT",
    "1000PEPEUSDT",
    "TIAUSDT",
    "INJUSDT",
]
TIMEFRAMES = ["15m", "5m"]


def fetch_klines(symbol: str, interval: str, start_time: int, end_time: int) -> pd.DataFrame:
    """
    Paginates through Binance Futures klines API to fetch complete contiguous candle history.
    """
    print(f"\n=============================================================================")
    print(f"📥 Fetching {symbol} [{interval}] from {START_DT.strftime('%Y-%m-%d')} to {END_DT.strftime('%Y-%m-%d')}")
    print(f"=============================================================================")

    current_start = start_time
    all_candles = []
    batch_count = 0

    session = requests.Session()
    session.headers.update({"User-Agent": "InstitutionalQuantBacktester/1.0"})

    while current_start < end_time:
        params = {
            "symbol": symbol,
            "interval": interval,
            "startTime": current_start,
            "endTime": end_time,
            "limit": 1500,
        }

        try:
            resp = session.get(API_ENDPOINT, params=params, timeout=15)
            if resp.status_code != 200:
                print(f"⚠️ Error {resp.status_code}: {resp.text}. Retrying in 2s...")
                time.sleep(2)
                continue

            data = resp.json()
            if not data or not isinstance(data, list):
                print(f"ℹ️ No more data returned. Ending pagination.")
                break

            for row in data:
                open_time = int(row[0])
                if open_time > end_time:
                    continue

                open_p = float(row[1])
                high_p = float(row[2])
                low_p = float(row[3])
                close_p = float(row[4])
                volume = float(row[5])
                close_time = int(row[6])
                quote_vol = float(row[7])
                trade_count = int(row[8])
                taker_buy_vol = float(row[9])
                taker_buy_quote = float(row[10])

                taker_sell_vol = max(0.0, volume - taker_buy_vol)
                volume_delta = taker_buy_vol - taker_sell_vol
                delta_ratio = volume_delta / volume if volume > 0 else 0.0

                all_candles.append({
                    "timestamp": open_time,
                    "datetime_utc": datetime.fromtimestamp(open_time / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
                    "open": open_p,
                    "high": high_p,
                    "low": low_p,
                    "close": close_p,
                    "volume": volume,
                    "quote_volume": quote_vol,
                    "trades": trade_count,
                    "taker_buy_volume": taker_buy_vol,
                    "taker_sell_volume": taker_sell_vol,
                    "volume_delta": volume_delta,
                    "delta_ratio": round(delta_ratio, 4),
                })

            last_open = int(data[-1][0])
            batch_count += 1
            last_date_str = datetime.fromtimestamp(last_open / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
            print(f"  [Batch {batch_count:02d}] Fetched {len(data)} candles | Up to: {last_date_str} (Total: {len(all_candles):,})", end="\r")

            # Advance timestamp by 1 ms past last close or last open
            next_start = last_open + 1
            if next_start <= current_start:
                break
            current_start = next_start

            # Gentle rate limiting
            time.sleep(0.08)

        except Exception as e:
            print(f"\n❌ Network error: {e}. Retrying in 2 seconds...")
            time.sleep(2)

    print()
    df = pd.DataFrame(all_candles)
    if df.empty:
        print(f"❌ No records found for {symbol} {interval}!")
        return df

    # Drop any possible duplicate timestamps
    df = df.drop_duplicates(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)
    return df


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    print(f"📂 Historical Data Directory: {DATA_DIR}")

    summary_records = []

    for symbol in SYMBOLS:
        for tf in TIMEFRAMES:
            filename = f"{symbol}_{tf}_2026_01_to_2026_09.csv"
            filepath = os.path.join(DATA_DIR, filename)

            # Check if file already exists and is complete
            if os.path.exists(filepath):
                try:
                    df = pd.read_csv(filepath)
                    min_req = 25000 if tf == "15m" else 75000
                    if len(df) >= min_req:
                        file_size_mb = os.path.getsize(filepath) / (1024 * 1024)
                        summary_records.append({
                            "Symbol": symbol,
                            "Timeframe": tf,
                            "Candles": len(df),
                            "Start Date": df["datetime_utc"].iloc[0],
                            "End Date": df["datetime_utc"].iloc[-1],
                            "Min Price": f"${df['low'].min():,.4f}",
                            "Max Price": f"${df['high'].max():,.4f}",
                            "File Size": f"{file_size_mb:.2f} MB",
                            "Path": filename,
                        })
                        print(f"⚡ Already cached: {filename} ({len(df):,} rows, {file_size_mb:.2f} MB)")
                        continue
                except Exception:
                    pass

            df = fetch_klines(symbol, tf, START_MS, END_MS)
            if df.empty:
                continue

            df.to_csv(filepath, index=False)

            file_size_mb = os.path.getsize(filepath) / (1024 * 1024)
            min_date = df["datetime_utc"].iloc[0]
            max_date = df["datetime_utc"].iloc[-1]
            min_price = df["low"].min()
            max_price = df["high"].max()

            summary_records.append({
                "Symbol": symbol,
                "Timeframe": tf,
                "Candles": len(df),
                "Start Date": min_date,
                "End Date": max_date,
                "Min Price": f"${min_price:,.4f}",
                "Max Price": f"${max_price:,.4f}",
                "File Size": f"{file_size_mb:.2f} MB",
                "Path": filename,
            })

            print(f"✅ Saved: {filename} ({len(df):,} rows, {file_size_mb:.2f} MB)")

    print("\n" + "=" * 80)
    print("📊 HISTORICAL FUTURES BACKTEST DATASET SUMMARY (JAN 2026 - SEP 2026)")
    print("=" * 80)
    summary_df = pd.DataFrame(summary_records)
    print(summary_df.to_string(index=False))
    print("=" * 80)
    print("🎯 Data download complete and ready for Godfather SMC Backtesting!\n")


if __name__ == "__main__":
    main()
