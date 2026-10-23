#!/usr/bin/env python3
import os
import sys
import pandas as pd
import numpy as np

from isolate_enhancements import simulate_unified_portfolio
from detect_overfitting import run_single_simulation, compute_metrics, DataCache

cached = DataCache.get("ETHUSDT")
df15, df5 = cached

# Let's inspect base vs enhanced trades
t_base = run_single_simulation("ETHUSDT")
df_t = pd.DataFrame(t_base)
print("=== BASE ETH TRADES ===")
print("Total:", len(df_t))
print("Win rate:", (df_t['pnl'] > 0).mean() * 100)
print("Total PnL:", df_t['pnl'].sum())
print("\nLoss trades breakdown:")
losses = df_t[df_t['pnl'] <= 0]
for idx, r in losses.head(10).iterrows():
    print(f"  {r['direction']} at {r['entry_p']:.1f}, SL: {r['sl']:.1f}, r_dist: {r['r_dist']:.1f}, bars: {r['bars']}, exit: {r['exit_reason']}, pnl: ${r['pnl']:.2f}")

print("\nWin trades breakdown:")
wins = df_t[df_t['pnl'] > 0]
for idx, r in wins.head(10).iterrows():
    print(f"  {r['direction']} at {r['entry_p']:.1f}, SL: {r['sl']:.1f}, r_dist: {r['r_dist']:.1f}, bars: {r['bars']}, exit: {r['exit_reason']}, pnl: ${r['pnl']:.2f}")
