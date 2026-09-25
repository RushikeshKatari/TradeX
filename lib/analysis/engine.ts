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
    reasons.push(`Price (₹${currentClose}) is trading above 20 EMA (₹${ema20})`);
  } else if (ema20 !== null && currentClose < ema20) {
    trendScore -= 1;
    reasons.push(`Price (₹${currentClose}) is trading below 20 EMA (₹${ema20})`);
  }

  if (ema50 !== null && ema20 !== null && ema20 > ema50) {
    trendScore += 1;
    reasons.push('20 EMA is above 50 EMA indicating positive intermediate trend structure');
  } else if (ema50 !== null && ema20 !== null && ema20 < ema50) {
    trendScore -= 1;
    reasons.push('20 EMA is below 50 EMA indicating negative intermediate trend structure');
  }

  if (st?.direction === 'UP') {
    trendScore += 1;
    reasons.push(`Supertrend (10, 3) is bullish at ₹${st.supertrend}`);
  } else if (st?.direction === 'DOWN') {
    trendScore -= 1;
    reasons.push(`Supertrend (10, 3) is bearish at ₹${st.supertrend}`);
  }

  // 2. Momentum Evaluation (-3 to +3)
  if (rsi !== null) {
    if (rsi >= 60) {
      momentumScore += 1;
      reasons.push(`RSI is ${rsi} showing bullish momentum`);
    } else if (rsi <= 40) {
      momentumScore -= 1;
      reasons.push(`RSI is ${rsi} indicating bearish momentum / oversold pressure`);
    } else {
      reasons.push(`RSI is neutral at ${rsi}`);
    }
  }

  if (macdVal?.macd !== null && macdVal?.signal !== null) {
    if (macdVal.macd > macdVal.signal) {
      momentumScore += 1;
      reasons.push(`MACD line (${macdVal.macd}) is above signal line (${macdVal.signal})`);
    } else {
      momentumScore -= 1;
      reasons.push(`MACD line (${macdVal.macd}) is below signal line (${macdVal.signal})`);
    }
  }

  if (adxVal !== null && adxVal > 25) {
    reasons.push(`ADX is ${adxVal} indicating measurable directional trend strength`);
  }

  // 3. Volume & VWAP Evaluation (-2 to +2)
  if (vwap !== null) {
    if (currentClose > vwap) {
      volumeScore += 1;
      reasons.push(`Price is holding above intraday VWAP (₹${vwap})`);
    } else {
      volumeScore -= 1;
      reasons.push(`Price is trading below intraday VWAP (₹${vwap})`);
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
