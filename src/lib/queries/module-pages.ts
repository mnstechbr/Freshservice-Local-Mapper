import type { AppDb } from '@/lib/db/client';
import { parseResourceQuery, type ResourceQuery } from '@/lib/ui/filters';
import type { SearchParams } from './params';
import type { ActiveInstance } from './instances';
import { listApiModules, type ApiModuleRow } from './modules';
import { listResources, type ResourceListResult } from './resources';

export interface ModuleGroup {
  /** Módulo usado para filtrar recursos. Null: o segmento não tem módulo de coleta (nada é consultado). */
  moduleKey: string | null;
  /** Endpoints exibidos no painel de status. */
  moduleKeys: readonly string[];
}

export interface ModulePageData {
  query: ResourceQuery;
  apiRows: ApiModuleRow[];
  resources: ResourceListResult | null;
}

/**
 * Dados de uma página de módulo: estado de acesso dos endpoints do grupo e recursos da última execução.
 * Sem instância ativa nada é consultado.
 */
export function loadModulePage(
  db: AppDb,
  instance: ActiveInstance | null,
  params: SearchParams,
  group: ModuleGroup,
): ModulePageData {
  const query = parseResourceQuery(params);
  if (!instance) return { query, apiRows: [], resources: null };

  const apiRows = listApiModules(db, instance.id).filter((row) => group.moduleKeys.includes(row.moduleKey));
  const resources = group.moduleKey
    ? listResources(db, {
        instanceId: instance.id,
        module: group.moduleKey,
        search: query.q || null,
        status: query.status || null,
        sort: query.sort,
        dir: query.dir,
        page: query.page,
        pageSize: 10,
      })
    : null;
  return { query, apiRows, resources };
}
