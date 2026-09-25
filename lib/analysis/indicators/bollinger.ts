import { Candle } from '@/types/market';
import { calculateSMA } from './sma';

export interface BollingerBandsResult {
  middle: number | null;
  upper: number | null;
  lower: number | null;
  bandwidth: number | null;
}

export function calculateBollingerBands(
  candles: Candle[],
  period: number = 20,
  stdDevMultiplier: number = 2
): BollingerBandsResult[] {
  const middle = calculateSMA(candles, period);
  const results: BollingerBandsResult[] = [];

  for (let i = 0; i < candles.length; i++) {
    const m = middle[i];
    if (m === null || i < period - 1) {
      results.push({ middle: null, upper: null, lower: null, bandwidth: null });
      continue;
    }

    let varianceSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      varianceSum += Math.pow(candles[j].close - m, 2);
    }
    const stdDev = Math.sqrt(varianceSum / period);
    const upper = Number((m + stdDevMultiplier * stdDev).toFixed(2));
    const lower = Number((m - stdDevMultiplier * stdDev).toFixed(2));
    const bandwidth = Number((((upper - lower) / m) * 100).toFixed(2));

    results.push({ middle: m, upper, lower, bandwidth });
  }

  return results;
}
