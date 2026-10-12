import { getAuthDeps } from '@/lib/auth/context';
import { errorResponse, jsonResponse, readJsonBody } from '@/lib/auth/route-utils';
import { readPreferencesView } from '@/lib/sync/prefs';
import { savePreferences } from '@/lib/sync/service';

export const dynamic = 'force-dynamic';

/** Preferências de coleta: { modules, metadataOnly, storeRaw }, com o valor efetivo por endpoint. Não depende de conexão. */
export function GET() {
  try {
    return jsonResponse(readPreferencesView(getAuthDeps().db));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Grava as preferências (validação estrita; erros listam só os nomes dos campos). */
export async function PUT(request: Request) {
  try {
    const saved = savePreferences(getAuthDeps(), await readJsonBody(request));
    return jsonResponse({ ok: true, ...saved });
  } catch (error) {
    return errorResponse(error);
  }
}
