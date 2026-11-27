import crypto from 'node:crypto';

const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

export type SessionRole = 'admin' | 'viewer';

export interface SessionPayload {
  role: SessionRole;
  username?: string;
  iat: number;
  exp: number;
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length || a.length % 2 !== 0) return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function timingSafeEqualStrings(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Hashes password with scrypt and a 16-byte random salt.
 * Output format: scrypt$<32-hex-salt>$<128-hex-key>
 */
export function hashPasswordScrypt(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * Verifies a password/passcode against scrypt, pbkdf2, or legacy 64-hex SHA-256 hash.
 */
export function verifyPasswordHash(password: string, storedHash: string): boolean {
  if (!password || !storedHash) return false;

  if (storedHash.startsWith('scrypt$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 3) return false;
    const salt = Buffer.from(parts[1], 'hex');
    const expectedHex = parts[2].toLowerCase();
    if (salt.length !== 16 || expectedHex.length !== 128) return false;
    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    return timingSafeEqualHex(derived, expectedHex);
  }

  if (storedHash.startsWith('pbkdf2$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 3) return false;
    const salt = Buffer.from(parts[1], 'hex');
    const expectedHex = parts[2].toLowerCase();
    if (salt.length !== 16 || expectedHex.length !== 64) return false;
    const derived = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
    return timingSafeEqualHex(derived, expectedHex);
  }

  if (/^[a-f0-9]{64}$/i.test(storedHash)) {
    const inputHex = crypto.createHash('sha256').update(password).digest('hex');
    return timingSafeEqualHex(inputHex.toLowerCase(), storedHash.toLowerCase());
  }

  return false;
}

export function issueSessionToken(role: SessionRole, username?: string): string {
  const now = Date.now();
  const payload: SessionPayload = {
    role,
    username,
    iat: now,
    exp: now + TOKEN_TTL_MS
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(authHeader: string | undefined): SessionPayload | null {
  if (!authHeader || typeof authHeader !== 'string') return null;
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;

  const encodedPayload = token.slice(0, dotIdx);
  const providedSig = token.slice(dotIdx + 1);
  if (!encodedPayload || !providedSig) return null;

  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encodedPayload)
    .digest('base64url');

  const sigA = Buffer.from(providedSig, 'utf8');
  const sigB = Buffer.from(expectedSig, 'utf8');
  if (sigA.length !== sigB.length || !crypto.timingSafeEqual(sigA, sigB)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed || (parsed.role !== 'admin' && parsed.role !== 'viewer')) return null;
    if (typeof parsed.exp !== 'number' || parsed.exp <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

interface RateBucket {
  failures: number;
  lockedUntil: number;
}

const rateBuckets = new Map<string, RateBucket>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30000;

export function checkAuthRateLimit(key: string): { allowed: boolean; remainingSeconds: number } {
  const bucket = rateBuckets.get(key);
  if (!bucket) return { allowed: true, remainingSeconds: 0 };
  const now = Date.now();
  if (bucket.lockedUntil > now) {
    return {
      allowed: false,
      remainingSeconds: Math.ceil((bucket.lockedUntil - now) / 1000)
    };
  }
  if (bucket.lockedUntil !== 0 && bucket.lockedUntil <= now) {
    rateBuckets.delete(key);
  }
  return { allowed: true, remainingSeconds: 0 };
}

export function recordAuthFailure(key: string): { locked: boolean; remainingSeconds: number } {
  const bucket = rateBuckets.get(key) || { failures: 0, lockedUntil: 0 };
  bucket.failures += 1;
  if (bucket.failures >= MAX_ATTEMPTS) {
    bucket.lockedUntil = Date.now() + LOCKOUT_MS;
    rateBuckets.set(key, bucket);
    return { locked: true, remainingSeconds: Math.ceil(LOCKOUT_MS / 1000) };
  }
  rateBuckets.set(key, bucket);
  return { locked: false, remainingSeconds: 0 };
}

export function clearAuthRateLimit(key: string): void {
  rateBuckets.delete(key);
}
