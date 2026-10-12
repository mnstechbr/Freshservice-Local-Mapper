import { getAuthDeps } from '../../../../lib/auth/context';
import { reconnect } from '../../../../lib/auth/connection';
import { errorResponse, jsonResponse } from '../../../../lib/auth/route-utils';

export const dynamic = 'force-dynamic';

/** OAuth: devolve authorization_url e define o cookie de state. API key: revalida. */
export async function POST() {
  try {
    const { result, setCookie } = await reconnect(getAuthDeps());
    return jsonResponse(result, 200, setCookie);
  } catch (error) {
    return errorResponse(error);
  }
}
