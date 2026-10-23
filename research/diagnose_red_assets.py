#!/usr/bin/env python3
"""
Forensic diagnosis of the RED / failing assets:
ETH, APT, TIA, ARB, and the other losing altcoins.
Examines:
  1. Long vs Short win rates and PnL
  2. Exit reason breakdown (Stop loss vs BE vs Stagnation)
  3. Trend alignment (H1/H4 macro regime)
  4. Stop distance / ATR buffer adequacy
"""

import os
import sys
import pandas as pd
import numpy as np

# Windows UTF-8 stdout fix
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

from detect_overfitting import run_single_simulation, compute_metrics, HOLDOUT_SYMBOLS, PRIMARY_SYMBOLS

ALL_DIAG_SYMBOLS = ["ETHUSDT", "APTUSDT", "ARBUSDT", "SUIUSDT"]

def diagnose_symbol(sym):
    trades = run_single_simulation(sym)
    m = compute_metrics(trades)
    print(f"\n========================================================")
    print(f"📊 DIAGNOSTIC: {sym}")
    print(f"Total Trades: {m['trades']}, Win Rate: {m['win_rate']:.1f}%, Net PnL: ${m['net_pnl']:.2f}, PF: {m['profit_factor']:.2f}")
    
    if not trades:
        return
        
    df = pd.DataFrame(trades)
    
    # 1. Long vs Short breakdown
    longs = df[df['direction'] == 'BUY']
    shorts = df[df['direction'] == 'SELL']
    
    l_pnl = longs['pnl'].sum() if len(longs) > 0 else 0
    s_pnl = shorts['pnl'].sum() if len(shorts) > 0 else 0
    l_wr = (longs['pnl'] > 0).mean() * 100 if len(longs) > 0 else 0
    s_wr = (shorts['pnl'] > 0).mean() * 100 if len(shorts) > 0 else 0
    
    print(f"\n[Directional Breakdown]")
    print(f"  LONGS:  {len(longs)} trades | Win Rate: {l_wr:.1f}% | Net PnL: ${l_pnl:.2f}")
    print(f"  SHORTS: {len(shorts)} trades | Win Rate: {s_wr:.1f}% | Net PnL: ${s_pnl:.2f}")
    
    # 2. Exit Reason breakdown
    print(f"\n[Exit Reason Breakdown]")
    for reason, grp in df.groupby('exit_reason'):
        r_pnl = grp['pnl'].sum()
        r_count = len(grp)
        r_wr = (grp['pnl'] > 0).mean() * 100
        print(f"  {reason:<25}: {r_count:>3} trades | WR: {r_wr:>5.1f}% | Net PnL: ${r_pnl:>8.2f}")
        
    # 3. Maximum favorable excursion (did trade reach +1R before stopping out?)
    # We can inspect r_dist vs m15_atr
    avg_r_dist = df['r_dist'].mean()
    avg_m15_atr = df['m15_atr'].mean()
    print(f"\n[Geometry Metrics]")
    print(f"  Avg Risk Distance (SL gap): {avg_r_dist:.4f}")
    print(f"  Avg M15 ATR:               {avg_m15_atr:.4f}")
    print(f"  SL / ATR Ratio:            {avg_r_dist / avg_m15_atr:.2f}x")

def main():
    print("=" * 70)
    print("🔬 FORENSIC INVESTIGATION OF FAILING / RED ASSETS")
    print("=" * 70)
    for sym in ALL_DIAG_SYMBOLS:
        diagnose_symbol(sym)

if __name__ == '__main__':
    main()
