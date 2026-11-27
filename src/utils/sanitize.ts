/**
 * Sanitizes text input by stripping ASCII control chars, trimming, and enforcing maxLength.
 */
export function sanitizeText(value: unknown, maxLength = 300): string {
  if (typeof value !== 'string') return '';
  // Strip control characters except normal spaces
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

/**
 * Neutralizes spreadsheet formula injection (=, +, -, @, tab, CR) when exporting to Excel.
 */
export function sanitizeSpreadsheetCell(value: unknown): string {
  const str = sanitizeText(String(value ?? ''), 500);
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

/**
 * Validates strict YYYY-MM-DD calendar date string.
 */
export function isValidYYYYMMDD(dateStr: string): boolean {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Validates finite integer within [min, max].
 */
export function isValidPositiveInt(
  value: unknown,
  min: number,
  max: number
): boolean {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

/**
 * Simple in-memory rate limiter to slow down brute-force auth attempts.
 */
export function createLoginRateLimiter(maxAttempts = 5, lockoutMs = 30000) {
  let failures = 0;
  let lockedUntil = 0;

  return {
    check(): { allowed: boolean; remainingSeconds: number } {
      const now = Date.now();
      if (lockedUntil > now) {
        return {
          allowed: false,
          remainingSeconds: Math.ceil((lockedUntil - now) / 1000)
        };
      }
      if (lockedUntil !== 0 && lockedUntil <= now) {
        failures = 0;
        lockedUntil = 0;
      }
      return { allowed: true, remainingSeconds: 0 };
    },
    recordFailure(): { locked: boolean; remainingSeconds: number } {
      failures += 1;
      if (failures >= maxAttempts) {
        lockedUntil = Date.now() + lockoutMs;
        return { locked: true, remainingSeconds: Math.ceil(lockoutMs / 1000) };
      }
      return { locked: false, remainingSeconds: 0 };
    },
    reset(): void {
      failures = 0;
      lockedUntil = 0;
    }
  };
}
