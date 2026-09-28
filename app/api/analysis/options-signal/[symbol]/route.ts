import { NextRequest, NextResponse } from 'next/server';
import { getMarketDataProvider } from '@/lib/market-data';
import { detectMarketRegime } from '@/lib/analysis/regime-engine';
import { analyzeOptionsSignal } from '@/lib/options/options-signal-engine';

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = params.symbol.toUpperCase();
    const provider = getMarketDataProvider();

    const [quote, candles, optionChain] = await Promise.all([
      provider.getQuote(symbol).catch(() => null),
      provider.getHistoricalCandles(symbol, '1D', '3mo').catch(() => []),
      provider.getOptionChain(symbol).catch(() => null),
    ]);

    const spot = quote?.lastPrice || optionChain?.underlyingPrice || 0;
    const pcr = optionChain?.pcr?.oiPcr ?? optionChain?.pcr?.volumePcr ?? 1.0;
    const step = symbol.includes('BANK') ? 100 : 50;
    const atmStrike = spot > 0 ? Math.round(spot / step) * step : undefined;
    const maxPain = optionChain?.highestVolumeStrikeCE?.strike ?? optionChain?.highestVolumeStrikePE?.strike;

    const regime = detectMarketRegime(candles, pcr, atmStrike, maxPain);
    const signal = analyzeOptionsSignal(regime, optionChain, spot);

    return NextResponse.json({
      symbol,
      quote,
      regime,
      signal,
      provider: provider.name,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'Failed to analyze options signal', details: msg },
      { status: 500 }
    );
  }
}
