import { getAuthDeps } from '@/lib/auth/context';
import { errorResponse, jsonResponse } from '@/lib/auth/route-utils';
import { startCollection } from '@/lib/sync/service';

export const dynamic = 'force-dynamic';

/** Sincronizar novamente. Exige uma execução anterior concluída (409 no_previous_run). 202 com runId. */
export async function POST() {
  try {
    const runId = await startCollection(getAuthDeps(), 'resync');
    return jsonResponse({ ok: true, runId, status: 'running' }, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
