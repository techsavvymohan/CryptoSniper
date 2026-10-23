#!/usr/bin/env python3
"""
=============================================================================
THE GODFATHER QUANTITATIVE ENGINE: ICT-LEVEL BACKTESTING FRAMEWORK
Institutional High-Fidelity Backtester for Crypto Perpetuals (BTC & SOL)
Dataset: Real Binance Futures OHLCV + Order Flow Delta (Jan 2026 - Sep 2026)
Zero Lookahead Bias | Real Taker Delta | Limit Order Retest | 3-Tranche Harvesting
=============================================================================
"""

import os
import sys
import math
from datetime import datetime, timezone
from bisect import bisect_left
import pandas as pd
import numpy as np

# Fix Windows cp1252 stdout encoding
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "historical")

# =============================================================================
# STRATEGY CONSTANTS & RISK PARAMETERS
# =============================================================================
INITIAL_EQUITY = 10000.0  # $10k Prop Firm / Retail Account
BASE_RISK_PCT = 0.0085    # 0.85% base risk per trade
CONVICTION_A_PLUS = 1.25  # 1.25x multiplier for Unicorn A+ setups (balanced risk)
CONVICTION_A = 1.00       # 1.00x multiplier for Standard A setups
CONVICTION_B = 0.50       # 0.50x multiplier for B setups
WEEKEND_DAMPENER = 0.50   # 50% risk reduction on weekends

MAKER_FEE_BPS = 2.0       # 0.02% maker fee for limit order entry
TAKER_FEE_BPS = 5.0       # 0.05% taker fee for SL & market exits
SLIPPAGE_BPS = 1.0        # 0.01% conservative market execution slippage

DAILY_LOSS_LIMIT_PCT = 0.045  # -4.50% Daily Loss Limit Circuit Breaker
MAX_DRAWDOWN_LIMIT_PCT = 0.09 # -9.00% Account Max Drawdown Freeze

BTC_MIN_SWEEP_BREACH = 50.0   # $50 minimum liquidity sweep breach for BTC
SOL_MIN_SWEEP_BREACH = 0.35   # $0.35 minimum liquidity sweep breach for SOL

BTC_SL_BUFFER = 15.0          # $15 buffer beyond sweep wick
SOL_SL_BUFFER = 0.20          # $0.20 buffer beyond sweep wick

BTC_MIN_FVG_GAP = 10.0        # $10 minimum FVG gap for BTC
SOL_MIN_FVG_GAP = 0.10        # $0.10 minimum FVG gap for SOL

MAX_RETEST_BARS_BTC = 8       # Max 5m bars to fill limit order at FVG proximal edge
MAX_RETEST_BARS_SOL = 12


# =============================================================================
# QUANT INDICATORS & STRUCTURE DETECTION (100% SYNCHRONIZED WITH BOT)
# =============================================================================

def calculate_ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def calculate_atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Wilder's Smoothed Average True Range (ATR)"""
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
    """
    Choppiness Index (CHOP 14)
    CHOP = 100 * LOG10( SUM(TrueRange, 14) / (MaxHigh(14) - MinLow(14)) ) / LOG10(14)
    Value > 61.8 indicates consolidation (trading halted).
    """
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
    """
    Evaluates ICT Session Killzones & Perpetual Funding Windows
    """
    hour = dt.hour
    minute = dt.minute
    day = dt.weekday() # 5 = Sat, 6 = Sun
    is_weekend = (day >= 5)

    session_name = "OFF_SESSION"
    is_high_volume = False

    # US ETF Open / Core (13:30 - 17:00 UTC)
    if (hour == 13 and minute >= 30) or (14 <= hour < 17):
        session_name = "US_ETF_SESSION"
        is_high_volume = True
    # London Ingestion (07:00 - 10:00 UTC)
    elif 7 <= hour < 10:
        session_name = "LONDON_KILLZONE"
        is_high_volume = True
    # Asia Open (00:00 - 03:00 UTC)
    elif 0 <= hour < 3:
        session_name = "ASIA_OPEN"
        is_high_volume = False

    # Check 8-Hour Funding Reset Blackout (00:00, 08:00, 16:00 UTC +- 10 min)
    is_funding_blackout = False
    for r_hour in [0, 8, 16]:
        prev_hour = (r_hour - 1 + 24) % 24
        if (hour == prev_hour and minute >= 50) or (hour == r_hour and minute <= 10):
            is_funding_blackout = True
            break

    return session_name, is_high_volume, is_weekend, is_funding_blackout


