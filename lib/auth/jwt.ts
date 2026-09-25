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
