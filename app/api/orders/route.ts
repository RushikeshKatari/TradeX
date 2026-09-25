import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { orderSchema } from '@/lib/validation/schemas';
import { executePaperOrder, ExecutionError } from '@/lib/trading/execution';
import { checkRateLimit } from '@/lib/security/rate-limit';

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orders = await prisma.order.findMany({
    where: { userId: user.userId },
    orderBy: { createdAt: 'desc' },
    include: { trades: true },
    take: 50,
  });

  return NextResponse.json(orders);
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { allowed } = checkRateLimit(`order_${user.userId}`, 20, 60000);
  if (!allowed) {
    return NextResponse.json({ error: 'Order placement rate limit reached. Please slow down.' }, { status: 429 });
  }

  try {
    const body = await req.json();
    const parsed = orderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message || 'Invalid order parameters' }, { status: 400 });
    }

    const result = await executePaperOrder(user.userId, parsed.data);
    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    if (err instanceof ExecutionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : 'Order could not be processed.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
