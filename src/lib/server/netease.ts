import { UserFacingError } from '$lib/server/errors';
import { explicitSongLanguage, inferLyricLanguage, inferSongLanguage } from '$lib/language';
import type { SongLanguage } from '$lib/types';

type NeteaseApi = {
  playlist_detail: (params: { id: string; timeout: number }) => Promise<NeteasePlaylistResponse>;
  song_detail: (params: { ids: string; timeout: number }) => Promise<NeteaseSongResponse>;
  lyric: (params: { id: string; timeout: number }) => Promise<{
    body?: { code?: number; lrc?: { lyric?: unknown } };
  }>;
};

type NeteaseArtist = {
  name?: unknown;
};

type NeteaseTrack = {
  id?: unknown;
  name?: unknown;
  ar?: unknown;
  language?: unknown;
};

type NeteasePlaylistResponse = {
  body?: {
    code?: number;
    playlist?: {
      trackIds?: NeteaseTrackId[];
    };
  };
};

type NeteaseSongResponse = {
  body?: {
    code?: number;
    songs?: NeteaseTrack[];
  };
};

export type NeteasePlaylistSong = {
  title: string;
  artist: string;
  language?: SongLanguage;
  neteaseId?: string;
  languageSource?: 'metadata' | 'lyrics' | 'title' | 'unknown';
};

type NeteaseTrackId = {
  id?: unknown;
};

const songDetailBatchSize = 1000;
const playlistReadErrorMessage = '读取网易云公开歌单失败。';
const songReadErrorMessage = '读取网易云单曲失败。';

const languageCache = new Map<string, { language?: SongLanguage; expires: number }>();
const pendingLanguages = new Map<string, Promise<SongLanguage | undefined>>();
async function lyricLanguage(api: NeteaseApi, id: string): Promise<SongLanguage | undefined> {
  const cached = languageCache.get(id);
  if (cached && cached.expires > Date.now()) return cached.language;
  const pending = pendingLanguages.get(id);
  if (pending) return pending;
  // Bound total outstanding requests across simultaneous previews in this instance.
  if (pendingLanguages.size >= 16) return undefined;
  const task = (async () => {
    let language: SongLanguage | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        api.lyric({ id, timeout: 3000 }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('lyric timeout')), 3200);
        })
      ]);
      // lrc is the original lyric. Never classify tlyric (translation) or romalrc.
      if (response.body?.code === 200) language = inferLyricLanguage(response.body.lrc?.lyric);
    } catch {
      // Missing/restricted lyrics must never prevent song import.
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (languageCache.size >= 2000) languageCache.delete(languageCache.keys().next().value!);
    languageCache.set(id, { language, expires: Date.now() + (language ? 3_600_000 : 30_000) });
    return language;
  })();
  pendingLanguages.set(id, task);
  try {
    return await task;
  } finally {
    pendingLanguages.delete(id);
  }
}

async function identifyTrackLanguages(api: NeteaseApi, tracks: NeteaseTrack[], errorMessage: string) {
  const songs: NeteasePlaylistSong[] = tracks.map((track) => {
    const explicit = explicitSongLanguage(track.language);
    const language = explicit || inferSongLanguage(typeof track.name === 'string' ? track.name : '');
    return {
      ...mapTrack(track, errorMessage),
      language,
      languageSource: explicit ? 'metadata' : language === '其他' ? 'unknown' : 'title',
      ...(typeof track.id === 'number' && Number.isSafeInteger(track.id) && track.id > 0
        ? { neteaseId: String(track.id) }
        : {})
    };
  });
  let cursor = 0;
  const deadline = Date.now() + 8000;
  // Keep large playlists responsive: at most 80 lyric lookups, four workers,
  // no new request after the eight-second budget. Remaining rows stay editable.
  await Promise.all(
    Array.from({ length: Math.min(4, tracks.length) }, async () => {
      while (cursor < Math.min(tracks.length, 80) && Date.now() < deadline) {
        const index = cursor++;
        const track = tracks[index];
        if (explicitSongLanguage(track.language)) continue;
        if (typeof track.id !== 'number' || !Number.isSafeInteger(track.id) || track.id <= 0) continue;
        const language = await lyricLanguage(api, String(track.id));
        if (language) {
          songs[index].language = language;
          songs[index].languageSource = 'lyrics';
        }
      }
    })
  );
  return songs;
}

