<script lang="ts">
  import AppearanceSettings from './AppearanceSettings.svelte';
  import { enhance } from '$app/forms';
  import { pendingActions } from '$lib/pending.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import { Dialog } from 'bits-ui';
  import { onDestroy, untrack } from 'svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { PageSettings } from '$lib/types';

  let {
    settings,
    adminError,
    open = $bindable()
  }: { settings: PageSettings; adminError?: string; open: boolean } = $props();
  let pending = $state(false);
  let revision = $state(0);
  let backgroundBlur = $state(16);
  const createImagePreview = (getDefault: () => string) => {
    let objectUrl = $state('');
    const clear = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = '';
    };
    const onChange = (event: Event) => {
      clear();
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) objectUrl = URL.createObjectURL(file);
    };
    return {
      get preview() {
        return objectUrl || getDefault();
      },
      onChange,
      clear
    };
  };
  const avatarPreview = createImagePreview(() => settings.avatar);
  const backgroundPreview = createImagePreview(() => settings.background);
  $effect(() => {
    if (open) {
      backgroundBlur = settings.appearance.backgroundBlur;
      untrack(() => {
        avatarPreview.clear();
        backgroundPreview.clear();
      });
    }
  });
  onDestroy(() => {
    avatarPreview.clear();
    backgroundPreview.clear();
  });
  const submit: SubmitFunction = () => {
    pending = true;
    pendingActions.add('page-settings');
    return async ({ result, update }) => {
      try {
        await update({ reset: false });
        if (result.type === 'success') {
          avatarPreview.clear();
          backgroundPreview.clear();
          revision++;
        }
      } finally {
        pending = false;
        pendingActions.delete('page-settings');
      }
    };
  };
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="dialog-overlay" />
    <Dialog.Content class="dialog-content page-settings-dialog">
      <div class="dialog-header">
        <div>
          <Dialog.Title class="dialog-title">页面设置</Dialog.Title>
          <Dialog.Description class="dialog-description">设置主播资料，按需展开个性化选项</Dialog.Description>
        </div>
        <Dialog.Close class="dialog-close" aria-label="关闭"><Icon name="close" size={18} /></Dialog.Close>
      </div>
      <form
        method="POST"
        action="?/savePageSettings"
        enctype="multipart/form-data"
        class="page-settings-form"
        use:enhance={submit}
      >
        <div class="page-settings-body">
          {#if adminError}<div role="alert" class="alert alert-danger mb-4">{adminError}</div>{/if}
          <fieldset disabled={pending} class="space-y-4">
            {#key revision}
              <div class="grid gap-4 sm:grid-cols-2">
                <label class="field-label"
                  ><span>主播名称</span><input
                    name="heroTitle"
                    class="form-field"
                    required
                    maxlength="40"
                    value={settings.heroTitle}
                    placeholder="例如：主播点歌台"
                  /></label
                >
                <label class="field-label"
                  ><span>Bilibili 链接</span><input
                    name="bilibiliUrl"
                    type="url"
                    class="form-field"
                    required
                    maxlength="240"
                    value={settings.bilibiliUrl}
                    placeholder="https://space.bilibili.com/..."
                  /></label
                >
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <div class="rounded-xl border border-[var(--color-border-soft)] p-3">
                  <label class="field-label"
                    ><span>主播头像</span>
                    {#if avatarPreview.preview}<img
                        src={avatarPreview.preview}
                        alt="头像预览"
                        class="h-16 w-16 rounded-full object-cover"
                      />{/if}
                    <input
                      type="file"
                      name="avatar"
                      accept="image/*"
                      class="form-field"
                      onchange={avatarPreview.onChange}
                    />
                  </label>
                  <p class="mt-2 text-xs text-[var(--color-text-muted)]">建议正方形，不超过 2MB。</p>
                </div>
                <div class="rounded-xl border border-[var(--color-border-soft)] p-3">
                  <label class="field-label"
                    ><span>背景图片</span>
                    {#if backgroundPreview.preview}<div class="h-16 overflow-hidden rounded-lg">
                        <img
                          src={backgroundPreview.preview}
                          alt="背景预览"
                          class="h-full w-full object-cover"
                          style={`filter: blur(${backgroundBlur}px); transform: scale(1.1)`}
                        />
                      </div>{/if}
                    <input
                      type="file"
                      name="background"
                      accept="image/*"
                      class="form-field"
                      onchange={backgroundPreview.onChange}
                    />
                  </label>
                  <p class="mt-2 text-xs text-[var(--color-text-muted)]">建议 1920×1080，不超过 5MB。</p>
                  <label class="field-label mt-3"
                    ><span class="flex justify-between">背景模糊度 <output>{backgroundBlur}px</output></span><input
                      type="range"
                      name="backgroundBlur"
                      min="0"
                      max="40"
                      step="1"
                      bind:value={backgroundBlur}
                      class="w-full accent-[var(--color-accent)]"
                    /></label
                  >
                </div>
              </div>
              <AppearanceSettings appearance={settings.appearance} />
            {/key}
          </fieldset>
        </div>
        <div class="page-settings-footer">
          <button
            type="submit"
            class="button button-primary button-full"
            disabled={pending}
            data-pending={pending || undefined}>{pending ? '正在保存…' : '保存设置'}</button
          >
        </div>
      </form>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
