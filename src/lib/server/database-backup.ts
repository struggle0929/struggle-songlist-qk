import { randomUUID } from 'node:crypto';
import { appearancePaths, parseAppearance } from '$lib/appearance';
import {
  backupDataSchema,
  backupFormat,
  backupMaxTotalAssetBytes,
  backupVersion,
  completeImportSchema,
  prepareImportSchema,
  type BackupData
} from '$lib/database-backup';
import { fetchSupabasePages } from '$lib/server/pagination';
import {
  listSettings,
  pageSettingsDefaults,
  pageSettingsKeys,
  pageSettingsReadKeys,
  settingsAssetBucket
} from '$lib/server/settings';
import { supabaseAdmin, supabasePublic } from '$lib/server/supabase';
import type { Database, Json } from '$lib/server/database.types';
import { getErrorMessage, UserFacingError } from '$lib/server/errors';
import { ZodError } from 'zod';

type SongRow = Database['public']['Tables']['songs']['Row'];
type RequestRow = Database['public']['Tables']['requests']['Row'];

const jsonLimit = 3 * 1024 * 1024;
const assetExtension: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif'
};

export async function readLimitedJson(request: Request) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > jsonLimit) throw new UserFacingError('备份数据记录超过 3MB，无法导入。');
  const text = await request.text();
  if (Buffer.byteLength(text) > jsonLimit) throw new UserFacingError('备份数据记录超过 3MB，无法导入。');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new UserFacingError('备份数据不是有效的 JSON。');
  }
}

export const getBackupErrorMessage = (error: unknown) =>
  error instanceof ZodError ? (error.issues[0]?.message ?? '备份格式不正确。') : getErrorMessage(error);

export async function createExportManifest() {
  const [songs, requests, storedSettings] = await Promise.all([
    fetchSupabasePages<SongRow>((from, to) =>
      supabaseAdmin.from('songs').select('*').order('created_at').order('id').range(from, to)
    ),
    fetchSupabasePages<RequestRow>((from, to) =>
      supabaseAdmin.from('requests').select('*').order('created_at').order('id').range(from, to)
    ),
    listSettings(pageSettingsReadKeys)
  ]);
  const settings = pageSettingsReadKeys.map((key) => ({
    key,
    value: storedSettings[key] ?? pageSettingsDefaults[key]
  }));
  const paths = [
    storedSettings[pageSettingsKeys.avatarPath],
    storedSettings[pageSettingsKeys.backgroundPath],
    ...appearancePaths(parseAppearance(storedSettings[pageSettingsKeys.appearance]))
  ].filter((path): path is string => Boolean(path));
  const uniquePaths = [...new Set(paths)];
  const data = backupDataSchema.parse({ songs, requests, settings });
  return {
    format: backupFormat,
    version: backupVersion,
    exportedAt: new Date().toISOString(),
    data,
    assets: uniquePaths.map((originalPath) => ({
      originalPath,
      url: supabasePublic.storage.from(settingsAssetBucket).getPublicUrl(originalPath).data.publicUrl
    }))
  };
}

export async function prepareImport(input: unknown) {
  const { assets } = prepareImportSchema.parse(input);
  if (assets.reduce((total, asset) => total + asset.size, 0) > backupMaxTotalAssetBytes)
    throw new UserFacingError('备份素材总大小不能超过 24MB。');
  if (new Set(assets.map((asset) => asset.originalPath)).size !== assets.length)
    throw new UserFacingError('备份素材路径存在重复。');
  const restoreId = randomUUID();
  const bucket = supabaseAdmin.storage.from(settingsAssetBucket);
  const uploads = [];
  for (const asset of assets) {
    const path = `restores/${restoreId}/${randomUUID()}.${assetExtension[asset.contentType]}`;
    const { data, error } = await bucket.createSignedUploadUrl(path);
    if (error) {
      if (uploads.length) await bucket.remove(uploads.map((upload) => upload.path));
      throw error;
    }
    uploads.push({ originalPath: asset.originalPath, size: asset.size, path, token: data.token });
  }
  return { restoreId, uploads };
}

