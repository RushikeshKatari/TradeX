import { NextRequest, NextResponse } from 'next/server';
import { getMarketDataProvider } from '@/lib/market-data';
import { analyzeOptionChain } from '@/lib/options/analyzer';

export async function GET(req: NextRequest, { params }: { params: { symbol: string } }) {
  const url = new URL(req.url);
  const expiry = url.searchParams.get('expiry') || undefined;

  try {
    const symbol = params.symbol.toUpperCase();
    const provider = getMarketDataProvider();
    const chainData = await provider.getOptionChain(symbol, expiry);
    const analysis = analyzeOptionChain(chainData);

    return NextResponse.json({
      chain: chainData,
      analysis,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unable to load option chain.';
    return NextResponse.json({ error: msg }, { status: 503 });
  }
}
