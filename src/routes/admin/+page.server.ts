import { saveAppearance, saveHeaderText, readBackgroundBlur, saveBackgroundBlur } from '$lib/server/appearance';
import { fail, redirect } from '@sveltejs/kit';

import { inferSongLanguage } from '$lib/language';
import { clearAdminSession } from '$lib/server/auth';
import { getAdminDashboardData, resetDatabase as resetSonglistDatabase } from '$lib/server/catalog';
import { getErrorMessage, getValidationMessage } from '$lib/server/errors';
import {
  bulkUpdateSongsFormSchema,
  bulkTagSongsFormSchema,
  deleteSongFormSchema,
  maxPlaylistImportSongCount,
  playlistImportFormValuesSchema,
  playlistImportPayloadSchema,
  playlistPreviewFormValuesSchema,
  profileFormSchema,
  requestDecisionFormSchema,
  songFormSchema,
  songPreviewFormValuesSchema
} from '$lib/server/form-schemas';
import { fetchMusicTracks, fetchSharedMusic } from '$lib/server/music-import';
import { musicProviderLabel, musicProviderIds, type MusicProvider } from '$lib/music-import';
import { fetchMusicLanguageBatch, validLyricId } from '$lib/server/music-language';
import { consumeSharedRateLimit, rateLimitKey } from '$lib/server/rate-limit';
import { updateRequestStatus } from '$lib/server/requests';
import { pageSettingsKeys, saveSettingImage, saveSettings } from '$lib/server/settings';
import {
  bulkDeleteSongs,
  bulkAppendSongTags,
  bulkSetSongsPublic,
  deleteSong as removeSong,
  importSongs,
  saveSong
} from '$lib/server/songs';
import { playlistPreviewSchema, songPreviewSchema } from '$lib/validators';

import type { Actions, PageServerLoad } from './$types';

const avatarMaxBytes = 2 * 1024 * 1024;
const backgroundMaxBytes = 5 * 1024 * 1024;

export const load: PageServerLoad = async () => ({
  dashboard: await getAdminDashboardData()
});

