import type {
  OpportunityRepository,
  SimulationRepository,
  StatisticsRepository,
} from '@mev-research/database';
import { cacheGetJson, cacheSetJson } from '@mev-research/database';

const CACHE_TTL_SECONDS = 60;

interface Repos {
  opportunity: OpportunityRepository;
  simulation: SimulationRepository;
  statistics: StatisticsRepository;
}

export class AnalyticsService {
  private schedulerInterval?: ReturnType<typeof setInterval>;

  constructor(private readonly repos: Repos) {}

  /**
   * Get overall opportunity summary, cached in Redis for 60 seconds.
   */
  async getOpportunitySummary(): Promise<{
    total: number;
    profitable: number;
    avgNetProfitBps: number;
  }> {
    const cacheKey = 'analytics:opportunity_summary';
    const cached = await cacheGetJson<{ total: number; profitable: number; avgNetProfitBps: number }>(cacheKey);
    if (cached) return cached;

    const summary = await this.repos.opportunity.getSummary();
    await cacheSetJson(cacheKey, summary, CACHE_TTL_SECONDS);
    return summary;
  }

  /**
   * Get spread distribution across 6 buckets: <5, 5-10, 10-20, 20-50, 50-100, 100+
   */
  async getSpreadDistribution(): Promise<{ bucket: string; count: number }[]> {
    const cacheKey = 'analytics:spread_distribution';
    const cached = await cacheGetJson<{ bucket: string; count: number }[]>(cacheKey);
    if (cached) return cached;

    const distribution = await this.repos.opportunity.getSpreadDistribution();
    await cacheSetJson(cacheKey, distribution, CACHE_TTL_SECONDS);
    return distribution;
  }

  /**
   * Returns daily time series in ISO YYYY-MM-DD format.
   */
  async getDailyTimeSeries(
    days: number = 30,
  ): Promise<{ date: string; count: number; avgProfit: number }[]> {
    const cacheKey = `analytics:daily_ts:${days}`;
    const cached = await cacheGetJson<{ date: string; count: number; avgProfit: number }[]>(cacheKey);
    if (cached) return cached;

    const series = await this.repos.opportunity.getDailyTimeSeries(days);
    await cacheSetJson(cacheKey, series, CACHE_TTL_SECONDS);
    return series;
  }

  async getSimulationStats(): Promise<{
    total: number;
    successful: number;
    winRate: number;
    avgNetProfitBps: number;
  }> {
    return this.repos.simulation.getStats();
  }

  async getDailyPnL(days: number = 7) {
    return this.repos.statistics.getDailyPnL(days);
  }

  /**
   * Start scheduler that calls upsertDailyStats every 5 minutes.
   */
  startScheduler(): void {
    const upsert = async () => {
      const today = new Date().toISOString().split('T')[0]!;
      try {
        await this.repos.statistics.upsertDailyStats(today);
      } catch (e) {
        console.error('[Analytics] Failed to upsert daily stats:', e);
      }
    };

    upsert().catch(console.error);
    this.schedulerInterval = setInterval(upsert, 5 * 60 * 1_000);
    console.log('[Analytics] Scheduler started (5-minute interval)');
  }

  stopScheduler(): void {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
    }
  }
}
