import { getAuthDeps } from '@/lib/auth/context';
import { errorResponse, jsonResponse } from '@/lib/auth/route-utils';
import { startCollection } from '@/lib/sync/service';

export const dynamic = 'force-dynamic';

/** "Mapear tudo": inicia a coleta dos módulos das preferências em segundo plano. 202 com runId. */
export async function POST() {
  try {
    const runId = await startCollection(getAuthDeps(), 'full');
    return jsonResponse({ ok: true, runId, status: 'running' }, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
