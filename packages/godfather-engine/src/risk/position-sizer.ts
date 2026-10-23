import type { SignalGrade, TradeDirection } from '@mev-research/shared';

export interface PositionParams {
  symbol: string;
  accountEquity: number;
  entryPrice: number;
  stopLoss: number;
  direction: TradeDirection;
  grade: SignalGrade;
  isWeekend?: boolean;
  hasCorrelatedUsdExposure?: boolean;
  baseRiskPct?: number; // Default 0.85%
  convictionScaleAPlus?: number; // Default 2.40
  convictionScaleA?: number; // Default 1.00
  convictionScaleB?: number; // Default 0.50
}

export interface PositionCalculation {
  positionSize: number;
  allocatedRiskUsd: number;
  convictionMultiplier: number;
  stopDistanceUsd: number;
  isValid: boolean;
  rejectionReason?: string;
}

export function calculateGodfatherPosition(params: PositionParams): PositionCalculation {
  const {
    symbol,
    accountEquity,
    entryPrice,
    stopLoss,
    direction,
    grade,
    isWeekend = false,
    hasCorrelatedUsdExposure = false,
    baseRiskPct = 0.85,
    convictionScaleAPlus = 1.25,
    convictionScaleA = 1.00,
    convictionScaleB = 0.50,
  } = params;

  if (accountEquity <= 0) {
    return {
      positionSize: 0,
      allocatedRiskUsd: 0,
      convictionMultiplier: 0,
      stopDistanceUsd: 0,
      isValid: false,
      rejectionReason: 'ACCOUNT_EQUITY_ZERO',
    };
  }

  // Validate SL orientation
  if (direction === 'BUY' && stopLoss >= entryPrice) {
    return {
      positionSize: 0,
      allocatedRiskUsd: 0,
      convictionMultiplier: 0,
      stopDistanceUsd: 0,
      isValid: false,
      rejectionReason: 'INVERTED_SL_FOR_BUY',
    };
  }

  if (direction === 'SELL' && stopLoss <= entryPrice) {
    return {
      positionSize: 0,
      allocatedRiskUsd: 0,
      convictionMultiplier: 0,
      stopDistanceUsd: 0,
      isValid: false,
      rejectionReason: 'INVERTED_SL_FOR_SELL',
    };
  }

  const stopDistanceUsd = Math.abs(entryPrice - stopLoss);
  if (stopDistanceUsd <= 0) {
    return {
      positionSize: 0,
      allocatedRiskUsd: 0,
      convictionMultiplier: 0,
      stopDistanceUsd: 0,
      isValid: false,
      rejectionReason: 'ZERO_STOP_DISTANCE',
    };
  }

  // Conviction Multiplier
  let multiplier = convictionScaleA;
  if (grade === 'A_PLUS') {
    multiplier = convictionScaleAPlus;
  } else if (grade === 'B') {
    multiplier = convictionScaleB;
  } else if (grade === 'C') {
    multiplier = 0.25;
  }

  // Weekend Dampener
  if (isWeekend) {
    multiplier *= 0.50;
  }

  // Net Beta Gate
  if (hasCorrelatedUsdExposure) {
    multiplier *= 0.60;
  }

  const baseRiskUsd = accountEquity * (baseRiskPct / 100);
  const allocatedRiskUsd = baseRiskUsd * multiplier;
  const rawSize = allocatedRiskUsd / stopDistanceUsd;

  // Round according to asset precision dynamically based on asset price level
  let decimals = 2;
  if (entryPrice >= 10000) decimals = 4;
  else if (entryPrice >= 100) decimals = 2;
  else if (entryPrice >= 1) decimals = 1;
  else decimals = 0;

  const positionSize = parseFloat(rawSize.toFixed(decimals));

  return {
    positionSize,
    allocatedRiskUsd,
    convictionMultiplier: multiplier,
    stopDistanceUsd,
    isValid: positionSize > 0,
  };
}
