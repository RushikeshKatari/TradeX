import { Candle } from '@/types/market';

export function calculateSMA(candles: Candle[], period: number = 20): (number | null)[] {
  if (candles.length < period) return candles.map(() => null);

  const results: (number | null)[] = [];
  let sum = 0;

  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) {
      sum -= candles[i - period].close;
    }
    if (i >= period - 1) {
      results.push(Number((sum / period).toFixed(2)));
    } else {
      results.push(null);
    }
  }

  return results;
}
