import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
import { stringify } from 'devalue';
import { startLocalBackend, localKey, localSecret } from './lib/local-backend.mjs';
import { mkdir } from 'node:fs/promises';
process.env.SONGLIST_ENV_DIR = 'node_modules/.songlist-test-env';
await mkdir(process.env.SONGLIST_ENV_DIR, { recursive: true });

const backend = await startLocalBackend();
Object.assign(process.env, {
  PUBLIC_SUPABASE_URL: backend.url,
  PUBLIC_SUPABASE_PUBLISHABLE_KEY: localKey,
  SUPABASE_SECRET_KEY: localSecret,
  AUTH_SECRET: 'language-ui-test-only',
  LOCAL_DEMO: 'false',
  PUBLIC_SITE_TITLE: '主播歌单',
  PUBLIC_SITE_ICON: '/favicon.svg',
  PUBLIC_CUSTOM_CURSORS: 'false'
});
const { createServer } = await import('vite');
const app = await createServer({
  cacheDir: 'node_modules/.vite-tests/language-ui',
  server: { host: '127.0.0.1', port: 5196, strictPort: true }
});
await app.listen();
const api = (await import('@neteasecloudmusicapienhanced/api')).default;
const originalLyric = api.lyric;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
try {
  api.lyric = async ({ id }) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (String(id) === '996216') return { body: { code: 200 } };
    return { body: { code: 200, lrc: { lyric: 'きらめく夢を追いかけてどこまでも飛んでゆこう' } } };
  };
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5196/admin/login');
  await page.locator('[name=email]').fill('admin@local.test');
  await page.locator('[name=password]').fill(backend.password);
  await page.getByRole('button', { name: '登录后台' }).click();
  await page.waitForURL('**/admin');
  await page.waitForLoadState('networkidle');
  let generation = 0;
  let customPreview;
  await page.route('**/*', async (route) => {
    if (route.request().url().includes('?/identifyLanguages') && customPreview?.songs[0]?.lyricId) {
      assert.ok(route.request().postData().includes(customPreview.provider));
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'success',
          status: 200,
          data: stringify({
            languageResults: customPreview.songs.map((song) => ({ id: song.lyricId, language: '日语' }))
          })
        })
      });
      return;
    }
    if (!route.request().url().includes('?/previewMusic')) return route.continue();
    const mixed = generation === 2;
    const start = 996000 + generation++ * 100;
    const data = {
      kind: 'preview-ready',
      adminMessage: 'UI fixture',
      importPreview: {
        provider: 'netease',
        sourceKind: 'playlist',
        sourceInput: 'https://music.163.com/playlist?id=1',
        status: 'ready',
        songs: Array.from({ length: mixed ? 17 : 14 }, (_, i) => ({
          title: `Language UI ${start + i}`,
          artist: 'Artist',
          language: mixed && i < 2 ? '中文' : '其他',
          languageSource: mixed && i < 2 ? 'lyrics' : 'unknown',
          neteaseId: String(start + i),
          tagsInput: ''
        }))
      }
    };
    if (customPreview) data.importPreview = customPreview;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ type: 'success', status: 200, data: stringify(data) })
    });
  });
  async function openPreview() {
    await page.getByRole('tab', { name: '歌曲软件导入' }).click();
    await page.locator('[name=musicInput]').fill('https://music.163.com/playlist?id=1');
    await page.locator('form[action="?/previewMusic"] button[type=submit]').click();
    await page.getByRole('dialog').waitFor();
  }
  await openPreview();
  const dialog = page.getByRole('dialog');
  const first = dialog.locator('tbody tr').first();
  await first.locator('button.select-trigger').click();
  await page.getByRole('option', { name: '中文', exact: true }).click();
  await dialog.getByText('歌词检查：14/14；待核对：0', { exact: true }).waitFor({ timeout: 15000 });
  assert.equal(await first.locator('[name=songLanguage]').inputValue(), '中文');
  assert.equal(await dialog.locator('tbody tr').last().locator('[name=songLanguage]').inputValue(), '日语');
  assert.ok(await first.getByText('手动选择', { exact: true }).isVisible());
  await dialog.getByRole('button', { name: '导入勾选歌曲' }).click();
  await dialog.waitFor({ state: 'hidden' });
  const saved = (
    await backend.db.query("select title,language from songs where title like 'Language UI %' order by title")
  ).rows;
  assert.equal(saved.length, 14);
  assert.equal(saved[0].language, '中文');
  assert.equal(saved.at(-1).language, '日语');
  console.log('PASS all batches finish and manual changes survive delayed automatic results and import');
  await openPreview();
  await dialog.getByRole('button', { name: '停止识别，手动核对' }).click();
  assert.equal(await dialog.getByRole('button', { name: '导入勾选歌曲' }).isEnabled(), true);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await openPreview();
  const unresolved = dialog.locator('tbody tr').filter({ hasText: 'Language UI 996216' });
  await unresolved.locator('[name=songTagsInput]').fill('流行');
  await unresolved.locator('[name=selectedSong]').uncheck();
  await dialog.getByText('歌词检查：17/17；待核对：1', { exact: true }).waitFor({ timeout: 15000 });
  assert.equal(await dialog.locator('[data-song-list]').evaluate((node) => node.scrollTop), 0);
  assert.ok(await dialog.locator('tbody tr').first().getByText('Language UI 996216', { exact: true }).isVisible());
  assert.equal(await unresolved.locator('[name=songTagsInput]').inputValue(), '流行');
  assert.equal(await unresolved.locator('[name=selectedSong]').isChecked(), false);
  for (const viewport of [
    { width: 1920, height: 948 },
    { width: 1366, height: 768 },
    { width: 1280, height: 600 },
    { width: 390, height: 844 }
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(100);
    const button = await dialog.getByRole('button', { name: '导入勾选歌曲' }).boundingBox();
    assert.ok(button && button.y >= 0 && button.y + button.height <= viewport.height, JSON.stringify(viewport));
    assert.ok(await dialog.evaluate((node) => node.scrollHeight <= node.clientHeight + 1));
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: `${process.env.TEMP}/songlist-import-layout.png` });
  await unresolved.locator('button.select-trigger').click();
  await page.getByRole('option', { name: '英语', exact: true }).click();
  await dialog.getByText('歌词检查：17/17；待核对：0', { exact: true }).waitFor();
  assert.equal(await unresolved.locator('[name=selectedSong]').isChecked(), false);
  await dialog.getByRole('button', { name: '导入勾选歌曲' }).click();
  await dialog.waitFor({ state: 'hidden' });
  const mixedSaved = (await backend.db.query("select title from songs where title like 'Language UI 9962%'")).rows;
  assert.equal(mixedSaved.length, 16);
  assert.ok(mixedSaved.every((song) => song.title !== 'Language UI 996216'));
  console.log(
    'PASS total progress, unresolved-first ordering, preserved row edits and visible footer across viewport sizes'
  );
  for (const provider of ['netease', 'kugou', 'qqmusic']) {
    const normal = {
      title: `Dedup ${provider}`,
      artist: 'Artist',
      language: '中文',
      languageSource: 'metadata',
      tagsInput: ''
    };
    customPreview = {
      provider,
      sourceKind: 'playlist',
      sourceInput: 'fixture',
      status: 'ready',
      songs: [
        normal,
        { ...normal, title: `Review ${provider}`, language: '其他', languageSource: 'unknown' },
        { ...normal, title: 'Language UI 996000' },
        { ...normal },
        { ...normal, title: `Language UI 996000 (Live ${provider})` },
        { ...normal, title: 'Language UI 996000', artist: `Cover ${provider}` }
      ]
    };
    await openPreview();
    await dialog.getByText('歌词检查：6/6；待核对：1；重复：2（默认不勾选）', { exact: true }).waitFor();
    const tableRows = dialog.locator('tbody tr');
    assert.ok(await tableRows.nth(0).getByText('重复：歌单中已有', { exact: true }).isVisible());
    assert.ok(await tableRows.nth(1).getByText('重复：本次列表中已有', { exact: true }).isVisible());
    assert.ok(await tableRows.nth(2).getByText(`Review ${provider}`, { exact: true }).isVisible());
    assert.equal(await tableRows.nth(0).locator('[name=selectedSong]').isChecked(), false);
    assert.equal(await tableRows.nth(1).locator('[name=selectedSong]').isChecked(), false);
    assert.equal(await tableRows.nth(2).locator('[name=selectedSong]').isChecked(), true);
    await tableRows.nth(2).locator('[name=songTagsInput]').fill('流行');
    await dialog.getByRole('button', { name: '导入勾选歌曲' }).click();
    await dialog.waitFor({ state: 'hidden' });
    const imported = (await backend.db.query('select title,tags from songs where title=$1', [normal.title])).rows;
    assert.equal(imported.length, 1);
    const reviewed = (await backend.db.query('select tags from songs where title=$1', [`Review ${provider}`])).rows;
    assert.deepEqual(reviewed[0].tags, ['流行']);
    // Reopening the same import now finds every row already present, including hidden/versioned songs.
    await openPreview();
    await dialog.getByText('歌词检查：6/6；待核对：1；重复：6（默认不勾选）', { exact: true }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: '导入勾选歌曲' }).isEnabled(), false);
    await dialog.locator('tbody tr').first().locator('[name=selectedSong]').check();
    assert.equal(await dialog.getByRole('button', { name: '导入勾选歌曲' }).isEnabled(), true);
    await dialog.getByRole('button', { name: '导入勾选歌曲' }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(
      (await backend.db.query('select count(*)::int as count from songs where title=$1', [normal.title])).rows[0].count,
      2
    );
    console.log(
      `PASS ${provider} duplicates default unchecked, precede review rows, preserve versions and allow explicit reselection`
    );
  }
  for (const provider of ['kugou', 'qqmusic']) {
    customPreview = {
      provider,
      sourceKind: 'playlist',
      sourceInput: 'fixture',
      status: 'ready',
      songs: [0, 1].map((i) => ({
        title: `Lyrics ${provider} ${i}`,
        artist: 'Artist',
        language: '其他',
        languageSource: 'unknown',
        lyricId: provider === 'kugou' ? String(i + 1).repeat(32) : String(991200 + i),
        tagsInput: ''
      }))
    };
    await openPreview();
    const songRows = dialog.locator('tbody tr');
    await songRows.first().locator('button.select-trigger').click();
    await page.getByRole('option', { name: '中文', exact: true }).click();
    await dialog.getByText('歌词检查：2/2；待核对：0', { exact: true }).waitFor();
    assert.equal(await songRows.first().locator('[name=songLanguage]').inputValue(), '中文');
    assert.equal(await songRows.last().locator('[name=songLanguage]').inputValue(), '日语');
    await dialog.getByRole('button', { name: '导入勾选歌曲' }).click();
    await dialog.waitFor({ state: 'hidden' });
    const stored = (
      await backend.db.query('select language from songs where title like $1 order by title', [`Lyrics ${provider} %`])
    ).rows;
    assert.deepEqual(
      stored.map((song) => song.language),
      ['中文', '日语']
    );
    console.log(
      `PASS ${provider} lyric progress, provider dispatch and manual edits survive classification and import`
    );
  }
  assert.deepEqual(errors, []);
  console.log('PASS cancellation keeps manual import available and closing the modal has no runtime errors');
} finally {
  api.lyric = originalLyric;
  await browser.close();
  await app.close();
  await backend.close();
}
