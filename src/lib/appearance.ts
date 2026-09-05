export const cursorStates = ['default', 'pointer', 'text', 'not-allowed', 'progress', 'wait'] as const;
export type CursorState = (typeof cursorStates)[number];
export type CursorMode = 'system' | 'static' | 'animated';
export type UploadedCursorMode = Exclude<CursorMode, 'system'>;
export const cursorLabels: Record<CursorState, string> = {
  default: '普通选择',
  pointer: '链接 / 按钮',
  text: '文本选择',
  'not-allowed': '禁止操作',
  progress: '后台处理中',
  wait: '等待 / 忙碌'
};
export const staticStates = cursorStates.slice(0, 3);
export const defaultFavicon = '/favicon.svg';
export type CursorAsset = { file: string; hotspot: [number, number] };
export type Appearance = {
  logo: string;
  favicon: string;
  mode: CursorMode | 'inherit';
  static: Partial<Record<CursorState, CursorAsset>>;
  animated: Partial<Record<CursorState, CursorAsset>>;
};
export const emptyAppearance = (): Appearance => ({ logo: '', favicon: '', mode: 'inherit', static: {}, animated: {} });

export function hasCompleteCursorSet(appearance: Appearance, mode: UploadedCursorMode): boolean {
  const required = mode === 'static' ? staticStates : cursorStates;
  return required.every((state) => Boolean(appearance[mode][state]?.file));
}

export function getAutomaticCursorMode(appearance: Appearance): UploadedCursorMode | null {
  if (hasCompleteCursorSet(appearance, 'animated')) return 'animated';
  if (hasCompleteCursorSet(appearance, 'static')) return 'static';
  return null;
}

export const resolveFavicon = (appearance: Appearance, deploymentIcon: string) =>
  appearance.favicon || deploymentIcon || defaultFavicon;

// Only storage paths are persisted; URLs are resolved on the server.
export function parseAppearance(value: string | undefined): Appearance {
  const result = emptyAppearance();
  if (!value) return result;
  try {
    const raw = JSON.parse(value);
    if (!raw || typeof raw !== 'object') return result;
    for (const key of ['logo', 'favicon'] as const) {
      if (typeof raw[key] === 'string') result[key] = raw[key];
    }
    if (['inherit', 'system', 'static', 'animated'].includes(raw.mode)) result.mode = raw.mode;
    for (const mode of ['static', 'animated'] as const) {
      for (const state of mode === 'static' ? staticStates : cursorStates) {
        const asset = raw[mode]?.[state];
        if (
          typeof asset?.file === 'string' &&
          Array.isArray(asset.hotspot) &&
          asset.hotspot.length === 2 &&
          asset.hotspot.every((n: unknown) => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 31)
        ) {
          result[mode][state] = { file: asset.file, hotspot: asset.hotspot };
        }
      }
    }
  } catch {
    /* Unconfigured or invalid settings use deployment defaults. */
  }
  return result;
}

export function appearancePaths(value: Appearance): string[] {
  return [
    value.logo,
    value.favicon,
    ...Object.values(value.static).map((a) => a.file),
    ...Object.values(value.animated).map((a) => a.file)
  ].filter(Boolean);
}
