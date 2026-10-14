import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  cacheDir: resolve('node_modules/.vite-tests/music-import'),
  server: { middlewareMode: true },
  resolve: { alias: { $lib: resolve('src/lib') } }
});
const originalFetch = globalThis.fetch;
let passed = 0;
let calls = [];
let responses = [];
const reply = (body, status = 200, headers = {}) => new Response(body, { status, headers });
const mock = (...items) => {
  calls = [];
  responses = items;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const response = responses.shift();
    if (!response) throw new Error('unexpected request');
    return response;
  };
};
const track = (title) => ({ songname: title, singer: [{ name: 'A' }, { name: 'B' }] });
async function test(name, run) {
  await run();
  passed++;
  console.log('PASS', name);
}
try {
  const { fetchMusicTracks, parseKugouTracks, detectMusicLink, extractMusicLink, fetchSharedMusic } =
    await server.ssrLoadModule('/src/lib/server/music-import.ts');
  const { musicUrl, readMusicUrl, resolveMusicShare } = await server.ssrLoadModule('/src/lib/server/music-http.ts');
  await test('official short-link aliases resolve mobile QQ playlists and fall back without duplicate retries', async () => {
    const short = 'https://c6.y.qq.com/base/fcgi-bin/u?__=XpeQMp2GckbH';
    mock(
      reply('', 302, { location: 'https://i.y.qq.com/n2/m/share/details/taoge.html?id=8611139477&openinqqmusic=1' }),
      reply(JSON.stringify({ code: 0, cdlist: [{ songnum: 1, songlist: [track('QQ song')] }] }))
    );
    const result = await fetchSharedMusic(short);
    assert.equal(result.kind, 'playlist');
    assert.equal(result.songs.length, 1);
    assert.equal(new URL(calls[0]).hostname, 'c.y.qq.com');
    assert.equal(new URL(calls[1]).searchParams.get('disstid'), '8611139477');
    assert.equal(calls.length, 2); // Never fetch the target share HTML.
    assert.equal(detectMusicLink('https://i.y.qq.com/n2/m/share/details/taoge.html?id=invalid').kind, undefined);

    const seen = [];
    globalThis.fetch = async (url, options) => {
      seen.push(String(url));
      assert.ok(options.signal);
      if (seen.length === 1) throw new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } });
      return reply('', 302, {
        location: 'https://wwwapi.kugou.com/share/zlist.html?global_collection_id=collection_3_1415373104_5_0'
      });
    };
    const resolved = await resolveMusicShare(
      'https://t1.kugou.com/2D6aD33G6V2',
      'kugou',
      (url) => !!detectMusicLink(url.href).kind
    );
    assert.equal(resolved.url.searchParams.get('global_collection_id'), 'collection_3_1415373104_5_0');
    assert.deepEqual(
      seen.map((url) => new URL(url).hostname),
      ['t.kugou.com', 't1.kugou.com']
    );
    seen.length = 0;
    globalThis.fetch = async (url) => {
      seen.push(String(url));
      throw new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } });
    };
    await assert.rejects(
      () => resolveMusicShare(short, 'qqmusic', (url) => !!detectMusicLink(url.href).kind),
      /连接失败/
    );
    assert.equal(seen.length, 2);
    mock(
      reply('', 302, { location: 'https://evil.example/playlist/123' }),
      reply('', 302, { location: 'https://evil.example/playlist/123' })
    );
    await assert.rejects(
      () => resolveMusicShare(short, 'qqmusic', (url) => !!detectMusicLink(url.href).kind),
      /官方分享链接/
    );
    assert.equal(calls.length, 2);
  });
  await test('music-only transport retries once, reports safe network codes and never logs share tokens', async () => {
    let attempts = 0;
    globalThis.fetch = async (_url, options) => {
      assert.ok(options.dispatcher);
      assert.equal(options.redirect, 'manual');
      if (++attempts === 1)
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('connect timeout'), { code: 'ETIMEDOUT' })
        });
      return reply('ok');
    };
    assert.equal((await readMusicUrl('https://t1.kugou.com/test', 'kugou', AbortSignal.timeout(1000))).text, 'ok');
    assert.equal(attempts, 2);
    const warning = console.warn;
    const messages = [];
    try {
      console.warn = (...items) => messages.push(JSON.stringify(items));
      attempts = 0;
      globalThis.fetch = async () => {
        attempts++;
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' })
        });
      };
      await assert.rejects(
        () =>
          readMusicUrl(
            'https://c6.y.qq.com/base/fcgi-bin/u?__=secret-share-token',
            'qqmusic',
            AbortSignal.timeout(1000)
          ),
        /QQ音乐连接失败（UND_ERR_CONNECT_TIMEOUT）/
      );
      assert.equal(attempts, 2);
      assert.ok(messages.join('').includes('c6.y.qq.com'));
      assert.ok(!messages.join('').includes('secret-share-token'));
      const abort = new AbortController();
      abort.abort();
      attempts = 0;
      await assert.rejects(() => readMusicUrl('https://t1.kugou.com/test', 'kugou', abort.signal), /连接失败/);
      assert.equal(attempts, 1);
    } finally {
      console.warn = warning;
    }
  });
  const { markImportDuplicates } = await server.ssrLoadModule('/src/lib/import-duplicates.ts');
  const { fetchMusicLanguageBatch, validLyricId } = await server.ssrLoadModule('/src/lib/server/music-language.ts');
  const { fetchKugouPlaylist } = await server.ssrLoadModule('/src/lib/server/kugou-playlist.ts');
  await test('Kugou truncated share preview is replaced by all paginated songs and keeps hashes and artists', async () => {
    const gid = 'collection_3_1415373104_6_0';
    const preview =
      'var dataFromSmarty=' +
      JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ song_name: `Preview ${i}`, author_name: 'Artist' }))) +
      ';';
    const song = (i) => ({
      name: `A、B - Song ${i}`,
      singerinfo: [{ name: 'A' }, { name: 'B' }],
      hash: String(i).padStart(32, '0'),
      language: i === 126 ? '英语' : ''
    });
    const page = (begin, count, songs) =>
      reply(JSON.stringify({ error_code: 0, data: { begin_idx: begin, count, songs, list_info: { is_pri: 0 } } }));
    mock(
      reply('', 302, { location: `https://wwwapi.kugou.com/share/zlist.html?global_collection_id=${gid}` }),
      page(
        0,
        127,
        Array.from({ length: 100 }, (_, i) => song(i))
      ),
      page(
        100,
        127,
        Array.from({ length: 27 }, (_, i) => song(i + 100))
      )
    );
    const songs = await fetchMusicTracks('kugou', 'https://t1.kugou.com/fixture', 'playlist');
    assert.equal(songs.length, 127);
    assert.equal(songs[126].title, 'Song 126');
    assert.equal(songs[126].artist, 'A / B');
    assert.equal(songs[126].lyricId, String(126).padStart(32, '0'));
    assert.equal(songs[126].languageSource, 'metadata');
    assert.equal(new URL(calls[1]).searchParams.get('global_collection_id'), gid);
    assert.equal(new URL(calls[2]).searchParams.get('begin_idx'), '100');
    mock(reply(preview));
    await assert.rejects(
      () => fetchMusicTracks('kugou', 'https://wwwapi.kugou.com/share/zlist.html', 'playlist'),
      /部分歌曲/
    );
  });
  await test('Kugou refuses missing pages, changing totals, private lists, over-limit counts and invalid collection IDs', async () => {
    const gid = 'collection_3_1415373104_6_0';
    const row = { name: 'A - Song', singerinfo: [{ name: 'A' }] };
    const page = (begin, count, songs, privateList = 0) =>
      reply(
        JSON.stringify({ error_code: 0, data: { begin_idx: begin, count, songs, list_info: { is_pri: privateList } } })
      );
    mock(page(0, 2, [row]), page(1, 2, []));
    await assert.rejects(() => fetchKugouPlaylist(gid, 5000, AbortSignal.timeout(1000)), /完整歌单/);
    mock(page(0, 2, [row]), page(0, 2, [row]));
    await assert.rejects(() => fetchKugouPlaylist(gid, 5000, AbortSignal.timeout(1000)), /完整歌单/);
    mock(page(0, 2, [row]), page(1, 3, [{ ...row, name: 'A - Other' }]));
    await assert.rejects(() => fetchKugouPlaylist(gid, 5000, AbortSignal.timeout(1000)), /发生变化/);
    mock(page(0, 5001, [row]));
    await assert.rejects(() => fetchKugouPlaylist(gid, 5000, AbortSignal.timeout(1000)), /最多导入/);
    mock(page(0, 1, [row], 1));
    await assert.rejects(() => fetchKugouPlaylist(gid, 5000, AbortSignal.timeout(1000)), /完整歌单/);
    mock(page(0, 1, [{ fileid: 19, shield: 1 }]));
    await assert.rejects(() => fetchKugouPlaylist(gid, 5000, AbortSignal.timeout(1000)), /平台屏蔽/);
    mock();
    await assert.rejects(() => fetchKugouPlaylist('https://evil.test', 5000, AbortSignal.timeout(1000)), /编号无效/);
    assert.equal(calls.length, 0);
  });
  await test('QQ MID and Kugou hash survive song and playlist parsing; invalid IDs are not forwarded', async () => {
    const hash = '0123456789abcdef0123456789abcdef';
    assert.equal(
      parseKugouTracks(
        'var dataFromSmarty=' + JSON.stringify([{ song_name: 'This game', author_name: 'Singer', hash }]) + ';'
      )[0].lyricId,
      hash.toUpperCase()
    );
    mock(reply(JSON.stringify({ code: 0, data: [{ ...track('Butter-Fly'), songmid: '0039MnYb0qxYhV' }] })));
    assert.equal((await fetchMusicTracks('qqmusic', '123', 'song'))[0].lyricId, '0039MnYb0qxYhV');
    mock(
      reply(
        JSON.stringify({ code: 0, cdlist: [{ songnum: 1, songlist: [{ ...track('Song'), mid: '0039MnYb0qxYhV' }] }] })
      )
    );
    assert.equal((await fetchMusicTracks('qqmusic', '123', 'playlist'))[0].lyricId, '0039MnYb0qxYhV');
    assert.equal(validLyricId('kugou', 'https://evil.test'), false);
    assert.equal(validLyricId('qqmusic', '123&other=1'), false);
    await assert.rejects(() => fetchMusicLanguageBatch('kugou', ['bad']), /有效歌曲/);
    await assert.rejects(() => fetchMusicLanguageBatch('qqmusic', Array(13).fill('123')), /12/);
  });
  await test('QQ original lyrics override title, ignore translations, decode entities and cache by platform', async () => {
    const original =
      '[00:12]You are the one I love and you are in my heart\n[00:20]I don&#39;t know the way but you are with me';
    mock(
      reply(
        JSON.stringify({
          code: 0,
          lyric: Buffer.from(original).toString('base64'),
          trans: Buffer.from('きらめく夢を追いかけてどこまでも飛んでゆこう').toString('base64')
        })
      )
    );
    assert.deepEqual(await fetchMusicLanguageBatch('qqmusic', ['991111']), [{ id: '991111', language: '英语' }]);
    assert.equal(new URL(calls[0]).searchParams.get('musicid'), '991111');
    assert.equal((await fetchMusicLanguageBatch('qqmusic', ['991111', '991111'])).length, 1);
    assert.equal(calls.length, 1);
    mock(reply(JSON.stringify({ code: 0, lyric: '', trans: Buffer.from(original).toString('base64') })));
    assert.equal((await fetchMusicLanguageBatch('qqmusic', ['0039MnYb0qxYhV']))[0].language, undefined);
    assert.equal(new URL(calls[0]).searchParams.get('songmid'), '0039MnYb0qxYhV');
    mock(reply('{}', 403));
    assert.equal((await fetchMusicLanguageBatch('qqmusic', ['991112']))[0].language, undefined);
  });
  await test('Kugou uses exact song hash and original LRC, tolerates missing lyrics and rejects unsafe download IDs', async () => {
    const hash = 'A'.repeat(32);
    mock(
      reply(JSON.stringify({ status: 200, candidates: [{ id: '777', accesskey: 'ABC123' }] })),
      reply(
        JSON.stringify({
          status: 200,
          content: Buffer.from('きらめく夢を追いかけてどこまでも飛んでゆこう').toString('base64')
        })
      )
    );
    assert.deepEqual(await fetchMusicLanguageBatch('kugou', [hash]), [{ id: hash, language: '日语' }]);
    assert.equal(new URL(calls[0]).searchParams.get('hash'), hash);
    assert.equal(new URL(calls[0]).searchParams.has('keyword'), false);
    assert.equal(new URL(calls[1]).searchParams.get('fmt'), 'lrc');
    mock(reply(JSON.stringify({ status: 200, candidates: [{ id: '777', accesskey: 'https://evil.test' }] })));
    assert.equal((await fetchMusicLanguageBatch('kugou', ['B'.repeat(32)]))[0].language, undefined);
    assert.equal(calls.length, 1);
    mock(reply(JSON.stringify({ status: 200, candidates: [] })));
    assert.equal((await fetchMusicLanguageBatch('kugou', ['C'.repeat(32)]))[0].language, undefined);
  });
  await test('duplicate detection covers existing and batch songs across providers without merging versions or artists', () => {
    const existing = [
      { title: 'Butter-Fly', artist: '和田光司' },
      { title: 'Song', artist: 'A / B' }
    ];
    for (const provider of ['netease', 'kugou', 'qqmusic']) {
      const input = [
        { title: ' ＢＵＴＴＥＲ-ＦＬＹ ', artist: ' 和田光司 ', provider },
        { title: 'song', artist: 'A、B', provider },
        { title: 'Butter-Fly (Live)', artist: '和田光司', provider },
        { title: 'Butter-Fly', artist: '翻唱歌手', provider },
        { title: 'New Song', artist: 'Singer', provider },
        { title: ' new   song ', artist: 'singer', provider }
      ];
      assert.deepEqual(
        markImportDuplicates(input, existing).map((song) => song.duplicateReason),
        ['existing', 'existing', undefined, undefined, undefined, 'batch']
      );
      assert.ok(input.every((song) => !('duplicateReason' in song)));
      assert.equal(markImportDuplicates([input[0]], []).at(0).duplicateReason, undefined);
    }
  });
  const { playlistImportFormValuesSchema, playlistImportPayloadSchema } = await server.ssrLoadModule(
    '/src/lib/server/form-schemas.ts'
  );
  await test('unified links identify all platforms and song/playlist types, including NetEase hash routes', async () => {
    for (const [link, provider, kind] of [
      ['https://music.163.com/#/song?id=186016', 'netease', 'song'],
      ['https://music.163.com/#/playlist?id=123', 'netease', 'playlist'],
      ['https://y.music.163.com/m/song?id=186016', 'netease', 'song'],
      ['https://m.kugou.com/share/song.html?chain=x', 'kugou', 'song'],
      ['https://wwwapi.kugou.com/share/zlist.html?listid=2', 'kugou', 'playlist'],
      ['https://y.qq.com/n/ryqq_v2/songDetail/242254267', 'qqmusic', 'song'],
      ['https://y.qq.com/n/ryqq_v2/playlist/9787366199', 'qqmusic', 'playlist']
    ])
      assert.deepEqual(detectMusicLink(link), { provider, kind });
    assert.equal(
      extractMusicLink('分享歌曲：https://music.163.com/#/song?id=186016 （来自网易云）'),
      'https://music.163.com/#/song?id=186016'
    );
    assert.throws(() => detectMusicLink('https://evil.qq.com/song/123'), /官方分享/);
    assert.throws(() => extractMusicLink('186016'), /分享链接/);
    mock(
      reply('', 302, { location: 'https://y.qq.com/n/ryqq_v2/songDetail/242254267' }),
      reply(JSON.stringify({ code: 0, data: [track('悬溺')] }))
    );
    const result = await fetchSharedMusic('https://c6.y.qq.com/base/fcgi-bin/u?__=x');
    assert.equal(result.provider, 'qqmusic');
    assert.equal(result.kind, 'song');
    assert.equal(result.songs[0].title, '悬溺');
  });
  await test('preview echo never copies a song link into a playlist field', async () => {
    const { getSongInputEcho, getPlaylistInputEcho } = await server.ssrLoadModule('/src/lib/admin/result.ts');
    for (const provider of ['netease', 'kugou', 'qqmusic']) {
      const form = { kind: 'preview-ready', importPreview: { provider, sourceKind: 'song', sourceInput: 'song-link' } };
      assert.equal(getPlaylistInputEcho(form), '');
      assert.equal(getSongInputEcho(form), 'song-link');
      form.importPreview.sourceKind = 'playlist';
      assert.equal(getSongInputEcho(form), '');
      assert.equal(getPlaylistInputEcho(form), 'song-link');
    }
  });
  await test('Kugou JSON extraction handles Unicode, brackets and escaped quotes without executing scripts', () => {
    const rows = [{ song_name: '歌],名"', author_name: '甲、乙' }];
    assert.deepEqual(parseKugouTracks('var dataFromSmarty=' + JSON.stringify(rows) + ', playType="list";'), [
      { title: '歌],名"', artist: '甲 / 乙' }
    ]);
    assert.throws(() => parseKugouTracks('var dataFromSmarty=evil();'));
    assert.throws(() => parseKugouTracks('var dataFromSmarty=[{"song_name":"x"}]'));
  });
  await test('official links only; credentials, ports and cross-platform hosts rejected', () => {
    for (const input of [
      'https://localhost/a',
      'https://kugou.com.evil.test/a',
      'file:///a',
      'https://user:pw@www.kugou.com/a',
      'https://www.kugou.com:8080/a'
    ]) {
      assert.throws(() => musicUrl(input, 'kugou'));
    }
    assert.throws(() => musicUrl('https://www.kugou.com/a', 'qqmusic'));
    assert.equal(musicUrl('http://wwwapi.kugou.com/share/zlist.html', 'kugou').protocol, 'https:');
  });
  await test('redirect target checked before fetching; response sizes and redirect loops bounded', async () => {
    mock(reply('', 302, { location: 'http://127.0.0.1/secret' }));
    await assert.rejects(() => readMusicUrl('https://t1.kugou.com/test', 'kugou', AbortSignal.timeout(1000)));
    assert.equal(calls.length, 1);
    mock(reply('x'.repeat(4 * 1024 * 1024 + 1)));
    await assert.rejects(() => readMusicUrl('https://www.kugou.com/test', 'kugou', AbortSignal.timeout(1000)), /过大/);
    mock(...Array.from({ length: 6 }, () => reply('', 302, { location: '/loop' })));
    await assert.rejects(
      () => readMusicUrl('https://www.kugou.com/test', 'kugou', AbortSignal.timeout(1000)),
      /跳转次数/
    );
  });
  await test('Kugou song and playlist share redirects normalize to the same import format', async () => {
    const html = 'var dataFromSmarty=' + JSON.stringify([{ song_name: '月光河畔', author_name: '黄霄雲' }]) + ';';
    mock(reply('', 302, { location: 'https://www.kugou.com/share/token.html' }), reply(html));
    assert.deepEqual(await fetchMusicTracks('kugou', 'https://m.kugou.com/share/song.html?chain=x', 'song'), [
      { title: '月光河畔', artist: '黄霄雲' }
    ]);
    mock(reply('', 302, { location: 'http://wwwapi.kugou.com/share/zlist.html?chain=x' }), reply(html));
    assert.equal((await fetchMusicTracks('kugou', 'https://t1.kugou.com/token', 'playlist')).length, 1);
    assert.ok(calls[1].startsWith('https:'));
    mock(reply(html));
    await assert.rejects(
      () => fetchMusicTracks('kugou', 'https://wwwapi.kugou.com/share/zlist.html', 'song'),
      /歌单导入栏/
    );
    mock(reply('var dataFromSmarty=[];'));
    await assert.rejects(
      () => fetchMusicTracks('kugou', 'https://wwwapi.kugou.com/share/zlist.html', 'playlist'),
      /没有可导入/
    );
  });
  await test('QQ song resolves numeric ID and combines multiple artists', async () => {
    mock(
      reply('', 302, { location: 'https://y.qq.com/n/ryqq_v2/songDetail/242254267' }),
      reply(JSON.stringify({ code: 0, data: [track('悬溺')] }))
    );
    assert.deepEqual(await fetchMusicTracks('qqmusic', 'https://c6.y.qq.com/base/fcgi-bin/u?__=x', 'song'), [
      { title: '悬溺', artist: 'A / B' }
    ]);
    assert.equal(new URL(calls[1]).searchParams.get('songid'), '242254267');
  });
  await test('QQ playlists paginate, enforce limits and reject missing/repeated pages', async () => {
    const page = (songs, total = 2) =>
      reply(JSON.stringify({ code: 0, cdlist: [{ songnum: total, songlist: songs }] }));
    mock(page([track('First')]), page([track('Second')]));
    assert.deepEqual(
      (await fetchMusicTracks('qqmusic', '123', 'playlist')).map((song) => song.title),
      ['First', 'Second']
    );
    assert.equal(new URL(calls[1]).searchParams.get('song_begin'), '1');
    mock(page([track('First')]), page([track('First')]));
    await assert.rejects(() => fetchMusicTracks('qqmusic', '123', 'playlist'), /完整歌单/);
    mock(page([], 5001));
    await assert.rejects(() => fetchMusicTracks('qqmusic', '123', 'playlist'), /最多导入/);
    mock(reply('{"code":100}'));
    await assert.rejects(() => fetchMusicTracks('qqmusic', '123', 'playlist'), /解析失败/);
  });
  await test('provider survives preview errors and import tags/schema; old NetEase forms still work', () => {
    for (const provider of ['netease', 'kugou', 'qqmusic']) {
      const form = new FormData();
      form.set('provider', provider);
      form.set('status', 'ready');
      form.set('sharedTagsInput', '旧,统一');
      form.append('selectedSong', '0');
      form.append('songTitle', 'Title');
      form.append('songArtist', 'Artist');
      form.append('songLanguage', '中文');
      form.append('songTagsInput', '旧');
      const values = playlistImportFormValuesSchema.parse(form);
      const payload = playlistImportPayloadSchema.parse(values);
      assert.equal(payload.importPreview.provider, provider);
      assert.deepEqual(new Set(payload.songsToImport[0].tags), new Set(['旧', '统一']));
      form.delete('provider');
      assert.equal(playlistImportFormValuesSchema.parse(form).importPreview.provider, 'netease');
    }
  });
  await test('updated NetEase API preserves single-song and playlist imports with bounded network timeout', async () => {
    const api = (await import('@neteasecloudmusicapienhanced/api')).default;
    const originalSong = api.song_detail;
    const originalPlaylist = api.playlist_detail;
    try {
      api.song_detail = async (params) => {
        assert.equal(params.timeout, 30_000);
        return { body: { code: 200, songs: [{ name: '测试歌曲', ar: [{ name: '测试原唱' }] }] } };
      };
      api.playlist_detail = async (params) => {
        assert.equal(params.timeout, 30_000);
        return { body: { code: 200, playlist: { trackIds: [{ id: 123 }] } } };
      };
      assert.deepEqual(await fetchMusicTracks('netease', '123', 'song'), [
        { title: '测试歌曲', artist: '测试原唱', language: '中文', languageSource: 'title' }
      ]);
      assert.deepEqual(await fetchMusicTracks('netease', '123', 'playlist'), [
        { title: '测试歌曲', artist: '测试原唱', language: '中文', languageSource: 'title' }
      ]);
    } finally {
      api.song_detail = originalSong;
      api.playlist_detail = originalPlaylist;
    }
  });
  await test('language inference uses lyric content, strips credits and avoids English-title/artist guesses', async () => {
    const { inferLyricLanguage, inferSongLanguage, explicitSongLanguage } =
      await server.ssrLoadModule('/src/lib/language.ts');
    assert.equal(inferSongLanguage('Butter-Fly', '和田光司'), '其他');
    assert.equal(inferSongLanguage('Hello', '日本歌手'), '其他');
    assert.equal(inferSongLanguage('别让爱凋落 (Live版)'), '中文');
    assert.equal(
      inferLyricLanguage('中文的歌声在这里继续响起我们共同唱着心中的愿望与梦想不断前进\nЯ люблю тебя и мы поём песню'),
      '中文'
    );
    assert.equal(inferLyricLanguage('Я люблю тебя и мы поём песню снова и снова каждую ночь'), '其他');
    assert.equal(
      inferLyricLanguage('[00:00]作词：日本の作家\n[00:10]这是我们一起唱过的歌也是心中的梦想让我们一起勇敢向前走'),
      '中文'
    );
    assert.equal(
      inferLyricLanguage('[00:12]きらめく夢を追いかけて\n[00:20]どこまでも飛んでゆこう\n[00:30]Butter Fly'),
      '日语'
    );
    assert.equal(
      inferLyricLanguage('[00:00]I love you and you are in my heart\n[00:10]We are together and this is our love'),
      '英语'
    );
    assert.equal(inferLyricLanguage('Bonjour mon amour je cherche encore une belle chanson pour demain'), undefined);
    assert.equal(inferLyricLanguage('[00:00]纯音乐，请欣赏'), undefined);
    assert.equal(inferLyricLanguage('[00:00]作词：和田光司'), undefined);
    assert.equal(inferLyricLanguage('你好'), undefined);
    assert.equal(explicitSongLanguage(2), undefined);
    assert.equal(explicitSongLanguage('Japanese'), '日语');
  });
  await test('NetEase original lyrics override title, cache results, ignore translations and tolerate failures', async () => {
    const api = (await import('@neteasecloudmusicapienhanced/api')).default;
    const originalSong = api.song_detail,
      originalLyric = api.lyric,
      originalPlaylist = api.playlist_detail;
    let id = 990001,
      lyricCalls = 0;
    try {
      api.song_detail = async () => ({
        body: {
          code: 200,
          songs: [
            { id, name: 'Butter-Fly', ar: [{ name: '和田光司' }], ...(id === 990004 ? { language: 'English' } : {}) }
          ]
        }
      });
      api.playlist_detail = async () => ({ body: { code: 200, playlist: { trackIds: [{ id }] } } });
      api.lyric = async (params) => {
        lyricCalls++;
        assert.equal(params.timeout, 3000);
        assert.equal(params.id, String(id));
        if (id === 990003) throw new Error('provider unavailable');
        return {
          body: {
            code: 200,
            lrc: { lyric: id === 990002 ? '' : '[00:12]きらめく夢を追いかけて\n[00:20]どこまでも飛んでゆこう' },
            tlyric: { lyric: '这是我们一起唱过的歌也是心中的梦想让我们一起勇敢向前走' }
          }
        };
      };
      assert.equal((await fetchMusicTracks('netease', String(id), 'song'))[0].language, '日语');
      assert.equal((await fetchMusicTracks('netease', String(id), 'playlist'))[0].language, '日语');
      assert.equal(lyricCalls, 1);
      id = 990002;
      assert.equal((await fetchMusicTracks('netease', String(id), 'song'))[0].language, '其他');
      id = 990003;
      assert.equal((await fetchMusicTracks('netease', String(id), 'song'))[0].language, '其他');
      id = 990004;
      assert.equal((await fetchMusicTracks('netease', String(id), 'song'))[0].language, '英语');
      assert.equal(lyricCalls, 3);
    } finally {
      api.song_detail = originalSong;
      api.lyric = originalLyric;
      api.playlist_detail = originalPlaylist;
    }
  });
  await test('lyric lookups have bounded concurrency and playlist count; timeout preserves import', async () => {
    const api = (await import('@neteasecloudmusicapienhanced/api')).default;
    const originalSong = api.song_detail,
      originalLyric = api.lyric,
      originalPlaylist = api.playlist_detail;
    let active = 0,
      peak = 0,
      count = 0,
      timeout = false;
    try {
      api.playlist_detail = async () => ({
        body: { code: 200, playlist: { trackIds: Array.from({ length: 100 }, (_, i) => ({ id: 991000 + i })) } }
      });
      api.song_detail = async () => ({
        body: {
          code: 200,
          songs: timeout
            ? [{ id: 992000, name: 'Hello', ar: [{ name: 'Artist' }] }]
            : Array.from({ length: 100 }, (_, i) => ({ id: 991000 + i, name: 'Hello', ar: [{ name: 'Artist' }] }))
        }
      });
      api.lyric = async () => {
        if (timeout) return new Promise(() => {});
        count++;
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active--;
        return { body: { code: 200, lrc: { lyric: 'きらめく夢を追いかけてどこまでも飛んでゆこう' } } };
      };
      const songs = await fetchMusicTracks('netease', '991000', 'playlist');
      assert.equal(songs.length, 100);
      assert.equal(count, 80);
      assert.ok(peak <= 4);
      assert.equal(songs[0].language, '日语');
      assert.equal(songs[99].language, '其他');
      const { fetchNeteaseLanguageBatch } = await server.ssrLoadModule('/src/lib/server/netease.ts');
      assert.equal((await fetchNeteaseLanguageBatch(['991099']))[0].language, '日语');
      assert.equal(count, 81);
      await assert.rejects(
        () => fetchNeteaseLanguageBatch(Array.from({ length: 13 }, (_, i) => String(100 + i))),
        /12/
      );
      await assert.rejects(() => fetchNeteaseLanguageBatch(['https://evil.test/']), /有效歌曲/);
      timeout = true;
      const start = Date.now();
      assert.equal((await fetchMusicTracks('netease', '992000', 'song'))[0].language, '其他');
      assert.ok(Date.now() - start < 4500);
    } finally {
      api.song_detail = originalSong;
      api.lyric = originalLyric;
      api.playlist_detail = originalPlaylist;
    }
  });
  console.log(passed + ' music import tests passed. No real database used.');
  if (process.argv.includes('--live')) {
    globalThis.fetch = originalFetch;
    for (const [provider, kind, url] of [
      ['kugou', 'song', 'https://m.kugou.com/share/song.html?chain=AajH2eG6V2'],
      ['kugou', 'playlist', 'https://t1.kugou.com/2CXQN07G6V2'],
      ['qqmusic', 'song', 'https://c6.y.qq.com/base/fcgi-bin/u?__=f46TFfM'],
      ['qqmusic', 'playlist', 'https://c6.y.qq.com/base/fcgi-bin/u?__=Uax9covl9eq7']
    ]) {
      const songs = await fetchMusicTracks(provider, url, kind);
      console.log('LIVE', provider, kind, songs.length, songs[0]);
    }
  }
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}
