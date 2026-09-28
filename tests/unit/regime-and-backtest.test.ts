import { describe, it, expect } from 'vitest';
import { detectMarketRegime } from '@/lib/analysis/regime-engine';
import { analyzeOptionsSignal } from '@/lib/options/options-signal-engine';
import { runBacktestSimulation } from '@/lib/analysis/backtesting-engine';
import { Candle } from '@/types/market';
import { OptionChainData } from '@/types/options';

function generateSampleCandles(count: number, trend: 'up' | 'down' | 'flat'): Candle[] {
  const candles: Candle[] = [];
  let basePrice = 24000;
  const now = Math.floor(Date.now() / 1000);

  for (let i = 0; i < count; i++) {
    const delta = trend === 'up' ? 25 : trend === 'down' ? -25 : (i % 2 === 0 ? 10 : -10);
    basePrice += delta;
    candles.push({
      time: now - (count - i) * 86400,
      open: basePrice - 10,
      high: basePrice + 30,
      low: basePrice - 20,
      close: basePrice,
      volume: 150000,
    });
  }
  return candles;
}

describe('Market Regime & Options Signal Engine', () => {
  it('detects BULLISH regime on sustained upward candles and bullish PCR', () => {
    const candles = generateSampleCandles(60, 'up');
    const regime = detectMarketRegime(candles, 1.4, 25500, 25500);

    expect(regime.regime).toBe('BULLISH');
    expect(regime.confidence).toBeGreaterThan(30);
    expect(regime.trendStrength).toBeDefined();
    expect(regime.supportingFactors.length).toBeGreaterThan(0);
  });

  it('detects BEARISH regime on sustained downward candles and low PCR', () => {
    const candles = generateSampleCandles(60, 'down');
    const regime = detectMarketRegime(candles, 0.6, 22500, 22500);

    expect(regime.regime).toBe('BEARISH');
    expect(regime.confidence).toBeGreaterThan(30);
    expect(regime.supportingFactors.length).toBeGreaterThan(0);
  });

  it('returns INSUFFICIENT_DATA when candle history is below 20 bars', () => {
    const candles = generateSampleCandles(10, 'up');
    const regime = detectMarketRegime(candles, 1.2, 24000);

    expect(regime.regime).toBe('INSUFFICIENT_DATA');
    expect(regime.confidence).toBe(0);
  });

  it('evaluates LONG_CALL option trade on bullish regime with favorable asymmetry', () => {
    const candles = generateSampleCandles(60, 'up');
    const regime = detectMarketRegime(candles, 1.3, 25500, 25500);
    const spot = candles[candles.length - 1].close;

    const mockChain: OptionChainData = {
      underlyingSymbol: 'NIFTY50',
      underlyingPrice: spot,
      timestamp: new Date().toISOString(),
      expiryDates: [new Date(Date.now() + 7 * 86400000).toISOString()],
      selectedExpiry: new Date(Date.now() + 7 * 86400000).toISOString(),
      highestVolumeStrikeCE: { strike: 25500, volume: 50000 },
      highestVolumeStrikePE: { strike: 25500, volume: 40000 },
      pcr: { volumePcr: 1.2, oiPcr: 1.3 },
      dataSource: 'Test Provider',
      isDelayed: false,
      strikes: [
        {
          strikePrice: 25500,
          ce: { ltp: 150, change: 5, volume: 50000, oi: 100000, changeOi: 5000, iv: 14 },
          pe: { ltp: 140, change: -5, volume: 40000, oi: 90000, changeOi: -2000, iv: 14 },
        },
      ],
    };

    const signal = analyzeOptionsSignal(regime, mockChain, spot);
    expect(signal.signal).toBe('LONG_CALL');
    expect(signal.optionType).toBe('CE');
    expect(signal.strike).toBe(25500);
    expect(signal.riskReward).toBeGreaterThan(0.4);
  });

  it('runs backtest simulation generating realistic trades and metrics', () => {
    const candles = generateSampleCandles(60, 'up');
    const result = runBacktestSimulation(candles, {
      symbol: 'NIFTY50',
      startingCapital: 500000,
      lotSize: 25,
      slippagePerUnit: 0.5,
      costPerTrade: 20,
      strategy: 'REGIME_MOMENTUM',
    });

    expect(result.status).toBe('SUCCESS');
    expect(result.metrics.totalTrades).toBeGreaterThan(0);
    expect(result.equityCurve.length).toBeGreaterThan(20);
    expect(result.regimePerformance.length).toBeGreaterThan(0);
  });
});
