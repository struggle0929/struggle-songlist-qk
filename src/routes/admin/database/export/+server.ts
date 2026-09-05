import { createExportManifest, getBackupErrorMessage } from '$lib/server/database-backup';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    return json(await createExportManifest(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return json({ error: getBackupErrorMessage(error) }, { status: 500 });
  }
};
