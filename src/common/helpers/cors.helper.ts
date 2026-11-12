/**
 * Shared origin check for the HTTP API and the Socket.IO gateway.
 *
 * Allowed: explicit origins from CORS_ORIGINS, any `*.vercel.app` deployment
 * and localhost / 127.0.0.1 on any port. Hostnames are parsed rather than
 * substring-matched, so look-alikes such as `https://evilvercel.app` or
 * `https://localhost.evil.com` are rejected.
 */
export function parseCorsOrigins(raw?: string): string[] {
  return (raw || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export function isOriginAllowed(
  origin: string,
  explicitOrigins: string[],
): boolean {
  if (explicitOrigins.includes(origin.replace(/\/$/, ''))) return true;

  let hostname: string;
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }

  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.vercel.app')
  );
}
