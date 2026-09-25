import { describe, it, expect } from 'vitest';
import { analyzeTechnicalSetup } from '@/lib/analysis/engine';
import { Candle } from '@/types/market';

describe('Market Analysis Engine', () => {
  it('evaluates insufficient candles safely without crashing', () => {
    const result = analyzeTechnicalSetup([]);
    expect(result.status).toBe('SIDEWAYS');
    expect(result.signalConfidence).toBe('Weak');
    expect(result.totalScore).toBe(0);
    expect(result.reasons[0]).toContain('Insufficient historical candles');
  });

  it('evaluates technical setup with transparent multi-factor scoring', () => {
    // Generate a strong upward trending series (30 candles)
    const candles: Candle[] = [];
    for (let i = 0; i < 30; i++) {
      const p = 100 + i * 2;
      candles.push({
        time: 1700000000 + i * 86400,
        open: p - 1,
        high: p + 2,
        low: p - 1.5,
        close: p + 1,
        volume: 10000 + i * 500,
      });
    }

    const result = analyzeTechnicalSetup(candles);
    expect(['BULLISH', 'BEARISH', 'SIDEWAYS']).toContain(result.status);
    expect(['Weak', 'Moderate', 'Strong']).toContain(result.signalConfidence);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.disclaimer).toContain('Signal strength represents agreement');
    expect(result.metrics.price).toBe(candles[candles.length - 1].close);
  });
});
