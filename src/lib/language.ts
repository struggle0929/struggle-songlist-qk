import type { SongLanguage } from '$lib/types';

const kanaPattern = /[\u3040-\u30ff]/u;
const cjkPattern = /[\u3400-\u9fff]/gu;
const latinPattern = /[A-Za-z]/gu;

const countMatches = (value: string, pattern: RegExp) => value.match(pattern)?.length ?? 0;

export const inferSongLanguage = (title: string, artist = ''): SongLanguage => {
  const text = `${title} ${artist}`;

  if (kanaPattern.test(text)) {
    return '日语';
  }

  const cjkCount = countMatches(text, cjkPattern);
  const latinCount = countMatches(text, latinPattern);

  if (cjkCount > 0 && cjkCount >= latinCount) {
    return '中文';
  }

  if (latinCount > 0) {
    return '英语';
  }

  return '其他';
};