// Small authenticated follow-up batches cover the whole playlist without one
// long request. Only IDs accepted; no URLs or client-supplied language evidence.
export async function fetchNeteaseLanguageBatch(ids: string[]) {
  if (!ids.length || ids.length > 12 || ids.some((id) => !/^[1-9]\d{0,15}$/.test(id)))
    throw new UserFacingError('每次最多识别 12 首有效歌曲。');
  const api = await getNeteaseApi();
  const unique = [...new Set(ids)];
  const results: Array<{ id: string; language?: SongLanguage }> = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, unique.length) }, async () => {
      while (cursor < unique.length) {
        const id = unique[cursor++];
        results.push({ id, language: await lyricLanguage(api, id) });
      }
    })
  );
  return results;
}

const getNeteaseApi = async () =>
  ((await import('@neteasecloudmusicapienhanced/api')) as { default: NeteaseApi }).default;

const extractNeteaseId = (value: string, pathName: string, errorMessage: string) => {
  const trimmed = value.trim();

  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  const idFromQuery = trimmed.match(/[?&]id=(\d+)/)?.[1];

  if (idFromQuery) {
    return idFromQuery;
  }

  const idFromPath = trimmed.match(new RegExp(`${pathName}/(\\d+)`))?.[1];

  if (idFromPath) {
    return idFromPath;
  }

  throw new UserFacingError(errorMessage);
};

const extractPlaylistId = (value: string) =>
  extractNeteaseId(value, 'playlist', '请填写有效的网易云公开歌单链接或 ID。');

const extractSongId = (value: string) => extractNeteaseId(value, 'song', '请填写有效的网易云单曲链接或 ID。');

const getArtistName = (artist: unknown) => {
  if (artist === null || typeof artist !== 'object') {
    return '';
  }

  const { name } = artist as NeteaseArtist;

  return typeof name === 'string' ? name.trim() : '';
};

const parseTrackIds = (trackIds: NeteaseTrackId[]) =>
  trackIds.map((trackId) => {
    if (typeof trackId.id !== 'number' || !Number.isSafeInteger(trackId.id) || trackId.id <= 0) {
      throw new UserFacingError(playlistReadErrorMessage);
    }

    return String(trackId.id);
  });

const parseArtistNames = (value: unknown, errorMessage: string) => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new UserFacingError(errorMessage);
  }

  const names = value.map(getArtistName);

  if (names.some((name) => !name)) {
    throw new UserFacingError(errorMessage);
  }

  return names;
};

const mapTrack = (track: NeteaseTrack, errorMessage: string): NeteasePlaylistSong => {
  const title = typeof track.name === 'string' ? track.name.trim() : '';

  if (!title) {
    throw new UserFacingError(errorMessage);
  }

  const artists = parseArtistNames(track.ar, errorMessage);

  return {
    title,
    artist: artists.join(' / ')
  };
};

const fetchSongDetails = async (api: NeteaseApi, ids: string[], errorMessage: string) => {
  const tracks: NeteaseTrack[] = [];

  for (let index = 0; index < ids.length; index += songDetailBatchSize) {
    const batchIds = ids.slice(index, index + songDetailBatchSize);
    const detail = await api.song_detail({ ids: batchIds.join(','), timeout: 30_000 });
    const detailTracks = detail.body?.songs;

    if (detail.body?.code !== 200 || !Array.isArray(detailTracks)) {
      throw new UserFacingError(errorMessage);
    }

    tracks.push(...detailTracks);
  }

  return tracks;
};

export const fetchNeteasePlaylistSongs = async (playlistInput: string, maxSongs: number) => {
  const playlistId = extractPlaylistId(playlistInput);
  const api = await getNeteaseApi();
  const response = await api.playlist_detail({ id: playlistId, timeout: 30_000 });
  const trackIds = response.body?.playlist?.trackIds;

  if (response.body?.code !== 200 || !Array.isArray(trackIds)) {
    throw new UserFacingError(playlistReadErrorMessage);
  }

  if (trackIds.length > maxSongs) {
    throw new UserFacingError(`单次最多导入 ${maxSongs} 首歌曲。`);
  }

  const tracks = await fetchSongDetails(api, parseTrackIds(trackIds), playlistReadErrorMessage);
  const songs = await identifyTrackLanguages(api, tracks, playlistReadErrorMessage);

  if (songs.length === 0) {
    throw new UserFacingError('这个歌单没有可导入的歌曲。');
  }

  return songs;
};

export const fetchNeteaseSong = async (songInput: string) => {
  const songId = extractSongId(songInput);
  const api = await getNeteaseApi();
  const [track] = await fetchSongDetails(api, [songId], songReadErrorMessage);

  if (!track) {
    throw new UserFacingError(songReadErrorMessage);
  }

  return (await identifyTrackLanguages(api, [track], songReadErrorMessage))[0];
};
