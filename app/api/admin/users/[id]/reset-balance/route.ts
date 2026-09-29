import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { ExecutionError, resetAdminBalance } from '@/lib/trading/execution';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Forbidden: Admin access required.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const targetBalance = typeof body?.targetBalance === 'number' ? body.targetBalance : Number.NaN;
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!Number.isFinite(targetBalance) || targetBalance < 0 || targetBalance > Number.MAX_SAFE_INTEGER) {
      return NextResponse.json({ error: 'Enter a valid non-negative balance amount.' }, { status: 400 });
    }
    if (reason.length < 3 || reason.length > 200) {
      return NextResponse.json({ error: 'Reason must be between 3 and 200 characters.' }, { status: 400 });
    }

    const result = await resetAdminBalance({
      targetUserId: params.id,
      adminUserId: admin.userId,
      targetBalance,
      reason,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    if (err instanceof ExecutionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'Could not reset the virtual balance.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
