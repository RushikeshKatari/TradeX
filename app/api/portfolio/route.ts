import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { getPortfolioSummary } from '@/lib/trading/execution';

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await getPortfolioSummary(user.userId);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to retrieve portfolio data';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
