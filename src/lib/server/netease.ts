import { UserFacingError } from '$lib/server/errors';

type NeteaseApi = {
  playlist_detail: (params: { id: string }) => Promise<NeteasePlaylistResponse>;
  song_detail: (params: { ids: string }) => Promise<NeteaseSongResponse>;
};

type NeteaseArtist = {
  name?: unknown;
};

type NeteaseTrack = {
  name?: unknown;
  ar?: unknown;
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
};

type NeteaseTrackId = {
  id?: unknown;
};

const songDetailBatchSize = 1000;
const playlistReadErrorMessage = '读取网易云公开歌单失败。';
const songReadErrorMessage = '读取网易云单曲失败。';

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
    const detail = await api.song_detail({ ids: batchIds.join(',') });
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
  const response = await api.playlist_detail({ id: playlistId });
  const trackIds = response.body?.playlist?.trackIds;

  if (response.body?.code !== 200 || !Array.isArray(trackIds)) {
    throw new UserFacingError(playlistReadErrorMessage);
  }

  if (trackIds.length > maxSongs) {
    throw new UserFacingError(`单次最多导入 ${maxSongs} 首歌曲。`);
  }

  const tracks = await fetchSongDetails(api, parseTrackIds(trackIds), playlistReadErrorMessage);
  const songs = tracks.map((track) => mapTrack(track, playlistReadErrorMessage));

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

  return mapTrack(track, songReadErrorMessage);
};
