import { startLocalBackend, localKey, localSecret } from './local-backend.mjs';
import { mkdir } from 'node:fs/promises';

export async function startUiFixture(port = 5198) {
  process.env.SONGLIST_ENV_DIR = 'node_modules/.songlist-test-env';
  await mkdir(process.env.SONGLIST_ENV_DIR, { recursive: true });
  const backend = await startLocalBackend();
  Object.assign(process.env, {
    LOCAL_DEMO: 'false',
    PUBLIC_SITE_TITLE: '主播歌单',
    PUBLIC_SITE_ICON: '/favicon.svg',
    PUBLIC_CUSTOM_CURSORS: 'false',
    PUBLIC_SUPABASE_URL: backend.url,
    PUBLIC_SUPABASE_PUBLISHABLE_KEY: localKey,
    SUPABASE_SECRET_KEY: localSecret,
    AUTH_SECRET: 'local-ui-only-session-secret'
  });
  const vite = await import('vite');
  const production = process.env.SECURITY_PRODUCTION_TEST === 'true';
  let app;
  if (production) {
    await vite.build();
    app = await vite.preview({ preview: { host: '127.0.0.1', port, strictPort: true } });
  } else {
    app = await vite.createServer({
      cacheDir: 'node_modules/.vite-tests/ui-fixture',
      server: { host: '127.0.0.1', port, strictPort: true }
    });
    await app.listen();
  }
  const base = `http://127.0.0.1:${port}`;
  return {
    ...backend,
    base,
    login: async (context) => {
      const result = await context.request.post(base + '/admin/login', {
        form: { email: 'admin@local.test', password: backend.password },
        headers: { Origin: base }
      });
      if (result.status() !== 200) throw Error('Local test login failed: ' + result.status());
    },
    close: async () => {
      if (production) await new Promise((resolve) => app.httpServer.close(resolve));
      else await app.close();
      await backend.close();
    }
  };
}
