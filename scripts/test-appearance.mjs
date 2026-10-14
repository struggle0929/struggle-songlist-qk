// Isolated storage tests: never connects to a real Supabase project.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { resolve } from 'node:path';

const state = { value: '', uploaded: [], removed: [], failUpload: 0, failSave: false, entries: {} };
globalThis.__appearanceTest = state;
const server = await createServer({
  configFile: false,
  cacheDir: resolve('node_modules/.vite-tests/appearance'),
  server: { middlewareMode: true },
  resolve: {
    alias: [
      { find: '$lib/server/settings', replacement: '\0mock:$lib/server/settings' },
      { find: '$lib/server/supabase', replacement: '\0mock:$lib/server/supabase' },
      { find: '$lib', replacement: resolve('src/lib') }
    ]
  },
  plugins: [
    {
      name: 'isolated-appearance-storage',
      enforce: 'pre',
      resolveId(id) {
        if (id.startsWith('\0mock:')) return id;
        if (id === '$lib/server/settings' || id === '$lib/server/supabase') return '\0mock:' + id;
      },
      load(id) {
        if (id === '\0mock:$lib/server/settings')
          return `
        const state = globalThis.__appearanceTest;
        export const pageSettingsKeys = {appearance: 'appearance',heroTitle:'hero_title',bilibiliUrl:'bilibili_url',avatarPath:'avatar_path',backgroundPath:'background_path'};
        export const settingsAssetBucket = 'site-assets';
        export function resolveImageExtension(file) { if(file.type !== 'image/png') throw new Error('invalid profile image'); return 'png'; }
        export async function listSettings() { return {...state.entries,appearance: state.value}; }
        export async function saveSettings(entries) {
          if (state.failSave) throw new Error('save failed');
          state.value = entries.appearance;
          Object.assign(state.entries, entries);
        }
      `;
        if (id === '\0mock:$lib/server/supabase')
          return `
        const state = globalThis.__appearanceTest;
        export const supabaseAdmin = {storage: {from: () => ({
          async upload(path) {
            if (state.failUpload && state.uploaded.length + 1 === state.failUpload) return {error: new Error('upload failed')};
            state.uploaded.push(path); return {error: null};
          },
          async remove(paths) { state.removed.push(...paths); return {error: null}; }
        })}};
      `;
      }
    }
  ]
});

function png(width = 32, height = width) {
  const bytes = Buffer.alloc(45);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.write('IEND', 37);
  return new File([bytes], 'cursor.png', { type: 'image/png' });
}
function gif() {
  const bytes = Buffer.alloc(14);
  bytes.write('GIF89a');
  bytes.writeUInt16LE(128, 6);
  bytes.writeUInt16LE(128, 8);
  return new File([bytes], 'cursor.gif', { type: 'image/gif' });
}
const form = (mode = 'system') => {
  const value = new FormData();
  value.set('cursorMode', mode);
  return value;
};
const reset = () =>
  Object.assign(state, { value: '', uploaded: [], removed: [], failUpload: 0, failSave: false, entries: {} });
