import { getAuthDeps } from '../../../lib/auth/context';
import { createInstance, listInstances } from '../../../lib/auth/instances';
import { errorResponse, jsonResponse, readJsonBody } from '../../../lib/auth/route-utils';

// Lê o banco a cada requisição (nunca pré-renderizado no build).
export const dynamic = 'force-dynamic';

export function GET() {
  try {
    return jsonResponse(listInstances(getAuthDeps()));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Cadastra ou reativa uma instância (https, *.freshservice.com por padrão). */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const result = await createInstance(getAuthDeps(), body);
    return jsonResponse(result, result.created ? 201 : 200);
  } catch (error) {
    return errorResponse(error);
  }
}
