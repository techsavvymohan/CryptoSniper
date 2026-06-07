import type { PoolSnapshot, ArbitrageOpportunity } from '@mev-research/shared';
import { comparePoolPair } from '../detection/spread-detector.js';

const MAX_HISTORY = 10_000;

interface DetectionRecord {
  opportunityId: string;
  netProfitBps: number;
  detectedAt: number;
  latencyMs: number;
}

export interface OpportunityManagerStats {
  totalPoolsTracked: number;
  totalPairsMonitored: number;
  totalDetections: number;
  avgDetectionLatencyMs: number;
  recentOpportunities: number;
}

export class OpportunityManager {
  /** Maps sorted-mint key → [poolA, poolB] */
  private poolsByTokenPair = new Map<string, PoolSnapshot[]>();

  /** Ring buffer of detection history, capped at MAX_HISTORY */
  private detectionHistory: DetectionRecord[] = [];

  private callbacks: Array<(opp: ArbitrageOpportunity) => void> = [];

  constructor(
    private readonly tradeCapitalUsdc: number,
    private readonly minNetProfitBps: number,
  ) {}

  onOpportunity(callback: (opp: ArbitrageOpportunity) => void): void {
    this.callbacks.push(callback);
  }

  updatePool(snapshot: PoolSnapshot): void {
    const start = Date.now();

    // Key uses sorted mints so A/B order doesn't matter
    const pairKey = [snapshot.tokenMintA, snapshot.tokenMintB]
      .map(m => m.toLowerCase())
      .sort()
      .join(':');

    const peers = this.poolsByTokenPair.get(pairKey) ?? [];

    // Update or insert this pool in the list
    const existingIdx = peers.findIndex(p => p.address === snapshot.address);
    if (existingIdx >= 0) {
      peers[existingIdx] = snapshot;
    } else {
      peers.push(snapshot);
    }
    this.poolsByTokenPair.set(pairKey, peers);

    // Only compare when at least 2 pools for this pair exist
    if (peers.length < 2) return;

    // Compare each unique pair combination
    for (let i = 0; i < peers.length; i++) {
      for (let j = i + 1; j < peers.length; j++) {
        const opp = comparePoolPair(
          peers[i]!,
          peers[j]!,
          this.tradeCapitalUsdc,
          this.minNetProfitBps,
        );
        if (!opp) continue;

        const latencyMs = Date.now() - start;
        console.log(
          `[SpreadEngine] Opportunity: ${opp.pair} | net ${opp.netProfitBps.toFixed(1)}bps | ` +
          `confidence ${opp.confidenceScore} | latency ${latencyMs}ms`,
        );

        // Push to ring buffer — evict oldest if at capacity
        if (this.detectionHistory.length >= MAX_HISTORY) {
          this.detectionHistory.shift();
        }
        this.detectionHistory.push({
          opportunityId: opp.id,
          netProfitBps: opp.netProfitBps,
          detectedAt: opp.detectedAt,
          latencyMs,
        });

        for (const cb of this.callbacks) {
          try {
            cb(opp);
          } catch {
            // Callback errors must not propagate
          }
        }
      }
    }
  }

  getStatistics(): OpportunityManagerStats {
    const totalDetections = this.detectionHistory.length;
    const avgLatency =
      totalDetections > 0
        ? this.detectionHistory.reduce((s, r) => s + r.latencyMs, 0) / totalDetections
        : 0;
    const recentCutoff = Date.now() - 60_000;
    const recentOpportunities = this.detectionHistory.filter(
      r => r.detectedAt >= recentCutoff,
    ).length;

    return {
      totalPoolsTracked: [...this.poolsByTokenPair.values()].reduce(
        (s, arr) => s + arr.length, 0,
      ),
      totalPairsMonitored: this.poolsByTokenPair.size,
      totalDetections,
      avgDetectionLatencyMs: Math.round(avgLatency),
      recentOpportunities,
    };
  }
}
