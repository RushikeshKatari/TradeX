import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { hashPassword } from '@/lib/auth/passwords';
import { createUserSchema } from '@/lib/validation/schemas';
import { logAudit } from '@/lib/security/audit';
import Decimal from 'decimal.js';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Forbidden: Admin access required.' }, { status: 403 });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() || '';

  const users = await prisma.user.findMany({
    where: q
      ? {
          OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { username: { contains: q, mode: 'insensitive' } },
            { displayName: { contains: q, mode: 'insensitive' } },
          ],
        }
      : undefined,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      role: true,
      status: true,
      createdAt: true,
      virtualAccount: {
        select: {
          balance: true,
          reservedBalance: true,
        },
      },
      _count: {
        select: {
          orders: true,
          trades: true,
          positions: true,
        },
      },
    },
  });

  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Forbidden: Admin access required.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message || 'Invalid user data' }, { status: 400 });
    }

    const { email, username, displayName, password, role, initialCapital } = parsed.data;

    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }],
      },
    });

    if (existing) {
      return NextResponse.json({ error: 'A user with this email or username already exists.' }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const initialDec = new Decimal(initialCapital);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: email.toLowerCase(),
          username: username.toLowerCase(),
          displayName,
          passwordHash,
          role,
          status: 'ACTIVE',
          virtualAccount: {
            create: {
              balance: initialDec,
              currency: 'INR',
            },
          },
        },
        include: { virtualAccount: true },
      });

      if (created.virtualAccount) {
        await tx.fundTransaction.create({
          data: {
            virtualAccountId: created.virtualAccount.id,
            userId: created.id,
            type: 'INITIAL_ALLOCATION',
            amount: initialDec,
            balanceBefore: 0,
            balanceAfter: initialDec,
            reason: `Initial virtual capital allocation by administrator ${admin.username}`,
            createdBy: admin.userId,
          },
        });
      }

      return created;
    });

    await logAudit({
      userId: admin.userId,
      action: 'ADMIN_CREATE_USER',
      entity: 'USER',
      entityId: user.id,
      details: { email: user.email, username: user.username, role: user.role, initialCapital },
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        balance: user.virtualAccount ? Number(user.virtualAccount.balance) : 0,
      },
    });
  } catch (err: unknown) {
    console.error('[ADMIN_CREATE_USER_ERROR]', err);
    return NextResponse.json({ error: 'Failed to create user.' }, { status: 500 });
  }
}
