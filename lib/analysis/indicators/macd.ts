import { Candle } from '@/types/market';
import { calculateEMA } from './ema';

export interface MACDResult {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
}

export function calculateMACD(
  candles: Candle[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult[] {
  const fastEma = calculateEMA(candles, fastPeriod);
  const slowEma = calculateEMA(candles, slowPeriod);

  const macdLine: (number | null)[] = [];
  const validMacdCandles: Candle[] = [];

  for (let i = 0; i < candles.length; i++) {
    const f = fastEma[i];
    const s = slowEma[i];
    if (f !== null && s !== null) {
      const val = Number((f - s).toFixed(2));
      macdLine.push(val);
      validMacdCandles.push({
        time: candles[i].time,
        open: val,
        high: val,
        low: val,
        close: val,
        volume: 0,
      });
    } else {
      macdLine.push(null);
    }
  }

  const signalLineValues = calculateEMA(validMacdCandles, signalPeriod);
  const results: MACDResult[] = [];
  let signalIdx = 0;

  for (let i = 0; i < candles.length; i++) {
    const m = macdLine[i];
    if (m === null) {
      results.push({ macd: null, signal: null, histogram: null });
    } else {
      const sig = signalLineValues[signalIdx];
      signalIdx++;
      if (sig !== null) {
        const hist = Number((m - sig).toFixed(2));
        results.push({ macd: m, signal: sig, histogram: hist });
      } else {
        results.push({ macd: m, signal: null, histogram: null });
      }
    }
  }

  return results;
}
