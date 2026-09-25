import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, getSessionUser } from '@/lib/auth/session';
import { logAudit } from '@/lib/security/audit';

export async function POST() {
  const user = await getSessionUser();
  if (user) {
    await logAudit({ userId: user.userId, action: 'LOGOUT', entity: 'USER' });
  }

  const response = NextResponse.json({ success: true, message: 'Logged out successfully' });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });

  return response;
}
