import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createHmac } from 'node:crypto';
import { startUiFixture } from './lib/ui-fixture.mjs';
const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
const fixture = await startUiFixture();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  if (process.env.SECURITY_PRODUCTION_TEST === 'true') {
    await page.route('**/_vercel/insights/script.js', (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `
      window.__analyticsViews = [];
      let filter;
      window.va = (kind, data) => {
        if (kind === 'beforeSend') filter = data;
        if (kind === 'pageview') {
          const event = {type:'pageview',url:new URL(data.path, location.origin).href};
          const result = filter ? filter(event) : event;
          if(result) window.__analyticsViews.push(result);
        }
      };
      for(const args of window.vaq || []) window.va(...args);
    `
      })
    );
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(fixture.base + '/admin');
  assert.ok(page.url().includes('/admin/login'));
  const oldPayload = `admin:${Date.now()}`;
  await context.addCookies([
    {
      name: 'songlist_admin_session',
      value: oldPayload + '.' + createHmac('sha256', process.env.AUTH_SECRET).update(oldPayload).digest('hex'),
      url: fixture.base
    }
  ]);
  await page.goto(fixture.base + '/admin');
  assert.ok(page.url().includes('/admin/login'));
  await page.waitForLoadState('networkidle');
  await page.locator('[name=email]').fill('admin@local.test');
  await page.locator('[name=password]').fill(fixture.password);
  await page.waitForLoadState('networkidle');
  const loginResponse = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/admin/login')
  );
  await page.getByRole('button', { name: '登录后台' }).click();
  const loggedIn = await loginResponse;
  assert.ok(loggedIn.status() < 400, await loggedIn.text());
  const loginResult = await loggedIn.json();
  assert.equal(loginResult.type, 'redirect', JSON.stringify(loginResult));
  await page.waitForURL('**/admin');
  await page.waitForLoadState('networkidle');
  const response = await context.request.get(fixture.base + '/');
  const html = await response.text();
  assert.ok(html.includes('本地测试歌曲'));
  assert.ok(!html.includes('本地隐藏歌曲'));
  assert.ok(html.includes('<title>主播歌单</title>'));
  assert.ok(!html.includes('/favicon.jpg'));
  assert.equal(await page.locator('header a').first().innerText(), '主播歌单\n主播歌单与愿望单管理');
  assert.equal(response.headers()['x-frame-options'], 'DENY');
  assert.equal(response.headers()['x-content-type-options'], 'nosniff');
  assert.ok(response.headers()['cache-control'].includes('no-store'));
  if (process.env.SECURITY_PRODUCTION_TEST === 'true') {
    const csp = response.headers()['content-security-policy'];
    assert.ok(csp && !csp.includes("'unsafe-inline'"));
    const nonce = html.match(/<script nonce="([^"]+)"/)[1];
    assert.ok(csp.includes('nonce-' + nonce));
  }
  console.log('PASS real login, old cookie rejected, private song isolation and security headers');
  const signedCookies = await context.cookies();
  const session = signedCookies.find((c) => c.name === 'songlist_admin_session_v2');
  const value = JSON.parse(Buffer.from(session.value.split('.')[0], 'base64url'));
  value.expiresAt = 0;
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  await context.addCookies([
    {
      ...session,
      value: payload + '.' + createHmac('sha256', process.env.AUTH_SECRET).update(payload).digest('base64url')
    }
  ]);
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(new URL(page.url()).pathname, '/admin');
  console.log('PASS expired access token refreshes with verified account identity');
  await page.getByRole('button', { name: '页面配置', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('页面文字与图标', { exact: true }).click();
  await dialog.locator('[name=siteTitle]').fill('主播测试标题');
  await dialog.locator('[name=siteDescription]').fill('测试网页描述');
  await dialog.locator('[name=tagline]').fill('测试首页说明');
  const saved = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('savePageSettings'));
  await dialog.getByRole('button', { name: '保存设置', exact: true }).click();
  assert.equal((await saved).status(), 200);
  await page.waitForFunction(() => document.title.includes('主播测试标题'));
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.goto(fixture.base + '/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.title === '主播测试标题');
  if (process.env.SECURITY_PRODUCTION_TEST === 'true') {
    assert.equal(await page.locator('script[src="/_vercel/insights/script.js"]').count(), 1);
    assert.deepEqual(await page.evaluate(() => window.__analyticsViews), [
      { type: 'pageview', url: fixture.base + '/' }
    ]);
    console.log(
      'PASS analytics SDK loads under production CSP and emits a filtered public pageview; collector mocked.'
    );
  }
  assert.equal(await page.title(), '主播测试标题');
  assert.equal(await page.locator('meta[name=description]').getAttribute('content'), '测试网页描述');
  assert.ok(await page.getByText('测试首页说明', { exact: true }).isVisible());
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: process.env.TEMP + '/songlist-private-mobile.png' });
  await page.goto(fixture.base + '/admin');
  await page.waitForLoadState('networkidle');
  if (process.env.SECURITY_PRODUCTION_TEST === 'true')
    assert.deepEqual(await page.evaluate(() => window.__analyticsViews), []);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: process.env.TEMP + '/songlist-private-desktop.png' });
  console.log('PASS saved site text reaches public and admin pages, personal assets preserved, mobile layout');
  const invalid = await context.request.post(fixture.base + '/admin?/identifyLanguages', {
    form: { provider: 'qqmusic', ids: '["https://evil.example"]' },
    headers: {
      Origin: fixture.base,
      'x-sveltekit-action': 'true',
      Cookie: (await context.cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
    }
  });
  assert.equal((await invalid.json()).status, 400);
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.waitForURL('**/admin/login');
  assert.equal(
    (await context.cookies()).some((c) => c.name === 'songlist_admin_session_v2'),
    false
  );
  await fixture.db.exec('delete from request_rate_limits');
  for (let i = 0; i < 11; i++) {
    const result = await context.request.post(fixture.base + '/admin/login', {
      form: { email: 'admin@local.test', password: 'bad-password' },
      headers: { Origin: fixture.base, Accept: 'text/html' }
    });
    assert.equal(result.status(), i === 10 ? 429 : 400);
    if (i === 10) assert.equal(result.headers()['retry-after'], '600');
  }
  const counters = (await fixture.db.query('select client_key from request_rate_limits')).rows;
  assert.ok(counters.every((row) => !row.client_key.includes('@') && !row.client_key.includes('127.0.0.1')));
  assert.deepEqual(errors, []);
  console.log(
    'PASS bad lyric IDs rejected, logout clears sessions and atomic login limits return 429 with hashed keys'
  );
} finally {
  await browser.close();
  await fixture.close();
}
