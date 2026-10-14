import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
import { startUiFixture } from './lib/ui-fixture.mjs';
const backend = await startUiFixture(5197);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const dir = `${process.env.TEMP}/songlist-qk-settings-qa`;
await mkdir(dir, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5197/admin/login');
  await page.locator('[name=email]').fill('admin@local.test');
  await page.locator('[name=password]').fill(backend.password);
  await page.getByRole('button', { name: '登录后台' }).click();
  await page.waitForURL('**/admin');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '页面配置', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.waitFor();
  assert.equal(await modal.locator('form').count(), 1);
  assert.equal(await modal.getByRole('button', { name: '保存设置', exact: true }).count(), 1);
  assert.equal(await modal.locator('details.settings-section[open]').count(), 0);
  assert.equal(await modal.getByText('确认小标题', { exact: true }).count(), 0);
  await page.waitForTimeout(250); // Let the dialog's entrance animation finish before visual inspection.
  await page.screenshot({ path: `${dir}/compact-desktop.png` });
  console.log('PASS compact settings contain one form and three default-collapsed sections');

  await modal.getByText('页面文字与图标', { exact: true }).click();
  await modal.locator('[name=headerTitle]').fill('测试标题');
  await modal.locator('[name=headerSubtitle]').fill('测试副标题');
  await modal.getByText('点歌复制格式', { exact: true }).click();
  await modal.locator('[name=requestPrefix]').fill(' 我要听  ');
  await modal.getByText('复制示例：我要听 Butter-Fly', { exact: true }).waitFor();
  await modal.locator('[name=heroTitle]').fill('新的主播名');
  await modal.locator('[name=avatar]').setInputFiles({
    name: 'preview.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=',
      'base64'
    )
  });
  assert.ok((await modal.locator('img[alt="头像预览"]').getAttribute('src')).startsWith('blob:'));
  await modal.locator('[name=backgroundBlur]').fill('0');
  assert.ok((await modal.locator('img[alt="头像预览"]').getAttribute('src')).startsWith('blob:'));
  const saved = page.waitForResponse((r) => r.url().includes('?/savePageSettings'));
  await modal.getByRole('button', { name: '保存设置', exact: true }).click();
  assert.equal((await saved).status(), 200);
  await page.waitForLoadState('networkidle');
  const rows = await backend.db.query('select key,value from settings');
  const settings = Object.fromEntries(rows.rows.map((r) => [r.key, r.value]));
  assert.equal(settings.hero_title, '新的主播名');
  const appearance = JSON.parse(settings.appearance);
  assert.equal(appearance.requestPrefix, '我要听');
  assert.equal(appearance.headerTitle, '测试标题');
  assert.equal(appearance.headerSubtitle, '测试副标题');
  assert.equal(appearance.backgroundBlur, 0);
  console.log('PASS unified settings persist in PostgreSQL');

  const publicPage = await browser.newPage();
  await publicPage.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text) => {
          window.__copied = text;
        }
      },
      configurable: true
    });
  });
  await publicPage.goto('http://127.0.0.1:5197/');
  await publicPage.waitForLoadState('networkidle');
  const firstRow = publicPage.locator('.song-row').first();
  const title = await firstRow.locator('h3').first().innerText();
  await firstRow.click();
  await publicPage.waitForFunction(() => window.__copied);
  assert.equal(await publicPage.evaluate(() => window.__copied), `我要听 ${title}`);
  await publicPage.getByRole('button', { name: '随机歌曲', exact: true }).click();
  await publicPage.waitForTimeout(100);
  assert.ok((await publicPage.evaluate(() => window.__copied)).startsWith('我要听 '));
  console.log('PASS public song clicks and random selections copy the custom prefix');

  await modal.getByText('鼠标指针', { exact: true }).click();
  await modal.locator('[name=cursorMode]').selectOption('animated');
  await modal.getByText('点歌复制格式', { exact: true }).click();
  await modal.locator('[name=requestPrefix]').fill('待保存前缀');
  const rejected = page.waitForResponse((r) => r.url().includes('?/savePageSettings'));
  await modal.getByRole('button', { name: '保存设置', exact: true }).click();
  const rejection = await (await rejected).json();
  assert.equal(rejection.type, 'failure');
  assert.equal(rejection.status, 400);
  await modal.getByRole('alert').waitFor();
  assert.equal(await modal.locator('[name=requestPrefix]').inputValue(), '待保存前缀');
  const unchanged = await backend.db.query("select value from settings where key='appearance'");
  assert.equal(JSON.parse(unchanged.rows[0].value).requestPrefix, '我要听');
  console.log('PASS failed validation preserves unsaved input and does not change the saved settings');

  await modal.locator('[name=cursorMode]').selectOption('inherit');
  await modal.getByRole('button', { name: '恢复默认', exact: true }).click();
  assert.equal(await modal.locator('[name=requestPrefix]').inputValue(), '点歌');
  const reset = page.waitForResponse((r) => r.url().includes('?/savePageSettings'));
  await modal.getByRole('button', { name: '保存设置', exact: true }).click();
  assert.equal((await reset).status(), 200);
  await page.waitForLoadState('networkidle');
  const defaults = await backend.db.query("select value from settings where key='appearance'");
  assert.equal(JSON.parse(defaults.rows[0].value).requestPrefix, '点歌');
  assert.equal(JSON.parse(defaults.rows[0].value).headerTitle, '测试标题');
  console.log('PASS restore-default resets only the copy prefix and retains other saved settings');

  for (const [name, width, height] of [
    ['mobile', 390, 844],
    ['short-desktop', 1280, 600]
  ]) {
    await page.setViewportSize({ width, height });
    await modal.locator('details.settings-section').evaluateAll((elements) => elements.forEach((e) => (e.open = true)));
    const button = modal.getByRole('button', { name: '保存设置', exact: true });
    const rect = await button.boundingBox();
    assert.ok(rect.y >= 0 && rect.y + rect.height <= height, name);
    const before = await button.boundingBox();
    await modal.locator('.page-settings-body').evaluate((e) => (e.scrollTop = e.scrollHeight));
    const after = await button.boundingBox();
    assert.equal(Math.round(before.y), Math.round(after.y));
    await page.screenshot({ path: `${dir}/${name}.png` });
  }
  assert.deepEqual(errors, []);
  console.log('PASS save footer stays visible on mobile and short desktop while only the settings body scrolls');
  console.log('6 settings UI tests passed. No production data used.');
} finally {
  await browser.close();
  await backend.close();
}
