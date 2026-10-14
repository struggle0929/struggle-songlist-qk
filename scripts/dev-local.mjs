import { startLocalBackend, localKey, localSecret } from './lib/local-backend.mjs';
import { mkdir } from 'node:fs/promises';
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
  AUTH_SECRET: 'local-only-session-secret-do-not-use-in-production'
});
const { createServer } = await import('vite');
const app = await createServer({
  cacheDir: 'node_modules/.vite-local',
  server: { host: '127.0.0.1', port: 5183, strictPort: true }
});
await app.listen();
console.log('本地隔离测试： http://127.0.0.1:5183/ · 后台 /admin');
console.log('账号 admin@local.test，密码 Local-only-0929!。数据仅保存在内存，退出后清空。');
console.log('不连接正式 Supabase；音乐解析仍会请求官方音乐接口。不用于生产部署。');
async function close() {
  await app.close();
  await backend.close();
  process.exit();
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
