import { describe, it, expect } from 'vitest';
import { calculateSMA } from '@/lib/analysis/indicators/sma';
import { calculateEMA } from '@/lib/analysis/indicators/ema';
import { calculateRSI } from '@/lib/analysis/indicators/rsi';
import { calculateMACD } from '@/lib/analysis/indicators/macd';
import { calculateBollingerBands } from '@/lib/analysis/indicators/bollinger';
import { calculateATR } from '@/lib/analysis/indicators/atr';
import { calculateSupertrend } from '@/lib/analysis/indicators/supertrend';
import { calculateVWAP } from '@/lib/analysis/indicators/vwap';
import { Candle } from '@/types/market';

describe('Technical Indicators Suite', () => {
  // Mock standard candle series
  const candles: Candle[] = [
    { time: 1, open: 100, high: 105, low: 98, close: 102, volume: 1000 },
    { time: 2, open: 102, high: 108, low: 101, close: 106, volume: 1500 },
    { time: 3, open: 106, high: 107, low: 103, close: 104, volume: 1200 },
    { time: 4, open: 104, high: 110, low: 103, close: 109, volume: 2000 },
    { time: 5, open: 109, high: 112, low: 108, close: 111, volume: 1800 },
    { time: 6, open: 111, high: 115, low: 110, close: 114, volume: 2200 },
    { time: 7, open: 114, high: 116, low: 112, close: 113, volume: 1900 },
    { time: 8, open: 113, high: 118, low: 113, close: 117, volume: 2500 },
    { time: 9, open: 117, high: 120, low: 115, close: 119, volume: 2400 },
    { time: 10, open: 119, high: 122, low: 118, close: 121, volume: 3000 },
    { time: 11, open: 121, high: 121, low: 116, close: 117, volume: 1600 },
    { time: 12, open: 117, high: 119, low: 114, close: 115, volume: 1400 },
    { time: 13, open: 115, high: 116, low: 112, close: 113, volume: 1200 },
    { time: 14, open: 113, high: 118, low: 113, close: 116, volume: 1700 },
    { time: 15, open: 116, high: 120, low: 115, close: 119, volume: 2100 },
    { time: 16, open: 119, high: 123, low: 118, close: 122, volume: 2600 },
    { time: 17, open: 122, high: 124, low: 120, close: 123, volume: 2800 },
    { time: 18, open: 123, high: 125, low: 121, close: 124, volume: 3100 },
    { time: 19, open: 124, high: 127, low: 123, close: 126, volume: 3500 },
    { time: 20, open: 126, high: 128, low: 124, close: 125, volume: 2900 },
    { time: 21, open: 125, high: 129, low: 125, close: 128, volume: 3200 },
  ];

  it('calculates Simple Moving Average (SMA)', () => {
    const period = 5;
    const sma = calculateSMA(candles, period);
    expect(sma.length).toBe(candles.length);
    expect(sma[0]).toBeNull();
    expect(sma[3]).toBeNull();
    // 5th candle SMA = (102 + 106 + 104 + 109 + 111) / 5 = 532 / 5 = 106.40
    expect(sma[4]).toBe(106.4);
    // Last candle is a number
    expect(typeof sma[sma.length - 1]).toBe('number');
  });

  it('calculates Exponential Moving Average (EMA)', () => {
    const period = 5;
    const ema = calculateEMA(candles, period);
    expect(ema.length).toBe(candles.length);
    expect(ema[0]).toBeNull();
    expect(ema[4]).toBe(106.4); // Seeds with SMA
    expect(typeof ema[5]).toBe('number');
    expect(ema[5]).toBeGreaterThan(106);
  });

  it('calculates Relative Strength Index (RSI)', () => {
    const period = 14;
    const rsi = calculateRSI(candles, period);
    expect(rsi.length).toBe(candles.length);
    expect(rsi[0]).toBeNull();
    expect(rsi[13]).toBeNull();
    const lastRsi = rsi[rsi.length - 1];
    expect(lastRsi).not.toBeNull();
    expect(lastRsi).toBeGreaterThanOrEqual(0);
    expect(lastRsi).toBeLessThanOrEqual(100);
  });

  it('calculates Average True Range (ATR)', () => {
    const period = 10;
    const atr = calculateATR(candles, period);
    expect(atr.length).toBe(candles.length);
    const lastAtr = atr[atr.length - 1];
    expect(lastAtr).not.toBeNull();
    expect(lastAtr).toBeGreaterThan(0);
  });

  it('calculates Bollinger Bands (Upper, Middle, Lower)', () => {
    const bb = calculateBollingerBands(candles, 10, 2);
    expect(bb.length).toBe(candles.length);
    const lastBB = bb[bb.length - 1];
    expect(lastBB.middle).not.toBeNull();
    expect(lastBB.upper).not.toBeNull();
    expect(lastBB.lower).not.toBeNull();
    expect(lastBB.upper!).toBeGreaterThan(lastBB.middle!);
    expect(lastBB.middle!).toBeGreaterThan(lastBB.lower!);
    expect(lastBB.bandwidth).toBeGreaterThan(0);
  });

  it('calculates Volume Weighted Average Price (VWAP)', () => {
    const vwap = calculateVWAP(candles);
    expect(vwap.length).toBe(candles.length);
    const lastVwap = vwap[vwap.length - 1];
    expect(lastVwap).not.toBeNull();
    expect(lastVwap).toBeGreaterThan(100);
  });

  it('calculates Supertrend direction and value', () => {
    const st = calculateSupertrend(candles, 10, 3);
    expect(st.length).toBe(candles.length);
    const lastSt = st[st.length - 1];
    expect(lastSt.supertrend).not.toBeNull();
    expect(['UP', 'DOWN']).toContain(lastSt.direction);
  });
});
