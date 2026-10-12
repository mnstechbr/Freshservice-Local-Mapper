import { AuthError } from '@/lib/auth/errors';
import { errorResponse, jsonResponse } from '@/lib/auth/route-utils';
import { getDb } from '@/lib/db/client';
import { CHANGE_TYPES, REVIEW_STATUSES, SEVERITIES } from '@/lib/db/schema';
import { listChanges } from '@/lib/queries/changes';
import { isModuleKey } from '@/lib/queries/module-filter';
import { getActiveInstance } from '@/lib/queries/instances';
import {
  dayEnd,
  dayStart,
  enumParam,
  firstParam,
  pageParam,
  type SearchParams,
  textParam,
} from '@/lib/queries/params';

export const dynamic = 'force-dynamic';

/** Lista as mudanças da instância ativa. Filtros: type, module, severity, review, from, to, page. */
export async function GET(request: Request) {
  try {
    const db = getDb();
    const instance = getActiveInstance(db);
    if (!instance) {
      return jsonResponse({ error: { code: 'no_active_instance', message: 'Nenhuma instância ativa.' } }, 409);
    }
    const params: SearchParams = Object.fromEntries(new URL(request.url).searchParams);
    const moduleKey = textParam(firstParam(params, 'module'), 64);
    // Chave inválida recebe 400 (sem eco do valor). Curingas como "*" nunca são aceitos.
    if (moduleKey !== null && !isModuleKey(moduleKey)) {
      throw new AuthError('invalid_input', 400, 'Campos inválidos: module.');
    }
    const result = listChanges(db, {
      instanceId: instance.id,
      type: enumParam(firstParam(params, 'type'), CHANGE_TYPES),
      module: moduleKey,
      severity: enumParam(firstParam(params, 'severity'), SEVERITIES),
      review: enumParam(firstParam(params, 'review'), REVIEW_STATUSES),
      from: dayStart(firstParam(params, 'from')),
      to: dayEnd(firstParam(params, 'to')),
      page: pageParam(firstParam(params, 'page')),
    });
    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
