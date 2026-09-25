import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { cancelOpenOrder, ExecutionError } from '@/lib/trading/execution';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const updated = await cancelOpenOrder(user.userId, params.id);
    return NextResponse.json({ success: true, order: updated });
  } catch (err: unknown) {
    if (err instanceof ExecutionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Could not cancel order.' }, { status: 500 });
  }
}