export const actions: Actions = {
  identifyLanguages: async ({ request, locals, getClientAddress }) => {
    if (!locals.isAdmin) return fail(403, { adminError: '需要歌单管理权限。' });
    try {
      const form = await request.formData();
      const providerValue = form.get('provider') ?? 'netease';
      if (!musicProviderIds.includes(providerValue as MusicProvider))
        return fail(400, { adminError: '音乐平台无效。' });
      const provider = providerValue as MusicProvider;
      const raw = form.get('ids');
      if (typeof raw !== 'string' || raw.length > 1000) return fail(400, { adminError: '歌曲 ID 无效。' });
      const ids: unknown = JSON.parse(raw);
      if (
        !Array.isArray(ids) ||
        ids.length < 1 ||
        ids.length > 12 ||
        ids.some((id) => typeof id !== 'string' || !validLyricId(provider, id))
      )
        return fail(400, { adminError: '每次最多识别 12 首有效歌曲。' });
      if (
        !(await consumeSharedRateLimit(
          'music-language:' + rateLimitKey(locals.userId || getClientAddress()),
          500,
          600_000
        ))
      )
        return fail(429, { adminError: '语言识别请求过于频繁，请稍后重试。' });
      return { languageResults: await fetchMusicLanguageBatch(provider, ids) };
    } catch (error) {
      return fail(400, { adminError: getErrorMessage(error) });
    }
  },
  saveHeader: async ({ request }) => {
    try {
      await saveHeaderText(await request.formData());
      return { kind: 'success' as const, adminMessage: '页面左上角文字已更新。' };
    } catch (error) {
      return fail(400, { kind: 'profile-error' as const, adminError: getErrorMessage(error) });
    }
  },
  previewMusic: async ({ request }) => {
    const value = (await request.formData()).get('musicInput');
    const musicInput = typeof value === 'string' ? value.trim() : '';
    try {
      if (!musicInput || musicInput.length > 4000) throw new Error('请填写有效的音乐分享链接（最多 4000 字）。');
      const { provider, kind, songs } = await fetchSharedMusic(musicInput, maxPlaylistImportSongCount);
      return {
        kind: 'preview-ready' as const,
        adminMessage: `已识别${musicProviderLabel(provider)}${kind === 'song' ? '单曲' : '歌单'}，共 ${songs.length} 首歌曲，请确认后导入。`,
        importPreview: {
          provider,
          sourceKind: kind,
          sourceInput: musicInput,
          status: 'ready',
          songs: songs.map((song) => ({
            ...song,
            language: song.language ?? inferSongLanguage(song.title),
            tagsInput: ''
          }))
        }
      };
    } catch (error) {
      return fail(400, { kind: 'preview-parse-error' as const, adminError: getErrorMessage(error), musicInput });
    }
  },
  bulkTagSongs: async ({ request }) => {
    const parsed = bulkTagSongsFormSchema.safeParse(await request.formData());
    if (!parsed.success) return fail(400, { kind: 'error' as const, adminError: getValidationMessage(parsed.error) });
    try {
      const count = await bulkAppendSongTags(parsed.data.ids, parsed.data.tags);
      return { kind: 'success' as const, adminMessage: `已为 ${count} 首歌曲追加标签，原有标签已保留。` };
    } catch (error) {
      return fail(400, { kind: 'error' as const, adminError: getErrorMessage(error) });
    }
  },
  saveSong: async ({ request }) => {
    const parsed = songFormSchema.safeParse(await request.formData());

    if (!parsed.success) {
      return fail(400, {
        kind: 'error' as const,
        adminError: getValidationMessage(parsed.error)
      });
    }

    try {
      await saveSong(parsed.data);
    } catch (error) {
      return fail(500, {
        kind: 'error' as const,
        adminError: getErrorMessage(error)
      });
    }

    return {
      kind: 'success' as const,
      adminMessage: '歌曲信息已保存。'
    };
  },

  deleteSong: async ({ request }) => {
    const parsed = deleteSongFormSchema.safeParse(await request.formData());

    if (!parsed.success) {
      return fail(400, {
        kind: 'error' as const,
        adminError: getValidationMessage(parsed.error)
      });
    }

    try {
      await removeSong(parsed.data.id);
    } catch (error) {
      return fail(500, {
        kind: 'error' as const,
        adminError: getErrorMessage(error)
      });
    }

    return {
      kind: 'success' as const,
      adminMessage: '歌曲已删除。'
    };
  },

  bulkUpdateSongs: async ({ request }) => {
    const parsed = bulkUpdateSongsFormSchema.safeParse(await request.formData());

    if (!parsed.success) {
      return fail(400, { kind: 'error' as const, adminError: getValidationMessage(parsed.error) });
    }

    const { bulkAction, ids } = parsed.data;

    if (ids.length === 0) {
      return fail(400, { kind: 'error' as const, adminError: '请至少选择一首歌曲。' });
    }

    try {
      if (bulkAction === 'delete') {
        const count = await bulkDeleteSongs(ids);
        return { kind: 'success' as const, adminMessage: `已删除 ${count} 首歌曲。` };
      }

      const makePublic = bulkAction === 'setPublic';
      const count = await bulkSetSongsPublic(ids, makePublic);
      return {
        kind: 'success' as const,
        adminMessage: `已${makePublic ? '公开' : '隐藏'} ${count} 首歌曲。`
      };
    } catch (error) {
      return fail(500, { kind: 'error' as const, adminError: getErrorMessage(error) });
    }
  },

  previewPlaylist: async ({ request }) => {
    const formData = await request.formData();
    const formValues = playlistPreviewFormValuesSchema.safeParse(formData);
    if (!formValues.success)
      return fail(400, { kind: 'error' as const, adminError: getValidationMessage(formValues.error) });
    const values = formValues.data;
    const parsed = playlistPreviewSchema.safeParse(values);

    if (!parsed.success) {
      return fail(400, {
        kind: 'preview-parse-error' as const,
        adminError: getValidationMessage(parsed.error),
        playlistImport: values,
        provider: values.provider
      });
    }

    try {
      const playlistSongs = await fetchMusicTracks(
        values.provider,
        parsed.data.playlistInput,
        'playlist',
        maxPlaylistImportSongCount
      );

      return {
        kind: 'preview-ready' as const,
        adminMessage: `已解析 ${playlistSongs.length} 首歌曲，请勾选要导入的歌曲。`,
        importPreview: {
          sourceInput: parsed.data.playlistInput,
          sourceKind: 'playlist' as const,
          provider: values.provider,
          status: 'ready',
          songs: playlistSongs.map((song) => ({
            ...song,
            language: song.language ?? inferSongLanguage(song.title),
            tagsInput: ''
          }))
        }
      };
    } catch (error) {
      return fail(500, {
        kind: 'preview-parse-error' as const,
        adminError: getErrorMessage(error),
        playlistImport: values,
        provider: values.provider
      });
    }
  },

  previewSong: async ({ request }) => {
    const formData = await request.formData();
    const formValues = songPreviewFormValuesSchema.safeParse(formData);
    if (!formValues.success)
      return fail(400, { kind: 'error' as const, adminError: getValidationMessage(formValues.error) });
    const values = formValues.data;
    const parsed = songPreviewSchema.safeParse(values);

    if (!parsed.success) {
      return fail(400, {
        kind: 'preview-parse-error' as const,
        adminError: getValidationMessage(parsed.error),
        songImport: values,
        provider: values.provider
      });
    }

    try {
      const [song] = await fetchMusicTracks(values.provider, parsed.data.songInput, 'song');

      return {
        kind: 'preview-ready' as const,
        adminMessage: '已解析 1 首歌曲，请确认后导入。',
        importPreview: {
          sourceInput: parsed.data.songInput,
          sourceKind: 'song' as const,
          provider: values.provider,
          status: 'ready',
          songs: [
            {
              ...song,
              language: song.language ?? inferSongLanguage(song.title),
              tagsInput: ''
            }
          ]
        }
      };
    } catch (error) {
      return fail(500, {
        kind: 'preview-parse-error' as const,
        adminError: getErrorMessage(error),
        songImport: values,
        provider: values.provider
      });
    }
  },

  importPlaylist: async ({ request }) => {
    const values = playlistImportFormValuesSchema.safeParse(await request.formData());

    if (!values.success) {
      return fail(400, {
        kind: 'error' as const,
        adminError: getValidationMessage(values.error)
      });
    }

    const parsed = playlistImportPayloadSchema.safeParse(values.data);

    if (!parsed.success) {
      return fail(400, {
        kind: 'preview-import-error' as const,
        adminError: getValidationMessage(parsed.error),
        importPreview: values.data.importPreview
      });
    }

    const { importPreview, songsToImport } = parsed.data;

    try {
      const importedCount = await importSongs(songsToImport);

      return {
        kind: 'success' as const,
        adminMessage: `已从${musicProviderLabel(importPreview.provider)}导入 ${importedCount} 首歌曲。`
      };
    } catch (error) {
      return fail(500, {
        kind: 'preview-import-error' as const,
        adminError: getErrorMessage(error),
        importPreview
      });
    }
  },

  updateRequestStatus: async ({ request }) => {
    const parsed = requestDecisionFormSchema.safeParse(await request.formData());

    if (!parsed.success) {
      return fail(400, {
        kind: 'error' as const,
        adminError: getValidationMessage(parsed.error)
      });
    }

    try {
      await updateRequestStatus(parsed.data);
    } catch (error) {
      return fail(500, {
        kind: 'error' as const,
        adminError: getErrorMessage(error)
      });
    }

    return {
      kind: 'success' as const,
      adminMessage: '愿望状态已更新。'
    };
  },

  resetDatabase: async () => {
    try {
      await resetSonglistDatabase();
    } catch (error) {
      return fail(500, {
        kind: 'error' as const,
        adminError: getErrorMessage(error)
      });
    }

    return {
      kind: 'success' as const,
      adminMessage: '数据库已恢复到空白初始状态。'
    };
  },

  logout: async ({ cookies }) => {
    clearAdminSession(cookies);
    redirect(303, '/admin/login');
  },

  saveAppearance: async ({ request }) => {
    try {
      await saveAppearance(await request.formData());
      return { kind: 'success' as const, adminMessage: '图标和鼠标指针配置已更新。' };
    } catch (error) {
      return fail(400, { kind: 'profile-error' as const, adminError: getErrorMessage(error) });
    }
  },

  saveProfile: async ({ request }) => {
    const formData = await request.formData();
    let backgroundBlur: number | undefined;
    try {
      backgroundBlur = readBackgroundBlur(formData);
    } catch (error) {
      return fail(400, { kind: 'profile-error' as const, adminError: getErrorMessage(error) });
    }
    const parsed = profileFormSchema.safeParse(formData);

    if (!parsed.success) {
      return fail(400, {
        kind: 'profile-error' as const,
        adminError: getValidationMessage(parsed.error)
      });
    }

    const { avatar: avatarFile, background: bgFile, heroTitle, bilibiliUrl } = parsed.data;
    const hasAvatarFile = avatarFile !== undefined;
    const hasBackgroundFile = bgFile !== undefined;

    if (hasAvatarFile && avatarFile.size > avatarMaxBytes) {
      return fail(400, { kind: 'profile-error' as const, adminError: '头像文件不能超过 2MB' });
    }

    if (hasBackgroundFile && bgFile.size > backgroundMaxBytes) {
      return fail(400, { kind: 'profile-error' as const, adminError: '背景文件不能超过 5MB' });
    }

    try {
      await saveSettings({
        [pageSettingsKeys.heroTitle]: heroTitle,
        [pageSettingsKeys.bilibiliUrl]: bilibiliUrl
      });

      if (hasAvatarFile) {
        await saveSettingImage('avatar', avatarFile);
      }

      if (hasBackgroundFile) {
        await saveSettingImage('background', bgFile);
      }
      if (backgroundBlur !== undefined) await saveBackgroundBlur(backgroundBlur);
    } catch (error) {
      return fail(500, { kind: 'profile-error' as const, adminError: getErrorMessage(error) });
    }

    return { kind: 'success' as const, adminMessage: '页面配置已更新。' };
  }
};
