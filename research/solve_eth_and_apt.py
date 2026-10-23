#!/usr/bin/env python3
"""
Targeted solution for ETH and APT:
Test Target R1 = 1.0R (vs 1.5R) and tight structure for low-volatility / institutional assets.
"""
import os
import sys
import pandas as pd
import numpy as np

from detect_overfitting import (
    DataCache, compute_metrics, get_session
)
from bisect import bisect_left

def test_eth_parameters(
    t1_r: float = 1.0,
    t2_r: float = 2.0,
    be_r: float = 1.4,
    stag_bars: int = 48,
    trail_mult: float = 2.5,
):
    cached = DataCache.get("ETHUSDT")
    df15, df5 = cached
    
    avg_price = float(df5['close'].mean())
    min_sweep_breach = 3.0
    min_fvg_gap = 0.80
    max_wait = 10
    
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

            cur_r = (b_c - entry_p) / r_dist if direction == 'BUY' else (entry_p - b_c) / r_dist
            if active['bars'] >= stag_bars and cur_r < 0.20 and not active['is_be']:
                pnl_unit = (b_c - entry_p) if direction == 'BUY' else (entry_p - b_c)
                fee = b_c * 0.0006
                pnl = (pnl_unit - fee) * active['rem_size']
                active['pnl'] += pnl
                daily_pnl += pnl
                active['exit_reason'] = 'STAGNATION_EXIT'
                trades.append(active)
                active = None
                continue

            # T1: t1_r (e.g. 1.0R)
            if not active['t1']:
                t1_p = entry_p + t1_r * r_dist if direction == 'BUY' else entry_p - t1_r * r_dist
                if (b_h >= t1_p if direction == 'BUY' else b_l <= t1_p):
                    active['t1'] = True
                    t1_size = active['total_size'] * 0.40
                    fee = t1_p * 0.0002
                    pnl = ((t1_p - entry_p - fee) if direction == 'BUY' else (entry_p - t1_p - fee)) * t1_size
                    active['pnl'] += pnl
                    active['rem_size'] -= t1_size
                    daily_pnl += pnl
                    active['sl'] = entry_p - 0.20 * r_dist if direction == 'BUY' else entry_p + 0.20 * r_dist

            # Move to BE at be_r
            if active['t1'] and not active['is_be']:
                be_trigger = entry_p + be_r * r_dist if direction == 'BUY' else entry_p - be_r * r_dist
                if (b_h >= be_trigger if direction == 'BUY' else b_l <= be_trigger):
                    active['is_be'] = True
                    active['sl'] = entry_p + 0.05 * r_dist if direction == 'BUY' else entry_p - 0.05 * r_dist

            # T2: t2_r (e.g. 2.0R)
            if active['t1'] and not active['t2']:
                t2_p = entry_p + t2_r * r_dist if direction == 'BUY' else entry_p - t2_r * r_dist
                if (b_h >= t2_p if direction == 'BUY' else b_l <= t2_p):
                    active['t2'] = True
                    t2_size = active['total_size'] * 0.35
                    fee = t2_p * 0.0002
                    pnl = ((t2_p - entry_p - fee) if direction == 'BUY' else (entry_p - t2_p - fee)) * t2_size
                    active['pnl'] += pnl
                    active['rem_size'] -= t2_size
                    daily_pnl += pnl
                    active['is_be'] = True
                    active['sl'] = entry_p + 0.8 * r_dist if direction == 'BUY' else entry_p - 0.8 * r_dist

            # Runner
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
                        pt = b_h - trail_mult * m15_a
                        if pt > trail: active['trail'] = pt
                    else:
                        pt = b_l + trail_mult * m15_a
                        if pt < trail: active['trail'] = pt

        # 2. Manage pending
        if pending is not None and active is None:
            pending['wait'] += 1
            lp = pending['entry_p']
            if (b_l <= lp if pending['direction'] == 'BUY' else b_h >= lp):
                fee = lp * 0.0002 * pending['size']
                active = {
                    'symbol': 'ETHUSDT',
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

            if m15_chops[k15] > 55.0: continue
            m15_a = m15_atrs[k15]
            if m15_a <= 0: continue

            h1_trend = 'BULLISH' if m15_ema9[k15] > m15_ema21[k15] else 'BEARISH'
            dyn_sl_buffer = max(0.25 * m15_a, 1.5)

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

            # Bullish
            if ssl is not None:
                if h1_trend != 'BEARISH':
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
                            disp = (body >= 0.50 * cur_a5) and (body >= 0.50 * rng)
                            fvg = b_l - h5[i-2]
                            delta_abs = (b_d > 0) or (b_d >= deltas[min_idx])
                            if disp and fvg >= min_fvg_gap:
                                mult = 1.25 * sess_mult
                                risk = 85.0 * mult
                                entry_p = float(b_l)
                                sl_p = float(min_l - dyn_sl_buffer)
                                r_d = float(entry_p - sl_p)
                                if 3.0 <= r_d <= 25.0:  # Cap risk distance to realistic ETH moves!
                                    sz = risk / r_d
                                    pending = {
                                        'direction': 'BUY', 'entry_p': entry_p, 'sl': sl_p,
                                        'r_dist': r_d, 'size': sz, 'risk': risk,
                                        'm15_atr': m15_a, 'wait': 0
                                    }
                                    continue

            # Bearish
            if bsl is not None:
                if h1_trend != 'BULLISH':
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
                            disp = (body >= 0.50 * cur_a5) and (body >= 0.50 * rng)
                            fvg = l5[i-2] - b_h
                            delta_abs = (b_d < 0) or (b_d <= deltas[max_idx])
                            if disp and fvg >= min_fvg_gap:
                                mult = 1.25 * sess_mult
                                risk = 85.0 * mult
                                entry_p = float(b_h)
                                sl_p = float(max_h + dyn_sl_buffer)
                                r_d = float(sl_p - entry_p)
                                if 3.0 <= r_d <= 25.0:  # Cap risk distance!
                                    sz = risk / r_d
                                    pending = {
                                        'direction': 'SELL', 'entry_p': entry_p, 'sl': sl_p,
                                        'r_dist': r_d, 'size': sz, 'risk': risk,
                                        'm15_atr': m15_a, 'wait': 0
                                    }

    return compute_metrics(trades)

print("Testing ETH with Target 1 = 1.0R, BE = 1.4R, Target 2 = 2.0R, capped SL distance (<= 25):")
for t1 in [0.8, 1.0, 1.2]:
    for t2 in [1.8, 2.2, 2.5]:
        m = test_eth_parameters(t1_r=t1, t2_r=t2, be_r=t1 + 0.3)
        print(f"  T1 = {t1}R, T2 = {t2}R -> PnL: ${m['net_pnl']:.2f}, PF: {m['profit_factor']:.2f}, WR: {m['win_rate']:.1f}%, Trades: {m['trades']}")
