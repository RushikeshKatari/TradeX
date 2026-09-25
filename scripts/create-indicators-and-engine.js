const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

function write(relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content.trim() + '\n', 'utf8');
  console.log('Created: ' + relPath);
}

write('lib/analysis/indicators/sma.ts', `
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
`);

write('lib/analysis/indicators/ema.ts', `
import { Candle } from '@/types/market';

export function calculateEMA(candles: Candle[], period: number = 20): (number | null)[] {
  if (candles.length < period) return candles.map(() => null);

  const results: (number | null)[] = [];
  const multiplier = 2 / (period + 1);

  // Initial SMA as first EMA seed
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
`);

write('lib/analysis/indicators/atr.ts', `
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
  // First ATR is simple average of first 'period' TRs
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += trueRanges[i];
    results.push(null);
  }

  let currentAtr = sum / period;
  results[period - 1] = Number(currentAtr.toFixed(2));

  // Wilder's smoothed ATR
  for (let i = period; i < candles.length; i++) {
    currentAtr = (currentAtr * (period - 1) + trueRanges[i]) / period;
    results.push(Number(currentAtr.toFixed(2)));
  }

  return results;
}
`);

write('lib/analysis/indicators/supertrend.ts', `
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
`);

write('lib/analysis/indicators/adx.ts', `
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
`);

write('lib/analysis/indicators/rsi.ts', `
import { Candle } from '@/types/market';

export function calculateRSI(candles: Candle[], period: number = 14): (number | null)[] {
  if (candles.length <= period) return candles.map(() => null);

  const results: (number | null)[] = [];
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
    results.push(null);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  let rsi = 100 - (100 / (1 + rs));
  results.push(Number(rsi.toFixed(2)));

  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    const currentGain = diff > 0 ? diff : 0;
    const currentLoss = diff < 0 ? Math.abs(diff) : 0;

    // Wilder's smoothing
    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));
    results.push(Number(rsi.toFixed(2)));
  }

  return results;
}
`);

write('lib/analysis/indicators/macd.ts', `
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
`);

write('lib/analysis/indicators/stochastic.ts', `
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

  // Smooth %K
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

  // Calculate %D (SMA of smoothed %K)
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
`);

write('lib/analysis/indicators/bollinger.ts', `
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
`);

write('lib/analysis/indicators/vwap.ts', `
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
`);

write('lib/analysis/indicators/obv.ts', `
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
`);

