<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { PUBLIC_SUPABASE_PUBLISHABLE_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
  import type { BackupFile } from '$lib/database-backup';
  import Icon from '$lib/components/ui/Icon.svelte';
  import { Dialog } from 'bits-ui';
  import { toast } from 'svelte-sonner';

  let { open = $bindable() }: { open: boolean } = $props();
  let tab = $state<'export' | 'import'>('export');
  let pending = $state(false);
  let progress = $state('');
  let selectedFile = $state<File | null>(null);
  let parsedBackup = $state<BackupFile | null>(null);
  let validationError = $state('');

  const requestJson = async (url: string, options?: RequestInit) => {
    const response = await fetch(url, options);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || '操作失败，请稍后重试。');
    return body;
  };
  const blobToBase64 = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(new Error('无法读取备份素材。'));
      reader.readAsDataURL(blob);
    });
  const base64ToBlob = (base64: string, contentType: string) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: contentType });
  };
  const inferContentType = (path: string, received: string) => {
    if (['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(received)) return received;
    const extension = path.split('.').pop()?.toLowerCase();
    return extension === 'jpg' || extension === 'jpeg'
      ? 'image/jpeg'
      : extension === 'png'
        ? 'image/png'
        : extension === 'webp'
          ? 'image/webp'
          : extension === 'gif'
            ? 'image/gif'
            : extension === 'avif'
              ? 'image/avif'
              : received;
  };
  const download = (content: Blob, name: string) => {
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  };

  async function exportDatabase() {
    pending = true;
    try {
      progress = '正在读取数据库…';
      const [{ backupFileSchema, backupFormat, backupVersion }, manifest] = await Promise.all([
        import('$lib/database-backup'),
        requestJson('/admin/database/export')
      ]);
      const assets = [];
      for (let index = 0; index < manifest.assets.length; index++) {
        progress = `正在下载素材 ${index + 1}/${manifest.assets.length}…`;
        const response = await fetch(manifest.assets[index].url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`无法下载素材：${manifest.assets[index].originalPath}`);
        const blob = await response.blob();
        assets.push({
          originalPath: manifest.assets[index].originalPath,
          contentType: inferContentType(manifest.assets[index].originalPath, blob.type),
          size: blob.size,
          base64: await blobToBase64(blob)
        });
      }
      const backup = backupFileSchema.parse({ ...manifest, format: backupFormat, version: backupVersion, assets });
      const date = new Date().toISOString().replace(/[:.]/g, '-');
      download(new Blob([JSON.stringify(backup)], { type: 'application/json' }), `songlist-backup-${date}.json`);
      toast.success(
        `已导出 ${backup.data.songs.length} 首歌曲、${backup.data.requests.length} 条愿望和 ${assets.length} 个素材。`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出失败。');
    } finally {
      pending = false;
      progress = '';
    }
  }

  async function selectBackup(event: Event) {
    selectedFile = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
    parsedBackup = null;
    validationError = '';
    if (!selectedFile) return;
    if (selectedFile.size > 40 * 1024 * 1024) {
      validationError = '备份文件不能超过 40MB。';
      return;
    }
    try {
      const { backupFileSchema } = await import('$lib/database-backup');
      const result = backupFileSchema.safeParse(JSON.parse(await selectedFile.text()));
      if (!result.success) throw new Error(result.error.issues[0]?.message || '备份格式不正确。');
      for (const asset of result.data.assets) {
        const blob = base64ToBlob(asset.base64, asset.contentType);
        if (blob.size !== asset.size) throw new Error(`素材大小不匹配：${asset.originalPath}`);
      }
      parsedBackup = result.data;
    } catch (error) {
      validationError = error instanceof Error ? error.message : '无法读取备份文件。';
    }
  }

  async function importDatabase() {
    if (!parsedBackup) return;
    pending = true;
    let restoreId = '';
    try {
      progress = '正在准备素材上传…';
      const preparation = await requestJson('/admin/database/import/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assets: parsedBackup.assets.map(({ originalPath, contentType, size }) => ({
            originalPath,
            contentType,
            size
          }))
        })
      });
      restoreId = preparation.restoreId;
      const { createClient } = await import('@supabase/supabase-js');
      const storage = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
      }).storage.from('site-assets');
      for (let index = 0; index < preparation.uploads.length; index++) {
        const upload = preparation.uploads[index];
        const asset = parsedBackup.assets.find((item) => item.originalPath === upload.originalPath);
        if (!asset) throw new Error('备份素材映射不完整。');
        progress = `正在上传素材 ${index + 1}/${preparation.uploads.length}…`;
        const { error } = await storage.uploadToSignedUrl(
          upload.path,
          upload.token,
          base64ToBlob(asset.base64, asset.contentType),
          { contentType: asset.contentType, cacheControl: '31536000' }
        );
        if (error) throw error;
      }
      progress = '正在恢复数据库…';
      const result = await requestJson('/admin/database/import/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restoreId,
          data: parsedBackup.data,
          assets: preparation.uploads.map(
            ({ originalPath, path, size }: { originalPath: string; path: string; size: number }) => ({
              originalPath,
              path,
              size
            })
          )
        })
      });
      await invalidateAll();
      open = false;
      toast.success(`已恢复 ${result.songs} 首歌曲、${result.requests} 条愿望和 ${result.assets} 个素材。`);
      selectedFile = null;
      parsedBackup = null;
    } catch (error) {
      if (restoreId)
        await fetch('/admin/database/import/cleanup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ restoreId })
        }).catch(() => undefined);
      toast.error(error instanceof Error ? error.message : '加载数据库失败。');
    } finally {
      pending = false;
      progress = '';
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="dialog-overlay" />
    <Dialog.Content class="dialog-content max-w-2xl">
      <div class="dialog-header">
        <div>
          <Dialog.Title class="dialog-title">数据配置</Dialog.Title>
          <Dialog.Description class="dialog-description">导出完整备份，或用本地备份覆盖当前歌单数据</Dialog.Description>
        </div>
        <Dialog.Close class="dialog-close" aria-label="关闭" disabled={pending}
          ><Icon name="close" size={18} /></Dialog.Close
        >
      </div>

      <div class="mb-5 grid grid-cols-2 rounded-xl bg-[var(--color-surface-muted)] p-1">
        <button
          type="button"
          class:button-primary={tab === 'export'}
          class="button"
          onclick={() => (tab = 'export')}
          disabled={pending}>导出数据库</button
        >
        <button
          type="button"
          class:button-primary={tab === 'import'}
          class="button"
          onclick={() => (tab = 'import')}
          disabled={pending}>加载数据库</button
        >
      </div>

      {#if tab === 'export'}
        <div class="space-y-4">
          <p class="text-sm text-[var(--color-text-secondary)]">
            下载一个 JSON 备份文件，包含歌曲、愿望单、页面配置，以及头像、背景、图标和鼠标指针素材。
          </p>
          <p class="text-xs text-[var(--color-text-muted)]">
            管理员账号和请求限流记录不会导出。请妥善保存备份，因为愿望单可能包含观众填写的昵称和留言。
          </p>
          <button type="button" class="button button-primary button-full" onclick={exportDatabase} disabled={pending}
            >{pending ? progress : '导出并下载备份'}</button
          >
        </div>
      {:else}
        <div class="space-y-4">
          <label class="field-label">
            <span>选择歌单备份文件（.json，最多 40MB）</span>
            <input
              type="file"
              accept="application/json,.json"
              class="form-field"
              onchange={selectBackup}
              disabled={pending}
            />
          </label>
          {#if validationError}<div class="alert alert-danger">{validationError}</div>{/if}
          {#if parsedBackup}
            <div
              class="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-muted)] p-4 text-sm"
            >
              <p class="font-medium">备份检查通过</p>
              <p class="mt-2 text-[var(--color-text-secondary)]">
                导出时间：{new Date(parsedBackup.exportedAt).toLocaleString('zh-CN')}
              </p>
              <p class="text-[var(--color-text-secondary)]">
                歌曲 {parsedBackup.data.songs.length} 首 · 愿望 {parsedBackup.data.requests.length} 条 · 素材 {parsedBackup
                  .assets.length} 个
              </p>
            </div>
            <div class="alert alert-danger">
              加载会完整覆盖当前歌曲、愿望单和页面配置。建议先导出当前数据库作为备份。
            </div>
          {/if}
          <button
            type="button"
            class="button button-danger button-full"
            onclick={importDatabase}
            disabled={pending || !parsedBackup}>{pending ? progress : '确认加载并覆盖当前数据'}</button
          >
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
