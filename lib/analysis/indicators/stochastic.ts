import { Candle } from '@/types/market';

export interface StochasticResult {
  k: number | null;
  d: number | null;
}

export function calculateStochastic(
  candles: Candle[],
  kPeriod: number = 14,
  dPeriod: number = 3,
  smooth: number = 3
): StochasticResult[] {
  if (candles.length < kPeriod) return candles.map(() => ({ k: null, d: null }));

  const rawK: (number | null)[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < kPeriod - 1) {
      rawK.push(null);
      continue;
    }

    let highestHigh = -Infinity;
    let lowestLow = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (candles[j].high > highestHigh) highestHigh = candles[j].high;
      if (candles[j].low < lowestLow) lowestLow = candles[j].low;
    }

    const currentClose = candles[i].close;
    const range = highestHigh - lowestLow;
    const kVal = range === 0 ? 50 : ((currentClose - lowestLow) / range) * 100;
    rawK.push(Number(kVal.toFixed(2)));
  }

  const smoothedK: (number | null)[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < kPeriod - 1 + smooth - 1) {
      smoothedK.push(null);
    } else {
      let sum = 0;
      for (let j = i - smooth + 1; j <= i; j++) {
        sum += rawK[j] ?? 50;
      }
      smoothedK.push(Number((sum / smooth).toFixed(2)));
    }
  }

  const results: StochasticResult[] = [];
  for (let i = 0; i < candles.length; i++) {
    const currentK = smoothedK[i];
    if (currentK === null || i < kPeriod - 1 + smooth - 1 + dPeriod - 1) {
      results.push({ k: currentK, d: null });
    } else {
      let sum = 0;
      for (let j = i - dPeriod + 1; j <= i; j++) {
        sum += smoothedK[j] ?? 50;
      }
      const dVal = Number((sum / dPeriod).toFixed(2));
      results.push({ k: currentK, d: dVal });
    }
  }

  return results;
}
