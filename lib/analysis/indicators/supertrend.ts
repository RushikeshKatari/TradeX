import { Candle } from '@/types/market';
import { calculateATR } from './atr';

export interface SupertrendResult {
  supertrend: number | null;
  direction: 'UP' | 'DOWN' | null;
}

export function calculateSupertrend(candles: Candle[], period: number = 10, multiplier: number = 3): SupertrendResult[] {
  const atrs = calculateATR(candles, period);
  const results: SupertrendResult[] = [];

  let prevUpper = 0;
  let prevLower = 0;
  let prevDirection: 'UP' | 'DOWN' = 'UP';
  let prevSupertrend = 0;

  for (let i = 0; i < candles.length; i++) {
    const atr = atrs[i];
    if (atr === null || i < period) {
      results.push({ supertrend: null, direction: null });
      continue;
    }

    const hl2 = (candles[i].high + candles[i].low) / 2;
    let basicUpper = hl2 + multiplier * atr;
    let basicLower = hl2 - multiplier * atr;

    let upper = basicUpper;
    let lower = basicLower;

    if (i > period) {
      const prevClose = candles[i - 1].close;
      upper = basicUpper < prevUpper || prevClose > prevUpper ? basicUpper : prevUpper;
      lower = basicLower > prevLower || prevClose < prevLower ? basicLower : prevLower;
    }

    let direction: 'UP' | 'DOWN' = prevDirection;
    let supertrendVal = 0;

    if (direction === 'UP') {
      if (candles[i].close < lower) {
        direction = 'DOWN';
        supertrendVal = upper;
      } else {
        supertrendVal = lower;
      }
    } else {
      if (candles[i].close > upper) {
        direction = 'UP';
        supertrendVal = lower;
      } else {
        supertrendVal = upper;
      }
    }

    prevUpper = upper;
    prevLower = lower;
    prevDirection = direction;
    prevSupertrend = supertrendVal;

    results.push({
      supertrend: Number(supertrendVal.toFixed(2)),
      direction,
    });
  }

  return results;
}
