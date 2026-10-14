import { startUiFixture } from './lib/ui-fixture.mjs';
// Live metadata previews only. The final import POST is intercepted; no song data is written.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'devalue';

const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
const fixture = await startUiFixture();
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await fixture.login(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let imported;
  await page.route(
    (url) => url.pathname === '/admin' && url.search.includes('importPlaylist'),
    async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      if (!route.request().url().includes('importPlaylist')) return route.continue();
      imported = await new Response(route.request().postDataBuffer(), {
        headers: { 'content-type': route.request().headers()['content-type'] }
      }).formData();
      await route.fulfill({
        json: { type: 'success', status: 200, data: stringify({ kind: 'success', adminMessage: 'mock import' }) }
      });
    }
  );
  await page.goto('http://127.0.0.1:5198/admin', { waitUntil: 'networkidle' });
  for (const [provider, label, kind, url, count, title] of [
    ['netease', '网易云', 'song', 'https://music.163.com/#/song?id=186016', 1, '晴天'],
    ['kugou', '酷狗', 'song', 'https://m.kugou.com/share/song.html?chain=AajH2eG6V2', 1, '月光河畔'],
    ['kugou', '酷狗', 'playlist', 'https://t1.kugou.com/2CXQN07G6V2', 127, 'Singing For You'],
    ['qqmusic', 'QQ音乐', 'song', 'https://c6.y.qq.com/base/fcgi-bin/u?__=f46TFfM', 1, '悬溺'],
    ['qqmusic', 'QQ音乐', 'playlist', 'https://c6.y.qq.com/base/fcgi-bin/u?__=Uax9covl9eq7', 2, '传奇']
  ]) {
    await page.getByRole('tab', { name: '歌曲软件导入', exact: true }).click();
    await page.locator('[name="musicInput"]').fill(url);
    const response = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes('previewMusic')
    );
    await page.getByRole('button', { name: '解析链接', exact: true }).click();
    const result = await response;
    assert.equal(result.status(), 200, await result.text());
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(await dialog.locator('[name="provider"]').inputValue(), provider);
    assert.equal(await dialog.locator('tbody tr').count(), count);
    assert.ok((await dialog.innerText()).includes(title));
    await page.screenshot({ path: join(tmpdir(), `songlist-${provider}-${kind}.png`) });
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('[name="musicInput"]').inputValue(), url);
    assert.equal(await page.locator('[name="playlistInput"]').count(), 0);
    console.log('PASS live preview', provider, kind, count);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: '歌曲软件导入', exact: true }).scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(tmpdir(), 'songlist-music-import-mobile.png') });
  await page.locator('[name="musicInput"]').fill('https://c6.y.qq.com/base/fcgi-bin/u?__=Uax9covl9eq7');
  const previewResponse = page.waitForResponse(
    (res) => res.request().method() === 'POST' && res.url().includes('previewMusic')
  );
  await page.getByRole('button', { name: '解析链接', exact: true }).click();
  await previewResponse;
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await dialog.locator('[name="selectedSong"]').last().uncheck();
  await dialog.locator('[name="sharedTagsInput"]').fill('测试标签');
  const importResponse = page.waitForResponse(
    (res) => res.request().method() === 'POST' && res.url().includes('importPlaylist')
  );
  await dialog.getByRole('button', { name: '导入勾选歌曲', exact: true }).click();
  await importResponse;
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(imported.get('provider'), 'qqmusic');
  assert.deepEqual(imported.getAll('selectedSong'), ['0']);
  assert.equal(imported.get('sharedTagsInput'), '测试标签');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS mobile layout and shared import submission; all database writes intercepted.');
} finally {
  await browser.close();
  await fixture.close();
}
