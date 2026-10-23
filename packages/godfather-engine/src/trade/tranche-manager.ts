import type {
  Candle,
  GodfatherTrade,
  GodfatherTranche,
  TradeDirection,
} from '@mev-research/shared';
import { generateId } from '@mev-research/shared';

export interface TrancheEvaluationResult {
  action: 'NONE' | 'TRANCHE_1_HIT' | 'TRANCHE_2_HIT' | 'TRANCHE_3_HIT' | 'FULL_STOP_OUT' | 'STAGNATION_EXIT';
  tradeUpdates?: Partial<GodfatherTrade>;
  trancheUpdates?: Array<{ id: string; updates: Partial<GodfatherTranche> }>;
  realizedPnlDeltaUsd: number;
  message?: string;
}

/**
 * Initializes the 3 discrete harvesting tranches for a new trade:
 * Tranche 1: 35% volume @ +1.50R (triggers Breakeven stop ratchet)
 * Tranche 2: 35% volume @ +2.50R
 * Tranche 3: 30% volume Moonbag runner (dynamic 3.0x ATR Chandelier Stop)
 */
export function createTranches(
  tradeId: string,
  entryPrice: number,
  stopLoss: number,
  totalSize: number,
  direction: TradeDirection,
  targetR2 = 3.0,
): GodfatherTranche[] {
  const rDistance = Math.abs(entryPrice - stopLoss);
  const size1 = parseFloat((totalSize * 0.35).toFixed(4));
  const size2 = parseFloat((totalSize * 0.35).toFixed(4));
  // Allocate remaining volume to Tranche 3 to avoid rounding leakage
  const size3 = parseFloat((totalSize - size1 - size2).toFixed(4));

  const t1Target = direction === 'BUY' ? entryPrice + 1.5 * rDistance : entryPrice - 1.5 * rDistance;
  const t2Target = direction === 'BUY' ? entryPrice + targetR2 * rDistance : entryPrice - targetR2 * rDistance;

  return [
    {
      id: generateId(),
      tradeId,
      trancheNumber: 1,
      targetRr: 1.5,
      targetPrice: t1Target,
      volumeFraction: 0.35,
      size: size1,
      status: 'ACTIVE',
      realizedPnlUsd: 0,
    },
    {
      id: generateId(),
      tradeId,
      trancheNumber: 2,
      targetRr: targetR2,
      targetPrice: t2Target,
      volumeFraction: 0.35,
      size: size2,
      status: 'ACTIVE',
      realizedPnlUsd: 0,
    },
    {
      id: generateId(),
      tradeId,
      trancheNumber: 3,
      targetRr: undefined,
      targetPrice: undefined, // Moonbag runner
      volumeFraction: 0.30,
      size: size3,
      trailingStop: stopLoss,
      status: 'ACTIVE',
      realizedPnlUsd: 0,
    },
  ];
}

/**
 * Evaluates trade state against current closed M1 bar.
 */