# =============================================================================
# INSTITUTIONAL ICT BACKTEST ENGINE
# =============================================================================

class InstitutionalGodfatherBacktest:
    def __init__(self, symbol: str, df_15m: pd.DataFrame, df_5m: pd.DataFrame):
        self.symbol = symbol
        self.df_15m = df_15m.copy()
        self.df_5m = df_5m.copy()
        self.is_btc = "BTC" in symbol.upper()
        self.is_sol = "SOL" in symbol.upper()

        avg_price = float(self.df_5m['close'].mean())
        if self.is_btc:
            self.min_sweep_breach = BTC_MIN_SWEEP_BREACH
            self.sl_buffer = BTC_SL_BUFFER
            self.min_fvg_gap = BTC_MIN_FVG_GAP
            self.decimals = 4
        elif self.is_sol:
            self.min_sweep_breach = SOL_MIN_SWEEP_BREACH
            self.sl_buffer = SOL_SL_BUFFER
            self.min_fvg_gap = SOL_MIN_FVG_GAP
            self.decimals = 2
        else:
            self.min_sweep_breach = max(avg_price * 0.0035, 0.0001)
            self.sl_buffer = max(avg_price * 0.0015, 0.00005)
            self.min_fvg_gap = max(avg_price * 0.0008, 0.00002)
            if avg_price >= 1000:
                self.decimals = 3
            elif avg_price >= 10:
                self.decimals = 2
            elif avg_price >= 1:
                self.decimals = 1
            else:
                self.decimals = 0

        self.max_retest_bars = MAX_RETEST_BARS_BTC if self.is_btc else MAX_RETEST_BARS_SOL

        self.equity = INITIAL_EQUITY
        self.peak_equity = INITIAL_EQUITY
        self.daily_pnl = 0.0
        self.current_day_str = ""

        self.trades = []
        self.equity_curve = []

    def prepare_data(self):
        """Pre-computes indicators with zero future leak"""
        print(f"[{self.symbol}] Pre-computing M15 indicators (ATR, CHOP, Fractals, H1 EMA)...")
        self.df_15m['dt'] = pd.to_datetime(self.df_15m['datetime_utc'], utc=True)
        self.df_5m['dt'] = pd.to_datetime(self.df_5m['datetime_utc'], utc=True)

        self.df_15m['atr'] = calculate_atr(self.df_15m, 14)
        self.df_15m['chop'] = calculate_choppiness(self.df_15m, 14)

        # H1 EMA Trend on 15m (4 bars per H1 -> 9*4 = 36 bars, 21*4 = 84 bars)
        self.df_15m['h1_ema9'] = calculate_ema(self.df_15m['close'], 36)
        self.df_15m['h1_ema21'] = calculate_ema(self.df_15m['close'], 84)

        # 5m ATR for displacement checks
        self.df_5m['atr'] = calculate_atr(self.df_5m, 14)

        # Map 15m bar index to 5m bars for instant point-in-time synchronization
        self.df_5m['m15_timestamp'] = (self.df_5m['timestamp'] // (15 * 60 * 1000)) * (15 * 60 * 1000)

    def run(self):
        self.prepare_data()
        print(f"[{self.symbol}] Commencing ICT Smart Money Concept Backtesting across {len(self.df_5m):,} bars...")

        # Pre-index 15m data by timestamp
        m15_by_ts = {row['timestamp']: row for _, row in self.df_15m.iterrows()}
        m15_timestamps = sorted(list(m15_by_ts.keys()))

        pending_order = None # Limit order waiting for FVG proximal retest
        active_trade = None  # Live 3-tranche position

        # We need at least 40 M15 bars (10 hours) of burn-in history
        start_5m_idx = 40 * 3 

        for i in range(start_5m_idx, len(self.df_5m)):
            bar = self.df_5m.iloc[i]
            dt = bar['dt']
            day_str = dt.strftime("%Y-%m-%d")

            # Daily circuit breaker reset at 00:00 UTC
            if day_str != self.current_day_str:
                self.current_day_str = day_str
                self.daily_pnl = 0.0

            # Record continuous equity curve
            self.peak_equity = max(self.peak_equity, self.equity)
            self.equity_curve.append({
                "timestamp": bar['timestamp'],
                "datetime_utc": bar['datetime_utc'],
                "equity": self.equity,
                "peak_equity": self.peak_equity,
                "drawdown_pct": (self.peak_equity - self.equity) / self.peak_equity,
            })

            # -------------------------------------------------------------
            # STEP 1: EVALUATE ACTIVE 3-TRANCHE TRADE
            # -------------------------------------------------------------
            if active_trade is not None:
                active_trade['bars_held'] += 1
                tr = active_trade
                direction = tr['direction']
                entry_p = tr['entry_price']
                sl_p = tr['stop_loss']
                r_dist = tr['r_dist']
                m15_atr = tr['m15_atr']

                # 1. Full Stop Loss check
                stopped_out = (bar['low'] <= sl_p) if direction == 'BUY' else (bar['high'] >= sl_p)
                if stopped_out:
                    exit_price = sl_p
                    # Apply taker fee & slippage
                    exit_fee = exit_price * (TAKER_FEE_BPS + SLIPPAGE_BPS) / 10000.0
                    loss_per_unit = (exit_price - entry_p - exit_fee) if direction == 'BUY' else (entry_p - exit_price - exit_fee)
                    
                    realized_pnl = loss_per_unit * tr['remaining_size']
                    tr['total_realized_pnl'] += realized_pnl
                    tr['remaining_size'] = 0.0
                    tr['exit_time'] = bar['datetime_utc']
                    tr['exit_reason'] = "BREAKEVEN_SL" if tr['is_breakeven'] else "INITIAL_STOP_LOSS"
                    
                    self.equity += realized_pnl
                    self.daily_pnl += realized_pnl
                    self.trades.append(tr)
                    active_trade = None
                    continue

                # 2. Stagnation Exit (> 24 bars / 2 hours with < +0.30R profit and not BE locked)
                cur_floating_r = (bar['close'] - entry_p) / r_dist if direction == 'BUY' else (entry_p - bar['close']) / r_dist
                if tr['bars_held'] >= 24 and cur_floating_r < 0.30 and not tr['is_breakeven']:
                    exit_price = bar['close']
                    exit_fee = exit_price * (TAKER_FEE_BPS + SLIPPAGE_BPS) / 10000.0
                    pnl_unit = (exit_price - entry_p - exit_fee) if direction == 'BUY' else (entry_p - exit_price - exit_fee)
                    realized_pnl = pnl_unit * tr['remaining_size']
                    tr['total_realized_pnl'] += realized_pnl
                    tr['remaining_size'] = 0.0
                    tr['exit_time'] = bar['datetime_utc']
                    tr['exit_reason'] = "STAGNATION_EXIT"
                    
                    self.equity += realized_pnl
                    self.daily_pnl += realized_pnl
                    self.trades.append(tr)
                    active_trade = None
                    continue

                # 3. Tranche 1 Check (+1.50R Target -> Bank 35%, Ratchet SL to Breakeven +0.10R)
                if not tr['t1_taken']:
                    t1_target = entry_p + (1.5 * r_dist) if direction == 'BUY' else entry_p - (1.5 * r_dist)
                    t1_hit = (bar['high'] >= t1_target) if direction == 'BUY' else (bar['low'] <= t1_target)
                    if t1_hit:
                        tr['t1_taken'] = True
                        t1_size = tr['total_size'] * 0.35
                        t1_fee = t1_target * (MAKER_FEE_BPS / 10000.0) # limit TP
                        pnl_unit = (t1_target - entry_p - t1_fee) if direction == 'BUY' else (entry_p - t1_target - t1_fee)
                        t1_pnl = pnl_unit * t1_size
                        tr['total_realized_pnl'] += t1_pnl
                        tr['remaining_size'] -= t1_size
                        self.equity += t1_pnl
                        self.daily_pnl += t1_pnl

                        # Ratchet Stop Loss to Breakeven (+0.10R buffer to lock fee costs)
                        be_buffer = r_dist * 0.10
                        tr['stop_loss'] = entry_p + be_buffer if direction == 'BUY' else entry_p - be_buffer
                        tr['is_breakeven'] = True

                # 4. Tranche 2 Check (+2.50R Target -> Bank 35%)
                if tr['t1_taken'] and not tr['t2_taken']:
                    t2_target = entry_p + (2.5 * r_dist) if direction == 'BUY' else entry_p - (2.5 * r_dist)
                    t2_hit = (bar['high'] >= t2_target) if direction == 'BUY' else (bar['low'] <= t2_target)
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

                # 5. Tranche 3 Moonbag Runner (Trailing 3.0x ATR Chandelier Stop)
                if tr['t2_taken'] and tr['is_breakeven']:
                    trailing_stop = tr.get('trailing_stop', tr['stop_loss'])
                    trail_hit = (bar['low'] <= trailing_stop) if direction == 'BUY' else (bar['high'] >= trailing_stop)
                    if trail_hit:
                        exit_price = trailing_stop
                        exit_fee = exit_price * (TAKER_FEE_BPS + SLIPPAGE_BPS) / 10000.0
                        pnl_unit = (exit_price - entry_p - exit_fee) if direction == 'BUY' else (entry_p - exit_price - exit_fee)
                        t3_pnl = pnl_unit * tr['remaining_size']
                        tr['total_realized_pnl'] += t3_pnl
                        tr['remaining_size'] = 0.0
                        tr['exit_time'] = bar['datetime_utc']
                        tr['exit_reason'] = "RUNNER_CHANDELIER_STOP"
                        
                        self.equity += t3_pnl
                        self.daily_pnl += t3_pnl
                        self.trades.append(tr)
                        active_trade = None
                        continue
                    else:
                        # Ratchet Chandelier Trailing Stop higher (BUY) or lower (SELL)
                        if m15_atr > 0:
                            chandelier_dist = 3.0 * m15_atr
                            if direction == 'BUY':
                                pot_trail = bar['high'] - chandelier_dist
                                if pot_trail > trailing_stop:
                                    tr['trailing_stop'] = pot_trail
                            else:
                                pot_trail = bar['low'] + chandelier_dist
                                if pot_trail < trailing_stop:
                                    tr['trailing_stop'] = pot_trail

            # -------------------------------------------------------------
            # STEP 2: EVALUATE PENDING FVG LIMIT ORDER (RETEST FILL)
            # -------------------------------------------------------------
            if pending_order is not None and active_trade is None:
                pending_order['bars_waited'] += 1
                limit_p = pending_order['entry_price']
                direction = pending_order['direction']

                # Limit order fills if price touched or crossed the proximal FVG boundary
                filled = (bar['low'] <= limit_p) if direction == 'BUY' else (bar['high'] >= limit_p)
                if filled:
                    entry_fee = limit_p * (MAKER_FEE_BPS / 10000.0)
                    active_trade = {
                        "id": f"TRD_{len(self.trades)+1:04d}",
                        "symbol": self.symbol,
                        "direction": direction,
                        "grade": pending_order['grade'],
                        "session": pending_order['session'],
                        "entry_time": bar['datetime_utc'],
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
                    # Order expired without filling (avoids chasing)
                    pending_order = None

            # -------------------------------------------------------------
            # STEP 3: SCAN FOR HIGH-PROBABILITY ICT SETUP
            # -------------------------------------------------------------
            if active_trade is None and pending_order is None:
                # Prop firm circuit breakers:
                if self.daily_pnl <= -(INITIAL_EQUITY * DAILY_LOSS_LIMIT_PCT):
                    continue # Daily loss reached, halt until next day
                if (self.peak_equity - self.equity) / self.peak_equity >= MAX_DRAWDOWN_LIMIT_PCT:
                    continue # Max account drawdown reached

                session_name, is_high_volume, is_weekend, is_funding = get_session_info(dt)
                if is_funding:
                    continue # Funding reset blackout
                if session_name == "OFF_SESSION":
                    continue # Strict ICT Killzone Rule: Never trade outside London / NY / Asia Open

                # Retrieve strictly historical 15m bars up to this 5m bar timestamp (Zero lookahead)
                curr_15m_ts = bar['m15_timestamp']
                idx_15m = bisect_left(m15_timestamps, curr_15m_ts)
                if idx_15m < 25:
                    continue
                hist_15m_ts = m15_timestamps[:idx_15m]

                last_15m = m15_by_ts[hist_15m_ts[-1]]
                if last_15m['chop'] > 61.8:
                    continue # Skip choppy sideways market

                m15_atr = last_15m['atr']
                if m15_atr <= 0:
                    continue

                # H1 Trend alignment
                h1_trend = "NEUTRAL"
                if last_15m['h1_ema9'] > last_15m['h1_ema21']:
                    h1_trend = "BULLISH"
                elif last_15m['h1_ema9'] < last_15m['h1_ema21']:
                    h1_trend = "BEARISH"

                # Detect 5-bar Bill Williams Fractals on completed M15 bars (Lookback 20)
                m15_window = [m15_by_ts[ts] for ts in hist_15m_ts[-22:]]
                bsl_level = None # Buy-side liquidity (Fractal High)
                ssl_level = None # Sell-side liquidity (Fractal Low)

                # Fractal confirmed at idx k requires k-2, k-1, k, k+1, k+2 closed
                for k in range(2, len(m15_window) - 2):
                    c = m15_window[k]
                    # Fractal High (BSL)
                    if (c['high'] > m15_window[k-1]['high'] and c['high'] > m15_window[k-2]['high'] and
                        c['high'] > m15_window[k+1]['high'] and c['high'] > m15_window[k+2]['high']):
                        bsl_level = c['high']
                    # Fractal Low (SSL)
                    if (c['low'] < m15_window[k-1]['low'] and c['low'] < m15_window[k-2]['low'] and
                        c['low'] < m15_window[k+1]['low'] and c['low'] < m15_window[k+2]['low']):
                        ssl_level = c['low']

                # Inspect recent 5m bars for ICT Setup:
                # 1. Sweep + Reclaim
                # 2. Institutional Displacement
                # 3. Market Structure Shift (MSS)
                # 4. Fair Value Gap (FVG)
                # 5. Order Flow Volume Delta Absorption
                bars_5m_window = self.df_5m.iloc[i - 5 : i + 1]
                if len(bars_5m_window) < 5:
                    continue

                # A. BULLISH SETUP (Sweep of Sell-Side Liquidity SSL)
                if ssl_level is not None:
                    min_low_in_window = bars_5m_window['low'].min()
                    sweep_breach = ssl_level - min_low_in_window

                    # Sweep breached SSL by threshold and current bar closed back ABOVE SSL
                    if sweep_breach >= self.min_sweep_breach and bar['close'] > ssl_level:
                        sweep_bar = bars_5m_window.loc[bars_5m_window['low'].idxmin()]
                        sweep_rng = sweep_bar['high'] - sweep_bar['low']
                        lower_wick = (ssl_level - sweep_bar['low']) / sweep_rng if sweep_rng > 0 else 0

                        # Rejection wick >= 25% of sweep candle
                        if lower_wick >= 0.25:
                            # Institutional Displacement on reclaim bar
                            body = abs(bar['close'] - bar['open'])
                            rng = bar['high'] - bar['low']
                            five_min_atr = bar['atr'] if bar['atr'] > 0 else m15_atr / math.sqrt(3)
                            has_displacement = (body >= 0.60 * five_min_atr) and (body >= 0.60 * rng)

                            # Bullish FVG detection across last 3 bars: Low[i] > High[i-2]
                            c1 = bars_5m_window.iloc[-3]
                            c3 = bars_5m_window.iloc[-1]
                            fvg_gap = c3['low'] - c1['high']

                            # Order Flow Volume Delta Absorption:
                            # Reclaim candle volume_delta turning positive or absorbing sweep volume
                            delta_absorbed = (bar['volume_delta'] > 0) or (bar['volume_delta'] >= sweep_bar['volume_delta'])

                            if has_displacement and (fvg_gap >= self.min_fvg_gap):
                                # Grade Determination:
                                is_a_plus = delta_absorbed and is_high_volume and (h1_trend != "BEARISH")
                                grade = "A_PLUS" if is_a_plus else "A"

                                # Sizing:
                                mult = CONVICTION_A_PLUS if grade == "A_PLUS" else CONVICTION_A
                                if is_weekend:
                                    mult *= WEEKEND_DAMPENER

                                stop_loss = sweep_bar['low'] - self.sl_buffer
                                entry_price = c3['low'] # Proximal edge of Bullish FVG
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
                                            "max_retest_bars": self.max_retest_bars,
                                        }
                                        continue

                # B. BEARISH SETUP (Sweep of Buy-Side Liquidity BSL)
                if bsl_level is not None:
                    max_high_in_window = bars_5m_window['high'].max()
                    sweep_breach = max_high_in_window - bsl_level

                    if sweep_breach >= self.min_sweep_breach and bar['close'] < bsl_level:
                        sweep_bar = bars_5m_window.loc[bars_5m_window['high'].idxmax()]
                        sweep_rng = sweep_bar['high'] - sweep_bar['low']
                        upper_wick = (sweep_bar['high'] - bsl_level) / sweep_rng if sweep_rng > 0 else 0

                        if upper_wick >= 0.25:
                            body = abs(bar['close'] - bar['open'])
                            rng = bar['high'] - bar['low']
                            five_min_atr = bar['atr'] if bar['atr'] > 0 else m15_atr / math.sqrt(3)
                            has_displacement = (body >= 0.60 * five_min_atr) and (body >= 0.60 * rng)

                            # Bearish FVG detection across last 3 bars: Low[i-2] > High[i]
                            c1 = bars_5m_window.iloc[-3]
                            c3 = bars_5m_window.iloc[-1]
                            fvg_gap = c1['low'] - c3['high']

                            # Order Flow Volume Delta Absorption:
                            delta_absorbed = (bar['volume_delta'] < 0) or (bar['volume_delta'] <= sweep_bar['volume_delta'])

                            if has_displacement and (fvg_gap >= self.min_fvg_gap):
                                is_a_plus = delta_absorbed and is_high_volume and (h1_trend != "BULLISH")
                                grade = "A_PLUS" if is_a_plus else "A"

                                mult = CONVICTION_A_PLUS if grade == "A_PLUS" else CONVICTION_A
                                if is_weekend:
                                    mult *= WEEKEND_DAMPENER

                                stop_loss = sweep_bar['high'] + self.sl_buffer
                                entry_price = c3['high'] # Proximal edge of Bearish FVG
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
                                            "max_retest_bars": self.max_retest_bars,
                                        }
                                        continue

        print(f"[{self.symbol}] Completed simulation. Total executed trades: {len(self.trades)}")


