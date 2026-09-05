import { env } from '$env/dynamic/public';

export const branding = {
  title: env.PUBLIC_SITE_TITLE || '主播歌单',
  subtitle: env.PUBLIC_SITE_SUBTITLE || '主播歌单与愿望单管理',
  description: env.PUBLIC_SITE_DESCRIPTION || '公开歌单、搜索筛选与愿望单提交。',
  tagline: env.PUBLIC_SITE_TAGLINE || '直播查歌、收歌、管歌，一站完成。',
  icon: env.PUBLIC_SITE_ICON || ''
};

export type CursorName = 'default' | 'progress' | 'text' | 'pointer' | 'not-allowed';
export type CursorDefinition = { file: string; hotspot: readonly [number, number] };

export const customCursors: Record<CursorName, CursorDefinition> = {
  default: { file: env.PUBLIC_CURSOR_DEFAULT || '', hotspot: [0, 0] },
  pointer: { file: env.PUBLIC_CURSOR_POINTER || '', hotspot: [0, 0] },
  text: { file: env.PUBLIC_CURSOR_TEXT || '', hotspot: [16, 16] },
  'not-allowed': { file: env.PUBLIC_CURSOR_DISABLED || '', hotspot: [0, 0] },
  progress: { file: env.PUBLIC_CURSOR_PROGRESS || '', hotspot: [0, 0] }
};

export const customCursorsEnabled =
  env.PUBLIC_CUSTOM_CURSORS === 'true' && Object.values(customCursors).every(({ file }) => Boolean(file));
