import { createHmac, timingSafeEqual } from 'node:crypto';

export const ACCESS_SESSION_COOKIE = 'lawsense_access_session';
export const ACCESS_SESSION_TTL_SECONDS = 8 * 60 * 60;
export const MIN_ACCESS_PASSPHRASE_LENGTH = 16;

export type AccessMode = 'local-only' | 'misconfigured' | 'passphrase';

export function getAccessMode(): AccessMode {
  const value = process.env.LAWSENSE_ACCESS_PIN;
  if (!value) return 'local-only';
  return value.length >= MIN_ACCESS_PASSPHRASE_LENGTH ? 'passphrase' : 'misconfigured';
}

export function getConfiguredAccessPassphrase(): string | null {
  return getAccessMode() === 'passphrase' ? process.env.LAWSENSE_ACCESS_PIN ?? null : null;
}

export function constantTimeTextEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function signatureFor(expiresAt: string, passphrase: string): string {
  return createHmac('sha256', passphrase)
    .update(`lawsense-access-v1:${expiresAt}`, 'utf8')
    .digest('base64url');
}

export function createAccessSessionToken(passphrase: string, nowMs = Date.now()): string {
  const expiresAt = String(Math.floor(nowMs / 1000) + ACCESS_SESSION_TTL_SECONDS);
  return `${expiresAt}.${signatureFor(expiresAt, passphrase)}`;
}

export function verifyAccessSessionToken(
  token: string | undefined,
  passphrase: string,
  nowMs = Date.now(),
): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2 || !/^\d{10,12}$/.test(parts[0])) return false;

  const expiresAt = Number(parts[0]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(nowMs / 1000)) return false;

  const expected = signatureFor(parts[0], passphrase);
  return constantTimeTextEqual(parts[1], expected);
}

export function safeReturnPath(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  if (value.startsWith('/unlock') || value.startsWith('/api/access/') || value.startsWith('/access-control/')) return '/';
  return value;
}