const replaceAssetPaths = (settings: BackupData['settings'], replacements: Map<string, string>) => {
  return settings.map((setting) => {
    if (setting.key === pageSettingsKeys.avatarPath || setting.key === pageSettingsKeys.backgroundPath)
      return { ...setting, value: replacements.get(setting.value) ?? setting.value };
    if (setting.key !== pageSettingsKeys.appearance || !setting.value) return setting;
    const appearance = parseAppearance(setting.value);
    for (const key of ['logo', 'favicon'] as const)
      appearance[key] = replacements.get(appearance[key]) ?? appearance[key];
    for (const mode of ['static', 'animated'] as const)
      for (const asset of Object.values(appearance[mode])) asset.file = replacements.get(asset.file) ?? asset.file;
    return { ...setting, value: JSON.stringify(appearance) };
  });
};

export async function completeImport(input: unknown) {
  const parsed = completeImportSchema.parse(input);
  const prefix = `restores/${parsed.restoreId}/`;
  if (parsed.assets.some((asset) => !asset.path.startsWith(prefix))) throw new UserFacingError('备份素材路径无效。');
  if (new Set(parsed.assets.map((asset) => asset.originalPath)).size !== parsed.assets.length)
    throw new UserFacingError('备份素材映射存在重复。');
  const { data: uploaded, error: listError } = await supabaseAdmin.storage
    .from(settingsAssetBucket)
    .list(`restores/${parsed.restoreId}`, { limit: 100 });
  if (listError) throw listError;
  const uploadedSizes = new Map((uploaded ?? []).map((file) => [`${prefix}${file.name}`, Number(file.metadata?.size)]));
  if (parsed.assets.some((asset) => uploadedSizes.get(asset.path) !== asset.size))
    throw new UserFacingError('上传的备份素材不完整或大小不匹配。');

  const currentSettings = await listSettings(pageSettingsReadKeys);
  const oldPaths = [
    currentSettings[pageSettingsKeys.avatarPath],
    currentSettings[pageSettingsKeys.backgroundPath],
    ...appearancePaths(parseAppearance(currentSettings[pageSettingsKeys.appearance]))
  ].filter((path): path is string => Boolean(path));
  const replacements = new Map(parsed.assets.map((asset) => [asset.originalPath, asset.path]));
  const settings = replaceAssetPaths(parsed.data.settings, replacements);
  const referencedPaths = [
    settings.find((setting) => setting.key === pageSettingsKeys.avatarPath)?.value,
    settings.find((setting) => setting.key === pageSettingsKeys.backgroundPath)?.value,
    ...appearancePaths(parseAppearance(settings.find((setting) => setting.key === pageSettingsKeys.appearance)?.value))
  ].filter((path): path is string => Boolean(path));
  if (referencedPaths.some((path) => !replacements.has(path) && !path.startsWith(prefix)))
    throw new UserFacingError('备份文件缺少页面配置引用的素材。');

  const { error } = await supabaseAdmin.rpc('restore_admin_data', {
    p_songs: parsed.data.songs as unknown as Json,
    p_requests: parsed.data.requests as unknown as Json,
    p_settings: Object.fromEntries(settings.map((setting) => [setting.key, setting.value]))
  });
  if (error) throw error;
  const keep = new Set(parsed.assets.map((asset) => asset.path));
  const unusedNewPaths = (uploaded ?? []).map((file) => `${prefix}${file.name}`).filter((path) => !keep.has(path));
  const removePaths = [...new Set([...oldPaths, ...unusedNewPaths])];
  if (removePaths.length) {
    const { error: removeError } = await supabaseAdmin.storage.from(settingsAssetBucket).remove(removePaths);
    if (removeError) console.warn('删除导入前的旧素材失败：', removeError);
  }
  return { songs: parsed.data.songs.length, requests: parsed.data.requests.length, assets: parsed.assets.length };
}

export async function cleanupImport(input: unknown) {
  const restoreId = typeof input === 'object' && input && 'restoreId' in input ? String(input.restoreId) : '';
  if (!/^[0-9a-f-]{36}$/i.test(restoreId)) return;
  const folder = `restores/${restoreId}`;
  const { data } = await supabaseAdmin.storage.from(settingsAssetBucket).list(folder, { limit: 100 });
  const settings = await listSettings(pageSettingsReadKeys);
  const referenced = new Set(
    [
      settings[pageSettingsKeys.avatarPath],
      settings[pageSettingsKeys.backgroundPath],
      ...appearancePaths(parseAppearance(settings[pageSettingsKeys.appearance]))
    ].filter((path): path is string => Boolean(path))
  );
  const paths = (data ?? []).map((file) => `${folder}/${file.name}`).filter((path) => !referenced.has(path));
  if (paths.length) await supabaseAdmin.storage.from(settingsAssetBucket).remove(paths);
}
