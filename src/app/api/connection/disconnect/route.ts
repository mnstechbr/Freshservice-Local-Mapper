import { getAuthDeps } from '../../../../lib/auth/context';
import { disconnect } from '../../../../lib/auth/connection';
import { errorResponse, jsonResponse } from '../../../../lib/auth/route-utils';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    return jsonResponse(await disconnect(getAuthDeps()));
  } catch (error) {
    return errorResponse(error);
  }
}
