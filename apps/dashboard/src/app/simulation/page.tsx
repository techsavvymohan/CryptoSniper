'use client';

import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function SimulationPage() {
  const { data: status, isLoading } = useQuery({
    queryKey: ['execution', 'status'],
    queryFn: async () => {
      const { data } = await axios.get(`${API_BASE}/api/v1/execution/status`);
      return data;
    },
    refetchInterval: 10_000,
  });

  return (
    <div className="min-h-screen text-white p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-black tracking-tight">SIMULATION</h1>
        <p className="text-gray-400 mt-1">72-hour simulation results and go-live recommendation</p>
      </header>

      <div className="bg-gray-900/80 backdrop-blur-md border border-gray-800/80 rounded-2xl p-6 shadow-lg shadow-[#9945FF]/10">
        {isLoading ? (
          <p className="text-gray-400">Loading...</p>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm uppercase tracking-widest font-black">Mode</span>
              <span className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest ${
                status?.simulationMode
                  ? 'bg-blue-600/20 border border-blue-500 text-blue-400'
                  : 'bg-red-600/20 border border-red-500 text-red-400'
              }`}>
                {status?.simulationMode ? 'SIMULATION' : 'LIVE'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm uppercase tracking-widest font-black">Kill Switch</span>
              <span className={status?.killSwitchActive ? 'text-red-400 font-bold' : 'text-green-400 font-bold'}>
                {status?.killSwitchActive ? 'ACTIVE' : 'INACTIVE'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
