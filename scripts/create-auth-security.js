const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

function write(relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content.trim() + '\n', 'utf8');
  console.log('Created: ' + relPath);
}

write('lib/auth/passwords.ts', `
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
`);

write('lib/auth/jwt.ts', `
import { SignJWT, jwtVerify } from 'jose';
import { UserSessionPayload } from '@/types/user';

const SECRET_KEY = process.env.AUTH_SECRET || 'tradex_super_secret_session_jwt_key_at_least_32_chars_2026';
const encodedKey = new TextEncoder().encode(SECRET_KEY);

export async function signSessionToken(payload: UserSessionPayload, expiresIn: string = '7d'): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(encodedKey);
}

export async function verifySessionToken(token: string): Promise<UserSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, encodedKey, {
      algorithms: ['HS256'],
    });
    return payload as unknown as UserSessionPayload;
  } catch {
    return null;
  }
}
`);

write('lib/auth/session.ts', `
import { cookies } from 'next/headers';
import { verifySessionToken } from './jwt';
import { UserSessionPayload } from '@/types/user';
import { prisma } from '@/lib/db/prisma';

export const SESSION_COOKIE_NAME = 'tradex_session_token';

export async function getSessionUser(): Promise<UserSessionPayload | null> {
  const cookieStore = cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const verified = await verifySessionToken(token);
  if (!verified) return null;

  // Verify status in DB if available
  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: verified.userId },
      select: { id: true, email: true, username: true, displayName: true, role: true, status: true },
    });
    if (!dbUser || dbUser.status !== 'ACTIVE') return null;
    return {
      userId: dbUser.id,
      email: dbUser.email,
      username: dbUser.username,
      displayName: dbUser.displayName,
      role: dbUser.role,
      status: dbUser.status,
    };
  } catch {
    return verified;
  }
}

export async function requireAuth(): Promise<UserSessionPayload> {
  const user = await getSessionUser();
  if (!user) {
    throw new Error('UNAUTHORIZED');
  }
  return user;
}

export async function requireAdmin(): Promise<UserSessionPayload> {
  const user = await requireAuth();
  if (user.role !== 'ADMIN') {
    throw new Error('FORBIDDEN');
  }
  return user;
}
`);

write('lib/security/audit.ts', `
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
`);

write('lib/security/rate-limit.ts', `
interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, RateLimitRecord>();

export function checkRateLimit(key: string, limit: number = 60, windowMs: number = 60000): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const record = memoryStore.get(key);

  if (!record || now > record.resetAt) {
    memoryStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }

  if (record.count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  record.count += 1;
  return { allowed: true, remaining: limit - record.count };
}
`);
