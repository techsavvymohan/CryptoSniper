import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen text-white flex flex-col items-center justify-center gap-10 p-8 bg-[#0a0a0f]">
      <div className="text-center max-w-2xl">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono font-bold mb-4">
          <span>●</span> DUAL-ENGINE QUANTITATIVE FUND
        </div>
        <h1 className="text-5xl font-black tracking-tight mb-3 bg-gradient-to-r from-[#F59E0B] via-[#14F195] to-[#9945FF] bg-clip-text text-transparent">
          GODFATHER & SOLANA MEV
        </h1>
        <p className="text-gray-400 text-base">
          Dual-engine institutional architecture: High-speed Solana cross-DEX MEV arbitrage coupled with the directional SMC Godfather scalper for BTCUSD & SOLUSD.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl">
        {/* The Godfather */}
        <Link
          href="/godfather"
          className="group relative bg-gray-900/80 backdrop-blur-md border border-gray-800 rounded-2xl p-6 hover:border-amber-500/50 transition-all shadow-xl shadow-amber-500/5 hover:-translate-y-1"
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl">🎩</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase">
              Directional
            </span>
          </div>
          <h2 className="text-xl font-bold mb-1 group-hover:text-amber-400 transition-colors">The Godfather</h2>
          <p className="text-gray-400 text-xs leading-relaxed">
            M15 20-bar fractals, liquidity sweeps, tick delta absorption, and 3-tranche harvesting for BTC & SOL.
          </p>
        </Link>

        {/* MEV Execution */}
        <Link
          href="/execution"
          className="group relative bg-gray-900/80 backdrop-blur-md border border-gray-800 rounded-2xl p-6 hover:border-[#14F195]/50 transition-all shadow-xl shadow-[#14F195]/5 hover:-translate-y-1"
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl">⚡</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#14F195]/10 text-[#14F195] border border-[#14F195]/20 uppercase">
              Arbitrage
            </span>
          </div>
          <h2 className="text-xl font-bold mb-1 group-hover:text-[#14F195] transition-colors">MEV Execution</h2>
          <p className="text-gray-400 text-xs leading-relaxed">
            Live Solana Raydium CLMM & Orca Whirlpool cross-DEX atomic swap bundles submitted via Jito.
          </p>
        </Link>

        {/* MEV Simulation */}
        <Link
          href="/simulation"
          className="group relative bg-gray-900/80 backdrop-blur-md border border-gray-800 rounded-2xl p-6 hover:border-[#9945FF]/50 transition-all shadow-xl shadow-[#9945FF]/5 hover:-translate-y-1"
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl">🧪</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#9945FF]/10 text-[#9945FF] border border-[#9945FF]/20 uppercase">
              Analytics
            </span>
          </div>
          <h2 className="text-xl font-bold mb-1 group-hover:text-[#9945FF] transition-colors">MEV Simulation</h2>
          <p className="text-gray-400 text-xs leading-relaxed">
            Spread curves, historical win rates, Jito tip model simulation, and capital efficiency analysis.
          </p>
        </Link>
      </div>
    </main>
  );
}
