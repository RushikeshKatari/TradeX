import { NextRequest, NextResponse } from 'next/server';
import { getMarketDataProvider } from '@/lib/market-data';
import { CandleInterval } from '@/types/market';
import { analyzeTechnicalSetup } from '@/lib/analysis/engine';

export async function GET(req: NextRequest, { params }: { params: { symbol: string } }) {
  const url = new URL(req.url);
  const interval = (url.searchParams.get('interval') || '1D') as CandleInterval;
  const range = url.searchParams.get('range') || '1mo';

  try {
    const symbol = params.symbol.toUpperCase();
    const provider = getMarketDataProvider();
    const candles = await provider.getHistoricalCandles(symbol, interval, range);
    const analysis = analyzeTechnicalSetup(candles);

    return NextResponse.json({
      symbol,
      interval,
      candles,
      analysis,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Historical market data temporarily unavailable.';
    return NextResponse.json({ error: msg }, { status: 503 });
  }
}
