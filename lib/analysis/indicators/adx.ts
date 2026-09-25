import { Candle } from '@/types/market';
import { calculateATR } from './atr';

export interface ADXResult {
  adx: number | null;
  plusDI: number | null;
  minusDI: number | null;
}

export function calculateADX(candles: Candle[], period: number = 14): ADXResult[] {
  if (candles.length < period * 2) {
    return candles.map(() => ({ adx: null, plusDI: null, minusDI: null }));
  }

  const plusDM: number[] = [0];
  const minusDM: number[] = [0];

  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;

    if (upMove > downMove && upMove > 0) {
      plusDM.push(upMove);
    } else {
      plusDM.push(0);
    }

    if (downMove > upMove && downMove > 0) {
      minusDM.push(downMove);
    } else {
      minusDM.push(0);
    }
  }

  const atrs = calculateATR(candles, period);
  const results: ADXResult[] = [];
  const dxValues: number[] = [];

  let smoothPlusDM = 0;
  let smoothMinusDM = 0;

  for (let i = 0; i < period; i++) {
    smoothPlusDM += plusDM[i];
    smoothMinusDM += minusDM[i];
    results.push({ adx: null, plusDI: null, minusDI: null });
  }

  for (let i = period; i < candles.length; i++) {
    smoothPlusDM = smoothPlusDM - (smoothPlusDM / period) + plusDM[i];
    smoothMinusDM = smoothMinusDM - (smoothMinusDM / period) + minusDM[i];

    const atr = atrs[i] ?? 1;
    const plusDI = Number(((smoothPlusDM / atr) * 100).toFixed(2));
    const minusDI = Number(((smoothMinusDM / atr) * 100).toFixed(2));
    const diDiff = Math.abs(plusDI - minusDI);
    const diSum = plusDI + minusDI || 1;
    const dx = (diDiff / diSum) * 100;
    dxValues.push(dx);

    if (dxValues.length < period) {
      results.push({ adx: null, plusDI, minusDI });
    } else if (dxValues.length === period) {
      const adxVal = dxValues.reduce((a, b) => a + b, 0) / period;
      results.push({ adx: Number(adxVal.toFixed(2)), plusDI, minusDI });
    } else {
      const prevAdx = results[results.length - 1]?.adx ?? 0;
      const adxVal = (prevAdx * (period - 1) + dx) / period;
      results.push({ adx: Number(adxVal.toFixed(2)), plusDI, minusDI });
    }
  }

  return results;
}
