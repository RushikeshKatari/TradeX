import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { executePairedOptionBuys, executePaperOrder, ExecutionError } from '@/lib/trading/execution';
import { OrderInput } from '@/types/trading';
import { isExpertPickEntryAllowed } from '@/lib/market-data/calendar';
import { getMarketDataProvider } from '@/lib/market-data';
import { randomUUID } from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isExpertPickEntryAllowed()) {
      return NextResponse.json(
        { error: 'Expert Picks entries are available from 09:15 AM to 03:45 PM IST on trading days.' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { underlying, strike, optionType, expiry, quantity, price, ceInvestment, peInvestment, ceStopLossPercent, peStopLossPercent, targetValue } = body;

    // Paired CE+PE entry. Investments are converted to whole lots using live LTPs.
    if (ceInvestment !== undefined || peInvestment !== undefined) {
      const ceBudget = Number(ceInvestment || 0);
      const peBudget = Number(peInvestment || 0);
      const stopLosses = [Number(ceStopLossPercent ?? 0), Number(peStopLossPercent ?? 0)];
      const target = Number(targetValue);
      const optionUnderlying = String(underlying || '').trim().toUpperCase();
      const optionStrike = Number(strike);
      if (
        !Number.isFinite(ceBudget) || ceBudget <= 0 ||
        !Number.isFinite(peBudget) || peBudget <= 0 ||
        !Number.isFinite(target) || target <= 0 ||
        !Number.isFinite(optionStrike) || optionStrike <= 0 ||
        !stopLosses.every((stop) => Number.isFinite(stop) && stop >= 0 && stop <= 100)
      ) {
        return NextResponse.json({ error: 'CE investment, PE investment, and exit target must be greater than zero.' }, { status: 400 });
      }

      const lotSizeByUnderlying: Record<string, number> = {
        NIFTY50: 75,
        BANKNIFTY: 30,
        SENSEX: 20,
        NIFTYIT: 25,
      };
      const lotSize = lotSizeByUnderlying[optionUnderlying];
      if (!lotSize) {
        return NextResponse.json({ error: 'Unsupported option underlying for a paired trade.' }, { status: 400 });
      }

      const groupId = randomUUID();
      const provider = getMarketDataProvider();
      const requestedLegs = [
        { optionType: 'CE' as const, budget: ceBudget, stopLossPercent: stopLosses[0] },
        { optionType: 'PE' as const, budget: peBudget, stopLossPercent: stopLosses[1] },
      ];
      const preparedLegs = await Promise.all(requestedLegs.map(async (leg) => {
        const symbol = `${optionUnderlying}_${optionStrike}_${leg.optionType}`;
        const quote = await provider.getQuote(symbol);
        if (!Number.isFinite(quote.lastPrice) || quote.lastPrice <= 0) {
          throw new ExecutionError(`A valid ${leg.optionType} quote is unavailable; neither side was entered.`);
        }
        const lots = Math.floor(leg.budget / (quote.lastPrice * lotSize));
        if (lots < 1) {
          throw new ExecutionError(`${leg.optionType} investment must cover at least one lot; neither side was entered.`);
        }
        return {
          ...leg,
          symbol,
          lots,
          quantity: lots * lotSize,
          price: quote.lastPrice,
          exchange: optionUnderlying === 'SENSEX' ? 'BSE' : 'NSE',
        };
      }));

      const results = await executePairedOptionBuys(
        user.userId,
        preparedLegs.map((leg) => ({
          symbol: leg.symbol,
          exchange: leg.exchange,
          quantity: leg.quantity,
          price: leg.price,
          stopLossPercent: leg.stopLossPercent,
          exitTargetValue: target,
          tradeGroupId: groupId,
        })),
      );

      return NextResponse.json({
        success: true,
        paired: true,
        groupId,
        results: results.map((result, index) => ({
          optionType: preparedLegs[index].optionType,
          lots: preparedLegs[index].lots,
          ...result,
        })),
      });
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
