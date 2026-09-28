import { Candle } from '@/types/market';
import { RegimeResult, MarketRegimeType, TrendStrengthType, VolatilityLevelType } from '@/types/regime';
import { calculateEMA } from './indicators/ema';
import { calculateRSI } from './indicators/rsi';
import { calculateADX } from './indicators/adx';
import { calculateBollingerBands } from './indicators/bollinger';
import { calculateVWAP } from './indicators/vwap';
import { calculateATR } from './indicators/atr';

const WEIGHTS = {
  ema_crossover: 20,
  rsi: 15,
  adx: 10,
  momentum: 10,
  bollinger: 10,
  bollinger_width: 5,
  vwap: 10,
  pcr: 15,
};

export function detectMarketRegime(
  candles: Candle[],
  pcr?: number,
  atmStrike?: number,
  maxPain?: number
): RegimeResult {
  if (!candles || candles.length < 20) {
    return {
      regime: 'INSUFFICIENT_DATA',
      confidence: 0,
      trendStrength: 'NONE',
      volatility: 'UNKNOWN',
      supportingFactors: ['Insufficient historical candles to determine market regime reliably (minimum 20 required).'],
      opposingFactors: [],
      scores: {},
      pcr,
      atmStrike,
      maxPain,
      timestamp: new Date().toISOString(),
    };
  }

  const lastIdx = candles.length - 1;
  const currentPrice = candles[lastIdx].close;

  // Indicators calculation
  const ema20Arr = calculateEMA(candles, 20);
  const ema50Arr = calculateEMA(candles, Math.min(50, candles.length));
  const ema20 = ema20Arr[lastIdx];
  const ema50 = ema50Arr[lastIdx];

  const rsiArr = calculateRSI(candles, 14);
  const rsi = rsiArr[lastIdx];

  const adxArr = calculateADX(candles, 14);
  const adx = adxArr[lastIdx]?.adx ?? null;

  const bbArr = calculateBollingerBands(candles, 20, 2);
  const bb = bbArr[lastIdx];

  const vwapArr = calculateVWAP(candles);
  const vwap = vwapArr[lastIdx];

  const atrArr = calculateATR(candles, 14);
  const atr = atrArr[lastIdx];

  // Momentum (10-period change)
  const momIdx = Math.max(0, lastIdx - 10);
  const momentum = currentPrice - candles[momIdx].close;

  let bullishScore = 0;
  let bearishScore = 0;
  let totalWeight = 0;
  const supporting: string[] = [];
  const opposing: string[] = [];
  const scores: Record<string, number> = {};

  // 1. EMA Crossover (weight: 20)
  if (ema20 !== null && ema50 !== null) {
    totalWeight += WEIGHTS.ema_crossover;
    if (ema20 > ema50) {
      bullishScore += WEIGHTS.ema_crossover;
      supporting.push(`EMA 20 (₹${ema20.toFixed(2)}) > EMA 50 (₹${ema50.toFixed(2)}) → Bullish crossover`);
      scores['EMA Crossover'] = WEIGHTS.ema_crossover;
    } else if (ema20 < ema50) {
      bearishScore += WEIGHTS.ema_crossover;
      supporting.push(`EMA 20 (₹${ema20.toFixed(2)}) < EMA 50 (₹${ema50.toFixed(2)}) → Bearish crossover`);
      scores['EMA Crossover'] = -WEIGHTS.ema_crossover;
    } else {
      scores['EMA Crossover'] = 0;
    }
  }

  // 2. RSI (weight: 15)
  if (rsi !== null) {
    totalWeight += WEIGHTS.rsi;
    if (rsi > 60) {
      const strength = Math.min((rsi - 60) / 20, 1.0);
      bullishScore += WEIGHTS.rsi * strength;
      supporting.push(`RSI=${rsi.toFixed(1)} → Bullish momentum`);
      scores['RSI'] = Number((WEIGHTS.rsi * strength).toFixed(1));
    } else if (rsi < 40) {
      const strength = Math.min((40 - rsi) / 20, 1.0);
      bearishScore += WEIGHTS.rsi * strength;
      supporting.push(`RSI=${rsi.toFixed(1)} → Bearish momentum`);
      scores['RSI'] = Number((-WEIGHTS.rsi * strength).toFixed(1));
    } else {
      opposing.push(`RSI=${rsi.toFixed(1)} → Neutral (40-60 range)`);
      scores['RSI'] = 0;
    }
  }

  // 3. ADX (weight: 10)
  if (adx !== null) {
    totalWeight += WEIGHTS.adx;
    if (adx > 25) {
      supporting.push(`ADX=${adx.toFixed(1)} → Strong trend detected`);
      scores['ADX'] = Number((WEIGHTS.adx * Math.min(adx / 50, 1.0)).toFixed(1));
      if (bullishScore > bearishScore) {
        bullishScore += WEIGHTS.adx * 0.5;
      } else if (bearishScore > bullishScore) {
        bearishScore += WEIGHTS.adx * 0.5;
      }
    } else {
      opposing.push(`ADX=${adx.toFixed(1)} → Weak trend (sideways likely)`);
      scores['ADX'] = 0;
    }
  }

  // 4. Momentum (weight: 10)
  totalWeight += WEIGHTS.momentum;
  if (momentum > 0) {
    bullishScore += WEIGHTS.momentum;
    supporting.push(`Momentum=${momentum >= 0 ? '+' : ''}${momentum.toFixed(1)} → Positive`);
    scores['Momentum'] = WEIGHTS.momentum;
  } else if (momentum < 0) {
    bearishScore += WEIGHTS.momentum;
    supporting.push(`Momentum=${momentum.toFixed(1)} → Negative`);
    scores['Momentum'] = -WEIGHTS.momentum;
  } else {
    scores['Momentum'] = 0;
  }

  // 5. Bollinger Bands (weight: 10 + 5)
  if (bb && bb.upper !== null && bb.lower !== null) {
    totalWeight += WEIGHTS.bollinger;
    if (currentPrice > bb.upper) {
      bullishScore += WEIGHTS.bollinger;
      supporting.push(`Price above upper Bollinger (₹${bb.upper.toFixed(2)}) → Strong breakout`);
      scores['Bollinger Position'] = WEIGHTS.bollinger;
    } else if (currentPrice < bb.lower) {
      bearishScore += WEIGHTS.bollinger;
      supporting.push(`Price below lower Bollinger (₹${bb.lower.toFixed(2)}) → Strong breakdown`);
      scores['Bollinger Position'] = -WEIGHTS.bollinger;
    } else {
      opposing.push('Price within Bollinger Bands → Range-bound');
      scores['Bollinger Position'] = 0;
    }

    if (bb.bandwidth !== null && bb.middle !== null) {
      totalWeight += WEIGHTS.bollinger_width;
      const bw = bb.bandwidth;
      if (bw > 4) {
        supporting.push(`BB Width=${bw.toFixed(2)}% → Volatility expansion`);
        scores['BB Width'] = WEIGHTS.bollinger_width;
      } else if (bw < 2) {
        opposing.push(`BB Width=${bw.toFixed(2)}% → Low volatility squeeze`);
        scores['BB Width'] = -2;
      } else {
        scores['BB Width'] = 0;
      }
    }
  }

  // 6. VWAP (weight: 10)
  if (vwap !== null) {
    totalWeight += WEIGHTS.vwap;
    if (currentPrice > vwap) {
      bullishScore += WEIGHTS.vwap;
      supporting.push(`Price above VWAP (₹${vwap.toFixed(2)}) → Institutional accumulation`);
      scores['VWAP'] = WEIGHTS.vwap;
    } else {
      bearishScore += WEIGHTS.vwap;
      supporting.push(`Price below VWAP (₹${vwap.toFixed(2)}) → Institutional distribution`);
      scores['VWAP'] = -WEIGHTS.vwap;
    }
  }

  // 7. PCR (weight: 15)
  if (typeof pcr === 'number') {
    totalWeight += WEIGHTS.pcr;
    if (pcr > 1.2) {
      bullishScore += WEIGHTS.pcr;
      supporting.push(`PCR=${pcr.toFixed(2)} → High PE OI (contrarian bullish)`);
      scores['PCR'] = WEIGHTS.pcr;
    } else if (pcr < 0.7) {
      bearishScore += WEIGHTS.pcr;
      supporting.push(`PCR=${pcr.toFixed(2)} → Low PE OI (contrarian bearish)`);
      scores['PCR'] = -WEIGHTS.pcr;
    } else if (pcr > 1.0) {
      bullishScore += WEIGHTS.pcr * 0.3;
      supporting.push(`PCR=${pcr.toFixed(2)} → Moderately bullish bias`);
      scores['PCR'] = Number((WEIGHTS.pcr * 0.3).toFixed(1));
    } else {
      bearishScore += WEIGHTS.pcr * 0.3;
      opposing.push(`PCR=${pcr.toFixed(2)} → Moderately bearish bias`);
      scores['PCR'] = Number((-WEIGHTS.pcr * 0.3).toFixed(1));
    }
  }

  // Minimum data sufficiency
  if (totalWeight < 30) {
    return {
      regime: 'INSUFFICIENT_DATA',
      confidence: 0,
      trendStrength: 'NONE',
      volatility: 'UNKNOWN',
      supportingFactors: ['Insufficient technical indicator data available.'],
      opposingFactors: [],
      scores,
      pcr,
      atmStrike,
      maxPain,
      timestamp: new Date().toISOString(),
    };
  }

  const netScore = ((bullishScore - bearishScore) / totalWeight) * 100;
  const rawConfidence = Math.abs(netScore);

  let regime: MarketRegimeType = 'SIDEWAYS';
  if (netScore > 15) {
    regime = 'BULLISH';
  } else if (netScore < -15) {
    regime = 'BEARISH';
  }

  let trendStrength: TrendStrengthType = 'WEAK';
  if (rawConfidence > 60) {
    trendStrength = 'STRONG';
  } else if (rawConfidence > 30) {
    trendStrength = 'MODERATE';
  }

  let volatility: VolatilityLevelType = 'MODERATE';
  if (atr !== null && currentPrice > 0) {
    const atrPct = (atr / currentPrice) * 100;
    if (atrPct > 2.0) {
      volatility = 'HIGH';
    } else if (atrPct < 0.8) {
      volatility = 'LOW';
    }
  }

  const confidence = Math.min(Math.round(rawConfidence * 10) / 10, 95);

  return {
    regime,
    confidence,
    trendStrength,
    volatility,
    supportingFactors: supporting,
    opposingFactors: opposing,
    scores,
    pcr,
    atmStrike,
    maxPain,
    timestamp: new Date().toISOString(),
  };
}
