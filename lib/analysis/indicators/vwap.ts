import { Candle } from '@/types/market';

export function calculateVWAP(candles: Candle[]): (number | null)[] {
  if (candles.length === 0) return [];

  const results: (number | null)[] = [];
  let cumulativeTypicalVolume = 0;
  let cumulativeVolume = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const typicalPrice = (c.high + c.low + c.close) / 3;
    const vol = c.volume || 1;

    cumulativeTypicalVolume += typicalPrice * vol;
    cumulativeVolume += vol;

    const vwapVal = cumulativeTypicalVolume / (cumulativeVolume || 1);
    results.push(Number(vwapVal.toFixed(2)));
  }

  return results;
}
