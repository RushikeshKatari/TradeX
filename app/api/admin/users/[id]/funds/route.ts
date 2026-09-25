import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { allocateAdminFunds, ExecutionError } from '@/lib/trading/execution';
import { allocateFundsSchema } from '@/lib/validation/schemas';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Forbidden: Admin access required.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = allocateFundsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message || 'Invalid fund allocation parameters' }, { status: 400 });
    }

    const { amount, reason } = parsed.data;
    const tx = await allocateAdminFunds({
      targetUserId: params.id,
      adminUserId: admin.userId,
      amount,
      reason,
    });

    return NextResponse.json({ success: true, transaction: tx });
  } catch (err: unknown) {
    if (err instanceof ExecutionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : 'Fund allocation failed.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
