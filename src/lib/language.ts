import type { SongLanguage } from '$lib/types';

const kanaPattern = /[\u3040-\u30ff]/u;
const cjkPattern = /[\u3400-\u9fff]/gu;
const latinPattern = /[A-Za-z]/gu;

const countMatches = (value: string, pattern: RegExp) => value.match(pattern)?.length ?? 0;

// A performer name is not evidence of the language actually sung.
export const inferSongLanguage = (title: string, _artist = ''): SongLanguage => {
  const text = title.replace(/[（(][^()（）]*(?:live|version|remix|edit|ver\.|cover|伴奏)[^()（）]*[）)]/gi, '');

  if (kanaPattern.test(text)) {
    return '日语';
  }

  const cjkCount = countMatches(text, cjkPattern);
  const latinCount = countMatches(text, latinPattern);

  if (cjkCount > 0 && cjkCount >= latinCount) {
    return '中文';
  }

  return '其他';
};

// Accept only explicit textual labels; provider-specific numeric codes are ambiguous.
export function explicitSongLanguage(value: unknown): SongLanguage | undefined {
  if (typeof value !== 'string') return undefined;
  const labels: Record<string, SongLanguage> = {
    中文: '中文',
    汉语: '中文',
    国语: '中文',
    普通话: '中文',
    粤语: '中文',
    zh: '中文',
    'zh-cn': '中文',
    'zh-tw': '中文',
    chinese: '中文',
    mandarin: '中文',
    cantonese: '中文',
    日语: '日语',
    日文: '日语',
    ja: '日语',
    japanese: '日语',
    英语: '英语',
    英文: '英语',
    en: '英语',
    english: '英语',
    韩语: '其他',
    ko: '其他',
    korean: '其他'
  };
  return labels[value.trim().toLowerCase()];
}

export function inferLyricLanguage(lyric: unknown): SongLanguage | undefined {
  if (typeof lyric !== 'string') return undefined;
  const text = lyric
    .slice(0, 50_000)
    .split(/\r?\n/)
    .map((line) => line.replace(/\[[^\]]*\]/g, '').trim())
    .filter(
      (line) =>
        line &&
        !/^(?:作词|作曲|词曲|编曲|演唱|原唱|歌手|制作人?|词|曲|翻译|译|音乐总监|音响总监|音乐混音|吉他设计|live\s*弦乐|lyricist|composer|arranger|producer|lyrics?\s*(?:by|:))\s*[:：]/i.test(
          line
        )
    )
    .filter((line) => !/纯音乐|没有歌词|暂无歌词|instrumental|https?:\/\//i.test(line))
    .join('\n');
  const kana = countMatches(text, /[\u3040-\u30ff]/gu);
  const cjk = countMatches(text, cjkPattern);
  const latin = countMatches(text, latinPattern);
  const other = countMatches(text, /[\uac00-\ud7af\u0400-\u04ff]/gu);
  const total = kana + cjk + latin + other;
  if (total < 20) return undefined;
  // Japanese lyrics naturally include kanji and occasional English choruses.
  if (kana >= 8 && kana / total >= 0.15 && other / total < 0.2) return '日语';
  // Mixed performances follow their dominant language, not any foreign verse.
  if (kana === 0 && cjk >= 10 && cjk / total > 0.5) return '中文';
  if (other / total >= 0.6) return '其他';
  // Latin script alone does not distinguish English from French or romanized Japanese.
  const words = text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
  const english = new Set([
    'the',
    'you',
    'your',
    'i',
    'my',
    'me',
    'we',
    'our',
    'and',
    'is',
    'are',
    'to',
    'of',
    'in',
    'it',
    'this',
    'that',
    'with',
    'for',
    'be',
    'love',
    "don't",
    "i'm"
  ]);
  const hits = words.filter((word) => english.has(word));
  if (latin / total >= 0.8 && hits.length >= 5 && new Set(hits).size >= 3 && hits.length / words.length >= 0.15)
    return '英语';
  return undefined;
}
