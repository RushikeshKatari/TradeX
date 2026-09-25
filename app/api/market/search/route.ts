import { NextRequest, NextResponse } from 'next/server';
import { getMarketDataProvider } from '@/lib/market-data';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') || '';
  if (!q.trim()) {
    return NextResponse.json([]);
  }

  const provider = getMarketDataProvider();
  const results = await provider.searchInstruments(q);
  return NextResponse.json(results);
}
