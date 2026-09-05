<script lang="ts">
  import { onMount } from 'svelte';
  import { navigating } from '$app/state';
  import { pendingActions } from '$lib/pending.svelte';
  import { cursorStates, type CursorState as CursorName } from '$lib/appearance';
  let {
    cursors,
    animated = true
  }: {
    cursors: Partial<Record<CursorName, { file: string; hotspot: readonly [number, number] }>>;
    animated?: boolean;
  } = $props();

  const cursorNames = new Set<CursorName>(cursorStates);
  const disabledSelector = ':disabled, [aria-disabled="true"], [data-disabled]';
  const interactiveSelector = [
    'a[href]',
    'area[href]',
    'button',
    'select',
    'summary',
    'label[for]',
    '.button',
    '.select-item',
    '.select-trigger',
    '.song-row',
    '.song-table-sort',
    '[aria-haspopup]',
    '[role="button"]',
    '[role="checkbox"]',
    '[role="combobox"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="radio"]',
    '[role="slider"]',
    '[role="spinbutton"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="treeitem"]',
    'input[type="button"]',
    'input[type="checkbox"]',
    'input[type="color"]',
    'input[type="file"]',
    'input[type="image"]',
    'input[type="radio"]',
    'input[type="range"]',
    'input[type="reset"]',
    'input[type="submit"]'
  ].join(',');
  const textSelector = [
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'li',
    'dt',
    'dd',
    'th',
    'td',
    'label',
    'small',
    'strong',
    'em',
    'code',
    'pre',
    'input:not([type])',
    'input[type="date"]',
    'input[type="datetime-local"]',
    'input[type="email"]',
    'input[type="month"]',
    'input[type="number"]',
    'input[type="password"]',
    'input[type="search"]',
    'input[type="tel"]',
    'input[type="text"]',
    'input[type="time"]',
    'input[type="url"]',
    'input[type="week"]',
    'textarea',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]'
  ].join(',');

  let cursorElement: HTMLImageElement;
  let cursorName = $state<CursorName>('default');
  let visible = $state(false);
  let target: Element | null = null;
  let x = 0;
  let y = 0;

  function findCursor(target: Element | null): CursorName {
    if (animated && navigating.to) return cursors.wait ? 'wait' : 'progress';
    if (animated && pendingActions.size) return 'progress';
    if (!target) return 'default';

    const explicitCursor = target.closest<HTMLElement>('[data-cursor]')?.dataset.cursor;
    if (explicitCursor && cursorNames.has(explicitCursor as CursorName)) {
      return explicitCursor as CursorName;
    }

    if (animated && target.closest('[data-pending="true"], [aria-busy="true"]')) return 'progress';
    if (target.closest(disabledSelector)) return 'not-allowed';
    if (target.closest(interactiveSelector)) return 'pointer';
    if (target.closest(textSelector)) return 'text';
    return 'default';
  }

  function renderPosition() {
    const [hotspotX, hotspotY] = cursors[cursorName]?.hotspot ?? [0, 0];
    cursorElement.style.transform = `translate3d(${x - hotspotX}px, ${y - hotspotY}px, 0)`;
  }

  $effect(() => {
    // Re-evaluate even while the mouse is stationary during submissions/navigation.
    void navigating.to;
    void pendingActions.size;
    if (visible && cursorElement) {
      cursorName = findCursor(target);
      renderPosition();
    }
  });

  onMount(() => {
    const finePointer = window.matchMedia('(pointer: fine)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let active = false;
    let ready = false;
    let disposed = false;

    const setActive = () => {
      active = ready && finePointer.matches && (!animated || !reducedMotion.matches);
      if (!active) hide();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!active || event.pointerType === 'touch') return;

      x = event.clientX;
      y = event.clientY;
      target = event.target instanceof Element ? event.target : null;
      cursorName = findCursor(target);
      if (!cursors[cursorName]?.file) {
        hide();
        return;
      }
      visible = true;
      document.documentElement.classList.add('animated-cursor-active');
      renderPosition();
    };

    const handlePointerOut = (event: PointerEvent) => {
      if (!event.relatedTarget) hide();
    };

    const hide = () => {
      visible = false;
      document.documentElement.classList.remove('animated-cursor-active');
    };

    const preloadedImages: HTMLImageElement[] = [];
    Promise.all(
      Object.values(cursors).map(
        ({ file }) =>
          new Promise<void>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve();
            image.onerror = () => reject(new Error('Cursor image failed to load'));
            preloadedImages.push(image);
            image.src = file;
          })
      )
    )
      .then(() => {
        if (disposed) return;
        ready = true;
        setActive();
      })
      .catch(() => {
        if (!disposed) hide();
      });

    finePointer.addEventListener('change', setActive);
    reducedMotion.addEventListener('change', setActive);
    document.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.addEventListener('pointerout', handlePointerOut, { passive: true });
    window.addEventListener('blur', hide);

    return () => {
      disposed = true;
      for (const image of preloadedImages) {
        image.onload = null;
        image.onerror = null;
      }
      preloadedImages.length = 0;
      document.documentElement.classList.remove('animated-cursor-active');
      finePointer.removeEventListener('change', setActive);
      reducedMotion.removeEventListener('change', setActive);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerout', handlePointerOut);
      window.removeEventListener('blur', hide);
    };
  });
</script>

<img
  bind:this={cursorElement}
  class:visible
  class="animated-cursor"
  src={cursors[cursorName]?.file || cursors.default?.file}
  alt=""
  aria-hidden="true"
/>

<style>
  .animated-cursor {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 2147483647;
    width: var(--animated-cursor-size, 32px);
    height: var(--animated-cursor-size, 32px);
    pointer-events: none;
    visibility: hidden;
    object-fit: contain;
    will-change: transform;
  }

  .animated-cursor.visible {
    visibility: visible;
  }

  @media (pointer: coarse) {
    .animated-cursor {
      display: none;
    }
  }
</style>
