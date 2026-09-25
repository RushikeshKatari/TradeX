import { NextResponse } from 'next/server';
import { getMarketDataProvider } from '@/lib/market-data';

export async function GET() {
  const provider = getMarketDataProvider();
  const status = await provider.getMarketStatus();
  return NextResponse.json(status);
}
