<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { cursorLabels, cursorStates, staticStates, type Appearance } from '$lib/appearance';
  import AppearanceUpload from './AppearanceUpload.svelte';
  import { pendingActions } from '$lib/pending.svelte';
  let { appearance }: { appearance: Appearance } = $props();
  let mode = $state<Appearance['mode']>('inherit');
  let pending = $state(false);
  let revision = $state(0);
  $effect(() => {
    mode = appearance.mode;
  });
  const submit: SubmitFunction = () => {
    pending = true;
    pendingActions.add('appearance-settings');
    return async ({ result, update }) => {
      try {
        await update({ reset: false });
        if (result.type === 'success') revision++;
      } finally {
        pending = false;
        pendingActions.delete('appearance-settings');
      }
    };
  };
</script>

<section class="mt-6 border-t border-[var(--color-border-soft)] pt-6">
  <h3 class="text-base font-semibold">页面图标与鼠标指针</h3>
  <p class="mt-2 mb-4 text-sm text-[var(--color-text-muted)]">
    本区域单独保存，上传后立即生效。未选择新图片时保留已保存的图片。
  </p>
  <form method="POST" action="?/saveAppearance" enctype="multipart/form-data" class="space-y-4" use:enhance={submit}>
    <fieldset disabled={pending} class="space-y-4">
      {#key revision}
        <div class="grid gap-3 sm:grid-cols-2">
          <AppearanceUpload name="logo" label="页面左上角图片替换" current={appearance.logo} />
          <AppearanceUpload name="favicon" label="网址图标（favicon）" current={appearance.favicon} />
        </div>
        <p class="text-xs text-[var(--color-text-muted)]">
          图标：正方形 PNG，32～512 像素，不超过 512KB。网址图标建议 48×48 或
          96×96，供标签页、收藏夹和网址建议使用；浏览器可能缓存旧图标，地址栏安全标识不受此设置控制。
        </p>
        <label class="field-label">
          <span>鼠标指针模式</span>
          <select name="cursorMode" class="form-field" bind:value={mode}>
            <option value="inherit">自动选择（动态 → 静态 → 系统）</option>
            <option value="system">系统鼠标指针</option>
            <option value="static">静态鼠标指针（3 张 PNG）</option>
            <option value="animated">动态鼠标指针（6 张 GIF）</option>
          </select>
        </label>
        <p class="text-xs text-[var(--color-text-muted)]">
          静态 PNG 为 32×32；动态 GIF 为边长 32～128 像素的正方形，统一显示为 32×32。每张不超过
          256KB，建议透明背景。热点按显示尺寸计算，左上角为 (0,
          0)。两套图片分别保存，启用前需补齐对应图片。触屏保留系统行为，减少动画模式下不启用动态指针。
        </p>
        {#if mode === 'inherit'}
          <p class="rounded-xl bg-[var(--color-surface-muted)] p-3 text-xs text-[var(--color-text-muted)]">
            自动模式优先使用完整的动态指针，其次使用完整的静态指针；均未配置时尝试部署环境中的动态指针，最后使用系统指针。
          </p>
        {/if}
        {#each ['static', 'animated'] as const as kind}
          <details open={mode === kind} class="rounded-xl border border-[var(--color-border-soft)] p-3">
            <summary class="font-medium"
              >{kind === 'static' ? '静态鼠标指针 · 3 张 PNG' : '动态鼠标指针 · 6 张 GIF'}</summary
            >
            <div class="mt-3 grid gap-3 sm:grid-cols-2">
              {#each kind === 'static' ? staticStates : cursorStates as state}
                <AppearanceUpload
                  name={`${kind}_${state}`}
                  label={cursorLabels[state]}
                  current={appearance[kind][state]?.file}
                  cursor
                  animated={kind === 'animated'}
                  hotspot={appearance[kind][state]?.hotspot ??
                    (state === 'text' ? (kind === 'animated' ? [2, 5] : [16, 16]) : [0, 0])}
                />
              {/each}
            </div>
          </details>
        {/each}
      {/key}
      <p class="text-xs text-[var(--color-text-muted)]">
        动态“处理中”用于提交操作，“等待”用于页面跳转。图片载入失败时会保留系统指针。
      </p>
      <button type="submit" class="button button-primary button-full" disabled={pending}
        >{pending ? '正在保存…' : '保存图标与鼠标指针'}</button
      >
    </fieldset>
  </form>
</section>
