import type { LayoutServerLoad } from './$types';
import { getSettings } from '$lib/server/settings';
import { getDemoCatalog, localDemo } from '$lib/server/demo';

export const load: LayoutServerLoad = async ({ locals }) => ({
  isAdmin: locals.isAdmin,
  appearance: (localDemo ? getDemoCatalog().settings : await getSettings()).appearance
});
