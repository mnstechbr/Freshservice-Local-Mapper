import { getAuthDeps } from '../../../../lib/auth/context';
import { getStatus } from '../../../../lib/auth/connection';
import { errorResponse, jsonResponse } from '../../../../lib/auth/route-utils';

export const dynamic = 'force-dynamic';

/** Estado da conexão da instância ativa. Nunca devolve API key, tokens nem client_secret. */
export function GET() {
  try {
    return jsonResponse(getStatus(getAuthDeps()));
  } catch (error) {
    return errorResponse(error);
  }
}
