import type { BeforeSendEvent } from '@vercel/analytics/sveltekit';

export function publicPageView(event: BeforeSendEvent): BeforeSendEvent | null {
  if (event.type !== 'pageview') return null;
  try {
    const url = new URL(event.url);
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return null;
    url.search = '';
    url.hash = '';
    return { ...event, url: url.href };
  } catch {
    return null;
  }
}
