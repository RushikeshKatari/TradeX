import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { executePaperOrder } from '@/lib/trading/execution';
import { OrderInput } from '@/types/trading';

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { symbol, quantity, price, reason } = body;

    const orderInput: OrderInput = {
      symbol,
      instrumentType: 'OPTION',
      side: 'SELL', // Exiting a BUY position is a SELL
      orderType: 'MARKET',
      quantity,
      price
    };

    const result = await executePaperOrder(user.userId, orderInput);

    return NextResponse.json({ ...result, reason });
  } catch (error: any) {
    console.error('Expert Picks Exit Trade Error:', error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
