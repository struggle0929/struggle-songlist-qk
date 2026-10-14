import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer } from 'vite';
const app = await createServer({
  configFile: false,
  cacheDir: resolve('node_modules/.vite-tests/analytics'),
  server: { middlewareMode: true },
  resolve: { alias: { $lib: resolve('src/lib') } }
});
try {
  const { publicPageView } = await app.ssrLoadModule('/src/lib/analytics.ts');
  const event = { type: 'pageview', url: 'https://www.single.example.test/?token=private#requests' };
  assert.deepEqual(publicPageView(event), { type: 'pageview', url: 'https://www.single.example.test/' });
  assert.ok(event.url.includes('token=private'));
  for (const path of ['/admin', '/admin/login', '/admin/__data.json'])
    assert.equal(publicPageView({ type: 'pageview', url: 'https://www.single.example.test' + path }), null);
  assert.equal(publicPageView({ type: 'event', url: 'https://www.single.example.test/' }), null);
  assert.equal(publicPageView({ type: 'pageview', url: 'invalid' }), null);
  console.log('PASS public pageviews preserve hostname, remove URL parameters, exclude admin and custom events.');
} finally {
  await app.close();
}
