import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { getMarketDataProvider } from '@/lib/market-data';
import { watchlistSchema } from '@/lib/validation/schemas';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let wl = await prisma.watchlist.findFirst({
    where: { userId: user.userId },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });

  if (!wl) {
    wl = await prisma.watchlist.create({
      data: {
        userId: user.userId,
        name: 'My Watchlist',
        items: {
          createMany: {
            data: [
              { symbol: 'NIFTY50', sortOrder: 0 },
              { symbol: 'RELIANCE', sortOrder: 1 },
              { symbol: 'TCS', sortOrder: 2 },
              { symbol: 'HDFCBANK', sortOrder: 3 },
            ],
          },
        },
      },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  const provider = getMarketDataProvider();
  const quotes = await Promise.all(
    wl.items.map(async (item) => {
      try {
        const q = await provider.getQuote(item.symbol);
        return { id: item.id, ...q };
      } catch {
        return {
          id: item.id,
          symbol: item.symbol,
          name: item.symbol,
          exchange: 'NSE' as const,
          lastPrice: 0,
          change: 0,
          changePercent: 0,
          open: 0,
          high: 0,
          low: 0,
          close: 0,
          previousClose: 0,
          volume: 0,
          timestamp: new Date().toISOString(),
          isDelayed: true,
          marketStatus: 'CLOSED' as const,
          dataSource: 'Unavailable',
        };
      }
    })
  );

  return NextResponse.json(quotes);
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const parsed = watchlistSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 });
  }

  let wl = await prisma.watchlist.findFirst({ where: { userId: user.userId } });
  if (!wl) {
    wl = await prisma.watchlist.create({ data: { userId: user.userId, name: 'My Watchlist' } });
  }

  try {
    const item = await prisma.watchlistItem.create({
      data: {
        watchlistId: wl.id,
        symbol: parsed.data.symbol,
      },
    });
    return NextResponse.json({ success: true, item });
  } catch {
    return NextResponse.json({ error: 'Symbol already in watchlist or invalid' }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const symbol = url.searchParams.get('symbol')?.toUpperCase();
  if (!symbol) return NextResponse.json({ error: 'Symbol required' }, { status: 400 });

  const wl = await prisma.watchlist.findFirst({ where: { userId: user.userId } });
  if (!wl) return NextResponse.json({ success: true });

  await prisma.watchlistItem.deleteMany({
    where: { watchlistId: wl.id, symbol },
  });

  return NextResponse.json({ success: true });
}