write('lib/analysis/engine.ts', `
import { Candle } from '@/types/market';
import { calculateSMA } from './indicators/sma';
import { calculateEMA } from './indicators/ema';
import { calculateSupertrend } from './indicators/supertrend';
import { calculateADX } from './indicators/adx';
import { calculateRSI } from './indicators/rsi';
import { calculateMACD } from './indicators/macd';
import { calculateBollingerBands } from './indicators/bollinger';
import { calculateVWAP } from './indicators/vwap';
import { calculateATR } from './indicators/atr';

export type TechnicalStatus = 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
export type SignalConfidence = 'Weak' | 'Moderate' | 'Strong';

export interface TechnicalAnalysisResult {
  status: TechnicalStatus;
  signalConfidence: SignalConfidence;
  totalScore: number;
  breakdown: {
    trendScore: number;
    momentumScore: number;
    volumeScore: number;
    volatilityScore: number;
  };
  metrics: {
    price: number;
    sma20: number | null;
    ema20: number | null;
    ema50: number | null;
    vwap: number | null;
    rsi: number | null;
    macd: number | null;
    macdSignal: number | null;
    supertrend: number | null;
    supertrendDirection: 'UP' | 'DOWN' | null;
    adx: number | null;
    atr: number | null;
    bollingerUpper: number | null;
    bollingerLower: number | null;
  };
  reasons: string[];
  disclaimer: string;
}

export function analyzeTechnicalSetup(candles: Candle[]): TechnicalAnalysisResult {
  const disclaimer = 'Signal strength represents agreement among configured technical indicators. It does not represent probability of profit or guarantee future performance.';

  if (!candles || candles.length < 20) {
    return {
      status: 'SIDEWAYS',
      signalConfidence: 'Weak',
      totalScore: 0,
      breakdown: { trendScore: 0, momentumScore: 0, volumeScore: 0, volatilityScore: 0 },
      metrics: {
        price: candles?.[candles.length - 1]?.close ?? 0,
        sma20: null,
        ema20: null,
        ema50: null,
        vwap: null,
        rsi: null,
        macd: null,
        macdSignal: null,
        supertrend: null,
        supertrendDirection: null,
        adx: null,
        atr: null,
        bollingerUpper: null,
        bollingerLower: null,
      },
      reasons: ['Insufficient historical candles to compute reliable indicator matrix (minimum 20 required).'],
      disclaimer,
    };
  }

  const lastIdx = candles.length - 1;
  const currentClose = candles[lastIdx].close;

  // Compute indicators
  const sma20 = calculateSMA(candles, 20)[lastIdx];
  const ema20 = calculateEMA(candles, 20)[lastIdx];
  const ema50 = calculateEMA(candles, Math.min(50, candles.length))[lastIdx];
  const supertrendArr = calculateSupertrend(candles, 10, 3);
  const st = supertrendArr[lastIdx];
  const adxArr = calculateADX(candles, 14);
  const adxVal = adxArr[lastIdx]?.adx ?? null;
  const rsi = calculateRSI(candles, 14)[lastIdx];
  const macdArr = calculateMACD(candles, 12, 26, 9);
  const macdVal = macdArr[lastIdx];
  const bbArr = calculateBollingerBands(candles, 20, 2);
  const bb = bbArr[lastIdx];
  const vwap = calculateVWAP(candles)[lastIdx];
  const atr = calculateATR(candles, 14)[lastIdx];

  const reasons: string[] = [];
  let trendScore = 0;
  let momentumScore = 0;
  let volumeScore = 0;
  let volatilityScore = 0;

  // 1. Trend Evaluation (-3 to +3)
  if (ema20 !== null && currentClose > ema20) {
    trendScore += 1;
    reasons.push(`Price (₹\${currentClose}) is trading above 20 EMA (₹\${ema20})`);
  } else if (ema20 !== null && currentClose < ema20) {
    trendScore -= 1;
    reasons.push(`Price (₹\${currentClose}) is trading below 20 EMA (₹\${ema20})`);
  }

  if (ema50 !== null && ema20 !== null && ema20 > ema50) {
    trendScore += 1;
    reasons.push(`20 EMA is above 50 EMA indicating positive intermediate trend structure`);
  } else if (ema50 !== null && ema20 !== null && ema20 < ema50) {
    trendScore -= 1;
    reasons.push(`20 EMA is below 50 EMA indicating negative intermediate trend structure`);
  }

  if (st?.direction === 'UP') {
    trendScore += 1;
    reasons.push(`Supertrend (10, 3) is bullish at ₹\${st.supertrend}`);
  } else if (st?.direction === 'DOWN') {
    trendScore -= 1;
    reasons.push(`Supertrend (10, 3) is bearish at ₹\${st.supertrend}`);
  }

  // 2. Momentum Evaluation (-3 to +3)
  if (rsi !== null) {
    if (rsi >= 60) {
      momentumScore += 1;
      reasons.push(`RSI is \${rsi} showing bullish momentum`);
    } else if (rsi <= 40) {
      momentumScore -= 1;
      reasons.push(`RSI is \${rsi} indicating bearish momentum / oversold pressure`);
    } else {
      reasons.push(`RSI is neutral at \${rsi}`);
    }
  }

  if (macdVal?.macd !== null && macdVal?.signal !== null) {
    if (macdVal.macd > macdVal.signal) {
      momentumScore += 1;
      reasons.push(`MACD line (\${macdVal.macd}) is above signal line (\${macdVal.signal})`);
    } else {
      momentumScore -= 1;
      reasons.push(`MACD line (\${macdVal.macd}) is below signal line (\${macdVal.signal})`);
    }
  }

  if (adxVal !== null && adxVal > 25) {
    reasons.push(`ADX is \${adxVal} indicating measurable directional trend strength`);
  }

  // 3. Volume & VWAP Evaluation (-2 to +2)
  if (vwap !== null) {
    if (currentClose > vwap) {
      volumeScore += 1;
      reasons.push(`Price is holding above intraday VWAP (₹\${vwap})`);
    } else {
      volumeScore -= 1;
      reasons.push(`Price is trading below intraday VWAP (₹\${vwap})`);
    }
  }

  // 4. Volatility Evaluation (-1 to +1)
  if (bb?.upper !== null && bb?.lower !== null && bb?.middle !== null) {
    if (currentClose > bb.middle) {
      volatilityScore += 1;
    } else if (currentClose < bb.middle) {
      volatilityScore -= 1;
    }
  }

  const totalScore = trendScore + momentumScore + volumeScore + volatilityScore;

  let status: TechnicalStatus = 'SIDEWAYS';
  if (totalScore >= 3) {
    status = 'BULLISH';
  } else if (totalScore <= -3) {
    status = 'BEARISH';
  } else {
    status = 'SIDEWAYS';
  }

  const absScore = Math.abs(totalScore);
  let signalConfidence: SignalConfidence = 'Weak';
  if (absScore >= 5) {
    signalConfidence = 'Strong';
  } else if (absScore >= 3) {
    signalConfidence = 'Moderate';
  }

  return {
    status,
    signalConfidence,
    totalScore,
    breakdown: { trendScore, momentumScore, volumeScore, volatilityScore },
    metrics: {
      price: currentClose,
      sma20,
      ema20,
      ema50,
      vwap,
      rsi,
      macd: macdVal?.macd ?? null,
      macdSignal: macdVal?.signal ?? null,
      supertrend: st?.supertrend ?? null,
      supertrendDirection: st?.direction ?? null,
      adx: adxVal,
      atr,
      bollingerUpper: bb?.upper ?? null,
      bollingerLower: bb?.lower ?? null,
    },
    reasons,
    disclaimer,
  };
}
`);
