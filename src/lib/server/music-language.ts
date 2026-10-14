import { inferLyricLanguage } from '$lib/language';
import type { MusicProvider } from '$lib/music-import';
import type { SongLanguage } from '$lib/types';
import { UserFacingError } from './errors';
import { readMusicUrl } from './music-http';
import { fetchNeteaseLanguageBatch } from './netease';

export function validLyricId(provider: MusicProvider, id: string) {
  return (
    provider === 'kugou'
      ? /^[a-f0-9]{32}$/i
      : provider === 'qqmusic'
        ? /^(?:[A-Za-z0-9]{14}|[1-9]\d{0,15})$/
        : /^[1-9]\d{0,15}$/
  ).test(id);
}

const cache = new Map<string, { language?: SongLanguage; expires: number }>();
const pending = new Map<string, Promise<SongLanguage | undefined>>();
function decodeLyric(value: unknown) {
  if (typeof value !== 'string' || value.length > 300_000) return undefined;
  const decoded = Buffer.from(value, 'base64').toString('utf8');
  return decoded
    .replace(/&#(?:x([a-f0-9]+)|(\d+));/gi, (match, hex, decimal) => {
      const code = parseInt(hex ?? decimal, hex ? 16 : 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : match;
    })
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

async function originalLyric(provider: 'kugou' | 'qqmusic', id: string) {
  const signal = AbortSignal.timeout(6000);
  if (provider === 'qqmusic') {
    const url = new URL('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg');
    url.search = new URLSearchParams({
      [/^\d+$/.test(id) ? 'musicid' : 'songmid']: id,
      format: 'json',
      nobase64: '0',
      g_tk: '5381'
    }).toString();
    const data = JSON.parse((await readMusicUrl(url.href, provider, signal)).text);
    // trans is the translation; only the original lyric participates in classification.
    return data.code === 0 ? decodeLyric(data.lyric) : undefined;
  }
  const url = new URL('https://lyrics.kugou.com/search');
  url.search = new URLSearchParams({ ver: '1', client: 'pc', hash: id, man: 'yes' }).toString();
  const data = JSON.parse((await readMusicUrl(url.href, provider, signal)).text);
  if (data.status !== 200 || !Array.isArray(data.candidates)) return undefined;
  const candidate = data.candidates.find(
    (item: { id?: unknown; accesskey?: unknown }) =>
      /^(?:[1-9]\d{0,15})$/.test(String(item?.id ?? '')) &&
      typeof item?.accesskey === 'string' &&
      /^[a-z0-9]{1,128}$/i.test(item.accesskey)
  );
  if (!candidate) return undefined;
  const download = new URL('https://lyrics.kugou.com/download');
  download.search = new URLSearchParams({
    ver: '1',
    client: 'pc',
    id: String(candidate.id),
    accesskey: candidate.accesskey,
    fmt: 'lrc',
    charset: 'utf8'
  }).toString();
  const result = JSON.parse((await readMusicUrl(download.href, provider, signal)).text);
  return result.status === 200 ? decodeLyric(result.content) : undefined;
}

async function languageFor(provider: 'kugou' | 'qqmusic', id: string) {
  const key = `${provider}:${id}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.language;
  const inflight = pending.get(key);
  if (inflight) return inflight;
  if (pending.size >= 16) return undefined;
  const task = (async () => {
    let language: SongLanguage | undefined;
    try {
      language = inferLyricLanguage(await originalLyric(provider, id));
    } catch {
      /* Restricted or missing lyrics must not block import. */
    }
    if (cache.size >= 2000) cache.delete(cache.keys().next().value!);
    cache.set(key, { language, expires: Date.now() + (language ? 3_600_000 : 30_000) });
    return language;
  })();
  pending.set(key, task);
  try {
    return await task;
  } finally {
    pending.delete(key);
  }
}

export async function fetchMusicLanguageBatch(provider: MusicProvider, ids: string[]) {
  if (!ids.length || ids.length > 12 || ids.some((id) => !validLyricId(provider, id)))
    throw new UserFacingError('每次最多识别 12 首有效歌曲。');
  if (provider === 'netease') return fetchNeteaseLanguageBatch(ids);
  const unique = [...new Set(ids.map((id) => (provider === 'kugou' ? id.toUpperCase() : id)))];
  const results: Array<{ id: string; language?: SongLanguage }> = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, unique.length) }, async () => {
      while (cursor < unique.length) {
        const id = unique[cursor++];
        results.push({ id, language: await languageFor(provider, id) });
      }
    })
  );
  return results;
}
