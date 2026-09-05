<script lang="ts">
  import { branding } from '$lib/branding';
  import AddSongPanel from '$lib/components/admin/AddSongPanel.svelte';
  import DataSettingsModal from '$lib/components/admin/DataSettingsModal.svelte';
  import NeteaseImportModal from '$lib/components/admin/NeteaseImportModal.svelte';
  import OverviewCard from '$lib/components/admin/OverviewCard.svelte';
  import RequestListCard from '$lib/components/admin/RequestListCard.svelte';
  import SettingsModal from '$lib/components/admin/SettingsModal.svelte';
  import SongListCard from '$lib/components/admin/SongListCard.svelte';
  import { hasAdminMessage, hasImportPreview, hasToastableError, startsOnNeteasePanel } from '$lib/admin/result';
  import { Tabs } from 'bits-ui';
  import { onMount, untrack } from 'svelte';
  import { toast } from 'svelte-sonner';

  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form?: import('$lib/admin/result').AdminActionResult | null } = $props();
  let importModalDismissed = $state(true);
  let dataSettingsModalOpen = $state(false);
  let settingsModalOpen = $state(false);
  let activeTab = $state('songs');
  let syncedHashTab = 'songs';
  let addPanelActive = $state(untrack(() => (startsOnNeteasePanel(form) ? 'netease' : 'manual')));

  const settingsError = $derived(form?.kind === 'profile-error' ? form.adminError : undefined);
  const importError = $derived(form?.kind === 'preview-import-error' ? form.adminError : undefined);

  onMount(() => {
    if (window.location.hash === '#requests') {
      activeTab = 'requests';
      syncedHashTab = 'requests';
    }
  });

  $effect(() => {
    if (hasAdminMessage(form)) toast.success(form.adminMessage);
    if (hasToastableError(form)) toast.error(form.adminError);
  });

  $effect(() => {
    if (form?.kind === 'profile-error') {
      settingsModalOpen = true;
    }
  });

  $effect(() => {
    if (hasImportPreview(form)) {
      importModalDismissed = false;
    }
  });

  $effect(() => {
    if (activeTab !== syncedHashTab) {
      syncedHashTab = activeTab;
      window.history.replaceState(null, '', `#${activeTab}`);
    }
  });
</script>

<svelte:head>
  <title>后台管理 | {branding.title}</title>
</svelte:head>

<div class="space-y-6">
  <OverviewCard
    overview={data.dashboard.overview}
    onOpenDataSettings={() => (dataSettingsModalOpen = true)}
    onOpenSettings={() => (settingsModalOpen = true)}
  />

  <Tabs.Root bind:value={activeTab} class="space-y-5">
    <Tabs.List class="admin-tabs-list inline-flex">
      <Tabs.Trigger value="songs" class="admin-tab-trigger">
        歌曲 <span class="admin-tab-count">{data.dashboard.songs.length}</span>
      </Tabs.Trigger>
      <Tabs.Trigger value="requests" class="admin-tab-trigger">
        愿望单 <span class="admin-tab-count">{data.dashboard.requests.length}</span>
      </Tabs.Trigger>
    </Tabs.List>

    <Tabs.Content value="songs" class="grid items-start gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
      <AddSongPanel bind:active={addPanelActive} {form} />
      <SongListCard songs={data.dashboard.songs} />
    </Tabs.Content>

    <Tabs.Content value="requests">
      <RequestListCard requests={data.dashboard.requests} />
    </Tabs.Content>
  </Tabs.Root>
</div>

<SettingsModal settings={data.dashboard.settings} adminError={settingsError} bind:open={settingsModalOpen} />
<DataSettingsModal bind:open={dataSettingsModalOpen} />

{#if hasImportPreview(form) && !importModalDismissed}
  <NeteaseImportModal
    preview={form.importPreview}
    adminError={importError}
    onClose={() => (importModalDismissed = true)}
  />
{/if}
