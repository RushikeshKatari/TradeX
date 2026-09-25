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
