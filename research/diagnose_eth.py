#!/usr/bin/env python3
"""
Inspect ETH trades specifically to see why it loses.
"""
import os
import sys
import pandas as pd
import numpy as np

from detect_overfitting import DataCache, compute_metrics

cached = DataCache.get("ETHUSDT")
df15, df5 = cached
print("ETH Data points:", len(df15), "15m bars,", len(df5), "5m bars")
print(f"ETH Price range: ${df5['close'].min():.2f} - ${df5['close'].max():.2f}, Mean: ${df5['close'].mean():.2f}")
print(f"ETH 15m ATR range: ${df15['atr'].min():.2f} - ${df15['atr'].max():.2f}, Mean: ${df15['atr'].mean():.2f}")
