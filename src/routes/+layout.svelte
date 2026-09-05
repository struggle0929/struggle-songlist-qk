<script lang="ts">
  import '../app.css';
  import { getAutomaticCursorMode, hasCompleteCursorSet, resolveFavicon } from '$lib/appearance';
  import { branding, customCursorsEnabled, customCursors } from '$lib/branding';

  import { getCurrentYearInShanghai } from '$lib/datetime';
  import AnimatedCursor from '$lib/components/AnimatedCursor.svelte';
  import Header from '$lib/components/Header.svelte';
  import { Toaster } from 'svelte-sonner';

  import type { Snippet } from 'svelte';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: Snippet } = $props();
  const cursorConfig = $derived.by(() => {
    const appearance = data.appearance;
    if (appearance.mode === 'inherit') {
      const uploadedMode = getAutomaticCursorMode(appearance);
      if (uploadedMode) return { cursors: appearance[uploadedMode], animated: uploadedMode === 'animated' };
      return customCursorsEnabled ? { cursors: customCursors, animated: true } : null;
    }
    if (appearance.mode === 'system') return null;
    if (!hasCompleteCursorSet(appearance, appearance.mode)) return null;
    return { cursors: appearance[appearance.mode], animated: appearance.mode === 'animated' };
  });
  const currentYear = getCurrentYearInShanghai();
</script>

<svelte:head>
  <title>{branding.title}</title>
  <meta name="description" content={branding.description} />
  <link rel="icon" href={resolveFavicon(data.appearance, branding.icon)} />
</svelte:head>

<div class="flex min-h-screen flex-col">
  <div class="pointer-events-none fixed inset-0 -z-10 opacity-0 transition-opacity duration-300 dark:opacity-100">
    <div
      class="absolute top-[-18rem] left-[-14rem] h-[36rem] w-[36rem] rounded-full bg-[#2563eb]/20 blur-[120px]"
    ></div>
    <div class="absolute top-24 right-[-16rem] h-[34rem] w-[34rem] rounded-full bg-[#14b8a6]/10 blur-[120px]"></div>
  </div>

  <Header isAdmin={data.isAdmin} icon={data.appearance.logo || branding.icon} />

  <main class="mx-auto w-full max-w-7xl flex-1 px-4 pt-8 pb-16 lg:px-6 lg:pt-10">
    {@render children()}
  </main>

  <footer class="site-footer">
    <div class="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-6 lg:px-6">
      <p class="text-xs text-[var(--color-text-muted)]">
        © {currentYear}
        {branding.title}
      </p>
      <p class="text-xs text-[var(--color-text-muted)]">由 SvelteKit 驱动</p>
    </div>
  </footer>
</div>

<Toaster
  position="top-right"
  richColors
  closeButton
  toastOptions={{
    duration: 3000,
    classes: {
      toast: 'qk-toast'
    }
  }}
/>

{#key JSON.stringify(cursorConfig)}
  {#if cursorConfig}
    <AnimatedCursor cursors={cursorConfig.cursors} animated={cursorConfig.animated} />
  {/if}
{/key}
