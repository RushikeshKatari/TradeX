import { Candle } from '@/types/market';

export function calculateATR(candles: Candle[], period: number = 14): (number | null)[] {
  if (candles.length <= period) return candles.map(() => null);

  const trueRanges: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }

  const results: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += trueRanges[i];
    results.push(null);
  }

  let currentAtr = sum / period;
  results[period - 1] = Number(currentAtr.toFixed(2));

  for (let i = period; i < candles.length; i++) {
    currentAtr = (currentAtr * (period - 1) + trueRanges[i]) / period;
    results.push(Number(currentAtr.toFixed(2)));
  }

  return results;
}
