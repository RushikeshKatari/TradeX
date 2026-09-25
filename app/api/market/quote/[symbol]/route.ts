import { NextRequest, NextResponse } from 'next/server';
import { getMarketDataProvider } from '@/lib/market-data';

export async function GET(req: NextRequest, { params }: { params: { symbol: string } }) {
  try {
    const symbol = params.symbol.toUpperCase();
    const provider = getMarketDataProvider();
    const quote = await provider.getQuote(symbol);
    return NextResponse.json(quote);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Market data temporarily unavailable.';
    return NextResponse.json({ error: msg }, { status: 503 });
  }
}
