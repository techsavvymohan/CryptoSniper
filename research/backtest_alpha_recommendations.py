#!/usr/bin/env python3
"""
=============================================================================
RESEARCH BACKTESTER: ADAPTIVE ALPHA REGIME-SWITCHING & HIGH-FREQUENCY SCALPER
Testing High-Frequency (~15-25 trades/day) on the 7 Proven Alpha Winners:
[BTC, DOGE, INJ, OP, SOL, AVAX, APT]
Zero Production Code Touched | Real Binance Futures Jan 2026 - Sep 2026
=============================================================================
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

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "historical")

# =============================================================================
# RISK & PORTFOLIO PARAMETERS
# =============================================================================
INITIAL_EQUITY = 10000.0
BASE_RISK_PCT = 0.0085       # 0.85% base risk per trade
CONVICTION_A_PLUS = 1.25     # 1.25x for Unicorn A+ setups
CONVICTION_A = 1.00          # 1.00x for Standard A setups
CONVICTION_B = 0.50          # 0.50x for B setups
WEEKEND_DAMPENER = 0.50

MAKER_FEE_BPS = 2.0          # 0.02% maker fee
TAKER_FEE_BPS = 5.0          # 0.05% taker fee
SLIPPAGE_BPS = 1.0           # 0.01% conservative market execution slippage

DAILY_LOSS_LIMIT_PCT = 0.045 # -4.50% hard daily stop
MAX_CONCURRENT_POSITIONS = 5 # Portfolio net risk gate

# The 7 Proven Alpha Winners
ALPHA_SYMBOLS = [
    "BTCUSDT",
    "DOGEUSDT",
    "INJUSDT",
    "OPUSDT",
    "SOLUSDT",
    "AVAXUSDT",
    "APTUSDT",
]


# =============================================================================
# MATHEMATICAL INDICATORS
# =============================================================================

def calculate_atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    high = df['high'].values
    low = df['low'].values
    close = df['close'].values
    n = len(df)
    tr = np.zeros(n)
    tr[0] = high[0] - low[0]
    for i in range(1, n):
        tr[i] = max(high[i] - low[i], abs(high[i] - close[i - 1]), abs(low[i] - close[i - 1]))
    
    atr = np.zeros(n)
    if n < period:
        atr[:] = np.mean(tr)
        return pd.Series(atr, index=df.index)
    
    atr[period - 1] = np.mean(tr[:period])
    for i in range(period, n):
        atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period
    for i in range(period - 1):
        atr[i] = atr[period - 1]
    return pd.Series(atr, index=df.index)


def calculate_choppiness(df: pd.DataFrame, period: int = 14) -> pd.Series:
    high = df['high'].values
    low = df['low'].values
    close = df['close'].values
    n = len(df)
    tr = np.zeros(n)
    tr[0] = high[0] - low[0]
    for i in range(1, n):
        tr[i] = max(high[i] - low[i], abs(high[i] - close[i - 1]), abs(low[i] - close[i - 1]))
    
    chop = np.full(n, 50.0)
    log10_period = math.log10(period)
    
    for i in range(period, n):
        tr_sum = np.sum(tr[i - period + 1 : i + 1])
        max_h = np.max(high[i - period + 1 : i + 1])
        min_l = np.min(low[i - period + 1 : i + 1])
        rng = max_h - min_l
        if rng > 0 and tr_sum > 0:
            c_val = 100.0 * (math.log10(tr_sum / rng) / log10_period)
            chop[i] = max(0.0, min(100.0, c_val))
        else:
            chop[i] = 100.0
    return pd.Series(chop, index=df.index)


def get_session_info(dt: datetime):
    hour = dt.hour
    minute = dt.minute
    day = dt.weekday()
    is_weekend = (day >= 5)

    session_name = "OFF_SESSION"
    is_high_volume = False

    # London Killzone (07:00 - 10:00 UTC)
    if 7 <= hour < 10:
        session_name = "LONDON_KILLZONE"
        is_high_volume = True
    # US ETF & Cash Open (13:30 - 17:00 UTC)
    elif (hour == 13 and minute >= 30) or (14 <= hour < 17):
        session_name = "US_ETF_SESSION"
        is_high_volume = True
    # Asia Open (00:00 - 04:00 UTC)
    elif 0 <= hour < 4:
        session_name = "ASIA_OPEN"
        is_high_volume = True
    # Afternoon US Institutional Close (18:00 - 20:00 UTC)
    elif 18 <= hour < 20:
        session_name = "US_CLOSE"
        is_high_volume = True

    # 8-Hour Funding Blackout (+- 10 min around 00:00, 08:00, 16:00 UTC)
    is_funding_blackout = False
    for r_hour in [0, 8, 16]:
        prev_hour = (r_hour - 1 + 24) % 24
        if (hour == prev_hour and minute >= 50) or (hour == r_hour and minute <= 10):
            is_funding_blackout = True
            break

    return session_name, is_high_volume, is_weekend, is_funding_blackout


# =============================================================================
# HIGH-FREQUENCY ADAPTIVE ALPHA SIMULATOR (OPTIMIZED NUMPY ENGINE)
# =============================================================================

class HighFrequencyAlphaSimulator:
    def __init__(self, symbol: str, df_15m: pd.DataFrame, df_5m: pd.DataFrame):
        self.symbol = symbol
        self.df_15m = df_15m.copy()
        self.df_5m = df_5m.copy()

        self.equity = INITIAL_EQUITY
        self.peak_equity = INITIAL_EQUITY
        self.daily_pnl = 0.0
        self.current_day_str = ""

        self.trades = []
        self.equity_curve = []

        # Asset profile
        avg_price = float(self.df_5m['close'].mean())
        self.is_btc = "BTC" in symbol.upper()
        self.is_sol = "SOL" in symbol.upper()

        if self.is_btc:
            self.min_sweep_ratio = 0.0006 # ~$50 on $85k
            self.sl_buffer_ratio = 0.0002 # ~$15
            self.min_fvg_ratio = 0.00015  # ~$10
            self.decimals = 4
        elif self.is_sol:
            self.min_sweep_ratio = 0.0035 # ~$0.35 on $100
            self.sl_buffer_ratio = 0.0020 # ~$0.20
            self.min_fvg_ratio = 0.0010   # ~$0.10
            self.decimals = 2
        else:
            self.min_sweep_ratio = 0.0030
            self.sl_buffer_ratio = 0.0015
            self.min_fvg_ratio = 0.0008
            if avg_price >= 1000:
                self.decimals = 3
            elif avg_price >= 10:
                self.decimals = 2
            elif avg_price >= 1:
                self.decimals = 1
            else:
                self.decimals = 0

    def prepare_data(self):
        self.df_15m['dt'] = pd.to_datetime(self.df_15m['datetime_utc'], utc=True)
        self.df_5m['dt'] = pd.to_datetime(self.df_5m['datetime_utc'], utc=True)

        self.df_15m['atr'] = calculate_atr(self.df_15m, 14)
        self.df_15m['chop'] = calculate_choppiness(self.df_15m, 14)
        self.df_5m['atr'] = calculate_atr(self.df_5m, 14)
        self.df_5m['m15_timestamp'] = (self.df_5m['timestamp'] // (15 * 60 * 1000)) * (15 * 60 * 1000)

    def run(self):
        self.prepare_data()

        # Pre-extract arrays for blazing-fast C-speed execution
        highs = self.df_5m['high'].values
        lows = self.df_5m['low'].values
        closes = self.df_5m['close'].values
        opens = self.df_5m['open'].values
        deltas = self.df_5m['volume_delta'].values
        atrs_5m = self.df_5m['atr'].values
        timestamps = self.df_5m['timestamp'].values
        datetimes = self.df_5m['datetime_utc'].values
        m15_ts_arr = self.df_5m['m15_timestamp'].values
        dts = self.df_5m['dt'].dt.to_pydatetime()

        m15_timestamps = self.df_15m['timestamp'].values
        m15_atrs = self.df_15m['atr'].values
        m15_chops = self.df_15m['chop'].values
        m15_dict = {
            m15_timestamps[k]: (m15_atrs[k], m15_chops[k]) 
            for k in range(len(m15_timestamps))
        }
        sorted_m15_ts = sorted(list(m15_dict.keys()))

        pending_order = None
        active_trade = None

        start_idx = 40 * 3 # Burn-in
        n_bars = len(self.df_5m)

        for i in range(start_idx, n_bars):
            dt = dts[i]
            day_str = dt.strftime("%Y-%m-%d")
            b_high = highs[i]
            b_low = lows[i]
            b_close = closes[i]
            b_open = opens[i]
            b_delta = deltas[i]
            b_dt_str = datetimes[i]
            b_ts = timestamps[i]

            # Daily circuit breaker reset
            if day_str != self.current_day_str:
                self.current_day_str = day_str
                self.daily_pnl = 0.0

            self.peak_equity = max(self.peak_equity, self.equity)
            self.equity_curve.append({
                "timestamp": b_ts,
                "datetime_utc": b_dt_str,
                "equity": self.equity,
                "peak_equity": self.peak_equity,
                "drawdown_pct": (self.peak_equity - self.equity) / self.peak_equity,
            })

            # -----------------------------------------------------------------
            # 1. EVALUATE ACTIVE 3-TRANCHE POSITION
            # -----------------------------------------------------------------
            if active_trade is not None:
                active_trade['bars_held'] += 1
                tr = active_trade
                direction = tr['direction']
                entry_p = tr['entry_price']
                sl_p = tr['stop_loss']
                r_dist = tr['r_dist']
                m15_atr = tr['m15_atr']

                # Stop loss
                stopped_out = (b_low <= sl_p) if direction == 'BUY' else (b_high >= sl_p)
                if stopped_out:
                    exit_price = sl_p
                    exit_fee = exit_price * (TAKER_FEE_BPS + SLIPPAGE_BPS) / 10000.0
                    pnl_unit = (exit_price - entry_p - exit_fee) if direction == 'BUY' else (entry_p - exit_price - exit_fee)
                    realized_pnl = pnl_unit * tr['remaining_size']
                    tr['total_realized_pnl'] += realized_pnl
                    tr['remaining_size'] = 0.0
                    tr['exit_time'] = b_dt_str
                    tr['exit_reason'] = "BREAKEVEN_SL" if tr['is_breakeven'] else "INITIAL_STOP_LOSS"
                    
                    self.equity += realized_pnl
                    self.daily_pnl += realized_pnl
                    self.trades.append(tr)
                    active_trade = None
                    continue

                # Stagnation exit: 18 bars (90 mins) without progress
                cur_floating_r = (b_close - entry_p) / r_dist if direction == 'BUY' else (entry_p - b_close) / r_dist
                if tr['bars_held'] >= 18 and cur_floating_r < 0.30 and not tr['is_breakeven']:
                    exit_price = b_close
                    exit_fee = exit_price * (TAKER_FEE_BPS + SLIPPAGE_BPS) / 10000.0
                    pnl_unit = (exit_price - entry_p - exit_fee) if direction == 'BUY' else (entry_p - exit_price - exit_fee)
                    realized_pnl = pnl_unit * tr['remaining_size']
                    tr['total_realized_pnl'] += realized_pnl
                    tr['remaining_size'] = 0.0
                    tr['exit_time'] = b_dt_str
                    tr['exit_reason'] = "STAGNATION_EXIT"
                    
                    self.equity += realized_pnl
                    self.daily_pnl += realized_pnl
                    self.trades.append(tr)
                    active_trade = None
                    continue

                # Tranche 1: +1.50R Target -> Bank 35%, Ratchet SL to Breakeven (+0.10R)
                if not tr['t1_taken']:
                    t1_target = entry_p + (1.5 * r_dist) if direction == 'BUY' else entry_p - (1.5 * r_dist)
                    t1_hit = (b_high >= t1_target) if direction == 'BUY' else (b_low <= t1_target)
                    if t1_hit:
                        tr['t1_taken'] = True
                        t1_size = tr['total_size'] * 0.35
                        t1_fee = t1_target * (MAKER_FEE_BPS / 10000.0)
                        pnl_unit = (t1_target - entry_p - t1_fee) if direction == 'BUY' else (entry_p - t1_target - t1_fee)
                        t1_pnl = pnl_unit * t1_size
                        tr['total_realized_pnl'] += t1_pnl
                        tr['remaining_size'] -= t1_size
                        self.equity += t1_pnl
                        self.daily_pnl += t1_pnl

                        be_buffer = r_dist * 0.10
                        tr['stop_loss'] = entry_p + be_buffer if direction == 'BUY' else entry_p - be_buffer
                        tr['is_breakeven'] = True

                # Tranche 2: +2.50R Target -> Bank 35%
                if tr['t1_taken'] and not tr['t2_taken']:
                    t2_target = entry_p + (2.5 * r_dist) if direction == 'BUY' else entry_p - (2.5 * r_dist)
                    t2_hit = (b_high >= t2_target) if direction == 'BUY' else (b_low <= t2_target)
                    if t2_hit:
                        tr['t2_taken'] = True
                        t2_size = tr['total_size'] * 0.35
                        t2_fee = t2_target * (MAKER_FEE_BPS / 10000.0)
                        pnl_unit = (t2_target - entry_p - t2_fee) if direction == 'BUY' else (entry_p - t2_target - t2_fee)
                        t2_pnl = pnl_unit * t2_size
                        tr['total_realized_pnl'] += t2_pnl
                        tr['remaining_size'] -= t2_size
                        self.equity += t2_pnl
                        self.daily_pnl += t2_pnl

                # Tranche 3: 30% Moonbag Runner (Trailing 2.5x ATR Chandelier Stop)
                if tr['t2_taken'] and tr['is_breakeven']:
                    trailing_stop = tr.get('trailing_stop', tr['stop_loss'])
                    trail_hit = (b_low <= trailing_stop) if direction == 'BUY' else (b_high >= trailing_stop)
                    if trail_hit:
                        exit_price = trailing_stop
                        exit_fee = exit_price * (TAKER_FEE_BPS + SLIPPAGE_BPS) / 10000.0
                        pnl_unit = (exit_price - entry_p - exit_fee) if direction == 'BUY' else (entry_p - exit_price - exit_fee)
                        t3_pnl = pnl_unit * tr['remaining_size']
                        tr['total_realized_pnl'] += t3_pnl
                        tr['remaining_size'] = 0.0
                        tr['exit_time'] = b_dt_str
                        tr['exit_reason'] = "RUNNER_CHANDELIER_STOP"
                        
                        self.equity += t3_pnl
                        self.daily_pnl += t3_pnl
                        self.trades.append(tr)
                        active_trade = None
                        continue
                    else:
                        if m15_atr > 0:
                            chandelier_dist = 2.5 * m15_atr
                            if direction == 'BUY':
                                pot_trail = b_high - chandelier_dist
                                if pot_trail > trailing_stop:
                                    tr['trailing_stop'] = pot_trail
                            else:
                                pot_trail = b_low + chandelier_dist
                                if pot_trail < trailing_stop:
                                    tr['trailing_stop'] = pot_trail

            # -----------------------------------------------------------------
            # 2. EVALUATE PENDING FVG LIMIT ORDER
            # -----------------------------------------------------------------
            if pending_order is not None and active_trade is None:
                pending_order['bars_waited'] += 1
                limit_p = pending_order['entry_price']
                direction = pending_order['direction']

                filled = (b_low <= limit_p) if direction == 'BUY' else (b_high >= limit_p)
                if filled:
                    entry_fee = limit_p * (MAKER_FEE_BPS / 10000.0)
                    active_trade = {
                        "id": f"TRD_{len(self.trades)+1:04d}",
                        "symbol": self.symbol,
                        "direction": direction,
                        "grade": pending_order['grade'],
                        "session": pending_order['session'],
                        "entry_time": b_dt_str,
                        "entry_price": limit_p,
                        "stop_loss": pending_order['stop_loss'],
                        "r_dist": abs(limit_p - pending_order['stop_loss']),
                        "total_size": pending_order['position_size'],
                        "remaining_size": pending_order['position_size'],
                        "allocated_risk_usd": pending_order['allocated_risk_usd'],
                        "entry_fee_usd": entry_fee * pending_order['position_size'],
                        "m15_atr": pending_order['m15_atr'],
                        "is_breakeven": False,
                        "t1_taken": False,
                        "t2_taken": False,
                        "bars_held": 0,
                        "total_realized_pnl": -entry_fee * pending_order['position_size'],
                    }
                    self.equity -= entry_fee * pending_order['position_size']
                    pending_order = None
                elif pending_order['bars_waited'] >= pending_order['max_retest_bars']:
                    pending_order = None

            # -----------------------------------------------------------------
            # 3. HIGH-FREQUENCY INTERNAL LIQUIDITY SCANNER
            # -----------------------------------------------------------------
            if active_trade is None and pending_order is None:
                # Circuit breakers
                if self.daily_pnl <= -(INITIAL_EQUITY * DAILY_LOSS_LIMIT_PCT):
                    continue
                if (self.peak_equity - self.equity) / self.peak_equity >= 0.09:
                    continue

                session_name, is_high_volume, is_weekend, is_funding = get_session_info(dt)
                if is_funding or session_name == "OFF_SESSION":
                    continue

                curr_15m_ts = m15_ts_arr[i]
                idx_15m = bisect_left(sorted_m15_ts, curr_15m_ts)
                if idx_15m < 20:
                    continue

                last_15m_ts = sorted_m15_ts[idx_15m - 1]
                m15_atr, m15_chop = m15_dict[last_15m_ts]
                if m15_atr <= 0:
                    continue

                # Adaptive Regime: in high chop (> 61.8), require delta absorption
                is_choppy = m15_chop > 61.8

                price = b_close
                min_sweep_breach = price * self.min_sweep_ratio
                sl_buffer = price * self.sl_buffer_ratio
                min_fvg_gap = price * self.min_fvg_ratio

                # INTERNAL LIQUIDITY:
                # 1-Hour Buy-Side / Sell-Side Liquidity (IRL) from last 12 bars (60 mins)
                irl_high = np.max(highs[i - 12 : i])
                irl_low = np.min(lows[i - 12 : i])

                # Recent 5 bars (lookback for sweep confirmation)
                recent_lows = lows[i - 4 : i + 1]
                min_recent_low = np.min(recent_lows)
                sweep_breach_bull = irl_low - min_recent_low

                # A. BULLISH SETUP (Sweep of 1-Hour IRL Low)
                if sweep_breach_bull >= min_sweep_breach and b_close > irl_low:
                    min_idx = (i - 4) + int(np.argmin(recent_lows))
                    sweep_low = lows[min_idx]
                    sweep_high = highs[min_idx]
                    sweep_rng = sweep_high - sweep_low
                    lower_wick = (irl_low - sweep_low) / sweep_rng if sweep_rng > 0 else 0

                    if lower_wick >= 0.20:
                        body = abs(b_close - b_open)
                        rng = b_high - b_low
                        five_min_atr = atrs_5m[i] if atrs_5m[i] > 0 else m15_atr / 1.732
                        has_displacement = (body >= 0.50 * five_min_atr) and (body >= 0.50 * rng)

                        # FVG between candle i-2 and candle i
                        fvg_gap = b_low - highs[i - 2]
                        delta_absorbed = (b_delta > 0) or (b_delta >= deltas[min_idx])

                        if has_displacement and (fvg_gap >= min_fvg_gap):
                            if is_choppy and not delta_absorbed:
                                continue # Filter out unabsorbed chop

                            is_a_plus = delta_absorbed and is_high_volume
                            grade = "A_PLUS" if is_a_plus else "A"
                            mult = CONVICTION_A_PLUS if grade == "A_PLUS" else CONVICTION_A
                            if is_weekend:
                                mult *= WEEKEND_DAMPENER

                            stop_loss = sweep_low - sl_buffer
                            entry_price = b_low # Proximal edge of FVG
                            r_dist = entry_price - stop_loss

                            if r_dist > 0:
                                risk_usd = (self.equity * BASE_RISK_PCT) * mult
                                raw_size = risk_usd / r_dist
                                pos_size = round(raw_size, self.decimals)

                                if pos_size > 0:
                                    pending_order = {
                                        "symbol": self.symbol,
                                        "direction": "BUY",
                                        "grade": grade,
                                        "session": session_name,
                                        "entry_price": entry_price,
                                        "stop_loss": stop_loss,
                                        "position_size": pos_size,
                                        "allocated_risk_usd": risk_usd,
                                        "m15_atr": m15_atr,
                                        "bars_waited": 0,
                                        "max_retest_bars": 8,
                                    }
                                    continue

                # B. BEARISH SETUP (Sweep of 1-Hour IRL High)
                recent_highs = highs[i - 4 : i + 1]
                max_recent_high = np.max(recent_highs)
                sweep_breach_bear = max_recent_high - irl_high

                if sweep_breach_bear >= min_sweep_breach and b_close < irl_high:
                    max_idx = (i - 4) + int(np.argmax(recent_highs))
                    sweep_high = highs[max_idx]
                    sweep_low = lows[max_idx]
                    sweep_rng = sweep_high - sweep_low
                    upper_wick = (sweep_high - irl_high) / sweep_rng if sweep_rng > 0 else 0

                    if upper_wick >= 0.20:
                        body = abs(b_close - b_open)
                        rng = b_high - b_low
                        five_min_atr = atrs_5m[i] if atrs_5m[i] > 0 else m15_atr / 1.732
                        has_displacement = (body >= 0.50 * five_min_atr) and (body >= 0.50 * rng)

                        # Bearish FVG between candle i-2 low and candle i high
                        fvg_gap = lows[i - 2] - b_high
                        delta_absorbed = (b_delta < 0) or (b_delta <= deltas[max_idx])

                        if has_displacement and (fvg_gap >= min_fvg_gap):
                            if is_choppy and not delta_absorbed:
                                continue

                            is_a_plus = delta_absorbed and is_high_volume
                            grade = "A_PLUS" if is_a_plus else "A"
                            mult = CONVICTION_A_PLUS if grade == "A_PLUS" else CONVICTION_A
                            if is_weekend:
                                mult *= WEEKEND_DAMPENER

                            stop_loss = sweep_high + sl_buffer
                            entry_price = b_high # Proximal edge
                            r_dist = stop_loss - entry_price

                            if r_dist > 0:
                                risk_usd = (self.equity * BASE_RISK_PCT) * mult
                                raw_size = risk_usd / r_dist
                                pos_size = round(raw_size, self.decimals)

                                if pos_size > 0:
                                    pending_order = {
                                        "symbol": self.symbol,
                                        "direction": "SELL",
                                        "grade": grade,
                                        "session": session_name,
                                        "entry_price": entry_price,
                                        "stop_loss": stop_loss,
                                        "position_size": pos_size,
                                        "allocated_risk_usd": risk_usd,
                                        "m15_atr": m15_atr,
                                        "bars_waited": 0,
                                        "max_retest_bars": 8,
                                    }
                                    continue


# =============================================================================
# STATISTICAL METRICS REPORTING
# =============================================================================

def compute_metrics(trades: list, equity_curve: list, symbol: str):
    if not trades:
        return None

    df_tr = pd.DataFrame(trades)
    df_eq = pd.DataFrame(equity_curve)

    total_trades = len(df_tr)
    net_pnl = df_tr['total_realized_pnl'].sum()
    final_equity = INITIAL_EQUITY + net_pnl
    return_pct = (net_pnl / INITIAL_EQUITY) * 100.0

    wins = df_tr[df_tr['total_realized_pnl'] > 0]
    losses = df_tr[df_tr['total_realized_pnl'] <= 0]
    win_rate = (len(wins) / total_trades) * 100.0 if total_trades > 0 else 0.0

    gross_profit = wins['total_realized_pnl'].sum() if len(wins) > 0 else 0.0
    gross_loss = abs(losses['total_realized_pnl'].sum()) if len(losses) > 0 else 1.0
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else gross_profit

    avg_win = wins['total_realized_pnl'].mean() if len(wins) > 0 else 0.0
    avg_loss = abs(losses['total_realized_pnl'].mean()) if len(losses) > 0 else 0.0
    win_loss_ratio = avg_win / avg_loss if avg_loss > 0 else 0.0

    max_dd_pct = df_eq['drawdown_pct'].max() * 100.0
    max_dd_usd = (df_eq['peak_equity'] - df_eq['equity']).max()

    df_tr['r_multiple'] = df_tr['total_realized_pnl'] / df_tr['allocated_risk_usd']
    avg_r = df_tr['r_multiple'].mean()
    expectancy_usd = df_tr['total_realized_pnl'].mean()

    be_locked_trades = len(df_tr[df_tr['is_breakeven'] == True])
    be_lock_rate = (be_locked_trades / total_trades) * 100.0 if total_trades > 0 else 0.0

    pnl_series = df_tr['total_realized_pnl']
    sharpe = (pnl_series.mean() / pnl_series.std()) * math.sqrt(total_trades) if pnl_series.std() > 0 else 0.0
    downside_returns = pnl_series[pnl_series < 0]
    sortino = (pnl_series.mean() / downside_returns.std()) * math.sqrt(total_trades) if (len(downside_returns) > 0 and downside_returns.std() > 0) else sharpe

    return {
        "Symbol": symbol,
        "Trades": total_trades,
        "Trades/Day": f"{total_trades / 273.0:.1f}",
        "Win Rate": f"{win_rate:.1f}%",
        "Profit Factor": f"{profit_factor:.2f}",
        "Net Realized PnL": f"${net_pnl:+,.2f} ({return_pct:+.2f}%)",
        "Final Equity": f"${final_equity:,.2f}",
        "Max Drawdown": f"-{max_dd_pct:.2f}%",
        "Breakeven Rate": f"{be_lock_rate:.1f}%",
        "Avg R": f"{avg_r:+.2f}R",
        "Expectancy": f"${expectancy_usd:,.2f}",
        "Payoff": f"{win_loss_ratio:.2f}",
        "Sharpe": f"{sharpe:.2f}",
        "Sortino": f"{sortino:.2f}",
    }


def main():
    print("=" * 80, flush=True)
    print("🔬 ADVANCED RESEARCH BACKTEST: ADAPTIVE HIGH-FREQUENCY ALPHA ENGINE", flush=True)
    print("Testing Strategy: 7 Alpha Winners + Internal Liquidity Sweeps (IRL) + Adaptive CHOP", flush=True)
    print("Period: January 1, 2026 - September 30, 2026 (273 Days Real Binance Futures)", flush=True)
    print("Initial Equity: $10,000.00 | Base Risk: 0.85% | Sizing: 1.25x A+ / 1.00x A", flush=True)
    print("=" * 80, flush=True)

    results = []
    all_trades = []

    for symbol in ALPHA_SYMBOLS:
        path_15m = os.path.join(DATA_DIR, f"{symbol}_15m_2026_01_to_2026_09.csv")
        path_5m = os.path.join(DATA_DIR, f"{symbol}_5m_2026_01_to_2026_09.csv")

        if not os.path.exists(path_15m) or not os.path.exists(path_5m):
            print(f"⚠️ Dataset missing for {symbol}", flush=True)
            continue

        print(f"[{symbol}] Processing 78,624 bars of internal session liquidity...", end="", flush=True)
        df_15m = pd.read_csv(path_15m)
        df_5m = pd.read_csv(path_5m)

        start_time = datetime.now()
        sim = HighFrequencyAlphaSimulator(symbol, df_15m, df_5m)
        sim.run()
        elapsed = (datetime.now() - start_time).total_seconds()

        metrics = compute_metrics(sim.trades, sim.equity_curve, symbol)
        if metrics:
            results.append(metrics)
            all_trades.extend(sim.trades)
            print(f" Done ({elapsed:.1f}s) -> {metrics['Trades']} trades, WR: {metrics['Win Rate']}, PnL: {metrics['Net Realized PnL']}", flush=True)
        else:
            print(f" Done ({elapsed:.1f}s) -> 0 trades", flush=True)

    print("\n" + "=" * 80, flush=True)
    print("📊 INDIVIDUAL PERFORMANCE: 7 ALPHA WINNERS (HIGH-FREQUENCY SCALPER)", flush=True)
    print("=" * 80, flush=True)
    df_results = pd.DataFrame(results)
    print(df_results.to_string(index=False), flush=True)

    if all_trades:
        df_all = pd.DataFrame(all_trades).sort_values("entry_time").reset_index(drop=True)
        total_trades = len(df_all)
        daily_frequency = total_trades / 273.0

        wins = df_all[df_all['total_realized_pnl'] > 0]
        losses = df_all[df_all['total_realized_pnl'] <= 0]
        win_rate = (len(wins) / total_trades) * 100
        net_pnl = df_all['total_realized_pnl'].sum()
        gross_profit = wins['total_realized_pnl'].sum() if len(wins) > 0 else 0
        gross_loss = abs(losses['total_realized_pnl'].sum()) if len(losses) > 0 else 1
        pf = gross_profit / gross_loss if gross_loss > 0 else 0

        # Max drawdown across combined equity
        cumulative_pnl = df_all['total_realized_pnl'].cumsum()
        portfolio_curve = INITIAL_EQUITY + cumulative_pnl
        peak = portfolio_curve.cummax()
        dd = (peak - portfolio_curve) / peak
        max_dd = dd.max() * 100

        print("\n" + "=" * 80, flush=True)
        print("🏆 CONSOLIDATED PORTFOLIO SUMMARY: THE ADAPTIVE ALPHA MACHINE", flush=True)
        print("=" * 80, flush=True)
        print(f"  • Total Executed Trades:       {total_trades:,} trades across 9 months", flush=True)
        print(f"  • Daily Trading Frequency:     {daily_frequency:.1f} trades / day (Target ~15-20 Trades/Day)", flush=True)
        print(f"  • Portfolio Win Rate:          {win_rate:.1f}% ({len(wins)} Wins / {len(losses)} Losses)", flush=True)
        print(f"  • Profit Factor:               {pf:.2f}", flush=True)
        print(f"  • Total Net Realized Profit:   ${net_pnl:+,.2f} ({(net_pnl / INITIAL_EQUITY) * 100:+.2f}% ROI)", flush=True)
        print(f"  • Final Account Equity:        ${INITIAL_EQUITY + net_pnl:,.2f}", flush=True)
        print(f"  • Max Portfolio Drawdown:      -{max_dd:.2f}%", flush=True)
        print(f"  • Average Profit / Trade:      ${df_all['total_realized_pnl'].mean():+,.2f}", flush=True)
        print("=" * 80 + "\n", flush=True)

        # Save trade journal CSV for audit
        journal_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "alpha_recommendations_trade_journal.csv")
        df_all.to_csv(journal_path, index=False)
        print(f"💾 Complete Trade Journal saved to: {journal_path}", flush=True)


if __name__ == "__main__":
    main()
