'use client';

import React from 'react';

export function OrderDetail({ order, onClose }: { order: any; onClose: () => void }) {
  if (!order) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-md bg-gray-900 border-l border-gray-800 shadow-2xl z-50 overflow-y-auto">
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white">Order Details</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="space-y-6">
          {/* Status Header */}
          <div className={`p-4 rounded-lg ${
            order.status === 'landed' ? 'bg-green-900/20 border border-green-500 text-green-500' :
            order.status === 'failed' ? 'bg-red-900/20 border border-red-500 text-red-500' :
            'bg-amber-900/20 border border-amber-500 text-amber-500'
          }`}>
            <p className="text-sm uppercase font-bold tracking-wider">Status</p>
            <p className="text-2xl font-black">{order.status.toUpperCase()}</p>
          </div>

          {/* Execution Metrics */}
          <section>
            <h3 className="text-gray-400 text-xs uppercase mb-3 tracking-widest">Financials</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-800 p-3 rounded">
                <p className="text-gray-500 text-xs">Net Profit</p>
                <p className="text-white font-mono">{order.netProfitUsd?.toFixed(4)} USDC</p>
              </div>
              <div className="bg-gray-800 p-3 rounded">
                <p className="text-gray-500 text-xs">Jito Tip</p>
                <p className="text-white font-mono">{order.tipLamports / 1e9} SOL</p>
              </div>
            </div>
          </section>

          {/* Opportunity Link */}
          <section>
            <h3 className="text-gray-400 text-xs uppercase mb-3 tracking-widest">Opportunity</h3>
            <div className="bg-gray-800 p-4 rounded-lg space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-500 text-sm">Buy on</span>
                <span className="text-white font-medium">{order.opportunity?.buyDex}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 text-sm">Sell on</span>
                <span className="text-white font-medium">{order.opportunity?.sellDex}</span>
              </div>
            </div>
          </section>

          {/* Transactions */}
          {order.bundleId && (
            <section>
              <h3 className="text-gray-400 text-xs uppercase mb-3 tracking-widest">On-Chain</h3>
              <div className="space-y-2">
                <a 
                  href={`https://solscan.io/tx/${order.bundleId}`} 
                  target="_blank"
                  className="block w-full text-center py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium text-sm transition-colors"
                >
                  View Bundle on Solscan
                </a>
              </div>
            </section>
          )}

          {order.failureReason && (
            <section>
              <h3 className="text-red-400 text-xs uppercase mb-3 tracking-widest">Error Trace</h3>
              <div className="bg-red-900/10 border border-red-900/30 p-4 rounded font-mono text-xs text-red-500 whitespace-pre-wrap">
                {order.failureReason}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
