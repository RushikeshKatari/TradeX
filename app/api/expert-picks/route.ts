import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { getMarketDataProvider } from '@/lib/market-data';
import { detectMarketRegime } from '@/lib/analysis/regime-engine';
import { prisma } from '@/lib/db/prisma';
import { getTopPicksByVolume } from '@/lib/expert-picks/pick-service';
import { evaluateAndExecuteAutoExits } from '@/lib/expert-picks/exit-service';
import { ExpertPicksResponse, ExpertPickPosition } from '@/types/expert-picks';

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const symbol = (searchParams.get('symbol') || 'NIFTY50').toUpperCase().trim();
    const expiry = searchParams.get('expiry') || '';

    const provider = getMarketDataProvider();

    // 1. Fetch Option Chain and Candles
    const [chain, candles] = await Promise.all([
      provider.getOptionChain(symbol, expiry),
      provider.getHistoricalCandles(symbol, '1D', '3mo').catch(() => []),
    ]);

    // 2. Regime Analysis
    const pcr = chain?.pcr?.oiPcr ?? chain?.pcr?.volumePcr ?? 1.0;
    const spot = chain?.underlyingPrice || 0;
    const atmStrike = spot > 0 ? Math.round(spot / 50) * 50 : undefined;
    const maxPain = chain?.highestVolumeStrikeCE?.strike ?? chain?.highestVolumeStrikePE?.strike;
    const regime = detectMarketRegime(candles, pcr, atmStrike, maxPain);

    // 3. Lot Size Lookup
    const instrument = await prisma.instrument.findUnique({ where: { symbol } });
    const defaultLotSizes: Record<string, number> = { NIFTY50: 75, SENSEX: 20, BANKNIFTY: 30, NIFTYIT: 25 };
    const lotSize = instrument?.lotSize || defaultLotSizes[symbol] || 75;

    // 4. Virtual Cash
    let account = await prisma.virtualAccount.findUnique({ where: { userId: user.userId } });
    let availableCash = account?.balance ? Number(account.balance) : 0;

    // 5. Generate Top 5 Expert Picks by Volume
    const picks = getTopPicksByVolume(chain, regime, lotSize, availableCash);

    // 6. Fetch User's Open Option Positions
    const allDbPositions = await prisma.position.findMany({
      where: { userId: user.userId },
      orderBy: { updatedAt: 'desc' },
    });

    const positions: ExpertPickPosition[] = [];

    for (const p of allDbPositions) {
      if (p.quantity <= 0) continue;
      const match = p.symbol.match(/^([A-Z0-9]+)_(\d+(?:\.\d+)?)_(CE|PE)$/);
      if (!match) continue;

      const [, posUnderlying, strikeStr, legType] = match;
      const strike = Number(strikeStr);
      const optionType = legType as 'CE' | 'PE';

      // Query live quote for mark-to-market P&L
      let currentLtp = Number(p.averageEntryPrice);
      try {
        const quote = await provider.getQuote(p.symbol);
        if (quote && quote.lastPrice > 0) {
          currentLtp = quote.lastPrice;
        }
      } catch {
        // Fall back to averageEntryPrice if quote fails
      }

      const quantity = p.quantity;
      const entryPrice = Number(p.averageEntryPrice);
      const investment = Number((quantity * entryPrice).toFixed(2));
      const currentValue = Number((quantity * currentLtp).toFixed(2));
      const pnl = Number((currentValue - investment).toFixed(2));
      const pnlPercent = investment > 0 ? Number(((pnl / investment) * 100).toFixed(2)) : 0;
      const lots = Math.floor(quantity / lotSize);

      positions.push({
        id: p.id,
        underlying: posUnderlying,
        strike,
        optionType,
        expiry: chain.selectedExpiry,
        side: 'BUY',
        lots,
        lotSize,
        quantity,
        entryPrice,
        currentLtp,
        investment,
        currentValue,
        pnl,
        pnlPercent,
        status: 'OPEN',
        enteredAt: p.updatedAt.toISOString(),
      });
    }

    // 7. Auto-Exit Evaluation (50% stop loss, combined profit, 3:15 PM time exit)
    const autoExitResults = await evaluateAndExecuteAutoExits(user.userId, positions);
    if (autoExitResults.length > 0) {
      // Re-fetch cash balance if any positions were auto-closed
      account = await prisma.virtualAccount.findUnique({ where: { userId: user.userId } });
      availableCash = account?.balance ? Number(account.balance) : availableCash;
    }

    // Filter active open positions for summary
    const activePositions = positions.filter((p) => p.status === 'OPEN');
    const totalInvestment = activePositions.reduce((sum, p) => sum + p.investment, 0);
    const currentPnl = activePositions.reduce((sum, p) => sum + p.pnl, 0);

    const response: ExpertPicksResponse = {
      picks,
      positions, // includes any that just closed with status: 'CLOSED' and exitReason
      summary: {
        totalInvestment: Number(totalInvestment.toFixed(2)),
        currentPnl: Number(currentPnl.toFixed(2)),
        openPositions: activePositions.length,
        availableCash: Number(availableCash.toFixed(2)),
      },
      underlying: symbol,
      expiry: chain.selectedExpiry,
      lastUpdated: new Date().toISOString(),
      isStale: false,
    };

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to retrieve expert picks';
    console.error('[EXPERT_PICKS_API_ERROR]', error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
