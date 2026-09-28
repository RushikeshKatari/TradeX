import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { executePaperOrder, ExecutionError } from '@/lib/trading/execution';
import { OrderInput } from '@/types/trading';
import { getConfiguredExitTime, shouldTimeExit } from '@/lib/expert-picks/exit-service';
import { prisma } from '@/lib/db/prisma';
import { getMarketDataProvider } from '@/lib/market-data';
import { randomUUID } from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const exitTime = getConfiguredExitTime();
    if (shouldTimeExit(exitTime)) {
      return NextResponse.json(
        { error: `Expert Picks entries are closed after ${exitTime} IST. New positions will be available next trading session.` },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { underlying, strike, optionType, expiry, quantity, price, ceInvestment, peInvestment, ceStopLossPercent, peStopLossPercent, targetValue } = body;

    // Paired CE+PE entry. Investments are converted to whole lots using live LTPs.
    if (ceInvestment !== undefined || peInvestment !== undefined) {
      const ceBudget = Number(ceInvestment || 0);
      const peBudget = Number(peInvestment || 0);
      const provider = getMarketDataProvider();
      const lotSize = 75;
      const groupId = randomUUID();
      const legs = [
        { optionType: 'CE' as const, budget: ceBudget, stop: Number(ceStopLossPercent || 0) },
        { optionType: 'PE' as const, budget: peBudget, stop: Number(peStopLossPercent || 0) },
      ];
      if (ceBudget <= 0 || peBudget <= 0 || Number(targetValue) <= 0) {
        return NextResponse.json({ error: 'CE investment, PE investment, and exit target must be greater than zero.' }, { status: 400 });
      }
      const results = [];
      for (const leg of legs) {
        const quote = await provider.getQuote(`${underlying}_${strike}_${leg.optionType}`);
        const lots = Math.floor(leg.budget / (quote.lastPrice * lotSize));
        if (lots < 1) return NextResponse.json({ error: `${leg.optionType} investment must cover at least one lot.` }, { status: 400 });
        const result = await executePaperOrder(user.userId, {
          symbol: `${underlying}_${strike}_${leg.optionType}`,
          instrumentType: 'OPTION', side: 'BUY', orderType: 'MARKET',
          quantity: lots * lotSize, price: quote.lastPrice,
        });
        await prisma.position.update({
          where: { userId_symbol: { userId: user.userId, symbol: `${underlying}_${strike}_${leg.optionType}` } },
          data: { stopLossPercent: leg.stop, exitTargetValue: Number(targetValue), tradeGroupId: groupId },
        });
        results.push({ optionType: leg.optionType, lots, ...result });
      }
      return NextResponse.json({ success: true, paired: true, groupId, results });
    }

    if (!underlying || !strike || !optionType || !quantity || quantity <= 0) {
      return NextResponse.json({ error: 'Invalid order parameters. Quantity must be at least 1.' }, { status: 400 });
    }

    if (expiry !== undefined && typeof expiry !== 'string') {
      return NextResponse.json({ error: 'Invalid expiry.' }, { status: 400 });
    }

    const symbol = `${underlying}_${strike}_${optionType}`;

    // The shared paper execution engine supports funded long positions only.
    // Expert-pick SELL is a strategy signal (for example, option writing), not
    // a request to short an option without an existing position. Opening an
    // Expert Pick therefore always creates a funded BUY position; SELL picks
    // remain visible as the strategy recommendation and can be acted on via
    // the normal position/order flow when shorting is supported.
    const orderInput: OrderInput = {
      symbol,
      instrumentType: 'OPTION',
      side: 'BUY',
      orderType: 'MARKET',
      quantity: Math.floor(quantity),
      price: price ? Number(price) : undefined,
    };

    const result = await executePaperOrder(user.userId, orderInput);
    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    if (error instanceof ExecutionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const msg = error instanceof Error ? error.message : 'Trade execution failed';
    console.error('[EXPERT_PICKS_ENTER_ERROR]', error);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
