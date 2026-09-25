import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@prisma/client';

export async function logAudit(params: {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  details?: Prisma.InputJsonValue;
  ipAddress?: string | null;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId ?? null,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId ?? null,
        details: params.details ?? Prisma.JsonNull,
        ipAddress: params.ipAddress ?? null,
      },
    });
  } catch (err) {
    console.error('[AUDIT_LOG_ERROR]', err);
  }
}
