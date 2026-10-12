import { getAuthDeps } from '@/lib/auth/context';
import { errorResponse, jsonResponse } from '@/lib/auth/route-utils';
import { cancelCollection } from '@/lib/sync/service';

export const dynamic = 'force-dynamic';

/** Pede o cancelamento da execução ativa da instância. 409 se não houver execução. */
export function POST() {
  try {
    cancelCollection(getAuthDeps());
    return jsonResponse({ ok: true, cancelRequested: true }, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
