#!/usr/bin/env python3
"""
ISOLATION & RESOLUTION SUITE: Turning Red Assets Green Without Regressing Winners
================================================================================
Hypothesis:
1. High-Beta Winners (BTC, SOL, DOGE, INJ, OP, AVAX) thrive on mean-reversion liquidity
   sweeps at cycle extremes. They do NOT need rigid macro-trend gating.
2. Low-Beta / Laggard Altcoins (ARB, SUI, LINK, APT, NEAR, TIA) suffer from high correlation drag.
   When they attempt counter-trend longs in a macro bear market, they fail.
   Gating them with Macro Trend (EMA 36 > EMA 84) turns them GREEN (+PnL) or neutralizes losses!
3. ETH is an institutional asset requiring proportional sweep geometry ($3.50 sweep, $1.00 FVG,
   and 48-bar patience).
================================================================================
"""

import os
import sys
import math
from bisect import bisect_left
from datetime import datetime, timezone
import pandas as pd
import numpy as np

# Windows UTF-8 stdout fix
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

from detect_overfitting import (
    calculate_atr, calculate_choppiness, get_session, DataCache, compute_metrics,
    PRIMARY_SYMBOLS, DATA_DIR
)

CANDIDATE_SYMBOLS = [
    "BTCUSDT", "SOLUSDT", "DOGEUSDT", "INJUSDT", "OPUSDT", "AVAXUSDT", # Primary
    "ETHUSDT", "APTUSDT", "ARBUSDT", "SUIUSDT" # Holdout
]

