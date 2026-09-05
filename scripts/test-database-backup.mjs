import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const ids = {
  song: '11111111-1111-4111-8111-111111111111',
  request: '22222222-2222-4222-8222-222222222222'
};
const song = {
  id: ids.song,
  title: '测试歌曲',
  artist: '测试歌手',
  language: '中文',
  status: 'ready',
  tags: ['测试'],
  is_public: true,
  created_at: '2026-09-05T00:00:00.000Z'
};
const request = {
  id: ids.request,
  song_title: '测试愿望',
  artist: '',
  language: '中文',
  message: '',
  requester_name: null,
  status: 'accepted',
  matched_song_id: ids.song,
  created_at: '2026-09-05T00:00:00.000Z'
};
const initialAppearance = JSON.stringify({
  logo: 'appearance/old.png',
  favicon: '',
  mode: 'system',
  static: {},
  animated: {}
});
const state = {
  pages: [],
  settings: {
    avatar_path: 'profile/old.jpg',
    background_path: '',
    hero_title: '标题',
    bilibili_url: 'https://bilibili.com',
    appearance: initialAppearance
  },
  files: new Map(),
  signed: [],
  removed: [],
  rpc: null,
  failSignedAt: 0
};
globalThis.__backupTest = state;
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  resolve: {
    alias: [
      { find: '$lib/server/settings', replacement: '\0mock:$lib/server/settings' },
      { find: '$lib/server/supabase', replacement: '\0mock:$lib/server/supabase' },
      { find: '$lib/server/pagination', replacement: '\0mock:$lib/server/pagination' },
      { find: '$lib', replacement: resolve('src/lib') }
    ]
  },
  plugins: [
    {
      name: 'isolated-backup-storage',
      enforce: 'pre',
      resolveId(id) {
        if (id.startsWith('\0mock:')) return id;
        if (['$lib/server/settings', '$lib/server/supabase', '$lib/server/pagination'].includes(id))
          return `\0mock:${id}`;
      },
      load(id) {
        if (id === '\0mock:$lib/server/pagination')
          return `export async function fetchSupabasePages() { return globalThis.__backupTest.pages.shift(); }`;
        if (id === '\0mock:$lib/server/settings')
          return `
        const state = globalThis.__backupTest;
        export const settingsAssetBucket = 'site-assets';
        export const pageSettingsKeys = {appearance:'appearance',avatarPath:'avatar_path',backgroundPath:'background_path',heroTitle:'hero_title',bilibiliUrl:'bilibili_url'};
        export const pageSettingsReadKeys = ['appearance','avatar_path','background_path','hero_title','bilibili_url'];
        export const pageSettingsDefaults = {appearance:'',avatar_path:'',background_path:'',hero_title:'主播歌单',bilibili_url:'https://bilibili.com'};
        export async function listSettings() { return {...state.settings}; }
      `;
        if (id === '\0mock:$lib/server/supabase')
          return `
        const state = globalThis.__backupTest;
        const bucket = {
          getPublicUrl(path) { return {data:{publicUrl:'https://assets.test/'+path}}; },
          async createSignedUploadUrl(path) {
            if (state.failSignedAt && state.signed.length + 1 === state.failSignedAt) return {data:null,error:new Error('signed failed')};
            state.signed.push(path); return {data:{token:'token-'+path},error:null};
          },
          async list(folder) { return {data:[...state.files].filter(([path])=>path.startsWith(folder+'/')).map(([path,size])=>({name:path.slice(folder.length+1),metadata:{size}})),error:null}; },
          async remove(paths) { state.removed.push(...paths); for(const path of paths)state.files.delete(path); return {error:null}; }
        };
        const query = {select(){return this},order(){return this},range(){return this}};
        export const supabaseAdmin = {from(){return query},storage:{from(){return bucket}},async rpc(name,args){state.rpc={name,args};state.settings={...args.p_settings};return {error:null}}};
        export const supabasePublic = {storage:{from(){return bucket}}};
      `;
      }
    }
  ]
});

let passed = 0;
async function test(name, run) {
  state.pages = [];
  state.files.clear();
  state.signed = [];
  state.removed = [];
  state.rpc = null;
  state.failSignedAt = 0;
  state.settings = {
    avatar_path: 'profile/old.jpg',
    background_path: '',
    hero_title: '标题',
    bilibili_url: 'https://bilibili.com',
    appearance: initialAppearance
  };
  await run();
  passed++;
  console.log('PASS', name);
}

