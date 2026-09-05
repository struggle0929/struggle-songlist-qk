<script lang="ts">
  import Icon from '$lib/components/ui/Icon.svelte';
  import type { SongTitleSortDirection } from '$lib/songs';
  import { songStatusClasses } from '$lib/status-styles';
  import { songStatusLabels, type Song } from '$lib/types';
  import { toast } from 'svelte-sonner';

  let {
    songs,
    titleSortDirection = $bindable('asc'),
    selectedSongId = $bindable<Song['id'] | null>(null),
    randomSelectionVersion = 0
  }: {
    songs: Song[];
    titleSortDirection?: SongTitleSortDirection;
    selectedSongId?: Song['id'] | null;
    randomSelectionVersion?: number;
  } = $props();

  const songRowElements = new Map<Song['id'], HTMLElement>();
  let handledRandomSelectionVersion = 0;

  const toggleTitleSort = () => {
    titleSortDirection = titleSortDirection === 'asc' ? 'desc' : 'asc';
  };

  const fallbackCopyText = (text: string) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();

    if (!copied) {
      throw new Error('Copy command failed');
    }
  };

  const copySongRequest = async (song: Song) => {
    const text = `点歌 ${song.title}`;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        fallbackCopyText(text);
      }

      toast.success(`“${song.title}”成功复制到剪贴板！`, {
        duration: 3000,
        class: 'qk-copy-toast'
      });
    } catch {
      toast.error('复制失败，请手动复制歌名。');
    }
  };

  const selectAndCopySong = (song: Song) => {
    selectedSongId = song.id;
    void copySongRequest(song);
  };

  const handleSongRowKeydown = (event: KeyboardEvent, song: Song) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    selectAndCopySong(song);
  };

  const registerSongRow = (node: HTMLElement, songId: Song['id']) => {
    songRowElements.set(songId, node);

    return {
      destroy() {
        songRowElements.delete(songId);
      }
    };
  };

  $effect(() => {
    if (
      randomSelectionVersion === 0 ||
      randomSelectionVersion === handledRandomSelectionVersion ||
      selectedSongId === null
    ) {
      return;
    }

    handledRandomSelectionVersion = randomSelectionVersion;
    const song = songs.find((item) => item.id === selectedSongId);
    if (!song) return;

    setTimeout(() => {
      const row = songRowElements.get(song.id);
      const shouldScrollToSong = window.matchMedia('(min-width: 1024px)').matches;

      if (shouldScrollToSong) {
        row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }

      row?.focus({ preventScroll: true });
      void copySongRequest(song);
    }, 0);
  });
</script>

<div class="song-table">
  <div class="song-table-header">
    <button
      type="button"
      class="song-table-sort"
      aria-label={`按歌曲名${titleSortDirection === 'asc' ? '降序' : '升序'}排序`}
      title={`按歌曲名${titleSortDirection === 'asc' ? '降序' : '升序'}排序`}
      onclick={toggleTitleSort}
    >
      <span>歌曲名</span>
      <Icon
        name="arrow-down-up"
        size={14}
        class={`song-table-sort-icon ${titleSortDirection === 'desc' ? 'is-desc' : ''}`}
      />
    </button>
    <div>原唱</div>
    <div>语言</div>
    <div>当前状态</div>
    <div>标签</div>
  </div>

  {#if songs.length > 0}
    <div class="divide-y divide-[var(--color-border-soft)]">
      {#each songs as song (song.id)}
        <div
          class:song-row-selected={selectedSongId === song.id}
          class="song-row"
          role="button"
          tabindex="0"
          aria-label={`复制点歌 ${song.title}`}
          use:registerSongRow={song.id}
          onclick={() => selectAndCopySong(song)}
          onkeydown={(event) => handleSongRowKeydown(event, song)}
        >
          <div class="song-row-mobile">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h3 class="truncate text-base font-semibold text-[var(--color-text)]">{song.title}</h3>
                <p class="mt-1 truncate text-xs text-[var(--color-text-secondary)]">
                  {song.artist} · {song.language}
                </p>
              </div>
              <span class={`status-badge ${songStatusClasses[song.status]}`}>
                {songStatusLabels[song.status]}
              </span>
            </div>
            {#if song.tags.length > 0}
              <div class="mt-2.5 flex flex-wrap gap-1.5">
                {#each song.tags as tag}
                  <span class="tag-pill">{tag}</span>
                {/each}
              </div>
            {/if}
          </div>

          <div class="song-row-desktop">
            <h3 class="min-w-0 truncate text-sm font-medium text-[var(--color-text)]">{song.title}</h3>
            <p class="min-w-0 truncate text-sm text-[var(--color-text-secondary)]">{song.artist}</p>
            <p class="text-sm text-[var(--color-text-secondary)]">{song.language}</p>
            <div>
              <span class={`status-badge ${songStatusClasses[song.status]}`}>
                {songStatusLabels[song.status]}
              </span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              {#each song.tags as tag}
                <span class="tag-pill">{tag}</span>
              {/each}
            </div>
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <div class="song-empty">
      <Icon name="search-alt" size={28} strokeWidth={1.5} />
      <p class="mt-3 text-sm font-medium text-[var(--color-text-secondary)]">没有匹配的歌曲</p>
      <p class="mt-1 text-xs text-[var(--color-text-muted)]">试试放宽筛选或清空关键词</p>
    </div>
  {/if}
</div>
