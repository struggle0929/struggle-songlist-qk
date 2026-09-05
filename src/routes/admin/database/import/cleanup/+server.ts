import { cleanupImport, readLimitedJson } from '$lib/server/database-backup';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    await cleanupImport(await readLimitedJson(request));
  } catch {
    // Cleanup is best effort; the signed uploads are inaccessible without their token.
  }
  return json({ ok: true });
};
