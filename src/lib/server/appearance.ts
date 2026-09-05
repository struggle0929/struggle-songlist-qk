import { randomUUID } from 'node:crypto';
import {
  appearancePaths,
  cursorLabels,
  cursorStates,
  parseAppearance,
  staticStates,
  type CursorMode
} from '$lib/appearance';
import { UserFacingError } from '$lib/server/errors';
import { listSettings, pageSettingsKeys, saveSettings, settingsAssetBucket } from '$lib/server/settings';
import { supabaseAdmin } from '$lib/server/supabase';

export async function saveAppearance(form: FormData) {
  const mode = form.get('cursorMode');
  if (!['inherit', 'system', 'static', 'animated'].includes(String(mode)))
    throw new UserFacingError('请选择鼠标指针模式。');
  const existing = parseAppearance((await listSettings([pageSettingsKeys.appearance]))[pageSettingsKeys.appearance]);
  const next = structuredClone(existing);
  next.mode = mode as CursorMode | 'inherit';
  const uploads: { path: string; file: File }[] = [];

  const prepareImage = async (name: string, label: string, gif: boolean, cursor: boolean) => {
    const file = form.get(name);
    if (!(file instanceof File) || !file.size) return '';
    if (file.size > (cursor ? 256 : 512) * 1024)
      throw new UserFacingError(`${label}不能超过 ${cursor ? 256 : 512}KB。`);
    const bytes = Buffer.from(await file.arrayBuffer());
    const isPng =
      bytes.length >= 24 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.toString('ascii', 12, 16) === 'IHDR';
    const isGif = bytes.length >= 13 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6));
    if (gif ? !isGif || file.type !== 'image/gif' : !isPng || file.type !== 'image/png') {
      throw new UserFacingError(`${label}请上传${gif ? ' GIF' : ' PNG'} 图片。`);
    }
    const width = gif ? bytes.readUInt16LE(6) : bytes.readUInt32BE(16);
    const height = gif ? bytes.readUInt16LE(8) : bytes.readUInt32BE(20);
    const validDimensions = cursor
      ? gif
        ? width === height && width >= 32 && width <= 128
        : width === 32 && height === 32
      : width === height && width >= 32 && width <= 512;
    if (!validDimensions) {
      throw new UserFacingError(
        `${label}尺寸应为${cursor ? (gif ? ' 32～128 像素的正方形' : ' 32×32 像素') : ' 32～512 像素的正方形'}。`
      );
    }
    // A static cursor must not be an animated PNG.
    if (!gif) {
      for (let offset = 8; offset + 12 <= bytes.length; ) {
        const length = bytes.readUInt32BE(offset);
        if (bytes.toString('ascii', offset + 4, offset + 8) === 'acTL')
          throw new UserFacingError(`${label}请使用非动画 PNG。`);
        offset += length + 12;
      }
    }
    const path = `appearance/${randomUUID()}.${gif ? 'gif' : 'png'}`;
    uploads.push({ path, file });
    return path;
  };

  for (const key of ['logo', 'favicon'] as const) {
    const path = await prepareImage(key, key === 'logo' ? '左上角图片' : '网址图标', false, false);
    if (path) next[key] = path;
    else if (form.get(`remove_${key}`) === 'on') next[key] = '';
  }
  for (const kind of ['static', 'animated'] as const) {
    for (const state of kind === 'static' ? staticStates : cursorStates) {
      const name = `${kind}_${state}`;
      const path = await prepareImage(name, cursorLabels[state], kind === 'animated', true);
      const old = next[kind][state];
      const hotspot = ['x', 'y'].map((axis, index) => {
        const raw = form.get(`${name}_${axis}`);
        const number =
          raw === null
            ? (old?.hotspot[index] ?? (state === 'text' ? (kind === 'animated' ? [2, 5][index] : 16) : 0))
            : Number(raw);
        if (!Number.isInteger(number) || number < 0 || number > 31)
          throw new UserFacingError(`${cursorLabels[state]}的热点坐标应为 0～31 的整数。`);
        return number;
      }) as [number, number];
      if (path || old?.file) next[kind][state] = { file: path || old!.file, hotspot };
    }
  }
  if (mode === 'static' || mode === 'animated') {
    const required = mode === 'static' ? staticStates : cursorStates;
    const missing = required.filter((state) => !next[mode][state]?.file);
    if (missing.length)
      throw new UserFacingError(
        `请补齐${mode === 'static' ? '静态' : '动态'}指针图片：${missing.map((s) => cursorLabels[s]).join('、')}。`
      );
  }

  const bucket = supabaseAdmin.storage.from(settingsAssetBucket);
  const uploaded: string[] = [];
  try {
    for (const { path, file } of uploads) {
      const { error } = await bucket.upload(path, file, {
        contentType: file.type,
        cacheControl: '31536000',
        upsert: false
      });
      if (error) throw error;
      uploaded.push(path);
    }
    await saveSettings({ [pageSettingsKeys.appearance]: JSON.stringify(next) });
  } catch (error) {
    if (uploaded.length) await bucket.remove(uploaded);
    throw error;
  }
  const kept = new Set(appearancePaths(next));
  const removed = appearancePaths(existing).filter((path) => !kept.has(path));
  if (removed.length) {
    const { error } = await bucket.remove(removed);
    if (error) console.warn('删除旧外观图片失败：', error);
  }
}
