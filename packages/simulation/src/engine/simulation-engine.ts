import type { ArbitrageOpportunity, SimulationTrade } from '@mev-research/shared';
import { generateId } from '@mev-research/shared';
import type { SimulationRepository } from '@mev-research/database';

/**
 * Box-Muller transform: produces a normally distributed random number
 * with mean 0 and standard deviation 1.
 */
function gaussianRandom(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export interface SimulationConfig {
  /** Standard deviation of price noise (fraction of price, e.g. 0.001 = 0.1%) */
  noiseStdDev?: number;
  /** Capital size in USDC used for each simulation */
  capitalUsdc?: number;
}

export class SimulationEngine {
  private readonly noiseStdDev: number;
  private readonly capitalUsdc: number;

  constructor(
    private readonly repo: SimulationRepository,
    config: SimulationConfig = {},
  ) {
    this.noiseStdDev = config.noiseStdDev ?? 0.001;
    this.capitalUsdc = config.capitalUsdc ?? 50;
  }

  /**
   * Simulate a single arbitrage opportunity with realistic noise applied.
   * Noise is applied as: buyPrice * (1 + noise), sellPrice * (1 - |noise|)
   * Every simulation result is persisted to the database.
   */
  async simulate(opportunity: ArbitrageOpportunity): Promise<SimulationTrade> {
    const start = Date.now();
    const inputBuyPrice = 1.0; // Normalised: buy at 1.0, sell at 1 + spread
    const spread = opportunity.grossSpreadBps / 10_000;
    const inputSellPrice = inputBuyPrice * (1 + spread);

    const noise = gaussianRandom() * this.noiseStdDev;
    const noisedBuyPrice = inputBuyPrice * (1 + noise);
    const noisedSellPrice = inputSellPrice * (1 - Math.abs(noise));

    const noisedSpread = (noisedSellPrice - noisedBuyPrice) / noisedBuyPrice;
    const noisedGrossSpreadBps = noisedSpread * 10_000;

    const buyFeeBps = opportunity.buyFeesBps;
    const sellFeeBps = opportunity.sellFeesBps;
    const buySlippageBps = opportunity.buySlippageBps;
    const sellSlippageBps = opportunity.sellSlippageBps;

    const netProfitBps =
      noisedGrossSpreadBps - buyFeeBps - sellFeeBps - buySlippageBps - sellSlippageBps - 5;

    let success = true;
    let failureReason: SimulationTrade['failureReason'];

    if (noisedGrossSpreadBps < opportunity.grossSpreadBps * 0.1) {
      success = false;
      failureReason = 'SPREAD_EVAPORATED';
    } else if (buySlippageBps + sellSlippageBps > noisedGrossSpreadBps * 0.8) {
      success = false;
      failureReason = 'SLIPPAGE_EXCEEDED';
    } else if (netProfitBps <= 0) {
      success = false;
      failureReason = 'INSUFFICIENT_PROFIT';
    }

    const netProfitUsd = success ? (netProfitBps / 10_000) * this.capitalUsdc : 0;
    const latencyMs = Date.now() - start;

    const trade: SimulationTrade = {
      id: generateId(),
      opportunityId: opportunity.id,
      simulatedAt: new Date(),
      inputBuyPrice,
      inputSellPrice,
      noisedBuyPrice,
      noisedSellPrice,
      grossSpreadBps: noisedGrossSpreadBps,
      netProfitBps: success ? netProfitBps : 0,
      netProfitUsd,
      capitalUsdc: this.capitalUsdc,
      success,
      failureReason,
      latencyMs,
    };

    // Persist every simulation to the database
    await this.repo.insert(trade);
    return trade;
  }

  /**
   * Simulate a batch of opportunities with at most 10 concurrent simulations.
   */
  async simulateBatch(opportunities: ArbitrageOpportunity[]): Promise<SimulationTrade[]> {
    const CONCURRENCY = 10;
    const results: SimulationTrade[] = [];

    for (let i = 0; i < opportunities.length; i += CONCURRENCY) {
      const chunk = opportunities.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(chunk.map(opp => this.simulate(opp)));
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        }
      }
    }
    return results;
  }
}
