import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  cacheDir: resolve('node_modules/.vite-tests/security'),
  server: { middlewareMode: true }
});
try {
  const { createReadLimiter, securityHeaders } = await server.ssrLoadModule(resolve('src/lib/server/security.ts'));
  const limit = createReadLimiter(2, 1000, 2);
  assert.equal(limit('a', 0), true);
  assert.equal(limit('a', 1), true);
  assert.equal(limit('a', 2), false);
  assert.equal(limit('b', 2), true);
  assert.equal(limit('c', 3), false);
  assert.equal(limit('a', 4), false); // Flooded keys cannot evict active counters.
  assert.equal(limit('c', 1004), true);
  assert.equal(limit('a', 1005), true);
  const headers = new Headers();
  securityHeaders(headers);
  assert.equal(headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
  console.log('PASS read limiter boundaries, expiry, client isolation, bounded memory and security headers');
} finally {
  await server.close();
}
