<script lang="ts">
  import { enhance, deserialize } from '$app/forms';
  import { tick, untrack } from 'svelte';
  import { createLocalPending } from '$lib/pending.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import { songLanguageItems, songStatusItems } from '$lib/select-options';
  import type { ImportPreview } from '$lib/types';
  import { Dialog } from 'bits-ui';
  import { musicProviderLabel } from '$lib/music-import';
  import TagInput from './TagInput.svelte';
  import { markImportDuplicates, type DuplicateReason } from '$lib/import-duplicates';

  let {
    preview,
    adminError,
    onClose,
    tags = [],
    existingSongs = []
  }: {
    preview: ImportPreview;
    adminError?: string;
    onClose: () => void;
    tags?: string[];
    existingSongs?: Array<{ title: string; artist: string }>;
  } = $props();

  const submit = createLocalPending();
  type PreviewRow = ImportPreview['songs'][number] & {
    manual: boolean;
    selected: boolean;
    duplicateReason?: DuplicateReason;
  };
  let rows = $state<PreviewRow[]>([]);
  let identifying = $state(false);
  let completed = $state(0);
  let total = $state(0);
  let identificationError = $state('');
  function needsReview(song: PreviewRow) {
    return !song.manual && (song.language === '其他' || song.languageSource === 'unknown');
  }
  const reviewCount = $derived(rows.filter(needsReview).length);
  const checkedCount = $derived(preview.songs.length - total + completed);
  const duplicateCount = $derived(rows.filter((song) => song.duplicateReason).length);
  const selectedCount = $derived(rows.filter((song) => song.selected).length);
  // Stable groups preserve source order. Avoid moving nonduplicate rows during lyric checks.
  const displayedRows = $derived.by(() => {
    const duplicates = rows.filter((song) => song.duplicateReason);
    const remaining = rows.filter((song) => !song.duplicateReason);
    return identifying
      ? [...duplicates, ...remaining]
      : [...duplicates, ...remaining.filter(needsReview), ...remaining.filter((song) => !needsReview(song))];
  });
  let controller: AbortController | undefined;
  let songList: HTMLDivElement | undefined;
  $effect(() => {
    rows = markImportDuplicates(
      preview.songs,
      untrack(() => existingSongs)
    ).map((song) => ({
      ...song,
      manual: false,
      selected: !song.duplicateReason
    }));
    const list = untrack(() => rows);
    completed = 0;
    identificationError = '';
    const provider = preview.provider ?? 'netease';
    const lyricId = (song: PreviewRow) => (provider === 'netease' ? song.neteaseId : song.lyricId);
    const candidates = untrack(() =>
      list.filter((song) => lyricId(song) && song.languageSource !== 'lyrics' && song.languageSource !== 'metadata')
    );
    total = candidates.length;
    const abort = new AbortController();
    controller = abort;
    identifying = candidates.length > 0;
    void (async () => {
      try {
        for (let i = 0; i < candidates.length && !abort.signal.aborted; i += 12) {
          const batch = candidates.slice(i, i + 12);
          const body = new FormData();
          body.set('provider', provider);
          body.set('ids', JSON.stringify(batch.map(lyricId)));
          const response = await fetch('?/identifyLanguages', {
            method: 'POST',
            body,
            signal: abort.signal,
            headers: { 'x-sveltekit-action': 'true' }
          });
          const result = deserialize(await response.text());
          if (result.type !== 'success' || !Array.isArray(result.data?.languageResults))
            throw new Error('歌词识别暂时中断，可重新打开预览重试，或手动核对后导入。');
          for (const item of result.data.languageResults as Array<{ id: string; language?: string }>) {
            if (!item.language) continue;
            for (const song of list) {
              if (lyricId(song) === item.id && !song.manual) {
                song.language = item.language;
                song.languageSource = 'lyrics';
              }
            }
          }
          completed += batch.length;
        }
      } catch (error) {
        if (!abort.signal.aborted)
          identificationError = error instanceof Error ? error.message : '歌词识别暂时不可用。';
      } finally {
        if (!abort.signal.aborted) {
          identifying = false;
          await tick();
          if (songList) songList.scrollTop = 0;
        }
      }
    })();
    return () => abort.abort();
  });
  async function stopIdentification() {
    controller?.abort();
    identifying = false;
    await tick();
    if (songList) songList.scrollTop = 0;
  }
</script>

