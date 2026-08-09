import { SignJWT, jwtVerify } from 'jose';
import type { Request, Response, NextFunction } from 'express';
import { config, isProduction } from './config.js';
import { memoryStore, collections } from './db.js';
import { randomId, encryptSecret } from './crypto.js';
import type { User } from './types.js';

const COOKIE = 'dmt_session';
const secret = new TextEncoder().encode(config.AUTH_SECRET);
const exchangeCodes = new Map<string, { token: string; expiresAt: number }>();

export type AuthenticatedRequest = Request & { user?: User };

export async function createSession(user: User): Promise<string> {
  const sessionId = randomId();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const c = await collections();
  if (c) await c.sessions.insertOne({ _id: sessionId, userId: user.discordId, expiresAt });
  else memoryStore().sessions.set(sessionId, { userId: user.discordId, expiresAt });
  return new SignJWT({ sid: sessionId, uid: user.discordId })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30d').sign(secret);
}

export function setSessionCookie(response: Response, token: string): void {
  response.cookie(COOKIE, token, {
    httpOnly: true, secure: isProduction, sameSite: isProduction ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, path: '/',
  });
}

export function clearSessionCookie(response: Response): void { response.clearCookie(COOKIE, { path: '/' }); }

export function createExchangeCode(token: string): string {
  const code = randomId(18);
  exchangeCodes.set(code, { token, expiresAt: Date.now() + 90_000 });
  return code;
}

export function consumeExchangeCode(code: string): string | undefined {
  const entry = exchangeCodes.get(code); exchangeCodes.delete(code);
  if (!entry || entry.expiresAt < Date.now()) return undefined;
  return entry.token;
}

async function tokenFromRequest(request: Request): Promise<string | undefined> {
  const header = request.header('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return request.cookies?.[COOKIE];
}

export async function getSessionUser(request: Request): Promise<User | undefined> {
  const token = await tokenFromRequest(request);
  if (!token) return undefined;
  try {
    const payload = await jwtVerify(token, secret);
    const sid = String(payload.payload.sid ?? '');
    const c = await collections();
    const session = c ? await c.sessions.findOne({ _id: sid }) : memoryStore().sessions.get(sid);
    if (!session || new Date(session.expiresAt) <= new Date()) return undefined;
    const userId = String(session.userId);
    if (c) return (await c.users.findOne({ discordId: userId })) ?? undefined;
    return memoryStore().users.get(userId);
  } catch { return undefined; }
}

export async function requireAuth(request: AuthenticatedRequest, response: Response, next: NextFunction): Promise<void> {
  const user = await getSessionUser(request);
  if (!user) { response.status(401).json({ error: 'Authentication required' }); return; }
  request.user = user; next();
}

export async function upsertOAuthUser(profile: { id: string; username: string; avatar?: string | null }, oauth: { accessToken: string; refreshToken?: string; expiresIn?: number }): Promise<User> {
  const now = new Date();
  const user: User = { discordId: profile.id, username: profile.username, avatar: profile.avatar, createdAt: now, updatedAt: now, aiCredits: 0, freeQuestionsUsed: 0, cloudEnabled: false };
  const c = await collections();
  if (c) {
    await c.users.updateOne({ discordId: profile.id }, { $set: { username: profile.username, avatar: profile.avatar, updatedAt: now }, $setOnInsert: { createdAt: now, aiCredits: 0, freeQuestionsUsed: 0, cloudEnabled: false } }, { upsert: true });
    await c.tokens.updateOne({ _id: profile.id }, { $set: { userId: profile.id, accessToken: encryptSecret(oauth.accessToken), refreshToken: oauth.refreshToken ? encryptSecret(oauth.refreshToken) : undefined, expiresAt: oauth.expiresIn ? new Date(Date.now() + oauth.expiresIn * 1000) : undefined, updatedAt: now } }, { upsert: true });
    return (await c.users.findOne({ discordId: profile.id }))!;
  }
  const existing = memoryStore().users.get(profile.id);
  const merged = existing ? { ...existing, username: profile.username, avatar: profile.avatar, updatedAt: now } : user;
  memoryStore().users.set(profile.id, merged);
  memoryStore().tokens.set(profile.id, { userId: profile.id, accessToken: encryptSecret(oauth.accessToken), refreshToken: oauth.refreshToken ? encryptSecret(oauth.refreshToken) : undefined, expiresAt: oauth.expiresIn ? new Date(Date.now() + oauth.expiresIn * 1000) : undefined });
  return merged;
}

export async function getOAuthToken(userId: string): Promise<{ accessToken: string; refreshToken?: string } | undefined> {
  const c = await collections();
  const token = c ? await c.tokens.findOne({ _id: userId }) : memoryStore().tokens.get(userId);
  if (!token || typeof token.accessToken !== 'string') return undefined;
  const { decryptSecret } = await import('./crypto.js');
  return { accessToken: decryptSecret(token.accessToken), refreshToken: token.refreshToken ? decryptSecret(token.refreshToken) : undefined };
}

export const sessionCookieName = COOKIE;
