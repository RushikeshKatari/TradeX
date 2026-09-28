import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { executePaperOrder, ExecutionError } from '@/lib/trading/execution';
import { OrderInput } from '@/types/trading';
import { getConfiguredExitTime, shouldTimeExit } from '@/lib/expert-picks/exit-service';

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
    const { underlying, strike, optionType, expiry, quantity, price } = body;

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
