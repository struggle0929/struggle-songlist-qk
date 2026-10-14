import { z } from 'zod';
import { musicProviderLabel, type MusicProvider } from '$lib/music-import';
import { UserFacingError } from '$lib/server/errors';
import { musicUrl, readMusicUrl, resolveMusicShare } from '$lib/server/music-http';
import { fetchNeteasePlaylistSongs, fetchNeteaseSong } from '$lib/server/netease';
import { explicitSongLanguage } from '$lib/language';
import type { SongLanguage } from '$lib/types';
import { fetchKugouPlaylist, kugouCollectionId } from './kugou-playlist';

type Track = { title: string; artist: string; language?: SongLanguage; lyricId?: string; languageSource?: 'metadata' };

export function extractMusicLink(input: string) {
  const link = input.match(/https?:\/\/[^\s<>"'，。；）】]+/i)?.[0];
  if (!link) throw new UserFacingError('请粘贴网易云、酷狗或 QQ 音乐的单曲或歌单分享链接。');
  return link;
}

export function detectMusicLink(value: string): { provider: MusicProvider; kind?: 'song' | 'playlist' } {
  const url = new URL(value);
  const provider = ['music.163.com', 'y.music.163.com', '163cn.tv'].includes(url.hostname)
    ? 'netease'
    : url.hostname.endsWith('.kugou.com')
      ? 'kugou'
      : url.hostname.endsWith('.qq.com')
        ? 'qqmusic'
        : undefined;
  if (!provider) throw new UserFacingError('仅支持网易云、酷狗和 QQ 音乐的官方分享链接。');
  musicUrl(value, provider);
  const path = url.pathname + url.search + url.hash;
  const kind =
    provider === 'netease'
      ? /(?:playlist|toplist)(?:\/|\?)/i.test(path)
        ? 'playlist'
        : /song(?:\/|\?)/i.test(path)
          ? 'song'
          : undefined
      : provider === 'kugou'
        ? /zlist|songlist|special/i.test(path)
          ? 'playlist'
          : /\/song\.html|\/share\/[^/]+\.html/i.test(path)
            ? 'song'
            : undefined
        : /\/playlist\/|[?&]disstid=/i.test(url.href) ||
            (/\/n2\/m\/share\/details\/taoge\.html$/i.test(url.pathname) &&
              /^\d+$/.test(url.searchParams.get('id') ?? ''))
          ? 'playlist'
          : /\/(?:songDetail|song)\/|[?&]song(?:mid|id)=/i.test(url.href)
            ? 'song'
            : undefined;
  return { provider, kind };
}

export async function fetchSharedMusic(input: string, maxSongs = 5000) {
  let link = extractMusicLink(input);
  let detected = detectMusicLink(link);
  if (!detected.kind) {
    try {
      link = (await resolveMusicShare(link, detected.provider, (url) => !!detectMusicLink(url.href).kind)).url.href;
      detected = detectMusicLink(link);
    } catch (error) {
      if (error instanceof UserFacingError) throw error;
      throw new UserFacingError('分享链接暂时无法访问，请稍后重试。');
    }
  }
  if (!detected.kind) throw new UserFacingError('无法识别单曲或歌单类型，请重新复制分享链接。');
  const songs = await fetchMusicTracks(detected.provider, link, detected.kind, maxSongs);
  return { ...detected, songs };
}
const name = z.string().trim().min(1);
const kugouTrack = z.object({ song_name: name, author_name: name, hash: z.unknown().optional() });
const qqTrack = z
  .object({ name: name.optional(), songname: name.optional(), singer: z.array(z.object({ name })).min(1) })
  .refine((song) => !!(song.name || song.songname));

// Extract only the JSON array, never execute the provider's embedded JavaScript.
export function parseKugouTracks(html: string): Track[] {
  const assignment = /\bdataFromSmarty\s*=\s*\[/g.exec(html);
  if (!assignment) throw new UserFacingError('酷狗未返回歌曲列表，请确认链接有效、歌单公开。');
  const start = assignment.index + assignment[0].length - 1;
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '[') depth++;
    else if (char === ']' && --depth === 0) {
      const rows = z.array(kugouTrack).parse(JSON.parse(html.slice(start, i + 1)));
      return rows.map((row) => ({
        title: row.song_name,
        ...(typeof row.hash === 'string' && /^[a-f0-9]{32}$/i.test(row.hash)
          ? { lyricId: row.hash.toUpperCase() }
          : {}),
        artist: row.author_name
          .split('、')
          .map((part) => part.trim())
          .filter(Boolean)
          .join(' / ')
      }));
    }
  }
  throw new UserFacingError('酷狗歌曲列表不完整，请稍后重试。');
}

const mapQQ = (input: unknown): Track => {
  const row = qqTrack.parse(input);
  const language = explicitSongLanguage((input as { language?: unknown }).language);
  const raw = input as { mid?: unknown; songmid?: unknown; id?: unknown; songid?: unknown };
  const id = raw.mid ?? raw.songmid ?? raw.id ?? raw.songid;
  const lyricId = typeof id === 'string' || (typeof id === 'number' && Number.isSafeInteger(id)) ? String(id) : '';
  return {
    title: row.name ?? row.songname!,
    artist: row.singer.map((singer) => singer.name).join(' / '),
    ...(/^(?:[A-Za-z0-9]{14}|[1-9]\d{0,15})$/.test(lyricId) ? { lyricId } : {}),
    ...(language ? { language, languageSource: 'metadata' as const } : {})
  };
};
const qqPlaylist = z.object({
  code: z.literal(0),
  cdlist: z
    .array(
      z.object({
        songnum: z.number().int().nonnegative(),
        songlist: z.array(z.unknown())
      })
    )
    .min(1)
});

async function qqId(input: string, kind: 'song' | 'playlist', signal: AbortSignal) {
  const raw = input.trim();
  if (/^\d+$/.test(raw) || (kind === 'song' && /^[A-Za-z0-9]{14}$/.test(raw))) return raw;
  const direct = musicUrl(raw, 'qqmusic');
  const { url } = await readMusicUrl(direct.href, 'qqmusic', signal, (url) => !!detectMusicLink(url.href).kind);
  const id =
    kind === 'song'
      ? (url.pathname.match(/\/(?:songDetail|song)\/([A-Za-z0-9]+)(?:\.html)?/)?.[1] ??
        url.searchParams.get('songmid') ??
        url.searchParams.get('songid'))
      : (url.pathname.match(/\/playlist\/(\d+)/)?.[1] ?? url.searchParams.get('disstid') ?? url.searchParams.get('id'));
  if (!id || !(kind === 'song' ? /^[A-Za-z0-9]+$/ : /^\d+$/).test(id)) {
    throw new UserFacingError(`请填写有效的QQ音乐${kind === 'song' ? '单曲' : '公开歌单'}链接。`);
  }
  return id;
}

async function qqSongs(
  input: string,
  kind: 'song' | 'playlist',
  maxSongs: number,
  signal: AbortSignal
): Promise<Track[]> {
  const id = await qqId(input, kind, signal);
  if (kind === 'song') {
    const url = new URL('https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg');
    url.search = new URLSearchParams({
      [/^\d+$/.test(id) ? 'songid' : 'songmid']: id,
      platform: 'yqq',
      format: 'json'
    }).toString();
    const { text } = await readMusicUrl(url.href, 'qqmusic', signal);
    const response = z.object({ code: z.literal(0), data: z.array(z.unknown()).min(1) }).parse(JSON.parse(text));
    return [mapQQ(response.data[0])];
  }
  const songs: Track[] = [];
  const pageSize = 500;
  const seen = new Set<string>();
  while (true) {
    const url = new URL('https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg');
    url.search = new URLSearchParams({
      type: '1',
      json: '1',
      utf8: '1',
      onlysong: '0',
      disstid: id,
      format: 'json',
      song_begin: String(songs.length),
      song_num: String(pageSize)
    }).toString();
    const { text } = await readMusicUrl(url.href, 'qqmusic', signal);
    const list = qqPlaylist.parse(JSON.parse(text)).cdlist[0];
    if (list.songnum > maxSongs) throw new UserFacingError(`单次最多导入 ${maxSongs} 首歌曲。`);
    const fingerprint = JSON.stringify(list.songlist);
    if (!list.songlist.length || seen.has(fingerprint)) {
      if (!list.songnum && !songs.length) return [];
      throw new UserFacingError('QQ音乐未返回完整歌单，请稍后重试，或拆分歌单后导入。');
    }
    seen.add(fingerprint);
    songs.push(...list.songlist.map(mapQQ));
    if (songs.length > maxSongs) throw new UserFacingError(`单次最多导入 ${maxSongs} 首歌曲。`);
    if (songs.length === list.songnum) return songs;
    if (songs.length > list.songnum) throw new UserFacingError('QQ音乐歌曲数量不一致，请重新解析歌单。');
  }
}

export async function fetchMusicTracks(
  provider: MusicProvider,
  input: string,
  kind: 'song' | 'playlist',
  maxSongs = 5000
) {
  if (provider === 'netease')
    return kind === 'song' ? [await fetchNeteaseSong(input)] : fetchNeteasePlaylistSongs(input, maxSongs);
  const signal = AbortSignal.timeout(30000);
  try {
    let songs: Track[];
    if (provider === 'qqmusic') songs = await qqSongs(input, kind, maxSongs, signal);
    else {
      const direct = musicUrl(input.trim(), 'kugou');
      const directCollection = kind === 'playlist' ? kugouCollectionId(direct) : undefined;
      if (directCollection) {
        songs = await fetchKugouPlaylist(directCollection, maxSongs, signal);
      } else {
        const { text, url } = await readMusicUrl(
          input.trim(),
          'kugou',
          signal,
          (url) => kind === 'playlist' && !!kugouCollectionId(url)
        );
        if (kind === 'song' && /zlist|songlist|special/.test(url.pathname))
          throw new UserFacingError('请在歌单导入栏填写此链接。');
        if (kind === 'playlist' && !/zlist|songlist|special/.test(url.pathname))
          throw new UserFacingError('请填写酷狗公开歌单分享链接。');
        const collectionId = kind === 'playlist' ? kugouCollectionId(url) : undefined;
        songs = collectionId ? await fetchKugouPlaylist(collectionId, maxSongs, signal) : parseKugouTracks(text);
        if (kind === 'playlist' && !collectionId && [10, 100].includes(songs.length))
          throw new UserFacingError('酷狗分享页可能只返回部分歌曲，请重新复制包含完整歌单编号的分享链接。');
        if (kind === 'song' && songs.length !== 1) throw new UserFacingError('请填写酷狗单曲分享链接。');
      }
    }
    if (!songs.length) throw new UserFacingError('这个歌单没有可导入的歌曲。');
    if (songs.length > maxSongs) throw new UserFacingError(`单次最多导入 ${maxSongs} 首歌曲。`);
    return songs;
  } catch (error) {
    if (error instanceof UserFacingError) throw error;
    throw new UserFacingError(
      `${musicProviderLabel(provider)}解析失败：请确认链接有效、歌单公开；平台限制或网络异常时请稍后重试。`
    );
  }
}
