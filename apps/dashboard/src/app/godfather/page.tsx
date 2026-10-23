'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface SignalDisplay {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  grade: 'A_PLUS' | 'A' | 'B';
  entryPrice: number;
  stopLoss: number;
  sweepBreachUsd: number;
  allocatedRiskUsd: number;
  positionSize: number;
  session: string;
  status: string;
  detectedAt: number;
}

interface ActiveTradeDisplay {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  breakevenPrice: number;
  isBreakevenLocked: boolean;
  totalSize: number;
  remainingSize: number;
  realizedPnlUsd: number;
  tranches: Array<{
    trancheNumber: 1 | 2 | 3;
    targetPrice?: number;
    size: number;
    status: string;
    realizedPnlUsd: number;
  }>;
}

export default function GodfatherDashboard() {
  const [currentSession, setCurrentSession] = useState({
    name: 'US_ETF_CORE',
    isKillzone: true,
    timeUtc: '',
  });

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const h = now.getUTCHours();
      const m = now.getUTCMinutes();
      const s = now.getUTCSeconds();
      const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} UTC`;

      let name = 'OFF_SESSION';
      let isKillzone = false;

      if ((h === 13 && m >= 30) || (h >= 14 && h < 17)) {
        name = 'US_ETF_OPEN & CASH SESSION';
        isKillzone = true;
      } else if (h >= 7 && h < 10) {
        name = 'LONDON INGESTION KILLZONE';
        isKillzone = true;
      } else if (h >= 0 && h < 3) {
        name = 'ASIA OPEN';
        isKillzone = false;
      }

      setCurrentSession({ name, isKillzone, timeUtc: timeStr });
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const [activeTrades, setActiveTrades] = useState<ActiveTradeDisplay[]>([
    {
      id: 'trade-btc-01',
      symbol: 'BTCUSD',
      direction: 'BUY',
      entryPrice: 67250.0,
      stopLoss: 67180.0,
      breakevenPrice: 67257.0,
      isBreakevenLocked: true,
      totalSize: 0.35,
      remainingSize: 0.26,
      realizedPnlUsd: 61.25,
      tranches: [
        { trancheNumber: 1, targetPrice: 67320.0, size: 0.09, status: 'TAKEN', realizedPnlUsd: 61.25 },
        { trancheNumber: 2, targetPrice: 67390.0, size: 0.12, status: 'ACTIVE', realizedPnlUsd: 0 },
        { trancheNumber: 3, targetPrice: undefined, size: 0.14, status: 'ACTIVE', realizedPnlUsd: 0 },
      ],
    },
  ]);

  const [recentSignals, setRecentSignals] = useState<SignalDisplay[]>([
    {
      id: 'sig-01',
      symbol: 'BTCUSD',
      direction: 'BUY',
      grade: 'A_PLUS',
      entryPrice: 67250.0,
      stopLoss: 67180.0,
      sweepBreachUsd: 74.5,
      allocatedRiskUsd: 245.0,
      positionSize: 0.35,
      session: 'US_ETF_OPEN',
      status: 'FILLED',
      detectedAt: Date.now() - 1000 * 60 * 18,
    },
    {
      id: 'sig-02',
      symbol: 'SOLUSD',
      direction: 'SELL',
      grade: 'A',
      entryPrice: 178.4,
      stopLoss: 179.6,
      sweepBreachUsd: 0.85,
      allocatedRiskUsd: 102.0,
      positionSize: 85.0,
      session: 'LONDON_INGESTION',
      status: 'CLOSED',
      detectedAt: Date.now() - 1000 * 60 * 140,
    },
  ]);

  const [dailyPnl, setDailyPnl] = useState<number>(61.25);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [footprintData, setFootprintData] = useState<{
    BTC?: { currentPrice: number; vwap: number; deltaVwap: number; cvd: number; obi: number; isAbsorptionConfirmed: boolean };
    SOL?: { currentPrice: number; vwap: number; deltaVwap: number; cvd: number; obi: number; isAbsorptionConfirmed: boolean };
  }>({
    BTC: { currentPrice: 67250.0, vwap: 67232.5, deltaVwap: 17.5, cvd: 42.5, obi: 0.38, isAbsorptionConfirmed: true },
    SOL: { currentPrice: 178.4, vwap: 178.65, deltaVwap: -0.25, cvd: -180.2, obi: -0.32, isAbsorptionConfirmed: true },
  });

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

    const fetchGodfatherData = async () => {
      try {
        const [signalsRes, tradesRes, statusRes] = await Promise.all([
          fetch(`${apiUrl}/api/v1/godfather/signals?limit=20`),
          fetch(`${apiUrl}/api/v1/godfather/trades?status=OPEN`),
          fetch(`${apiUrl}/api/v1/godfather/status`),
        ]);

        if (signalsRes.ok) {
          const sigs = await signalsRes.json();
          if (Array.isArray(sigs) && sigs.length > 0) {
            setRecentSignals(sigs);
          }
        }

        if (tradesRes.ok) {
          const trades = await tradesRes.json();
          if (Array.isArray(trades)) {
            setActiveTrades(trades);
          }
        }

        if (statusRes.ok) {
          const status = await statusRes.json();
          if (typeof status.dailyPnlUsd === 'number') {
            setDailyPnl(status.dailyPnlUsd);
          }
          if (status.footprint && (status.footprint.BTC || status.footprint.SOL)) {
            setFootprintData(prev => ({
              BTC: status.footprint.BTC || prev.BTC,
              SOL: status.footprint.SOL || prev.SOL,
            }));
          }
        }

        setIsConnected(true);
      } catch {
        setIsConnected(false);
      }
    };

    fetchGodfatherData();
    const interval = setInterval(fetchGodfatherData, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen text-white p-8 bg-[#0a0a0f]">
      {/* Header & Nav */}
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 pb-6 border-b border-gray-800">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-3xl">🎩</span>
            <h1 className="text-3xl font-black tracking-tight bg-gradient-to-r from-[#F59E0B] via-[#10B981] to-[#6366F1] bg-clip-text text-transparent">
              THE GODFATHER
            </h1>
            <span className="px-2.5 py-0.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-full text-xs font-mono font-bold">
              v1.0 SMC Engine
            </span>
            <span className={`px-2 py-0.5 border rounded-full text-xs font-mono font-bold ${
              isConnected
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
            }`}>
              {isConnected ? '● LIVE API' : '○ DEMO'}
            </span>
          </div>
          <p className="text-gray-400 text-sm mt-1">
            Institutional Liquidity Sweep & 3-Tranche Quantitative Scalper (BTCUSD & SOLUSD)
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="bg-gray-900/90 border border-gray-800 px-4 py-2 rounded-xl text-right">
            <div className="flex items-center gap-2 justify-end">
              <span className={`w-2 h-2 rounded-full ${currentSession.isKillzone ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              <span className="text-xs font-mono text-gray-300 font-bold">{currentSession.name}</span>
            </div>
            <p className="text-[11px] font-mono text-gray-500">{currentSession.timeUtc}</p>
          </div>

          <Link
            href="/"
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-xl text-xs font-semibold text-gray-300 transition-colors"
          >
            ← Switch Engine
          </Link>
        </div>
      </header>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Sizing & Asset Watchlist */}
        <div className="lg:col-span-1 space-y-6">
          {/* Kelly Risk Sizer Card */}
          <div className="bg-gray-900/70 backdrop-blur-md border border-gray-800 rounded-2xl p-6 shadow-xl">
            <h2 className="text-gray-400 text-xs font-black uppercase tracking-widest mb-4">
              Fractional Kelly Capital Allocation
            </h2>
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b border-gray-800/60">
                <span className="text-sm text-gray-400">Base Risk (κ = 0.25)</span>
                <span className="font-mono font-bold text-emerald-400">0.85% Account</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-800/60">
                <span className="text-sm text-gray-400">🦄 A+ Unicorn Multiplier</span>
                <span className="font-mono font-bold text-amber-400">2.40x Base</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-800/60">
                <span className="text-sm text-gray-400">⭐ Grade A Multiplier</span>
                <span className="font-mono font-bold text-blue-400">1.00x Base</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-800/60">
                <span className="text-sm text-gray-400">Daily Circuit Breaker</span>
                <span className="font-mono font-bold text-red-400">-4.50% Hard Cap</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-sm text-gray-400">Max Portfolio DD</span>
                <span className="font-mono font-bold text-red-500">9.00% Account</span>
              </div>
            </div>
          </div>

          {/* Asset Microstructure Parameters */}
          <div className="bg-gray-900/70 backdrop-blur-md border border-gray-800 rounded-2xl p-6 shadow-xl">
            <h2 className="text-gray-400 text-xs font-black uppercase tracking-widest mb-4">
              Asset Microstructure Guards
            </h2>
            <div className="space-y-4">
              <div className="p-4 bg-gray-950/60 border border-gray-800/80 rounded-xl">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-bold text-amber-400">BTCUSD Perpetual</span>
                  <span className="text-xs bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded border border-amber-500/20 font-mono">
                    Tier 1
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono text-gray-400">
                  <div>Min Sweep: <span className="text-white font-bold">≥ $50.00</span></div>
                  <div>Retest Cap: <span className="text-white font-bold">≤ 8 bars</span></div>
                  <div>Tranche 2 TP: <span className="text-white font-bold">+2.00R</span></div>
                  <div>BE Ratchet: <span className="text-emerald-400 font-bold">+1.00R</span></div>
                </div>
              </div>

              <div className="p-4 bg-gray-950/60 border border-gray-800/80 rounded-xl">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-bold text-purple-400">SOLUSD Perpetual</span>
                  <span className="text-xs bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded border border-purple-500/20 font-mono">
                    Tier 1
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono text-gray-400">
                  <div>Min Sweep: <span className="text-white font-bold">≥ $0.50</span></div>
                  <div>Retest Cap: <span className="text-white font-bold">≤ 15 bars</span></div>
                  <div>Tranche 2 TP: <span className="text-white font-bold">+2.50R</span></div>
                  <div>BE Ratchet: <span className="text-emerald-400 font-bold">+1.00R</span></div>
                </div>
              </div>
            </div>
          </div>

          {/* Sub-Second Tick Footprint & VWAP Delta */}
          <div className="bg-gray-900/70 backdrop-blur-md border border-gray-800 rounded-2xl p-6 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-gray-400 text-xs font-black uppercase tracking-widest">
                👣 Sub-Second Orderflow Footprint
              </h2>
              <span className="text-[10px] font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded animate-pulse">
                Hyperliquid L2
              </span>
            </div>

            <div className="space-y-4">
              {/* BTC Footprint */}
              <div className="p-4 bg-gray-950/70 border border-gray-800/80 rounded-xl space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-sm text-amber-400">BTC Footprint</span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                    footprintData.BTC?.isAbsorptionConfirmed
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-gray-800 text-gray-400'
                  }`}>
                    {footprintData.BTC?.isAbsorptionConfirmed ? 'ABSORPTION CONFIRMED' : 'NORMAL FLOW'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono text-gray-300">
                  <div>VWAP Δ: <span className={footprintData.BTC?.deltaVwap! >= 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                    {footprintData.BTC?.deltaVwap! >= 0 ? '+' : ''}${footprintData.BTC?.deltaVwap?.toFixed(2)}
                  </span></div>
                  <div>CVD: <span className="text-white font-bold">{footprintData.BTC?.cvd?.toFixed(2)} BTC</span></div>
                  <div>OBI (Depth 5): <span className={footprintData.BTC?.obi! >= 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                    {footprintData.BTC?.obi! >= 0 ? '+' : ''}{(footprintData.BTC?.obi! * 100).toFixed(1)}%
                  </span></div>
                  <div>VWAP: <span className="text-gray-400">${footprintData.BTC?.vwap?.toFixed(1)}</span></div>
                </div>
              </div>

              {/* SOL Footprint */}
              <div className="p-4 bg-gray-950/70 border border-gray-800/80 rounded-xl space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-sm text-purple-400">SOL Footprint</span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                    footprintData.SOL?.isAbsorptionConfirmed
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-gray-800 text-gray-400'
                  }`}>
                    {footprintData.SOL?.isAbsorptionConfirmed ? 'ABSORPTION CONFIRMED' : 'NORMAL FLOW'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono text-gray-300">
                  <div>VWAP Δ: <span className={footprintData.SOL?.deltaVwap! >= 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                    {footprintData.SOL?.deltaVwap! >= 0 ? '+' : ''}${footprintData.SOL?.deltaVwap?.toFixed(2)}
                  </span></div>
                  <div>CVD: <span className="text-white font-bold">{footprintData.SOL?.cvd?.toFixed(1)} SOL</span></div>
                  <div>OBI (Depth 5): <span className={footprintData.SOL?.obi! >= 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                    {footprintData.SOL?.obi! >= 0 ? '+' : ''}{(footprintData.SOL?.obi! * 100).toFixed(1)}%
                  </span></div>
                  <div>VWAP: <span className="text-gray-400">${footprintData.SOL?.vwap?.toFixed(2)}</span></div>
                </div>
              </div>
            </div>
          </div>

          {/* Multi-Region Geyser Colocation Card */}
          <div className="bg-gray-900/70 backdrop-blur-md border border-gray-800 rounded-2xl p-6 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-gray-400 text-xs font-black uppercase tracking-widest">
                🌐 Multi-Region Geyser Colocation
              </h2>
              <span className="text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded">
                Race Deduplication &lt;1μs
              </span>
            </div>
            <div className="space-y-3 text-xs font-mono">
              <div className="flex justify-between items-center p-2.5 bg-gray-950/60 border border-gray-800 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span className="text-gray-200 font-bold">Amsterdam (AMS)</span>
                </div>
                <span className="text-emerald-400 font-bold">5ms (64% Wins)</span>
              </div>
              <div className="flex justify-between items-center p-2.5 bg-gray-950/60 border border-gray-800 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-gray-200 font-bold">Tokyo (TYO)</span>
                </div>
                <span className="text-cyan-400 font-bold">105ms (22% Wins)</span>
              </div>
              <div className="flex justify-between items-center p-2.5 bg-gray-950/60 border border-gray-800 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-gray-200 font-bold">New York (EWR)</span>
                </div>
                <span className="text-amber-400 font-bold">28ms (14% Wins)</span>
              </div>
              <div className="p-3 bg-gray-950/80 border border-gray-800/80 rounded-lg text-[11px] text-gray-400 space-y-1">
                <div className="flex justify-between">
                  <span>Leader-Aware Jito:</span>
                  <span className="text-emerald-400 font-bold">DIRECT TO DATACENTER</span>
                </div>
                <div className="flex justify-between">
                  <span>Transit Latency Cut:</span>
                  <span className="text-white font-bold">~70% (-85ms saved)</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Active Trades & Signals */}
        <div className="lg:col-span-2 space-y-6">
          {/* Active Trades & 3-Tranche Lifecycle */}
          <div className="bg-gray-900/70 backdrop-blur-md border border-gray-800 rounded-2xl p-6 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-gray-400 text-xs font-black uppercase tracking-widest">
                Active Trades & 3-Tranche Harvesting
              </h2>
              <span className="text-xs font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded">
                {activeTrades.length} Active
              </span>
            </div>

            {activeTrades.length === 0 ? (
              <p className="text-gray-500 text-sm py-8 text-center font-mono">No active Godfather positions currently open.</p>
            ) : (
              activeTrades.map(trade => (
                <div key={trade.id} className="p-5 bg-gray-950/80 border border-gray-800 rounded-xl space-y-4">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-1 rounded text-xs font-black ${trade.direction === 'BUY' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
                        {trade.direction}
                      </span>
                      <span className="font-bold text-lg">{trade.symbol}</span>
                      <span className="text-xs font-mono text-gray-400">Entry: ${trade.entryPrice.toFixed(2)}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-mono font-bold text-emerald-400">
                        +${trade.realizedPnlUsd.toFixed(2)} USDC
                      </span>
                      <p className="text-[10px] text-gray-500 uppercase">Realized Profit</p>
                    </div>
                  </div>

                  {/* 3-Tranche Lifecycle Tracker */}
                  <div className="grid grid-cols-3 gap-3 pt-2">
                    {trade.tranches.map(t => (
                      <div
                        key={t.trancheNumber}
                        className={`p-3 rounded-lg border text-xs font-mono ${
                          t.status === 'TAKEN'
                            ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                            : 'bg-gray-900 border-gray-800 text-gray-300'
                        }`}
                      >
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-bold">Tranche {t.trancheNumber}</span>
                          <span className={`text-[10px] uppercase font-bold ${t.status === 'TAKEN' ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {t.status}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-400">
                          Vol: {t.trancheNumber === 1 ? '25%' : t.trancheNumber === 2 ? '35%' : '40%'} ({t.size})
                        </p>
                        <p className="text-[11px] text-gray-400">
                          {t.targetPrice ? `Target: $${t.targetPrice.toFixed(2)}` : 'Moonbag Runner'}
                        </p>
                      </div>
                    ))}
                  </div>

                  {trade.isBreakevenLocked && (
                    <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-lg border border-emerald-500/20">
                      <span>🔒</span>
                      <span>100% Risk-Free: Stop-Loss ratcheted to Breakeven (${trade.breakevenPrice.toFixed(2)})</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Recent Signals Feed */}
          <div className="bg-gray-900/70 backdrop-blur-md border border-gray-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-6 border-b border-gray-800">
              <h2 className="text-gray-400 text-xs font-black uppercase tracking-widest">
                Recent Quant Signals & Order Events
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-950/50 text-gray-500 text-[10px] uppercase font-black tracking-widest">
                  <tr>
                    <th className="px-6 py-4">Time</th>
                    <th className="px-6 py-4">Asset</th>
                    <th className="px-6 py-4">Conviction</th>
                    <th className="px-6 py-4">Sweep Breach</th>
                    <th className="px-6 py-4">Entry / SL</th>
                    <th className="px-6 py-4">Allocated Risk</th>
                    <th className="px-6 py-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60 font-mono text-xs">
                  {recentSignals.map(sig => (
                    <tr key={sig.id} className="hover:bg-gray-850/40 transition-colors">
                      <td className="px-6 py-4 text-gray-400">
                        {new Date(sig.detectedAt).toLocaleTimeString()}
                      </td>
                      <td className="px-6 py-4 font-bold text-white">
                        {sig.symbol} ({sig.direction})
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                          sig.grade === 'A_PLUS' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                        }`}>
                          {sig.grade === 'A_PLUS' ? '🦄 A+ Unicorn' : '⭐ Grade A'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-emerald-400">
                        +${sig.sweepBreachUsd.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 text-gray-300">
                        ${sig.entryPrice.toFixed(2)} / ${sig.stopLoss.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 text-gray-300">
                        ${sig.allocatedRiskUsd.toFixed(2)}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-emerald-400 font-bold">{sig.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