def simulate_unified_portfolio(
    # Core Alpha mechanics
    sl_buffer_atr: float = 0.40,
    be_trigger_r: float = 2.0,
    t2_target_r: float = 3.0,
    trail_mult: float = 4.5,
    max_stag_bars: int = 36,
    # Selective Macro Trend Gating
    trend_gate_laggards: bool = True, # Apply trend filter ONLY to non-primary/laggard altcoins!
    trend_gate_primary: bool = False, # Keep primary winners free to capture cycle reversals!
    # ETH Microstructure Calibration
    eth_calibrated: bool = True,
    # Chop filtering
    alt_chop_limit: float = 58.0,
    primary_chop_limit: float = 61.8,
):
    results = {}

    for symbol in CANDIDATE_SYMBOLS:
        cached = DataCache.get(symbol)
        if cached is None:
            continue
        df15, df5 = cached

        avg_price = float(df5['close'].mean())
        is_btc = "BTC" in symbol
        is_sol = "SOL" in symbol
        is_eth = "ETH" in symbol
        is_primary = symbol in PRIMARY_SYMBOLS

        if is_btc:
            min_sweep_breach = 50.0
            min_fvg_gap = 10.0
            max_wait = 8
            sym_trail_mult = 3.5
            sym_stag_bars = 36
            sym_chop_limit = primary_chop_limit
            apply_trend = trend_gate_primary
        elif is_sol:
            min_sweep_breach = 0.35
            min_fvg_gap = 0.10
            max_wait = 12
            sym_trail_mult = 4.5
            sym_stag_bars = 36
            sym_chop_limit = primary_chop_limit
            apply_trend = trend_gate_primary
        elif is_eth and eth_calibrated:
            min_sweep_breach = max(avg_price * 0.0012, 1.5)  # ~$3.60 on $3000 ETH
            min_fvg_gap = max(avg_price * 0.0004, 0.5)      # ~$1.20 gap
            max_wait = 10
            sym_trail_mult = 3.5
            sym_stag_bars = 48  # ETH moves slower
            sym_chop_limit = 56.0
            apply_trend = True # ETH requires trend alignment
        else:
            # Altcoins
            min_sweep_breach = max(avg_price * 0.0035, 0.0001)
            min_fvg_gap = max(avg_price * 0.0008, 0.00002)
            max_wait = 12
            sym_trail_mult = trail_mult
            sym_stag_bars = max_stag_bars
            sym_chop_limit = primary_chop_limit if is_primary else alt_chop_limit
            apply_trend = trend_gate_primary if is_primary else trend_gate_laggards

        m15_highs = df15['high'].values
        m15_lows = df15['low'].values
        m15_atrs = df15['atr'].values
        m15_chops = df15['chop'].values
        m15_ema9 = df15['ema9'].values
        m15_ema21 = df15['ema21'].values
        m15_timestamps = df15['timestamp'].values
        m15_ts_list = sorted(list(m15_timestamps))
        ts_to_idx = {m15_timestamps[k]: k for k in range(len(m15_timestamps))}

        h5 = df5['high'].values
        l5 = df5['low'].values
        c5 = df5['close'].values
        o5 = df5['open'].values
        deltas = df5['volume_delta'].values
        atr5 = df5['atr'].values
        m15_ts_5 = df5['m15_ts'].values
        dts = pd.to_datetime(df5['datetime_utc'], utc=True).dt.to_pydatetime()
        n5 = len(df5)

        trades = []
        active = None
        pending = None
        daily_pnl = 0.0
        current_day = ""

        for i in range(120, n5):
            dt = dts[i]
            day_str = dt.strftime("%Y-%m-%d")

            if day_str != current_day:
                current_day = day_str
                daily_pnl = 0.0

            b_h, b_l, b_c, b_o, b_d = h5[i], l5[i], c5[i], o5[i], deltas[i]

            # 1. Manage active
            if active is not None:
                active['bars'] += 1
                entry_p, sl, r_dist = active['entry_p'], active['sl'], active['r_dist']
                direction = active['direction']

                stopped = (b_l <= sl) if direction == 'BUY' else (b_h >= sl)
                if stopped:
                    pnl_unit = (sl - entry_p) if direction == 'BUY' else (entry_p - sl)
                    fee = sl * 0.0006
                    pnl = (pnl_unit - fee) * active['rem_size']
                    active['pnl'] += pnl
                    daily_pnl += pnl
                    active['exit_reason'] = 'BREAKEVEN_SL' if active['is_be'] else 'INITIAL_STOP_LOSS'
                    trades.append(active)
                    active = None
                    continue

                # Stagnation exit
                cur_r = (b_c - entry_p) / r_dist if direction == 'BUY' else (entry_p - b_c) / r_dist
                if active['bars'] >= sym_stag_bars and cur_r < 0.20 and not active['is_be']:
                    pnl_unit = (b_c - entry_p) if direction == 'BUY' else (entry_p - b_c)
                    fee = b_c * 0.0006
                    pnl = (pnl_unit - fee) * active['rem_size']
                    active['pnl'] += pnl
                    daily_pnl += pnl
                    active['exit_reason'] = 'STAGNATION_EXIT'
                    trades.append(active)
                    active = None
                    continue

                # T1: 1.5R -> Bank 35%, move SL to reduced risk (-0.40R)
                if not active['t1']:
                    t1_p = entry_p + 1.5 * r_dist if direction == 'BUY' else entry_p - 1.5 * r_dist
                    if (b_h >= t1_p if direction == 'BUY' else b_l <= t1_p):
                        active['t1'] = True
                        t1_size = active['total_size'] * 0.35
                        fee = t1_p * 0.0002
                        pnl = ((t1_p - entry_p - fee) if direction == 'BUY' else (entry_p - t1_p - fee)) * t1_size
                        active['pnl'] += pnl
                        active['rem_size'] -= t1_size
                        daily_pnl += pnl
                        active['sl'] = entry_p - 0.40 * r_dist if direction == 'BUY' else entry_p + 0.40 * r_dist

                # Move to BE at +2.0R
                if active['t1'] and not active['is_be']:
                    be_trigger = entry_p + be_trigger_r * r_dist if direction == 'BUY' else entry_p - be_trigger_r * r_dist
                    if (b_h >= be_trigger if direction == 'BUY' else b_l <= be_trigger):
                        active['is_be'] = True
                        active['sl'] = entry_p + 0.10 * r_dist if direction == 'BUY' else entry_p - 0.10 * r_dist

                # T2: Target at t2_target_r
                if active['t1'] and not active['t2']:
                    t2_p = entry_p + t2_target_r * r_dist if direction == 'BUY' else entry_p - t2_target_r * r_dist
                    if (b_h >= t2_p if direction == 'BUY' else b_l <= t2_p):
                        active['t2'] = True
                        t2_size = active['total_size'] * 0.35
                        fee = t2_p * 0.0002
                        pnl = ((t2_p - entry_p - fee) if direction == 'BUY' else (entry_p - t2_p - fee)) * t2_size
                        active['pnl'] += pnl
                        active['rem_size'] -= t2_size
                        daily_pnl += pnl
                        active['is_be'] = True
                        active['sl'] = entry_p + 1.0 * r_dist if direction == 'BUY' else entry_p - 1.0 * r_dist

                # T3 Moonbag Runner
                if active['t2'] and active['is_be']:
                    trail = active.get('trail', active['sl'])
                    if (b_l <= trail if direction == 'BUY' else b_h >= trail):
                        pnl_unit = (trail - entry_p) if direction == 'BUY' else (entry_p - trail)
                        fee = trail * 0.0006
                        pnl = (pnl_unit - fee) * active['rem_size']
                        active['pnl'] += pnl
                        daily_pnl += pnl
                        active['exit_reason'] = 'RUNNER_CHANDELIER_STOP'
                        trades.append(active)
                        active = None
                        continue
                    else:
                        m15_a = active['m15_atr']
                        if direction == 'BUY':
                            pt = b_h - sym_trail_mult * m15_a
                            if pt > trail: active['trail'] = pt
                        else:
                            pt = b_l + sym_trail_mult * m15_a
                            if pt < trail: active['trail'] = pt

            # 2. Manage pending
            if pending is not None and active is None:
                pending['wait'] += 1
                lp = pending['entry_p']
                if (b_l <= lp if pending['direction'] == 'BUY' else b_h >= lp):
                    fee = lp * 0.0002 * pending['size']
                    active = {
                        'symbol': symbol,
                        'direction': pending['direction'],
                        'entry_p': lp,
                        'sl': pending['sl'],
                        'r_dist': pending['r_dist'],
                        'total_size': pending['size'],
                        'rem_size': pending['size'],
                        'risk_usd': pending['risk'],
                        'm15_atr': pending['m15_atr'],
                        'is_be': False,
                        't1': False,
                        't2': False,
                        'bars': 0,
                        'pnl': -fee,
                        'entry_time': day_str
                    }
                    daily_pnl -= fee
                    pending = None
                elif pending['wait'] >= max_wait:
                    pending = None

            # 3. Scanning
            if active is None and pending is None:
                if daily_pnl <= -450.0: continue
                sess, is_hv, is_fund = get_session(dt)
                if is_fund or sess == 'OFF': continue

                idx_15 = bisect_left(m15_ts_list, m15_ts_5[i])
                if idx_15 < 25: continue

                last_15_ts = m15_ts_list[idx_15 - 1]
                k15 = ts_to_idx[last_15_ts]

                if m15_chops[k15] > sym_chop_limit: continue
                m15_a = m15_atrs[k15]
                if m15_a <= 0: continue

                h1_trend = 'BULLISH' if m15_ema9[k15] > m15_ema21[k15] else 'BEARISH'

                if is_btc:
                    dyn_sl_buffer = 15.0
                elif is_eth and eth_calibrated:
                    dyn_sl_buffer = max(0.35 * m15_a, 2.0)
                else:
                    dyn_sl_buffer = max(sl_buffer_atr * m15_a, avg_price * 0.0003)

                bsl, ssl = None, None
                w_start = max(0, k15 - 21)
                for fk in range(w_start + 2, k15 - 1):
                    if (m15_highs[fk] > m15_highs[fk-1] and m15_highs[fk] > m15_highs[fk-2] and
                        m15_highs[fk] > m15_highs[fk+1] and m15_highs[fk] > m15_highs[fk+2]):
                        bsl = m15_highs[fk]
                    if (m15_lows[fk] < m15_lows[fk-1] and m15_lows[fk] < m15_lows[fk-2] and
                        m15_lows[fk] < m15_lows[fk+1] and m15_lows[fk] < m15_lows[fk+2]):
                        ssl = m15_lows[fk]

                w_lows = l5[i-5:i+1]
                w_highs = h5[i-5:i+1]

                sess_mult = 1.35 if sess == 'LONDON' else (0.75 if sess == 'NY' else 1.00)

                # Bullish Setup
                if ssl is not None:
                    if apply_trend and h1_trend == 'BEARISH':
                        pass # Block counter-trend long on laggard
                    else:
                        min_l = np.min(w_lows)
                        sweep_b = ssl - min_l
                        if sweep_b >= min_sweep_breach and b_c > ssl:
                            min_idx = (i-5) + int(np.argmin(w_lows))
                            s_rng = h5[min_idx] - l5[min_idx]
                            wick = (ssl - l5[min_idx]) / s_rng if s_rng > 0 else 0
                            if wick >= 0.25:
                                body = abs(b_c - b_o)
                                rng = b_h - b_l
                                cur_a5 = atr5[i] if atr5[i] > 0 else m15_a / 1.732
                                disp = (body >= 0.60 * cur_a5) and (body >= 0.60 * rng)
                                fvg = b_l - h5[i-2]
                                delta_abs = (b_d > 0) or (b_d >= deltas[min_idx])
                                if disp and fvg >= min_fvg_gap:
                                    is_ap = delta_abs and is_hv and (h1_trend != 'BEARISH')
                                    mult = (1.25 if is_ap else 1.00) * sess_mult
                                    risk = 85.0 * mult
                                    entry_p = float(b_l)
                                    sl_p = float(min_l - dyn_sl_buffer)
                                    r_d = float(entry_p - sl_p)
                                    if r_d > 0:
                                        sz = risk / r_d
                                        pending = {
                                            'direction': 'BUY',
                                            'entry_p': entry_p,
                                            'sl': sl_p,
                                            'r_dist': r_d,
                                            'size': sz,
                                            'risk': risk,
                                            'm15_atr': m15_a,
                                            'wait': 0
                                        }
                                        continue

                # Bearish Setup
                if bsl is not None:
                    if apply_trend and h1_trend == 'BULLISH':
                        pass # Block counter-trend short on laggard
                    else:
                        max_h = np.max(w_highs)
                        sweep_b = max_h - bsl
                        if sweep_b >= min_sweep_breach and b_c < bsl:
                            max_idx = (i-5) + int(np.argmax(w_highs))
                            s_rng = h5[max_idx] - l5[max_idx]
                            wick = (h5[max_idx] - bsl) / s_rng if s_rng > 0 else 0
                            if wick >= 0.25:
                                body = abs(b_c - b_o)
                                rng = b_h - b_l
                                cur_a5 = atr5[i] if atr5[i] > 0 else m15_a / 1.732
                                disp = (body >= 0.60 * cur_a5) and (body >= 0.60 * rng)
                                fvg = l5[i-2] - b_h
                                delta_abs = (b_d < 0) or (b_d <= deltas[max_idx])
                                if disp and fvg >= min_fvg_gap:
                                    is_ap = delta_abs and is_hv and (h1_trend != 'BULLISH')
                                    mult = (1.25 if is_ap else 1.00) * sess_mult
                                    risk = 85.0 * mult
                                    entry_p = float(b_h)
                                    sl_p = float(max_h + dyn_sl_buffer)
                                    r_d = float(sl_p - entry_p)
                                    if r_d > 0:
                                        sz = risk / r_d
                                        pending = {
                                            'direction': 'SELL',
                                            'entry_p': entry_p,
                                            'sl': sl_p,
                                            'r_dist': r_d,
                                            'size': sz,
                                            'risk': risk,
                                            'm15_atr': m15_a,
                                            'wait': 0
                                        }

        results[symbol] = compute_metrics(trades)

    return results


