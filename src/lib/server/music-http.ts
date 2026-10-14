import { UserFacingError } from '$lib/server/errors';
import type { MusicProvider } from '$lib/music-import';
import { Agent } from 'undici';
import { musicProviderLabel } from '$lib/music-import';

// Keep transport settings local to music requests; do not alter Supabase or global fetch.
const musicAgent = new Agent({ connect: { family: 4, autoSelectFamily: false, timeout: 10000 }, connections: 4 });
function connectionCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'NETWORK_ERROR';
  const item = error as { code?: unknown; name?: unknown; cause?: unknown; errors?: unknown[] };
  if (typeof item.code === 'string' && /^[A-Z_0-9]+$/.test(item.code)) return item.code;
  if (item.cause) return connectionCode(item.cause);
  if (item.errors?.length) return connectionCode(item.errors[0]);
  return item.name === 'TimeoutError' || item.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR';
}
async function requestMusic(url: URL, provider: MusicProvider, signal: AbortSignal, retry = true) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const options = {
        redirect: 'manual' as const,
        signal,
        dispatcher: musicAgent,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Referer: provider === 'qqmusic' ? 'https://y.qq.com/' : 'https://www.kugou.com/'
        }
      };
      return await fetch(url, options);
    } catch (error) {
      const code = connectionCode(error);
      if (
        !signal.aborted &&
        retry &&
        attempt === 0 &&
        ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(code)
      )
        continue;
      // Do not log full URLs, query strings, share tokens or account information.
      console.warn('music_connection_failed', { provider, host: url.hostname, code });
      throw new UserFacingError(
        `${musicProviderLabel(provider)}连接失败（${code}）。请稍后重试；短链接也可改用浏览器打开后的完整歌曲或歌单网址。`
      );
    }
  }
  throw new UserFacingError('音乐平台连接失败。');
}

const hosts = {
  netease: new Set(['music.163.com', 'y.music.163.com', '163cn.tv']),
  kugou: new Set([
    'm.kugou.com',
    'www.kugou.com',
    'wwwapi.kugou.com',
    't1.kugou.com',
    't.kugou.com',
    'lyrics.kugou.com',
    'gateway.kugou.com'
  ]),
  qqmusic: new Set(['c6.y.qq.com', 'c.y.qq.com', 'y.qq.com', 'i.y.qq.com', 'i2.y.qq.com'])
};
const maxBytes = 4 * 1024 * 1024;
// These official aliases accept the same share token as the app's short-link hosts.
// Give each distinct endpoint a bounded attempt, rather than retrying a blocked host.
export async function resolveMusicShare(value: string, provider: MusicProvider, stopAt: (url: URL) => boolean) {
  const original = musicUrl(value, provider);
  const alternate = new URL(original);
  if (provider === 'kugou' && original.hostname === 't1.kugou.com') alternate.hostname = 't.kugou.com';
  else if (provider === 'qqmusic' && original.hostname === 'c6.y.qq.com' && original.pathname === '/base/fcgi-bin/u')
    alternate.hostname = 'c.y.qq.com';
  else return readMusicUrl(original.href, provider, AbortSignal.timeout(30000), stopAt);

  let lastError: unknown;
  for (const candidate of [alternate, original]) {
    try {
      const result = await readMusicUrl(candidate.href, provider, AbortSignal.timeout(5000), stopAt, false);
      if (stopAt(result.url)) return result;
      lastError = new UserFacingError('无法识别单曲或歌单类型，请使用浏览器打开后的完整链接。');
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
export function musicUrl(value: string, provider: MusicProvider) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UserFacingError('请填写有效的音乐分享链接。');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    !hosts[provider].has(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new UserFacingError('请填写对应音乐平台的官方分享链接。');
  }
  // Some official short links still redirect to HTTP; always request the HTTPS equivalent.
  url.protocol = 'https:';
  return url;
}

export async function readMusicUrl(
  value: string,
  provider: MusicProvider,
  signal: AbortSignal,
  stopAt?: (url: URL) => boolean,
  retry = true
) {
  let url = musicUrl(value, provider);
  for (let hop = 0; hop < 6; hop++) {
    if (stopAt?.(url)) return { url, text: '' };
    const response = await requestMusic(url, provider, signal, retry);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new UserFacingError('分享链接跳转无效，请重新复制链接。');
      url = musicUrl(new URL(location, url).href, provider);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new UserFacingError('平台暂时无法读取，请确认歌单公开并稍后重试。');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new UserFacingError('平台返回了空内容。');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new UserFacingError('平台返回内容过大，请拆分歌单后导入。');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return { url, text: Buffer.concat(chunks).toString('utf8') };
  }
  throw new UserFacingError('分享链接跳转次数过多，请使用完整链接。');
}
