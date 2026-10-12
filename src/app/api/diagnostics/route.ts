import { getAuthDeps } from '@/lib/auth/context';
import { requireActiveInstance } from '@/lib/auth/instances';
import { errorResponse, jsonResponse } from '@/lib/auth/route-utils';
import { listDiagnostics, startDiagnostics } from '@/lib/sync/diagnostics';
import { requireDiagnosticsStart } from '@/lib/sync/service';

export const dynamic = 'force-dynamic';

/** Estado de acesso de cada adaptador da instância ativa (sem chamadas à API). */
export function GET() {
  try {
    const deps = getAuthDeps();
    const instance = requireActiveInstance(deps);
    return jsonResponse({ instanceId: instance.id, ...listDiagnostics(deps.db, instance.id) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Executa o diagnóstico em segundo plano (um GET por módulo). 202; o resultado aparece no GET. */
export function POST() {
  try {
    const deps = getAuthDeps();
    const instance = requireDiagnosticsStart(deps);
    startDiagnostics({ db: deps.db, auth: deps, instanceId: instance.id });
    return jsonResponse({ ok: true, running: true }, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
