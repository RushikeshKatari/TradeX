import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { logAudit } from '@/lib/security/audit';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const user = await prisma.user.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      role: true,
      status: true,
      createdAt: true,
      virtualAccount: {
        include: {
          transactions: {
            orderBy: { createdAt: 'desc' },
            take: 50,
          },
        },
      },
      orders: {
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: { trades: true },
      },
      positions: true,
      holdings: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json(user);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { status } = body;

  if (status !== 'ACTIVE' && status !== 'INACTIVE') {
    return NextResponse.json({ error: 'Invalid status value' }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: params.id },
    data: { status },
  });

  await logAudit({
    userId: admin.userId,
    action: status === 'ACTIVE' ? 'ADMIN_ACTIVATE_USER' : 'ADMIN_DEACTIVATE_USER',
    entity: 'USER',
    entityId: updated.id,
  });

  return NextResponse.json({ success: true, status: updated.status });
}
