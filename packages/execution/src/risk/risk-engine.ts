/**
 * Risk Engine for Solana Arbitrage Bot
 * Enforces safety constraints before allowing trade execution.
 */

import { ArbitrageOpportunity, ExecutionConfig } from '@mev-research/shared';

export interface ExecutionRepository {
  getDailyStats(date: Date): Promise<{ netProfitUsdc: number }>;
  findRecent(count: number): Promise<{ status: string }[]>;
  insert(order: any): Promise<void>;
  updateStatus(id: string, status: string, metadata?: any): Promise<any>;
}

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, duration?: number): Promise<void>;
  del(key: string): Promise<void>;
  publish(channel: string, message: any): Promise<void>;
}

export class RiskEngine {
  constructor(
    private config: ExecutionConfig,
    private executionRepo: ExecutionRepository,
    private redis: RedisClient
  ) {}

  /**
   * Evaluates if an arbitrage opportunity is safe to execute.
   */
  async canExecute(opportunity: ArbitrageOpportunity): Promise<{ allowed: boolean; reason?: string }> {
    // FIX 6: Redis check must be the FIRST check before anything else
    // FIX 6: Redis key must be exactly: 'execution:kill-switch'
    const killSwitch = await this.redis.get('execution:kill-switch');
    if (killSwitch) {
      return { allowed: false, reason: 'KILL_SWITCH' };
    }

    // FIX 7: dailyLossLimitUsdc check must use today's date in UTC: new Date().toISOString().split('T')[0]
    const todayStr = new Date().toISOString().split('T')[0];

    // 2. Check simulation mode
    if (this.config.simulationMode) {
      return { allowed: false, reason: 'SIMULATION_MODE' };
    }

    // 5. Check daily loss limit
    try {
      // FIX 7: executionRepo.getDailyStats() must filter by date = today (not timestamp range)
      // Implementation note: The repo should handle the date filtering
      const todayStats = await this.executionRepo.getDailyStats(new Date(todayStr));
      
      // FIX 7: Loss calculation: loss = sum of negative actual_profit_usdc for today's landed orders
      // (Assuming getDailyStats already returns the pre-calculated netProfitUsdc for the day)
      const dailyLoss = Math.abs(Math.min(todayStats.netProfitUsdc, 0));
      
      // FIX 7: Check must happen AFTER kill switch check but BEFORE concurrency check
      if (dailyLoss >= this.config.dailyLossLimitUsdc) {
        return { allowed: false, reason: 'DAILY_LOSS_LIMIT' };
      }
    } catch (e) {
      console.error('[RiskEngine] Failed to fetch daily stats:', e);
      return { allowed: false, reason: 'STATS_FETCH_FAILURE' };
    }

    // 3. Check opportunity confidence
    if (opportunity.confidenceScore < 60) {
      return { allowed: false, reason: 'LOW_CONFIDENCE' };
    }

    // 4. Check net profit
    if (opportunity.netProfitBps < this.config.minNetProfitBps) {
      return { allowed: false, reason: 'BELOW_MIN_PROFIT' };
    }

    // 6. Check consecutive failures
    try {
      const recentOrders = await this.executionRepo.findRecent(this.config.pauseOnConsecutiveFailures);
      const allFailed = 
        recentOrders.length >= this.config.pauseOnConsecutiveFailures &&
        recentOrders.every(o => o.status === 'failed');
      
      if (allFailed) {
        return { allowed: false, reason: 'CONSECUTIVE_FAILURES' };
      }
    } catch (e) {
      console.error('[RiskEngine] Failed to fetch recent orders:', e);
    }

    return { allowed: true };
  }

  /**
   * Triggers a temporary kill switch for execution.
   */
  async triggerKillSwitch(reason: string): Promise<void> {
    await this.redis.set('execution:kill-switch', reason, 'EX', 3600); // Expires in 1 hour
    console.error('[KILL SWITCH TRIGGERED]', reason);
  }

  /**
   * Manually releases the kill switch.
   */
  async releaseKillSwitch(): Promise<void> {
    await this.redis.del('execution:kill-switch');
    console.log('[KILL SWITCH RELEASED]');
  }
}
