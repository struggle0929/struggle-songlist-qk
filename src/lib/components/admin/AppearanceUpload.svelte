<script lang="ts">
  import { onDestroy } from 'svelte';
  let {
    name,
    label,
    current = '',
    animated = false,
    cursor = false,
    hotspot = [0, 0]
  }: {
    name: string;
    label: string;
    current?: string;
    animated?: boolean;
    cursor?: boolean;
    hotspot?: readonly number[];
  } = $props();
  let preview = $state('');
  let error = $state('');
  let generation = 0;
  function clear() {
    if (preview) URL.revokeObjectURL(preview);
    preview = '';
  }
  async function choose(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const token = ++generation;
    clear();
    error = '';
    const file = input.files?.[0];
    if (!file) return;
    if (file.type !== (animated ? 'image/gif' : 'image/png') || file.size > (cursor ? 256 : 512) * 1024) {
      error = `请选择不超过 ${cursor ? 256 : 512}KB 的 ${animated ? 'GIF' : 'PNG'} 图片。`;
      input.value = '';
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
      if (token !== generation) {
        URL.revokeObjectURL(url);
        return;
      }
      if (
        cursor
          ? animated
            ? image.naturalWidth !== image.naturalHeight || image.naturalWidth < 32 || image.naturalWidth > 128
            : image.naturalWidth !== 32 || image.naturalHeight !== 32
          : image.naturalWidth !== image.naturalHeight || image.naturalWidth < 32 || image.naturalWidth > 512
      ) {
        throw new Error(
          cursor
            ? animated
              ? '动态指针必须为边长 32～128 像素的正方形。'
              : '静态指针必须为 32×32 像素。'
            : '图标必须为边长 32～512 像素的正方形。'
        );
      }
      preview = url;
    } catch (cause) {
      URL.revokeObjectURL(url);
      if (token !== generation) return;
      error = cause instanceof Error ? cause.message : '无法读取图片。';
      input.value = '';
    }
  }
  onDestroy(() => {
    generation++;
    clear();
  });
</script>

<div class="space-y-3 rounded-xl border border-[var(--color-border-soft)] p-3">
  <label class="field-label">
    <span>{label}</span>
    {#if preview || current}
      <img
        src={preview || current}
        alt={`${label}预览`}
        width={cursor ? 32 : 48}
        height={cursor ? 32 : 48}
        class="rounded bg-[var(--color-surface-muted)] object-contain"
      />
    {/if}
    <input type="file" {name} accept={animated ? 'image/gif' : 'image/png'} class="form-field" onchange={choose} />
  </label>
  {#if error}<p role="alert" class="text-sm text-red-500">{error}</p>{/if}
  {#if cursor}
    <div class="flex gap-3">
      <label class="field-label"
        >热点 X<input
          class="form-field"
          type="number"
          name={`${name}_x`}
          min="0"
          max="31"
          step="1"
          required
          value={hotspot[0]}
        /></label
      >
      <label class="field-label"
        >热点 Y<input
          class="form-field"
          type="number"
          name={`${name}_y`}
          min="0"
          max="31"
          step="1"
          required
          value={hotspot[1]}
        /></label
      >
    </div>
  {:else if current}
    <label class="flex items-center gap-2 text-sm"
      ><input type="checkbox" name={`remove_${name}`} />移除已上传图片，恢复默认</label
    >
  {/if}
</div>
