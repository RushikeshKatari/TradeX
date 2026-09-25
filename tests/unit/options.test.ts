import { describe, it, expect } from 'vitest';
import { analyzeOptionChain } from '@/lib/options/analyzer';
import { OptionChainData } from '@/types/options';

describe('Options Analytics & Volume Leaders', () => {
  const mockChain: OptionChainData = {
    underlyingSymbol: 'NIFTY50',
    underlyingPrice: 24850,
    timestamp: new Date().toISOString(),
    expiryDates: ['26-Sep-2026', '03-Oct-2026'],
    selectedExpiry: '26-Sep-2026',
    strikes: [
      {
        strikePrice: 24800,
        ce: { ltp: 120, change: 5, volume: 40000, oi: 150000, changeOi: 5000, iv: 13.5 },
        pe: { ltp: 45, change: -4, volume: 65000, oi: 210000, changeOi: 8000, iv: 14.0 },
      },
      {
        strikePrice: 24900,
        ce: { ltp: 55, change: -3, volume: 85000, oi: 300000, changeOi: 12000, iv: 13.8 },
        pe: { ltp: 110, change: 8, volume: 30000, oi: 120000, changeOi: 4000, iv: 14.2 },
      },
    ],
    highestVolumeStrikeCE: { strike: 24900, volume: 85000 },
    highestVolumeStrikePE: { strike: 24800, volume: 65000 },
    pcr: { volumePcr: 0.79, oiPcr: 0.73 },
    dataSource: 'Live Exchange Feed',
    isDelayed: true,
  };

  it('accurately identifies highest observed volume strikes without recommendation labels', () => {
    const summary = analyzeOptionChain(mockChain);
    expect(summary.volumeLeaderCE?.strike).toBe(24900);
    expect(summary.volumeLeaderPE?.strike).toBe(24800);
    expect(summary.disclaimer).toContain('Volume leaders do NOT indicate trade recommendations');
  });

  it('computes Put/Call Ratio and market setup classification', () => {
    const summary = analyzeOptionChain(mockChain);
    expect(summary.oiPcr).toBe(0.73);
    expect(summary.volumePcr).toBe(0.79);
    expect(['BULLISH', 'BEARISH', 'NEUTRAL']).toContain(summary.sentiment);
  });
});
