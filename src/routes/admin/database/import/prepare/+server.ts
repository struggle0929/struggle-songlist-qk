import { getBackupErrorMessage, prepareImport, readLimitedJson } from '$lib/server/database-backup';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    return json(await prepareImport(await readLimitedJson(request)));
  } catch (error) {
    return json({ error: getBackupErrorMessage(error) }, { status: 400 });
  }
};
