import { getAuthDeps } from '../../../../../lib/auth/context';
import { createOAuthLaunch } from '../../../../../lib/auth/oauth';
import { errorResponse, jsonResponse } from '../../../../../lib/auth/route-utils';

export const dynamic = 'force-dynamic';

/** O proxy exige Host, Origin e Sec-Fetch-Site locais antes de emitir a passagem. */
export async function POST() {
  try {
    return jsonResponse({ launch_url: createOAuthLaunch(getAuthDeps()) });
  } catch (error) {
    return errorResponse(error);
  }
}