try {
  const shared = await server.ssrLoadModule('/src/lib/database-backup.ts');
  const service = await server.ssrLoadModule('/src/lib/server/database-backup.ts');
  const settingsRows = Object.entries(state.settings).map(([key, value]) => ({ key, value }));
  const data = { songs: [song], requests: [request], settings: settingsRows };

  await test('valid backup preserves songs, requests, settings and assets', async () => {
    const parsed = shared.backupFileSchema.parse({
      format: shared.backupFormat,
      version: shared.backupVersion,
      exportedAt: '2026-09-05T00:00:00.000Z',
      data,
      assets: [{ originalPath: 'profile/old.jpg', contentType: 'image/jpeg', size: 3, base64: 'YWJj' }]
    });
    assert.equal(parsed.data.requests[0].matched_song_id, ids.song);
  });

  await test('invalid versions, duplicate IDs and broken request links are rejected', async () => {
    const base = {
      format: shared.backupFormat,
      version: shared.backupVersion,
      exportedAt: '2026-09-05T00:00:00.000Z',
      data,
      assets: []
    };
    assert.equal(shared.backupFileSchema.safeParse({ ...base, version: 2 }).success, false);
    assert.equal(shared.backupFileSchema.safeParse({ ...base, data: { ...data, songs: [song, song] } }).success, false);
    assert.equal(shared.backupFileSchema.safeParse({ ...base, data: { ...data, songs: [] } }).success, false);
  });

  await test('export manifest includes raw data and each referenced asset once', async () => {
    state.pages = [[song], [request]];
    const manifest = await service.createExportManifest();
    assert.equal(manifest.data.songs.length, 1);
    assert.deepEqual(manifest.assets.map((asset) => asset.originalPath).sort(), [
      'appearance/old.png',
      'profile/old.jpg'
    ]);
  });

  await test('prepare creates isolated signed paths and cleans up on signing failure', async () => {
    const prepared = await service.prepareImport({
      assets: [
        { originalPath: 'profile/old.jpg', contentType: 'image/jpeg', size: 3 },
        { originalPath: 'appearance/old.png', contentType: 'image/png', size: 4 }
      ]
    });
    assert.equal(prepared.uploads.length, 2);
    assert.ok(prepared.uploads.every((upload) => upload.path.startsWith(`restores/${prepared.restoreId}/`)));
    state.signed = [];
    state.failSignedAt = 2;
    await assert.rejects(() =>
      service.prepareImport({
        assets: [
          { originalPath: 'a.png', contentType: 'image/png', size: 1 },
          { originalPath: 'b.png', contentType: 'image/png', size: 1 }
        ]
      })
    );
    assert.equal(state.removed.length, 1);
  });

  await test('complete atomically restores records, rewrites assets and removes old files', async () => {
    const prepared = await service.prepareImport({
      assets: [
        { originalPath: 'profile/old.jpg', contentType: 'image/jpeg', size: 3 },
        { originalPath: 'appearance/old.png', contentType: 'image/png', size: 4 }
      ]
    });
    for (const upload of prepared.uploads) state.files.set(upload.path, upload.size);
    const result = await service.completeImport({ restoreId: prepared.restoreId, data, assets: prepared.uploads });
    assert.deepEqual(result, { songs: 1, requests: 1, assets: 2 });
    assert.equal(state.rpc.name, 'restore_admin_data');
    assert.ok(state.rpc.args.p_settings.avatar_path.startsWith(`restores/${prepared.restoreId}/`));
    assert.ok(JSON.parse(state.rpc.args.p_settings.appearance).logo.startsWith(`restores/${prepared.restoreId}/`));
    assert.ok(state.removed.includes('profile/old.jpg'));
    assert.ok(state.removed.includes('appearance/old.png'));
  });

  await test('cleanup never deletes assets already referenced by restored settings', async () => {
    const restoreId = '33333333-3333-4333-8333-333333333333';
    const active = `restores/${restoreId}/active.png`;
    const abandoned = `restores/${restoreId}/abandoned.png`;
    state.files.set(active, 3);
    state.files.set(abandoned, 4);
    state.settings.appearance = JSON.stringify({ logo: active, favicon: '', mode: 'system', static: {}, animated: {} });
    await service.cleanupImport({ restoreId });
    assert.ok(!state.removed.includes(active));
    assert.ok(state.removed.includes(abandoned));
  });

  console.log(`${passed} database backup tests passed.`);
} finally {
  await server.close();
  delete globalThis.__backupTest;
}
