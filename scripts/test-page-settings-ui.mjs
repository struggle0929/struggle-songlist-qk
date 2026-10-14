import { startUiFixture } from './lib/ui-fixture.mjs';
// All writes are intercepted; never modifies real settings.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'devalue';
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const fixture = await startUiFixture();
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await fixture.login(context);
  const page = await context.newPage();
  const errors = [];
  const posts = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const form = await new Response(route.request().postDataBuffer(), {
      headers: { 'content-type': route.request().headers()['content-type'] }
    }).formData();
    posts.push({ url: route.request().url(), form });
    await route.fulfill({
      json: { type: 'success', status: 200, data: stringify({ kind: 'success', adminMessage: 'mock saved' }) }
    });
  });
  await page.goto('http://127.0.0.1:5198/admin', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '页面配置', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  const slider = dialog.locator('[name="backgroundBlur"]');
  assert.equal(await slider.inputValue(), '16');
  await slider.fill('30');
  assert.equal(
    await dialog.locator('img[alt="背景预览"]').evaluate((el) => getComputedStyle(el).filter),
    'blur(30px) saturate(1.1)'
  );
  await dialog.locator('[name="background"]').setInputFiles({
    name: 'preview.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=',
      'base64'
    )
  });
  assert.ok((await dialog.locator('img[alt="背景预览"]').getAttribute('src')).startsWith('blob:'));
  await dialog.locator('[name="headerTitle"]').fill('标题测试');
  const saved = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('saveHeader'));
  await dialog.getByRole('button', { name: '确认小标题', exact: true }).click();
  await saved;
  assert.equal(posts[0].form.get('headerField'), 'headerTitle');
  assert.equal(posts[0].form.get('headerTitle'), '标题测试');
  await dialog.getByRole('button', { name: '确认小标题', exact: true }).waitFor({ state: 'visible' });
  await dialog.locator('[name="headerSubtitle"]').fill('副标题测试');
  const saved2 = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('saveHeader'));
  await dialog.getByRole('button', { name: '确认副标题', exact: true }).click();
  await saved2;
  assert.equal(posts[1].form.get('headerField'), 'headerSubtitle');
  await page.waitForLoadState('networkidle');
  await slider.fill('0');
  await page.screenshot({ path: join(tmpdir(), 'songlist-page-settings-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await slider.scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(tmpdir(), 'songlist-page-settings-mobile.png') });
  const profile = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('saveProfile'));
  await dialog.getByRole('button', { name: '保存配置', exact: true }).click();
  await profile;
  assert.equal(posts[2].form.get('backgroundBlur'), '0');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(
    'PASS header confirmations, blur slider, selected-image preview and responsive layout; all writes mocked.'
  );
} finally {
  await browser.close();
  await fixture.close();
}
