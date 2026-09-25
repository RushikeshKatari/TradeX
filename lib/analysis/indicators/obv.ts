import { Candle } from '@/types/market';

export function calculateOBV(candles: Candle[]): number[] {
  if (candles.length === 0) return [];

  const results: number[] = [0];
  let obv = 0;

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const prev = candles[i - 1];

    if (current.close > prev.close) {
      obv += current.volume;
    } else if (current.close < prev.close) {
      obv -= current.volume;
    }
    results.push(obv);
  }

  return results;
}
