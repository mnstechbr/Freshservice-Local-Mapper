import { getAuthDeps } from '@/lib/auth/context';
import { errorResponse, jsonResponse } from '@/lib/auth/route-utils';
import { collectionStatus } from '@/lib/sync/service';

export const dynamic = 'force-dynamic';

/** Progresso do run ativo e a última execução da instância. Nunca devolve segredos. */
export function GET() {
  try {
    return jsonResponse(collectionStatus(getAuthDeps()));
  } catch (error) {
    return errorResponse(error);
  }
}
