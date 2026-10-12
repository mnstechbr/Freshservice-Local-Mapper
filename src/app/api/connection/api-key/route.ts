import { getAuthDeps } from '../../../../lib/auth/context';
import { saveApiKey } from '../../../../lib/auth/api-key';
import { errorResponse, jsonResponse, readJsonBody } from '../../../../lib/auth/route-utils';

export const dynamic = 'force-dynamic';

/** Body: { mode: "api_key_personal" | "api_key_integration", api_key: string }. */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    return jsonResponse(await saveApiKey(getAuthDeps(), body));
  } catch (error) {
    return errorResponse(error);
  }
}