# =============================================================================
# STATISTICAL REPORTING & QUANT METRICS
# =============================================================================

def compute_metrics(trades: list, equity_curve: list, symbol: str):
    if not trades:
        print(f"⚠️ No trades executed for {symbol}.")
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

    # R-Multiple calculations
    df_tr['r_multiple'] = df_tr['total_realized_pnl'] / df_tr['allocated_risk_usd']
    avg_r = df_tr['r_multiple'].mean()
    expectancy_usd = df_tr['total_realized_pnl'].mean()

    # Tranche 1 Breakeven Lock Rate (% of trades where capital was successfully protected)
    be_locked_trades = len(df_tr[df_tr['is_breakeven'] == True])
    be_lock_rate = (be_locked_trades / total_trades) * 100.0 if total_trades > 0 else 0.0

    # Annualized Sharpe & Sortino (assuming 252 trading days / 9 months sample)
    pnl_series = df_tr['total_realized_pnl']
    sharpe = (pnl_series.mean() / pnl_series.std()) * math.sqrt(total_trades) if pnl_series.std() > 0 else 0.0
    downside_returns = pnl_series[pnl_series < 0]
    sortino = (pnl_series.mean() / downside_returns.std()) * math.sqrt(total_trades) if (len(downside_returns) > 0 and downside_returns.std() > 0) else sharpe

    # Grade breakdown
    a_plus_trades = df_tr[df_tr['grade'] == 'A_PLUS']
    a_trades = df_tr[df_tr['grade'] == 'A']

    a_plus_wr = (len(a_plus_trades[a_plus_trades['total_realized_pnl'] > 0]) / len(a_plus_trades) * 100) if len(a_plus_trades) > 0 else 0
    a_wr = (len(a_trades[a_trades['total_realized_pnl'] > 0]) / len(a_trades) * 100) if len(a_trades) > 0 else 0

    return {
        "Symbol": symbol,
        "Total Trades": total_trades,
        "Win Rate": f"{win_rate:.1f}% ({len(wins)}W / {len(losses)}L)",
        "Profit Factor": f"{profit_factor:.2f}",
        "Net Realized PnL": f"${net_pnl:,.2f} ({return_pct:+.2f}%)",
        "Final Equity": f"${final_equity:,.2f}",
        "Max Drawdown ($)": f"-${max_dd_usd:,.2f}",
        "Max Drawdown (%)": f"-{max_dd_pct:.2f}%",
        "Breakeven Protection Rate": f"{be_lock_rate:.1f}%",
        "Avg R-Multiple": f"{avg_r:+.2f}R",
        "Expectancy ($/Trade)": f"${expectancy_usd:,.2f}",
        "Win/Loss Payoff": f"{win_loss_ratio:.2f}",
        "Sharpe Ratio": f"{sharpe:.2f}",
        "Sortino Ratio": f"{sortino:.2f}",
        "A+ Win Rate (Unicorn)": f"{a_plus_wr:.1f}% ({len(a_plus_trades)} trades)",
        "A Win Rate (Standard)": f"{a_wr:.1f}% ({len(a_trades)} trades)",
    }


