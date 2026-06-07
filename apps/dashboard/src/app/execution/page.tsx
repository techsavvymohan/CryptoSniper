'use client';

import React, { useState } from 'react';
import { 
  useRecentOrders, 
  useDailyPnl, 
  useWalletBalance 
} from '../../hooks/use-execution';
import { KillSwitchButton } from '../../components/execution/kill-switch-button';
import { OrderDetail } from '../../components/execution/order-detail';

export default function ExecutionDashboard() {
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  
  const { data: orders, isLoading: ordersLoading } = useRecentOrders(20);
  const { data: wallet, refetch: refreshWallet } = useWalletBalance();
  const { data: pnl } = useDailyPnl(7);

  const isSimulation = process.env.NEXT_PUBLIC_SIMULATION_MODE !== 'false';

  return (
    <div className="min-h-screen text-white p-8">
      {/* Header & Mode Banner */}
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight">EXECUTION</h1>
          <div className="mt-2">
            {isSimulation ? (
              <span className="px-3 py-1 bg-blue-600/20 border border-blue-500 text-blue-500 rounded-full text-xs font-black uppercase tracking-widest">
                🔵 SIMULATION MODE
              </span>
            ) : (
              <span className="px-3 py-1 bg-red-600/20 border border-red-500 text-red-500 rounded-full text-xs font-black uppercase tracking-widest animate-pulse">
                🔴 LIVE TRADING
              </span>
            )}
          </div>
        </div>
        
        <div className="w-64">
          <KillSwitchButton />
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Wallet & Stats */}
        <div className="lg:col-span-1 space-y-8">
          {/* Wallet Card */}
          <div className="bg-gray-900/80 backdrop-blur-md border border-gray-800/80 rounded-2xl p-6 shadow-xl shadow-[#9945FF]/10">
            <div className="flex justify-between items-start mb-6">
              <h2 className="text-gray-400 text-xs font-black uppercase tracking-widest">Wallet Status</h2>
              <button onClick={() => refreshWallet()} className="text-gray-500 hover:text-white transition-colors">
                <span className="material-symbols-outlined text-sm">refresh</span>
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <p className="text-2xl font-mono font-bold">{wallet?.solBalance?.toFixed(4) || '0.0000'} SOL</p>
                <p className="text-xs text-gray-500 uppercase">Solana Balance</p>
              </div>
              <div>
                <p className="text-2xl font-mono font-bold text-green-500">${wallet?.usdcBalance?.toLocaleString() || '0.00'} USDC</p>
                <p className="text-xs text-gray-500 uppercase">USDC Balance</p>
              </div>
            </div>
            
            <div className="mt-6 pt-6 border-t border-gray-800">
              <p className="text-sm font-medium">Daily P&L</p>
              <p className={`text-xl font-black ${pnl?.today >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {pnl?.today >= 0 ? '+' : ''}{pnl?.today?.toFixed(2) || '0.00'} USDC
              </p>
            </div>
          </div>

          {/* Today's Stats Cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-900/80 backdrop-blur-md border border-gray-800/80 p-4 rounded-xl">
              <p className="text-gray-500 text-[10px] uppercase font-black tracking-widest mb-1">Orders</p>
              <p className="text-xl font-bold">{orders?.length || 0}</p>
            </div>
            <div className="bg-gray-900/80 backdrop-blur-md border border-gray-800/80 p-4 rounded-xl">
              <p className="text-gray-500 text-[10px] uppercase font-black tracking-widest mb-1">Success</p>
              <p className="text-xl font-bold text-green-500">
                {orders?.length ? ((orders.filter((o:any) => o.status === 'landed').length / orders.length) * 100).toFixed(0) : 0}%
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Orders Table & Chart */}
        <div className="lg:col-span-2 space-y-8">
          {/* Orders Table */}
          <div className="bg-gray-900/80 backdrop-blur-md border border-gray-800/80 rounded-2xl overflow-hidden shadow-xl shadow-[#9945FF]/10">
            <div className="p-6 border-b border-gray-800">
              <h2 className="text-gray-400 text-xs font-black uppercase tracking-widest">Recent Activity</h2>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-950/50 text-gray-500 text-[10px] uppercase font-black tracking-widest">
                  <tr>
                    <th className="px-6 py-4">Time</th>
                    <th className="px-6 py-4">Pair</th>
                    <th className="px-6 py-4">Capital</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {orders?.map((order: any) => (
                    <tr 
                      key={order.id} 
                      onClick={() => setSelectedOrder(order)}
                      className="hover:bg-gray-800 cursor-pointer transition-colors"
                    >
                      <td className="px-6 py-4 text-xs font-mono text-gray-400">
                        {new Date(order.createdAt).toLocaleTimeString()}
                      </td>
                      <td className="px-6 py-4 font-bold text-sm">
                        {order.opportunity?.pair || 'SOL/USDC'}
                      </td>
                      <td className="px-6 py-4 text-sm font-mono">
                        ${order.opportunity?.requiredCapitalUsdc?.toFixed(0)}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-wider ${
                          order.status === 'landed' ? 'bg-green-500/10 text-green-500' :
                          order.status === 'failed' ? 'bg-red-500/10 text-red-500' :
                          'bg-amber-500/10 text-amber-500'
                        }`}>
                          {order.status}
                        </span>
                      </td>
                      <td className={`px-6 py-4 text-sm font-black font-mono ${order.netProfitUsd > 0 ? 'text-green-500' : 'text-gray-500'}`}>
                        {order.status === 'landed' ? `+${order.netProfitUsd?.toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <OrderDetail 
        order={selectedOrder} 
        onClose={() => setSelectedOrder(null)} 
      />
    </div>
  );
}
