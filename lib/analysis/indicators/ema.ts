import { Candle } from '@/types/market';

export function calculateEMA(candles: Candle[], period: number = 20): (number | null)[] {
  if (candles.length < period) return candles.map(() => null);

  const results: (number | null)[] = [];
  const multiplier = 2 / (period + 1);

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[i].close;
    results.push(null);
  }
  let currentEma = sum / period;
  results[period - 1] = Number(currentEma.toFixed(2));

  for (let i = period; i < candles.length; i++) {
    currentEma = (candles[i].close - currentEma) * multiplier + currentEma;
    results.push(Number(currentEma.toFixed(2)));
  }

  return results;
}
