import { createHash } from 'node:crypto';

// Cheap first-line protection before database reads. Per-instance only: edge
// firewall rules remain necessary for distributed attacks. Memory is bounded.
export function createReadLimiter(maxRequests = 240, windowMs = 60_000, maxEntries = 10_000) {
  const clients = new Map<string, { count: number; expires: number }>();
  let nextSweep = 0;
  return (address: string, now = Date.now()) => {
    const key = createHash('sha256').update(address).digest('hex');
    const previous = clients.get(key);
    if (previous && previous.expires > now) {
      if (previous.count >= maxRequests) return false;
      previous.count++;
      return true;
    }
    clients.delete(key);
    if (clients.size >= maxEntries) {
      // Amortize cleanup so address floods cannot force a full scan each time.
      if (now >= nextSweep) {
        for (const [id, value] of clients) if (value.expires <= now) clients.delete(id);
        nextSweep = now + 1000;
      }
      // Do not evict active counters: random addresses must not reset limits.
      if (clients.size >= maxEntries) return false;
    }
    clients.set(key, { count: 1, expires: now + windowMs });
    return true;
  };
}

export const consumePublicRead = createReadLimiter();

export function securityHeaders(headers: Headers) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}
