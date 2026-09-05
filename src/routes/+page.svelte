<script lang="ts">
  import { branding } from '$lib/branding';
  import FilterPanel from '$lib/components/public/FilterPanel.svelte';
  import Hero from '$lib/components/public/Hero.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import RequestForm from '$lib/components/public/RequestForm.svelte';
  import SongTable from '$lib/components/public/SongTable.svelte';
  import { matchesSongKeyword, sortSongsByTitle, type SongTitleSortDirection } from '$lib/songs';
  import { type Song, type SongLanguage, type SongStatus } from '$lib/types';

  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form?: ActionData } = $props();

  let query = $state('');
  let selectedLanguage = $state<'all' | SongLanguage>('all');
  let selectedTag = $state<string>('all');
  let selectedStatus = $state<'all' | SongStatus>('all');
  let titleSortDirection = $state<SongTitleSortDirection>('asc');
  let selectedSongId = $state<Song['id'] | null>(null);
  let randomSelectionVersion = $state(0);

  const filteredSongs = $derived(
    data.catalog.songs.filter((song) => {
      const matchesLanguage = selectedLanguage === 'all' || song.language === selectedLanguage;
      const matchesTag = selectedTag === 'all' || song.tags.includes(selectedTag);
      const matchesStatus = selectedStatus === 'all' || song.status === selectedStatus;

      return matchesSongKeyword(song, query) && matchesLanguage && matchesTag && matchesStatus;
    })
  );
  const sortedSongs = $derived(sortSongsByTitle(filteredSongs, titleSortDirection));

  const selectRandomSong = () => {
    if (sortedSongs.length === 0) return;

    const randomSong = sortedSongs[Math.floor(Math.random() * sortedSongs.length)];
    selectedSongId = randomSong.id;
    randomSelectionVersion += 1;
  };

  const scrollToPageTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollToPageBottom = () => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  };
</script>

<svelte:head>
  <title>{branding.title}</title>
</svelte:head>

<div class="space-y-8 lg:space-y-10">
  <Hero catalog={data.catalog} />

  <section class="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
    <FilterPanel
      tags={data.catalog.tags}
      total={data.catalog.songs.length}
      filtered={sortedSongs.length}
      bind:query
      bind:language={selectedLanguage}
      bind:tag={selectedTag}
      bind:status={selectedStatus}
      onRandomSong={selectRandomSong}
    />

    <SongTable songs={sortedSongs} bind:titleSortDirection bind:selectedSongId {randomSelectionVersion} />
  </section>

  <RequestForm {form} />
</div>

<div class="page-jump-controls" aria-label="页面跳转">
  <button type="button" class="page-jump-button" aria-label="回到页面顶部" title="回到顶部" onclick={scrollToPageTop}>
    <Icon name="triangle-up" size={14} />
  </button>
  <button
    type="button"
    class="page-jump-button"
    aria-label="跳转到页面底部"
    title="跳转到底部"
    onclick={scrollToPageBottom}
  >
    <Icon name="triangle-down" size={14} />
  </button>
</div>
