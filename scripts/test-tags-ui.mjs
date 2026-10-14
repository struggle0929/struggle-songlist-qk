import { startUiFixture } from './lib/ui-fixture.mjs';
// Read-only local browser check. All POST requests are mocked to prevent database writes.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'devalue';

const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
const fixture = await startUiFixture();
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await fixture.login(context);
  const page = await context.newPage();
  const errors = [];
  page.on('response', (response) => {
    if (response.status() >= 400) console.error('HTTP error:', response.status(), response.url());
  });
  page.on('requestfailed', (request) => console.error('Request failed:', request.url(), request.failure()?.errorText));
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('pageerror', (error) => console.error('Browser error:', error.stack));
  let submissions = 0;
  const savedTags = [];
  await page.route('**/*', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    submissions++;
    console.log('Mock POST', new URL(route.request().url()).search);
    const isPreview = route.request().url().includes('previewMusic');
    if (route.request().url().includes('saveSong')) {
      savedTags.push(new URLSearchParams(route.request().postData()).get('tagsInput'));
    }
    const data = isPreview
      ? {
          kind: 'preview-ready',
          adminMessage: 'mock preview',
          importPreview: {
            sourceInput: '123',
            status: 'ready',
            songs: [{ title: 'Test', artist: 'Singer', language: '中文', tagsInput: '' }]
          }
        }
      : { kind: 'success', adminMessage: 'mock saved' };
    await route.fulfill({ json: { type: 'success', status: 200, data: stringify(data) } });
  });
  await page.goto('http://127.0.0.1:5198/admin', { waitUntil: 'networkidle' });
  assert.equal(errors.length, 0, errors.join('\n'));
  const detail = page.locator('details').first();
  await detail.locator('summary').click();
  const edit = detail.locator('form[action="?/saveSong"]');
  const originalTitle = await edit.locator('[name="title"]').inputValue();
  const originalArtist = await edit.locator('[name="artist"]').inputValue();
  const originalPublic = await edit.locator('[name="isPublic"]').isChecked();
  const editChoice = edit.locator('[aria-label="已有标签"] input:not(:checked)').first();
  const addedTag = (await editChoice.locator('..').innerText()).trim();
  await editChoice.check();
  assert.ok((await edit.locator('[name="tagsInput"]').inputValue()).includes(addedTag));
  await detail.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('button[form^="save-song-"]').disabled === false);
  assert.ok(savedTags[0]?.includes(addedTag), 'edited tags must be included in the save request');
  assert.equal(await edit.locator('[name="title"]').inputValue(), originalTitle);
  assert.equal(await edit.locator('[name="artist"]').inputValue(), originalArtist);
  assert.equal(await edit.locator('[name="isPublic"]').isChecked(), originalPublic);
  await detail.locator('summary').click();
  await detail.locator('summary').click();
  assert.equal(await edit.locator('[name="title"]').inputValue(), originalTitle);
  assert.equal(await edit.locator('[name="artist"]').inputValue(), originalArtist);
  await page.getByRole('button', { name: '排序方式', exact: true }).click();
  await page.getByRole('option', { name: '导入次序排序', exact: true }).click();
  await page.getByRole('button', { name: '当前升序，切换为降序', exact: true }).click();
  assert.ok(await page.getByRole('button', { name: '当前降序，切换为升序', exact: true }).isVisible());
  await page.getByRole('button', { name: '排序方式', exact: true }).click();
  await page.getByRole('option', { name: '歌曲名排序', exact: true }).click();
  await page.getByRole('button', { name: '当前降序，切换为升序', exact: true }).click();
  await page.getByRole('button', { name: '排序方式', exact: true }).click();
  await page.getByRole('option', { name: '默认排序', exact: true }).click();
  await page.getByRole('tab', { name: /^愿望单/ }).click();
  assert.equal(await page.getByRole('tab', { name: /^愿望单/ }).getAttribute('aria-selected'), 'true');
  await page.getByRole('tab', { name: /^歌曲/ }).click();
  await page.getByRole('button', { name: '页面配置', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const manual = page.locator('form[action="?/saveSong"]').first();
  const choices = manual.locator('[aria-label="已有标签"] input');
  assert.ok((await choices.count()) > 0);
  await choices.first().check();
  assert.ok((await manual.locator('[name="tagsInput"]').inputValue()).length > 0);
  await choices.first().uncheck();
  assert.equal(await manual.locator('[name="tagsInput"]').inputValue(), '');
  await choices.first().check();
  await manual.locator('[name="title"]').fill('Test');
  await manual.locator('[name="artist"]').fill('Singer');
  await manual.getByRole('button', { name: '保存歌曲' }).click();
  await page.waitForFunction(
    () => document.querySelector('form[action="?/saveSong"] input[name="title"]').value === ''
  );
  assert.equal(await manual.locator('[name="tagsInput"]').inputValue(), '');
  await page.getByText('本页全选', { exact: true }).click();
  const bulk = page.locator('form[action="?/bulkTagSongs"]');
  await bulk.locator('[aria-label="已有标签"] input').first().check();
  assert.ok((await bulk.locator('input[name="id"]').count()) > 0);
  await page.screenshot({ path: join(tmpdir(), 'songlist-tags-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await bulk.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(tmpdir(), 'songlist-tags-mobile.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await bulk.getByRole('button').click();
  await page.getByRole('button', { name: '追加标签', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('form[action="?/bulkTagSongs"] input[name="tagsInput"]').value === ''
  );
  await page.goto('http://127.0.0.1:5198/admin', { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: '歌曲软件导入', exact: true }).click();
  await page.locator('[name="musicInput"]').fill('https://music.163.com/#/song?id=123');
  await page.getByRole('button', { name: '解析链接', exact: true }).click();
  const shared = page.locator('[name="sharedTagsInput"]');
  await shared.waitFor();
  await shared.locator('..').locator('..').locator('[aria-label="已有标签"] input').first().check();
  assert.ok((await shared.inputValue()).length > 0);
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(submissions, 4);
  console.log(
    'PASS edit-save/reopen field preservation, all sorting controls, manual tag selection/reset, bulk selection/confirmation/reset, import tags and mobile overflow. All writes mocked.'
  );
} finally {
  await browser.close();
  await fixture.close();
}