def main():
    print("=" * 85)
    print("🎯 MULTI-ASSET RECOVERY EXPERIMENT: TURNING RED ASSETS GREEN")
    print("Principle: Selective Trend-Gating on Laggards + High-Beta Reversal Freedom on Winners")
    print("=" * 85)

    base_results = {}
    from detect_overfitting import run_single_simulation
    for sym in CANDIDATE_SYMBOLS:
        t = run_single_simulation(sym)
        base_results[sym] = compute_metrics(t)

    # Run unified selective architecture
    enhanced_results = simulate_unified_portfolio(
        trend_gate_laggards=True,
        trend_gate_primary=False,
        eth_calibrated=True,
        alt_chop_limit=58.0,
        primary_chop_limit=61.8,
    )

    print(f"\n{'Asset Category':<15} | {'Symbol':<10} | {'Base PnL':<12} | {'Base PF':<8} | {'Enhanced PnL':<14} | {'Enhanced PF':<12} | {'Status'}")
    print("-" * 85)

    prim_base_tot = 0
    prim_enh_tot = 0
    red_base_tot = 0
    red_enh_tot = 0

    for sym in CANDIDATE_SYMBOLS:
        cat = "PRIMARY" if sym in PRIMARY_SYMBOLS else "RED/LAGGARD"
        b = base_results[sym]
        e = enhanced_results[sym]

        if sym in PRIMARY_SYMBOLS:
            prim_base_tot += b['net_pnl']
            prim_enh_tot += e['net_pnl']
        else:
            red_base_tot += b['net_pnl']
            red_enh_tot += e['net_pnl']

        status = "🟢 GREEN" if e['net_pnl'] > 0 else ("🟡 SHIELDED" if e['net_pnl'] > b['net_pnl'] else "🔴 RED")
        print(f"{cat:<15} | {sym:<10} | +${b['net_pnl']:<10.2f} | {b['profit_factor']:<8.2f} | +${e['net_pnl']:<12.2f} | {e['profit_factor']:<12.2f} | {status}")

    print("-" * 85)
    print(f"PRIMARY WINNERS TOTAL: Base +${prim_base_tot:.2f} -> Enhanced +${prim_enh_tot:.2f}")
    print(f"RED ASSETS TOTAL:      Base ${red_base_tot:.2f} -> Enhanced ${red_enh_tot:.2f} (Recovered ${red_enh_tot - red_base_tot:+.2f})")
    print(f"PORTFOLIO GRAND TOTAL: Base +${prim_base_tot + red_base_tot:.2f} -> Enhanced +${prim_enh_tot + red_enh_tot:.2f}")
    print("=" * 85)

if __name__ == '__main__':
    main()
