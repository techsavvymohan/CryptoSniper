import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

const API_BASE = '/api/v1/execution';

export function useRecentOrders(limit: number = 50) {
  return useQuery({
    queryKey: ['execution', 'orders', limit],
    queryFn: async () => {
      const { data } = await axios.get(`${API_BASE}/orders?limit=${limit}`);
      return data;
    },
    refetchInterval: 5000, // Refresh every 5s
  });
}

export function useDailyPnl(days: number = 7) {
  return useQuery({
    queryKey: ['execution', 'pnl', days],
    queryFn: async () => {
      const { data } = await axios.get(`${API_BASE}/pnl?days=${days}`);
      return data;
    },
  });
}

export function useWalletBalance() {
  return useQuery({
    queryKey: ['execution', 'wallet'],
    queryFn: async () => {
      const { data } = await axios.get(`${API_BASE}/wallet`);
      return data;
    },
    refetchInterval: 30000, // Refresh every 30s
  });
}

export function useKillSwitch() {
  const queryClient = useQueryClient();

  const { data: status } = useQuery({
    queryKey: ['execution', 'kill-switch'],
    queryFn: async () => {
      // Assuming a dedicated status endpoint or derived from config
      const { data } = await axios.get(`${API_BASE}/status`);
      return data.killSwitchActive;
    },
  });

  const activate = useMutation({
    mutationFn: (reason: string) => axios.post(`${API_BASE}/kill-switch`, { reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['execution'] }),
  });

  const release = useMutation({
    mutationFn: () => axios.delete(`${API_BASE}/kill-switch`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['execution'] }),
  });

  return {
    isActive: status,
    activate: activate.mutateAsync,
    release: release.mutateAsync,
    isActivating: activate.isPending,
    isReleasing: release.isPending,
  };
}
