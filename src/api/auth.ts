import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from './config';
import type { User } from '../shared/types';

export const SESSION_COOKIE = 'sas_session';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  pool: Pool,
  userId: string,
  ttlHours: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
    hashToken(token),
    userId,
    expiresAt,
  ]);
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  return { token, expiresAt };
}

export async function destroySession(pool: Pool, token: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export function mapUser(row: {
  id: string;
  email: string;
  name: string;
  role: 'manager' | 'staff';
}): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    canApprove: row.role === 'manager',
  };
}

export async function findSessionUser(pool: Pool, token: string): Promise<User | null> {
  const res = await pool.query<{
    id: string;
    email: string;
    name: string;
    role: 'manager' | 'staff';
  }>(
    `SELECT u.id, u.email, u.name, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const row = res.rows[0];
  return row ? mapUser(row) : null;
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  config: AppConfig,
  maxAgeSeconds: number,
): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: maxAgeSeconds,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function requestToken(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  const raw = req.cookies?.[SESSION_COOKIE];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/** Same-origin / configured origin のみ許可（SameSite=Lax と併用） */
export function isAllowedOrigin(req: FastifyRequest, config: AppConfig): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const allowed = new Set([
    config.appOrigin,
    ...config.corsOrigins,
    `http://127.0.0.1:${config.port}`,
    `http://localhost:${config.port}`,
    'http://127.0.0.1:5174',
    'http://localhost:5174',
  ]);
  return allowed.has(origin);
}
