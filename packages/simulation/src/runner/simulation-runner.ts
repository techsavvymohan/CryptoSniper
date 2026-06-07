import Redis from 'ioredis';
import type { ArbitrageOpportunity } from '@mev-research/shared';
import { CHANNELS } from '@mev-research/shared';
import type { SimulationRepository } from '@mev-research/database';
import { SimulationEngine } from '../engine/simulation-engine.js';

export interface SimulationStats {
  totalSimulated: number;
  totalSuccessful: number;
  totalFailed: number;
  winRate: number;
  avgNetProfitBps: number;
  failureBreakdown: {
    SLIPPAGE_EXCEEDED: number;
    SPREAD_EVAPORATED: number;
    INSUFFICIENT_PROFIT: number;
  };
}

export interface SimulationReport {
  stats: SimulationStats;
  recommendation: 'GO_LIVE' | 'NEEDS_MORE_DATA' | 'DO_NOT_GO_LIVE';
  reason: string;
}

const STATS_KEY = 'mev:simulation:stats';
const MIN_TRADES_FOR_RECOMMENDATION = 500;
const MIN_WIN_RATE_FOR_GO_LIVE = 60;

export class SimulationRunner {
  private engine: SimulationEngine;
  private subscriber: Redis;
  private publisher: Redis;
  private stats: SimulationStats = {
    totalSimulated: 0,
    totalSuccessful: 0,
    totalFailed: 0,
    winRate: 0,
    avgNetProfitBps: 0,
    failureBreakdown: { SLIPPAGE_EXCEEDED: 0, SPREAD_EVAPORATED: 0, INSUFFICIENT_PROFIT: 0 },
  };
  private profitBpsSum = 0;
  private saveInterval?: ReturnType<typeof setInterval>;

  constructor(
    private readonly repo: SimulationRepository,
    private readonly redisUrl: string,
    capitalUsdc: number = 50,
  ) {
    this.engine = new SimulationEngine(repo, { capitalUsdc });
    this.subscriber = new Redis(redisUrl);
    this.publisher = new Redis(redisUrl);
    this.subscriber.on('error', (e) => console.error('[SimRunner/sub]', e.message));
    this.publisher.on('error', (e) => console.error('[SimRunner/pub]', e.message));
  }

  async start(): Promise<void> {
    // Subscribe to the mev:opportunities channel
    await this.subscriber.subscribe(CHANNELS.OPPORTUNITIES);
    this.subscriber.on('message', (_channel: string, message: string) => {
      try {
        const event = JSON.parse(message) as { type: string; payload: unknown };
        if (event.type === 'OPPORTUNITY_DETECTED') {
          const opp = event.payload as ArbitrageOpportunity;
          this.engine.simulate(opp).then(result => {
            this.updateStats(result.success, result.netProfitBps, result.failureReason);
          }).catch(err => console.error('[SimRunner] Simulation error:', err));
        }
      } catch {
        // Malformed message — ignore
      }
    });

    // Save running stats to Redis every 60 seconds
    this.saveInterval = setInterval(() => this.saveStats(), 60_000);

    console.log('[SimRunner] Started — listening on', CHANNELS.OPPORTUNITIES);
  }

  stop(): void {
    if (this.saveInterval) clearInterval(this.saveInterval);
    this.subscriber.disconnect();
    this.publisher.disconnect();
  }

  private updateStats(
    success: boolean,
    netProfitBps: number,
    failureReason?: string,
  ): void {
    this.stats.totalSimulated++;
    if (success) {
      this.stats.totalSuccessful++;
      this.profitBpsSum += netProfitBps;
    } else {
      this.stats.totalFailed++;
      if (failureReason === 'SLIPPAGE_EXCEEDED') this.stats.failureBreakdown.SLIPPAGE_EXCEEDED++;
      if (failureReason === 'SPREAD_EVAPORATED') this.stats.failureBreakdown.SPREAD_EVAPORATED++;
      if (failureReason === 'INSUFFICIENT_PROFIT') this.stats.failureBreakdown.INSUFFICIENT_PROFIT++;
    }
    this.stats.winRate =
      this.stats.totalSimulated > 0
        ? (this.stats.totalSuccessful / this.stats.totalSimulated) * 100
        : 0;
    this.stats.avgNetProfitBps =
      this.stats.totalSuccessful > 0
        ? this.profitBpsSum / this.stats.totalSuccessful
        : 0;
  }

  private async saveStats(): Promise<void> {
    try {
      await this.publisher.set(STATS_KEY, JSON.stringify(this.stats), 'EX', 3600);
      console.log('[SimRunner] Stats saved:', JSON.stringify(this.stats));
    } catch (e) {
      console.error('[SimRunner] Failed to save stats:', e);
    }
  }

  getStats(): SimulationStats {
    return { ...this.stats };
  }

  /**
   * generateReport() — produces a go/no-go recommendation.
   * GO_LIVE:          winRate >= 60% AND total >= 500 AND avgNetProfitBps > 0
   * DO_NOT_GO_LIVE:   total >= 500 AND winRate < 60%
   * NEEDS_MORE_DATA:  total < 500
   */
  generateReport(): SimulationReport {
    const { totalSimulated, winRate, avgNetProfitBps } = this.stats;

    if (totalSimulated < MIN_TRADES_FOR_RECOMMENDATION) {
      return {
        stats: this.stats,
        recommendation: 'NEEDS_MORE_DATA',
        reason: `Only ${totalSimulated} simulations completed. Need at least ${MIN_TRADES_FOR_RECOMMENDATION}.`,
      };
    }

    if (winRate >= MIN_WIN_RATE_FOR_GO_LIVE && avgNetProfitBps > 0) {
      return {
        stats: this.stats,
        recommendation: 'GO_LIVE',
        reason: `Win rate ${winRate.toFixed(1)}% (>= 60%) with avg profit ${avgNetProfitBps.toFixed(1)}bps after ${totalSimulated} trades.`,
      };
    }

    return {
      stats: this.stats,
      recommendation: 'DO_NOT_GO_LIVE',
      reason: `Win rate ${winRate.toFixed(1)}% is below the 60% threshold after ${totalSimulated} trades.`,
    };
  }
}