<Dialog.Root
  open
  onOpenChange={(o) => {
    if (!o) onClose();
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay class="dialog-overlay" />
    <Dialog.Content class="dialog-content dialog-content-lg import-preview-dialog">
      <div class="dialog-header">
        <div>
          <Dialog.Title class="dialog-title">{musicProviderLabel(preview.provider)}歌单导入</Dialog.Title>
          <Dialog.Description class="dialog-description">勾选需要导入的歌曲，核对语言和标签后提交</Dialog.Description>
        </div>
        <Dialog.Close class="dialog-close" aria-label="关闭">
          <Icon name="close" size={18} />
        </Dialog.Close>
      </div>

      {#if adminError}
        <div class="alert alert-danger mb-5">{adminError}</div>
      {/if}

      <form
        method="POST"
        action="?/importPlaylist"
        class="flex min-h-0 flex-1 flex-col gap-4"
        use:enhance={submit.enhance}
      >
        <input type="hidden" name="sourceInput" value={preview.sourceInput} />
        <input type="hidden" name="provider" value={preview.provider ?? 'netease'} />
        <div class="grid shrink-0 gap-4 sm:grid-cols-2">
          <TagInput
            name="sharedTagsInput"
            suggestions={tags}
            value={preview.sharedTagsInput ?? ''}
            label="统一追加标签"
          />

          <label class="field-label">
            <span>状态</span>
            <Select name="status" value={preview.status} items={songStatusItems} />
          </label>
        </div>

        <div
          class="shrink-0 rounded-[18px] border border-[var(--color-accent-surface-border)] bg-[var(--color-accent-surface-bg)] px-4 py-3 text-sm text-[var(--color-text-secondary)]"
        >
          <p aria-live="polite">
            歌词检查：{checkedCount}/{preview.songs
              .length}；待核对：{reviewCount}{#if duplicateCount > 0}；重复：{duplicateCount}（默认不勾选）{/if}
          </p>
          {#if identifying}
            <button type="button" class="mt-2 text-xs underline" onclick={stopIdentification}>停止识别，手动核对</button
            >
          {/if}
          {#if identificationError}<p class="mt-2 text-xs">{identificationError}</p>{/if}
        </div>

        <div
          class="min-h-0 flex-1 overflow-auto rounded-[18px] border border-[var(--color-border-soft)]"
          data-song-list
          bind:this={songList}
        >
          <table class="w-full min-w-[760px] text-left text-sm">
            <thead
              class="sticky top-0 bg-[var(--color-surface)] text-xs tracking-[0.12em] text-[var(--color-text-muted)] uppercase"
            >
              <tr>
                <th class="w-12 px-3 py-3">选</th>
                <th class="px-3 py-3">歌曲</th>
                <th class="px-3 py-3">原唱</th>
                <th class="px-3 py-3">语言</th>
                <th class="px-3 py-3">标签</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[var(--color-border-soft)] bg-[var(--color-surface)]">
              {#each displayedRows as song, index (song)}
                <tr>
                  <td class="px-3 py-3 align-middle">
                    <div class="flex justify-center">
                      <input
                        name="selectedSong"
                        type="checkbox"
                        value={index}
                        class="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-accent)]"
                        bind:checked={song.selected}
                      />
                    </div>
                    <input type="hidden" name="songTitle" value={song.title} />
                    <input type="hidden" name="songArtist" value={song.artist} />
                  </td>
                  <td class="px-3 py-3 text-[var(--color-text)]">
                    {song.title}
                    {#if song.duplicateReason}
                      <p class="mt-1 text-xs text-[var(--color-text-muted)]">
                        {song.duplicateReason === 'existing' ? '重复：歌单中已有' : '重复：本次列表中已有'}
                      </p>
                    {/if}
                  </td>
                  <td class="px-3 py-3 text-[var(--color-text-secondary)]">{song.artist}</td>
                  <td class="px-3 py-3">
                    <Select
                      name="songLanguage"
                      required
                      bind:value={
                        () => song.language,
                        (value) => {
                          song.language = value ?? '其他';
                          song.manual = true;
                        }
                      }
                      items={songLanguageItems}
                      triggerClass="form-field-muted min-w-28"
                    />
                    <p class="mt-1 text-xs text-[var(--color-text-muted)]">
                      {song.manual
                        ? '手动选择'
                        : song.languageSource === 'lyrics'
                          ? '歌词识别'
                          : song.languageSource === 'metadata'
                            ? '平台信息'
                            : song.languageSource === 'title' || (!song.languageSource && song.language !== '其他')
                              ? '歌名推测'
                              : '待核对'}
                    </p>
                  </td>
                  <td class="px-3 py-3">
                    <input
                      name="songTagsInput"
                      class="form-field-muted min-w-48"
                      bind:value={song.tagsInput}
                      placeholder="例如：流行"
                    />
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <button
          type="submit"
          class="button button-primary button-full shrink-0"
          disabled={submit.pending || identifying || selectedCount === 0}
          data-pending={submit.pending || undefined}
        >
          导入勾选歌曲
        </button>
      </form>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