export function evaluateTrancheExits(
  trade: GodfatherTrade,
  currentCandle: Candle,
  atr: number,
  barsInTrade: number,
  maxStagnationBars = 36,
): TrancheEvaluationResult {
  if (trade.status !== 'OPEN') {
    return { action: 'NONE', realizedPnlDeltaUsd: 0 };
  }

  const { direction, entryPrice, stopLoss } = trade;
  // Derive immutable initial 1R unit risk distance: use initialStopLoss, or recover from Tranche 1 geometry, or fallback to current stopLoss
  const t1Tranche = trade.tranches.find(t => t.trancheNumber === 1);
  const rDistance = trade.initialStopLoss !== undefined
    ? Math.abs(entryPrice - trade.initialStopLoss)
    : (t1Tranche?.targetPrice && t1Tranche.targetRr
        ? Math.abs(t1Tranche.targetPrice - entryPrice) / t1Tranche.targetRr
        : Math.abs(entryPrice - stopLoss));
  const bufferR = rDistance * 0.10; // +0.10R buffer for breakeven lock

  // 1. Check Full Stop Loss
  const isStoppedOut =
    direction === 'BUY'
      ? currentCandle.low <= stopLoss
      : currentCandle.high >= stopLoss;

  if (isStoppedOut) {
    const exitPrice = stopLoss;
    const trancheUpdates: Array<{ id: string; updates: Partial<GodfatherTranche> }> = [];
    let totalPnlLoss = 0;

    for (const t of trade.tranches) {
      if (t.status === 'ACTIVE') {
        const pnl =
          direction === 'BUY'
            ? (exitPrice - entryPrice) * t.size
            : (entryPrice - exitPrice) * t.size;

        totalPnlLoss += pnl;
        trancheUpdates.push({
          id: t.id,
          updates: {
            status: 'STOPPED_OUT',
            closedPrice: exitPrice,
            realizedPnlUsd: pnl,
            closedAt: currentCandle.closeTime,
          },
        });
      }
    }

    return {
      action: 'FULL_STOP_OUT',
      tradeUpdates: {
        status: 'CLOSED',
        closedAt: currentCandle.closeTime,
        remainingSize: 0,
        realizedPnlUsd: trade.realizedPnlUsd + totalPnlLoss,
        exitReason: trade.isBreakevenLocked ? 'BREAKEVEN_STOP' : 'INITIAL_STOP_LOSS',
      },
      trancheUpdates,
      realizedPnlDeltaUsd: totalPnlLoss,
      message: `Stop Loss Hit at ${exitPrice}`,
    };
  }

  // 2. Check Stagnation Exit
  // If trade is older than maxStagnationBars and current price is < 0.30R in profit
  const currentFloatingProfitR =
    direction === 'BUY'
      ? (currentCandle.close - entryPrice) / rDistance
      : (entryPrice - currentCandle.close) / rDistance;

  if (barsInTrade >= maxStagnationBars && currentFloatingProfitR < 0.30 && !trade.isBreakevenLocked) {
    const exitPrice = currentCandle.close;
    const trancheUpdates: Array<{ id: string; updates: Partial<GodfatherTranche> }> = [];
    let stagPnl = 0;

    for (const t of trade.tranches) {
      if (t.status === 'ACTIVE') {
        const pnl =
          direction === 'BUY'
            ? (exitPrice - entryPrice) * t.size
            : (entryPrice - exitPrice) * t.size;
        stagPnl += pnl;
        trancheUpdates.push({
          id: t.id,
          updates: {
            status: 'CANCELLED',
            closedPrice: exitPrice,
            realizedPnlUsd: pnl,
            closedAt: currentCandle.closeTime,
          },
        });
      }
    }

    return {
      action: 'STAGNATION_EXIT',
      tradeUpdates: {
        status: 'CLOSED',
        closedAt: currentCandle.closeTime,
        remainingSize: 0,
        realizedPnlUsd: trade.realizedPnlUsd + stagPnl,
        exitReason: 'STAGNATION_EXIT',
      },
      trancheUpdates,
      realizedPnlDeltaUsd: stagPnl,
      message: `Stagnation Exit at Bar ${barsInTrade} (${currentFloatingProfitR.toFixed(2)}R)`,
    };
  }

  // 3. Evaluate Active Tranches
  const t1 = trade.tranches.find(t => t.trancheNumber === 1 && t.status === 'ACTIVE');
  const t2 = trade.tranches.find(t => t.trancheNumber === 2 && t.status === 'ACTIVE');
  const t3 = trade.tranches.find(t => t.trancheNumber === 3 && t.status === 'ACTIVE');

  // Check Tranche 1 (+1.00R)
  if (t1 && t1.targetPrice !== undefined) {
    const t1Hit =
      direction === 'BUY'
        ? currentCandle.high >= t1.targetPrice
        : currentCandle.low <= t1.targetPrice;

    if (t1Hit) {
      const exitPrice = t1.targetPrice;
      const pnl =
        direction === 'BUY'
          ? (exitPrice - entryPrice) * t1.size
          : (entryPrice - exitPrice) * t1.size;

      // Move Stop Loss to reduced risk (-0.40R) to give breathing room for normal FVG retests
      const reducedRiskPrice = direction === 'BUY' ? entryPrice - 0.40 * rDistance : entryPrice + 0.40 * rDistance;
      const bePrice = direction === 'BUY' ? entryPrice + bufferR : entryPrice - bufferR;

      return {
        action: 'TRANCHE_1_HIT',
        tradeUpdates: {
          stopLoss: reducedRiskPrice,
          initialStopLoss: trade.initialStopLoss ?? stopLoss,
          breakevenPrice: bePrice,
          isBreakevenLocked: false,
          remainingSize: trade.remainingSize - t1.size,
          realizedPnlUsd: trade.realizedPnlUsd + pnl,
        },
        trancheUpdates: [
          {
            id: t1.id,
            updates: {
              status: 'TAKEN',
              closedPrice: exitPrice,
              realizedPnlUsd: pnl,
              closedAt: currentCandle.closeTime,
            },
          },
        ],
        realizedPnlDeltaUsd: pnl,
        message: `Tranche 1 (+1.50R) Banked! SL moved to reduced risk -0.40R (${reducedRiskPrice.toFixed(2)})`,
      };
    }
  }

  // Check Breakeven Milestone (+2.00R Hit)
  // If Tranche 1 is taken but BE is not yet locked, lock full Breakeven once price expands to +2.00R
  const t1Taken = trade.tranches.find(t => t.trancheNumber === 1)?.status === 'TAKEN';
  if (t1Taken && !trade.isBreakevenLocked) {
    const beTriggerPrice = direction === 'BUY' ? entryPrice + 2.0 * rDistance : entryPrice - 2.0 * rDistance;
    const beTriggerHit =
      direction === 'BUY'
        ? currentCandle.high >= beTriggerPrice
        : currentCandle.low <= beTriggerPrice;

    if (beTriggerHit) {
      const bePrice = direction === 'BUY' ? entryPrice + bufferR : entryPrice - bufferR;
      return {
        action: 'NONE',
        tradeUpdates: {
          stopLoss: bePrice,
          breakevenPrice: bePrice,
          isBreakevenLocked: true,
        },
        realizedPnlDeltaUsd: 0,
        message: `+2.00R Milestone Reached! Stop Loss locked to Breakeven (${bePrice.toFixed(2)})`,
      };
    }
  }

  // Check Tranche 2 (+3.00R)
  if (t2 && t2.targetPrice !== undefined) {
    const t2Hit =
      direction === 'BUY'
        ? currentCandle.high >= t2.targetPrice
        : currentCandle.low <= t2.targetPrice;

    if (t2Hit) {
      const exitPrice = t2.targetPrice;
      const pnl =
        direction === 'BUY'
          ? (exitPrice - entryPrice) * t2.size
          : (entryPrice - exitPrice) * t2.size;

      const profitLockSl = direction === 'BUY' ? entryPrice + 1.0 * rDistance : entryPrice - 1.0 * rDistance;

      return {
        action: 'TRANCHE_2_HIT',
        tradeUpdates: {
          stopLoss: profitLockSl,
          isBreakevenLocked: true,
          remainingSize: trade.remainingSize - t2.size,
          realizedPnlUsd: trade.realizedPnlUsd + pnl,
        },
        trancheUpdates: [
          {
            id: t2.id,
            updates: {
              status: 'TAKEN',
              closedPrice: exitPrice,
              realizedPnlUsd: pnl,
              closedAt: currentCandle.closeTime,
            },
          },
        ],
        realizedPnlDeltaUsd: pnl,
        message: `Tranche 2 Banked at ${exitPrice}! Stop Loss ratcheted to +1.00R Profit Lock (${profitLockSl.toFixed(2)})`,
      };
    }
  }

  // Check Tranche 3 (Moonbag Runner with Chandelier ATR Trailing Stop)
  if (t3) {
    const currentTrail = t3.trailingStop ?? stopLoss;

    // Check if trailing stop hit
    const trailHit =
      direction === 'BUY'
        ? currentCandle.low <= currentTrail
        : currentCandle.high >= currentTrail;

    if (trailHit && trade.isBreakevenLocked) {
      const exitPrice = currentTrail;
      const pnl =
        direction === 'BUY'
          ? (exitPrice - entryPrice) * t3.size
          : (entryPrice - exitPrice) * t3.size;

      return {
        action: 'TRANCHE_3_HIT',
        tradeUpdates: {
          status: 'CLOSED',
          closedAt: currentCandle.closeTime,
          remainingSize: 0,
          realizedPnlUsd: trade.realizedPnlUsd + pnl,
          exitReason: 'TRAILING_STOP_HIT',
        },
        trancheUpdates: [
          {
            id: t3.id,
            updates: {
              status: 'TAKEN',
              closedPrice: exitPrice,
              realizedPnlUsd: pnl,
              closedAt: currentCandle.closeTime,
            },
          },
        ],
        realizedPnlDeltaUsd: pnl,
        message: `Moonbag Runner Exited at Trailing Stop ${exitPrice}`,
      };
    }

    // Ratchet Trailing Stop up (BUY) or down (SELL) via dynamic ATR
    // 3.5x ATR on BTC, 4.5x ATR on explosive Altcoins
    if (atr > 0) {
      const isBtc = trade.symbol?.toUpperCase().includes('BTC');
      const chandelierMultiplier = isBtc ? 3.5 : 4.5;
      const chandelierDistance = chandelierMultiplier * atr;
      if (direction === 'BUY') {
        const potentialTrail = currentCandle.high - chandelierDistance;
        if (potentialTrail > currentTrail + 0.10) {
          return {
            action: 'NONE',
            trancheUpdates: [
              {
                id: t3.id,
                updates: { trailingStop: potentialTrail },
              },
            ],
            realizedPnlDeltaUsd: 0,
          };
        }
      } else {
        const potentialTrail = currentCandle.low + chandelierDistance;
        if (potentialTrail < currentTrail - 0.10) {
          return {
            action: 'NONE',
            trancheUpdates: [
              {
                id: t3.id,
                updates: { trailingStop: potentialTrail },
              },
            ],
            realizedPnlDeltaUsd: 0,
          };
        }
      }
    }
  }

  return { action: 'NONE', realizedPnlDeltaUsd: 0 };
}
