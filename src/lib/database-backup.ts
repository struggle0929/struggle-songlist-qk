import { z } from 'zod';

export const backupFormat = 'struggle-songlist-qk-backup';
export const backupVersion = 1;
export const backupMaxAssets = 20;
export const backupMaxAssetBytes = 5 * 1024 * 1024;
export const backupMaxTotalAssetBytes = 24 * 1024 * 1024;

const language = z.enum(['中文', '英语', '日语', '其他']);
const songStatus = z.enum(['ready', 'learning', 'resting']);
const requestStatus = z.enum(['pending', 'accepted', 'refused']);
const settingKeys = ['avatar_path', 'background_path', 'hero_title', 'bilibili_url', 'appearance'] as const;
const timestamp = z.string().datetime({ offset: true });
const shortText = z.string().max(500);

export const backupSongSchema = z.object({
  id: z.string().uuid(),
  title: shortText,
  artist: shortText,
  language,
  status: songStatus,
  tags: z.array(z.string().max(100)).max(100),
  is_public: z.boolean(),
  created_at: timestamp
});

export const backupRequestSchema = z.object({
  id: z.string().uuid(),
  song_title: shortText,
  artist: shortText,
  language,
  message: z.string().max(2000),
  requester_name: z.string().max(200).nullable(),
  status: requestStatus,
  matched_song_id: z.string().uuid().nullable(),
  created_at: timestamp
});

export const backupSettingSchema = z.object({
  key: z.enum(settingKeys),
  value: z.string().max(100_000)
});

export const backupDataSchema = z
  .object({
    songs: z.array(backupSongSchema).max(10_000),
    requests: z.array(backupRequestSchema).max(10_000),
    settings: z.array(backupSettingSchema).max(5)
  })
  .superRefine(({ songs, requests, settings }, ctx) => {
    const songIds = new Set(songs.map((song) => song.id));
    if (songIds.size !== songs.length) ctx.addIssue({ code: 'custom', message: '歌曲 ID 存在重复。' });
    if (new Set(requests.map((request) => request.id)).size !== requests.length)
      ctx.addIssue({ code: 'custom', message: '愿望单 ID 存在重复。' });
    if (new Set(settings.map((setting) => setting.key)).size !== settings.length)
      ctx.addIssue({ code: 'custom', message: '页面设置键存在重复。' });
    const presentSettings = new Set(settings.map((setting) => setting.key));
    if (settingKeys.some((key) => !presentSettings.has(key)))
      ctx.addIssue({ code: 'custom', message: '备份文件缺少页面设置。' });
    for (const request of requests) {
      if (request.matched_song_id && !songIds.has(request.matched_song_id))
        ctx.addIssue({ code: 'custom', message: '愿望单关联了备份中不存在的歌曲。' });
    }
  });

export const backupAssetSchema = z.object({
  originalPath: z.string().min(1).max(500),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']),
  size: z.number().int().positive().max(backupMaxAssetBytes),
  base64: z.string().min(1)
});

export const backupFileSchema = z
  .object({
    format: z.literal(backupFormat),
    version: z.literal(backupVersion),
    exportedAt: timestamp,
    data: backupDataSchema,
    assets: z.array(backupAssetSchema).max(backupMaxAssets)
  })
  .superRefine(({ assets }, ctx) => {
    if (new Set(assets.map((asset) => asset.originalPath)).size !== assets.length)
      ctx.addIssue({ code: 'custom', message: '备份素材路径存在重复。' });
    if (assets.reduce((total, asset) => total + asset.size, 0) > backupMaxTotalAssetBytes)
      ctx.addIssue({ code: 'custom', message: '备份素材总大小不能超过 24MB。' });
  });

export const prepareImportSchema = z.object({
  assets: z.array(backupAssetSchema.omit({ base64: true })).max(backupMaxAssets)
});

export const completeImportSchema = z.object({
  restoreId: z.string().uuid(),
  data: backupDataSchema,
  assets: z
    .array(
      z.object({
        originalPath: z.string().min(1).max(500),
        path: z.string().min(1).max(500),
        size: z.number().int().positive().max(backupMaxAssetBytes)
      })
    )
    .max(backupMaxAssets)
});

export type BackupData = z.infer<typeof backupDataSchema>;
export type BackupFile = z.infer<typeof backupFileSchema>;