let passed = 0;
async function test(name, run) {
  reset();
  await run();
  passed++;
  console.log('PASS', name);
}
try {
  const { saveAppearance, saveHeaderText, saveBackgroundBlur, readBackgroundBlur } = await server.ssrLoadModule(
    '/src/lib/server/appearance.ts'
  );
  const { cursorStates, staticStates, parseAppearance, getAutomaticCursorMode, resolveFavicon } =
    await server.ssrLoadModule('/src/lib/appearance.ts');
  await test('missing active cursor images are rejected before upload', async () => {
    const input = form('animated');
    input.set('logo', png());
    await assert.rejects(() => saveAppearance(input));
    assert.equal(state.uploaded.length, 0);
  });
  await test('invalid MIME, dimensions, size and hotspots are rejected', async () => {
    for (const bad of [
      new File(['fake'], 'fake.png', { type: 'image/png' }),
      png(31),
      png(32, 64),
      new File([Buffer.alloc(600000)], 'large.png', { type: 'image/png' })
    ]) {
      const input = form();
      input.set('logo', bad);
      await assert.rejects(() => saveAppearance(input));
    }
    const input = form();
    input.set('static_text_x', '32');
    await assert.rejects(() => saveAppearance(input));
    assert.equal(state.uploaded.length, 0);
  });
  await test('logo and favicon persist independently and removal keeps the other asset', async () => {
    const input = form();
    input.set('logo', png());
    input.set('favicon', png(48));
    await saveAppearance(input);
    const first = JSON.parse(state.value);
    assert.notEqual(first.logo, first.favicon);
    const remove = form();
    remove.set('remove_logo', 'on');
    await saveAppearance(remove);
    assert.equal(JSON.parse(state.value).favicon, first.favicon);
    assert.deepEqual(state.removed, [first.logo]);
  });
  await test('three static and six animated images survive mode switches with their hotspots', async () => {
    const input = form('static');
    for (const name of staticStates) input.set(`static_${name}`, png());
    for (const name of cursorStates) input.set(`animated_${name}`, gif());
    input.set('animated_text_x', '2');
    input.set('animated_text_y', '5');
    await saveAppearance(input);
    const first = JSON.parse(state.value);
    assert.equal(state.uploaded.length, 9);
    await saveAppearance(form('animated'));
    assert.deepEqual(JSON.parse(state.value), { ...first, mode: 'animated' });
    await saveAppearance(form('system'));
    assert.equal(state.uploaded.length, 9);
    assert.deepEqual(JSON.parse(state.value).animated.text.hotspot, [2, 5]);
  });
  await test('partial upload failure rolls back new assets without changing settings', async () => {
    state.value = JSON.stringify({ ...parseAppearance(), logo: 'appearance/old.png' });
    const before = state.value;
    state.failUpload = 2;
    const input = form();
    input.set('logo', png());
    input.set('favicon', png());
    await assert.rejects(() => saveAppearance(input), /upload failed/);
    assert.equal(state.value, before);
    assert.deepEqual(state.removed, state.uploaded);
  });
  await test('database save failure rolls back uploads and preserves the old image', async () => {
    state.value = JSON.stringify({ ...parseAppearance(), logo: 'appearance/old.png' });
    const before = state.value;
    state.failSave = true;
    const input = form();
    input.set('logo', png());
    await assert.rejects(() => saveAppearance(input), /save failed/);
    assert.equal(state.value, before);
    assert.deepEqual(state.removed, state.uploaded);
    assert.ok(!state.removed.includes('appearance/old.png'));
  });
  await test('bad persisted settings fall back safely', async () => {
    assert.equal(parseAppearance('null').mode, 'inherit');
    assert.equal(parseAppearance('{').mode, 'inherit');
    assert.deepEqual(parseAppearance('{"static":{"text":{"file":"x","hotspot":[99,0]}}}').static, {});
  });
  await test('automatic mode prefers animated, then static, then no uploaded cursor', async () => {
    const appearance = parseAppearance();
    assert.equal(getAutomaticCursorMode(appearance), null);
    for (const state of staticStates) appearance.static[state] = { file: `${state}.png`, hotspot: [0, 0] };
    assert.equal(getAutomaticCursorMode(appearance), 'static');
    for (const state of cursorStates) appearance.animated[state] = { file: `${state}.gif`, hotspot: [0, 0] };
    assert.equal(getAutomaticCursorMode(appearance), 'animated');
  });
  await test('favicon reset selects deployment icon or built-in default', async () => {
    const appearance = parseAppearance();
    appearance.favicon = 'uploaded.png';
    assert.equal(resolveFavicon(appearance, 'deployment.png'), 'uploaded.png');
    appearance.favicon = '';
    assert.equal(resolveFavicon(appearance, 'deployment.png'), 'deployment.png');
    assert.equal(resolveFavicon(appearance, ''), '/favicon.svg');
  });
  await test('header defaults, independent text saves and blur preserve cursor and asset settings', async () => {
    assert.equal(parseAppearance().headerTitle, '');
    const { resolveHeaderText } = await server.ssrLoadModule('/src/lib/appearance.ts');
    const branding = { title: 'Siro的歌单', subtitle: 'Siro的歌单与愿望单管理' };
    assert.deepEqual(resolveHeaderText(parseAppearance(), branding), branding);
    assert.deepEqual(resolveHeaderText(parseAppearance('{"headerTitle":"新标题"}'), branding), {
      title: '新标题',
      subtitle: branding.subtitle
    });
    assert.equal(parseAppearance().backgroundBlur, 16);
    state.value = JSON.stringify({ ...parseAppearance(), logo: 'appearance/keep.png', mode: 'system' });
    const input = new FormData();
    input.set('headerField', 'headerTitle');
    input.set('headerTitle', ' 新标题 ');
    await saveHeaderText(input);
    input.set('headerField', 'headerSubtitle');
    input.set('headerSubtitle', '新副标题');
    await saveHeaderText(input);
    await saveBackgroundBlur(0);
    const saved = parseAppearance(state.value);
    assert.equal(saved.headerTitle, '新标题');
    assert.equal(saved.headerSubtitle, '新副标题');
    assert.equal(saved.backgroundBlur, 0);
    assert.equal(saved.logo, 'appearance/keep.png');
    assert.equal(saved.mode, 'system');
    input.set('headerSubtitle', '');
    await assert.rejects(() => saveHeaderText(input));
    for (const bad of ['', '-1', '41', '1.5', 'bad']) {
      input.set('backgroundBlur', bad);
      assert.throws(() => readBackgroundBlur(input));
    }
    input.set('backgroundBlur', '40');
    assert.equal(readBackgroundBlur(input), 40);
    assert.equal(parseAppearance('{"backgroundBlur":999}').backgroundBlur, 16);
  });
  await test('request prefix defaults, trimming and unified save preserve old assets and update all text', async () => {
    const { formatSongRequest } = await server.ssrLoadModule('/src/lib/appearance.ts');
    assert.equal(parseAppearance('{}').requestPrefix, '点歌');
    assert.equal(formatSongRequest('Butter-Fly', ' 我要听  '), '我要听 Butter-Fly');
    assert.equal(formatSongRequest('歌名', ''), '点歌 歌名');
    state.value = JSON.stringify({ ...parseAppearance(), logo: 'appearance/keep.png' });
    const input = form();
    input.set('requestPrefix', ' 我要听 ');
    input.set('headerTitle', '新标题');
    input.set('headerSubtitle', '新副标题');
    input.set('backgroundBlur', '0');
    await saveAppearance(input, { heroTitle: '主播', bilibiliUrl: 'https://space.bilibili.com/1' });
    const saved = parseAppearance(state.value);
    assert.equal(saved.requestPrefix, '我要听');
    assert.equal(saved.headerTitle, '新标题');
    assert.equal(saved.headerSubtitle, '新副标题');
    assert.equal(saved.backgroundBlur, 0);
    assert.equal(saved.logo, 'appearance/keep.png');
    assert.equal(state.entries.hero_title, '主播');
    input.set('requestPrefix', '');
    await saveAppearance(input);
    assert.equal(parseAppearance(state.value).requestPrefix, '点歌');
    for (const value of ['a'.repeat(21), '点歌\n']) {
      input.set('requestPrefix', value);
      await assert.rejects(() => saveAppearance(input));
    }
    assert.equal(state.uploaded.length, 0);
  });
  await test('unified profile and appearance uploads roll back together on failed settings write', async () => {
    const before = JSON.stringify({ ...parseAppearance(), requestPrefix: '原前缀' });
    state.value = before;
    state.entries.hero_title = '原主播';
    const input = form();
    input.set('avatar', png());
    input.set('logo', png());
    input.set('requestPrefix', '新前缀');
    state.failSave = true;
    await assert.rejects(() =>
      saveAppearance(input, { heroTitle: '新主播', bilibiliUrl: 'https://space.bilibili.com/1' })
    );
    assert.equal(state.value, before);
    assert.equal(state.entries.hero_title, '原主播');
    assert.equal(state.uploaded.length, 2);
    assert.deepEqual(state.removed, state.uploaded);
  });
  console.log(`${passed} appearance tests passed.`);
} finally {
  await server.close();
  delete globalThis.__appearanceTest;
}
