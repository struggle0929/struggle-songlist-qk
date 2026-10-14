<script lang="ts">
  import {
    cursorLabels,
    cursorStates,
    staticStates,
    resolveHeaderText,
    formatSongRequest,
    type Appearance
  } from '$lib/appearance';
  import { page } from '$app/state';
  import { branding } from '$lib/branding';
  import AppearanceUpload from './AppearanceUpload.svelte';
  let { appearance }: { appearance: Appearance } = $props();
  const headerText = $derived(resolveHeaderText(appearance, { ...branding, title: branding.title }));
  let mode = $state<Appearance['mode']>('inherit');
  let prefix = $state('点歌');
  $effect(() => {
    mode = appearance.mode;
    prefix = appearance.requestPrefix;
  });
  const customized = $derived(
    Boolean(
      appearance.siteTitle ||
      appearance.siteDescription ||
      appearance.tagline ||
      appearance.headerTitle ||
      appearance.headerSubtitle ||
      appearance.logo ||
      appearance.favicon
    )
  );
  const modeLabel = $derived(
    { inherit: '自动选择', system: '系统指针', static: '静态指针', animated: '动态指针' }[mode]
  );
</script>

<details class="settings-section">
  <summary
    ><span>页面文字与图标</span><span class="settings-summary">{customized ? '已自定义' : '使用默认配置'}</span
    ></summary
  >
  <div class="settings-section-body space-y-4">
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="field-label"
        ><span>浏览器标题</span><input
          name="siteTitle"
          class="form-field"
          maxlength="80"
          value={appearance.siteTitle}
          placeholder={branding.title}
        /></label
      >
      <label class="field-label"
        ><span>首页说明</span><input
          name="tagline"
          class="form-field"
          maxlength="200"
          value={appearance.tagline}
          placeholder={branding.tagline}
        /></label
      >
      <label class="field-label sm:col-span-2"
        ><span>网页描述</span><input
          name="siteDescription"
          class="form-field"
          maxlength="300"
          value={appearance.siteDescription}
          placeholder={page.data.siteDescription}
        /></label
      >
      <label class="field-label"
        ><span>左上角标题</span><input
          name="headerTitle"
          class="form-field"
          maxlength="40"
          value={appearance.headerTitle}
          placeholder={headerText.title}
        /></label
      >
      <label class="field-label"
        ><span>左上角副标题</span><input
          name="headerSubtitle"
          class="form-field"
          maxlength="80"
          value={appearance.headerSubtitle}
          placeholder={headerText.subtitle}
        /></label
      >
    </div>
    <p class="text-xs text-[var(--color-text-muted)]">文字留空使用默认值；未选择新图片时保留原图片。</p>
    <div class="grid gap-3 sm:grid-cols-2">
      <AppearanceUpload name="logo" label="左上角图标" current={appearance.logo} />
      <AppearanceUpload name="favicon" label="网址图标" current={appearance.favicon} />
    </div>
    <details class="text-xs text-[var(--color-text-muted)]">
      <summary>查看图标要求</summary>
      <p class="mt-2">正方形 PNG，32～512 像素，不超过 512KB。网址图标建议 48×48 或 96×96；浏览器可能缓存旧图标。</p>
    </details>
  </div>
</details>

<details class="settings-section">
  <summary><span>鼠标指针</span><span class="settings-summary">{modeLabel}</span></summary>
  <div class="settings-section-body space-y-4">
    <label class="field-label"
      ><span>鼠标指针模式</span>
      <select name="cursorMode" class="form-field" bind:value={mode}>
        <option value="inherit">自动选择（动态 → 静态 → 系统）</option>
        <option value="system">系统鼠标指针</option>
        <option value="static">静态鼠标指针（3 张 PNG）</option>
        <option value="animated">动态鼠标指针（6 张 GIF）</option>
      </select>
    </label>
    <details class="text-xs text-[var(--color-text-muted)]">
      <summary>查看指针要求与自动选择规则</summary>
      <p class="mt-2">
        静态 PNG 为 32×32；动态 GIF 为边长 32～128 像素的正方形。每张不超过 256KB，建议透明背景；热点为
        0～31。自动模式依次使用完整的动态图片、静态图片、网站默认和系统指针。触屏保留系统行为，减少动画模式下不启用动态指针。
      </p>
    </details>
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
  </div>
</details>

<details class="settings-section">
  <summary><span>点歌复制格式</span><span class="settings-summary">{formatSongRequest('歌名', prefix)}</span></summary>
  <div class="settings-section-body space-y-3">
    <label class="field-label"
      ><span>点歌前缀</span><input
        name="requestPrefix"
        class="form-field"
        maxlength="20"
        bind:value={prefix}
        placeholder="点歌"
      /></label
    >
    <p class="rounded-xl bg-[var(--color-surface-muted)] p-3 text-sm" aria-live="polite">
      复制示例：{formatSongRequest('Butter-Fly', prefix)}
    </p>
    <div class="flex items-center justify-between gap-3">
      <p class="text-xs text-[var(--color-text-muted)]">留空使用默认“点歌”，自动在前缀和歌名之间添加一个空格。</p>
      <button type="button" class="button button-secondary shrink-0" onclick={() => (prefix = '点歌')}>恢复默认</button>
    </div>
  </div>
</details>
