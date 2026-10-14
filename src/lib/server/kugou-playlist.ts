import { createHash, randomUUID } from 'node:crypto';
import { explicitSongLanguage } from '$lib/language';
import { UserFacingError } from './errors';
import { readMusicUrl } from './music-http';

const incomplete = '酷狗未返回完整歌单，请稍后重试，不会使用截断列表导入。';
const gidPattern = /^collection_[1-9]\d*_[1-9]\d*_[1-9]\d*_\d+$/;

export function kugouCollectionId(url: URL) {
  const id = url.searchParams.get('global_collection_id');
  if (!id) return undefined;
  if (!gidPattern.test(id) || id.length > 120) throw new UserFacingError('酷狗歌单编号无效。');
  return id;
}

function mapSong(song: Record<string, unknown>) {
  const name = typeof song.name === 'string' ? song.name.trim() : '';
  const separator = name.indexOf(' - ');
  const singers = Array.isArray(song.singerinfo) ? song.singerinfo : [];
  const artist =
    singers
      .map((singer) => (typeof singer?.name === 'string' ? singer.name.trim() : ''))
      .filter(Boolean)
      .join(' / ') || (separator > 0 ? name.slice(0, separator).trim().replace(/、/g, ' / ') : '');
  const title =
    typeof song.song_name === 'string'
      ? song.song_name.trim()
      : separator > 0
        ? name.slice(separator + 3).trim()
        : name;
  if (!title || !artist) {
    if (song.shield === 1)
      throw new UserFacingError(
        '酷狗歌单包含平台屏蔽或不可读取的歌曲，无法取得完整信息。请在酷狗移除不可用歌曲后重试，不会静默跳过。'
      );
    throw new UserFacingError(incomplete);
  }
  const language = explicitSongLanguage(song.language);
  return {
    title,
    artist,
    ...(typeof song.hash === 'string' && /^[a-f0-9]{32}$/i.test(song.hash) ? { lyricId: song.hash.toUpperCase() } : {}),
    ...(language ? { language, languageSource: 'metadata' as const } : {})
  };
}

// Public-list protocol reference: https://github.com/MakcRe/KuGouMusicApi/blob/main/module/playlist_track_all.js
// No account token, login cookies or private-list access is used.
export async function fetchKugouPlaylist(id: string, maxSongs: number, signal: AbortSignal) {
  if (!gidPattern.test(id) || id.length > 120) throw new UserFacingError('酷狗歌单编号无效。');
  const songs: ReturnType<typeof mapSong>[] = [];
  const pages = new Set<string>();
  const mid = createHash('md5').update(randomUUID()).digest('hex');
  let total: number | undefined;
  do {
    const params: Record<string, string> = {
      global_collection_id: id,
      begin_idx: String(songs.length),
      pagesize: '100',
      area_code: '1',
      plat: '1',
      type: '1',
      mode: '1',
      personal_switch: '1',
      dfid: '-',
      mid,
      uuid: '-',
      appid: '1005',
      clientver: '20489',
      clienttime: String(Math.floor(Date.now() / 1000))
    };
    // This is a public client protocol checksum, not a user credential.
    const salt = 'OIlwieks28dk2k092lksi2UIkp';
    const input = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('');
    params.signature = createHash('md5')
      .update(salt + input + salt)
      .digest('hex');
    const url = new URL('https://gateway.kugou.com/pubsongs/v2/get_other_list_file_nofilt');
    url.search = new URLSearchParams(params).toString();
    const response = JSON.parse((await readMusicUrl(url.href, 'kugou', signal)).text);
    const data = response?.data;
    if (
      response?.error_code !== 0 ||
      !data ||
      !Number.isSafeInteger(data.count) ||
      data.count < 0 ||
      !Array.isArray(data.songs) ||
      data.begin_idx !== songs.length ||
      data.list_info?.is_pri === 1
    )
      throw new UserFacingError(incomplete);
    if (data.count > maxSongs) throw new UserFacingError(`单次最多导入 ${maxSongs} 首歌曲。`);
    if (total !== undefined && total !== data.count)
      throw new UserFacingError('酷狗歌单在读取期间发生变化，请重新解析。');
    total = data.count;
    if (total === 0 && songs.length === 0 && data.songs.length === 0) return [];
    const fingerprint = JSON.stringify(data.songs);
    if (!data.songs.length || data.songs.length > 100 || pages.has(fingerprint)) throw new UserFacingError(incomplete);
    pages.add(fingerprint);
    songs.push(...data.songs.map(mapSong));
    if (songs.length > total! || songs.length > maxSongs) throw new UserFacingError(incomplete);
  } while (songs.length < total!);
  return songs;
}
