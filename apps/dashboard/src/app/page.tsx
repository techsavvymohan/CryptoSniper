import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen text-white flex flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-5xl font-black tracking-tight mb-2 bg-gradient-to-r from-[#14F195] via-white to-[#9945FF] bg-clip-text text-transparent">
          MEV Research Bot
        </h1>
        <p className="text-gray-400 text-lg">Solana cross-DEX arbitrage monitoring</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-lg">
        <Link
          href="/execution"
          className="bg-gray-900/80 backdrop-blur-md border border-gray-800/80 rounded-2xl p-6 hover:border-[#14F195]/50 transition-colors shadow-lg shadow-[#9945FF]/10"
        >
          <h2 className="text-xl font-bold mb-1">Execution</h2>
          <p className="text-gray-400 text-sm">Live orders, wallet, P&L</p>
        </Link>

        <Link
          href="/simulation"
          className="bg-gray-900/80 backdrop-blur-md border border-gray-800/80 rounded-2xl p-6 hover:border-[#14F195]/50 transition-colors shadow-lg shadow-[#9945FF]/10"
        >
          <h2 className="text-xl font-bold mb-1">Simulation</h2>
          <p className="text-gray-400 text-sm">Win rate, profit distribution</p>
        </Link>
      </div>
    </main>
  );
}