def main():
    print("=" * 80)
    print("🎩 THE GODFATHER QUANTITATIVE ENGINE: MULTI-ASSET ICT HISTORICAL BACKTEST")
    print("Period: January 1, 2026 - September 30, 2026 (9 Months Real Binance Futures)")
    print("Universe: Top 7 Alpha Winners (BTC, SOL, DOGE, INJ, OP, AVAX, APT) | Equity: $10,000.00")
    print("Risk: 0.85% Base Risk | Sizing: 1.25x A+ / 1.00x A | Fees: Maker 0.02%, Taker 0.05%")
    print("=" * 80)

    all_symbols = [
        "BTCUSDT", "SOLUSDT", "DOGEUSDT", "INJUSDT", "OPUSDT", "AVAXUSDT", "APTUSDT"
    ]

    results = []
    all_trades = []
    os.makedirs(os.path.join(DATA_DIR, "backtest_results"), exist_ok=True)

    for symbol in all_symbols:
        path_15m = os.path.join(DATA_DIR, f"{symbol}_15m_2026_01_to_2026_09.csv")
        path_5m = os.path.join(DATA_DIR, f"{symbol}_5m_2026_01_to_2026_09.csv")

        if not os.path.exists(path_15m) or not os.path.exists(path_5m):
            print(f"⚠️ Skipping {symbol}: Dataset not found.")
            continue

        df_15m = pd.read_csv(path_15m)
        df_5m = pd.read_csv(path_5m)

        bt = InstitutionalGodfatherBacktest(symbol, df_15m, df_5m)
        bt.run()

        metrics = compute_metrics(bt.trades, bt.equity_curve, symbol)
        if metrics:
            results.append(metrics)
            all_trades.extend(bt.trades)

            # Save individual journal
            journal_path = os.path.join(DATA_DIR, "backtest_results", f"{symbol.lower()}_trades.csv")
            pd.DataFrame(bt.trades).to_csv(journal_path, index=False)

    print("\n" + "=" * 80)
    print("📊 15-PAIR MULTI-ASSET ICT BACKTEST RESULTS (JAN 2026 - SEP 2026)")
    print("=" * 80)
    summary_df = pd.DataFrame(results)
    print(summary_df.to_string(index=False))

    # Consolidated Multi-Asset Portfolio Performance
    if all_trades:
        df_all = pd.DataFrame(all_trades).sort_values("entry_time").reset_index(drop=True)
        total_p_trades = len(df_all)
        p_wins = df_all[df_all['total_realized_pnl'] > 0]
        p_losses = df_all[df_all['total_realized_pnl'] <= 0]
        p_win_rate = (len(p_wins) / total_p_trades) * 100
        p_net_pnl = df_all['total_realized_pnl'].sum()
        p_gross_profit = p_wins['total_realized_pnl'].sum() if len(p_wins) > 0 else 0
        p_gross_loss = abs(p_losses['total_realized_pnl'].sum()) if len(p_losses) > 0 else 1
        p_pf = p_gross_profit / p_gross_loss if p_gross_loss > 0 else 0

        # 273 days between Jan 1 and Sep 30
        trades_per_day = total_p_trades / 273.0

        # Save consolidated trade master journal
        df_all.to_csv(os.path.join(DATA_DIR, "backtest_results", "portfolio_master_journal.csv"), index=False)

        print("\n" + "=" * 80)
        print("🏆 CONSOLIDATED MULTI-ASSET PORTFOLIO METRICS (15 PAIRS)")
        print("=" * 80)
        print(f"  • Total Executed Trades:       {total_p_trades:,} trades across 9 months")
        print(f"  • Daily Trading Frequency:     {trades_per_day:.1f} trades / day")
        print(f"  • Portfolio Win Rate:          {p_win_rate:.1f}% ({len(p_wins)} Wins / {len(p_losses)} Losses)")
        print(f"  • Portfolio Profit Factor:     {p_pf:.2f}")
        print(f"  • Total Net Realized Profit:   ${p_net_pnl:+,.2f} ({(p_net_pnl / INITIAL_EQUITY) * 100:+.2f}% ROI)")
        print(f"  • Final Account Equity:        ${INITIAL_EQUITY + p_net_pnl:,.2f}")
        print(f"  • Average Profit / Trade:      ${df_all['total_realized_pnl'].mean():+,.2f}")
        print("=" * 80)
        print(f"📁 Master Journal: data/historical/backtest_results/portfolio_master_journal.csv\n")


if __name__ == "__main__":
    main()
