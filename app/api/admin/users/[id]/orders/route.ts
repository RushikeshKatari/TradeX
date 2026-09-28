import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { clearUserOrderHistory, ExecutionError } from '@/lib/trading/execution';

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Forbidden: Admin access required.' }, { status: 403 });
  }

  try {
    const result = await clearUserOrderHistory({
      targetUserId: params.id,
      actorUserId: admin.userId,
      actorRole: 'ADMIN',
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    if (err instanceof ExecutionError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : 'Could not clear order history.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
