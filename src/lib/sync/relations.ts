import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import type { AppDb } from '../db/client';
import { resourceRelations, resources } from '../db/schema';

/*
 * M3: resolução de relações. Cada relação guarda o id externo do alvo (to_external_ref). Depois
 * do run, o alvo é ligado ao registro mapeado (to_resource_id) quando o módulo alvo já está no
 * banco da mesma instância. Mapa: módulo de origem -> (tipo da relação -> módulo alvo).
 * Tipos fora do mapa, ou alvos ainda não mapeados, ficam com to_resource_id nulo.
 * Os tipos vêm de relationFields de cada adaptador (src/lib/freshservice/modules/*.ts).
 */
export const RELATION_TARGETS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'tickets.tickets': {
    requester: 'users_groups.requesters',
    agent: 'users_groups.agents',
    agent_group: 'users_groups.agent_groups',
    department: 'users_groups.departments',
  },
  'itsm.problems': { department: 'users_groups.departments', agent_group: 'users_groups.agent_groups', agent: 'users_groups.agents' },
  'itsm.changes': { department: 'users_groups.departments', agent_group: 'users_groups.agent_groups', agent: 'users_groups.agents' },
  'itsm.releases': { department: 'users_groups.departments', agent_group: 'users_groups.agent_groups', agent: 'users_groups.agents' },
  'assets.assets': {
    asset_type: 'assets.asset_types',
    location: 'settings.locations',
    department: 'users_groups.departments',
    requester: 'users_groups.requesters',
  },
  'assets.asset_types': { asset_type: 'assets.asset_types' },
  'users_groups.agents': { location: 'settings.locations' },
  'users_groups.requesters': { location: 'settings.locations' },
  'service_catalog.items': { category: 'service_catalog.categories' },
  'knowledge_base.folders': { category: 'knowledge_base.categories' },
  'knowledge_base.articles': { folder: 'knowledge_base.folders' },
  'settings.locations': { location: 'settings.locations' },
  'settings.products': { asset_type: 'assets.asset_types' },
};

export interface RelationResolution {
  resolved: number;
  unresolved: number;
}

/** Liga as relações do run à instância. Só altera to_resource_id; não cria nem remove registros. */
export function resolveRelationTargets(db: AppDb, instanceId: number, runId: number): RelationResolution {
  return db.transaction((tx) => {
    const pending = tx
      .select({
        id: resourceRelations.id,
        sourceModule: resources.moduleKey,
        relationType: resourceRelations.relationType,
        ref: resourceRelations.toExternalRef,
      })
      .from(resourceRelations)
      .innerJoin(resources, eq(resources.id, resourceRelations.fromResourceId))
      .where(and(eq(resourceRelations.runId, runId), isNull(resourceRelations.toResourceId)))
      .all();

    // Um mapa externalId -> id por módulo alvo, lido uma vez por módulo.
    const lookups = new Map<string, Map<string, number>>();
    const lookupFor = (moduleKey: string): Map<string, number> => {
      const cached = lookups.get(moduleKey);
      if (cached) return cached;
      const map = new Map<string, number>();
      const rows = tx
        .select({ id: resources.id, externalId: resources.externalId })
        .from(resources)
        .where(and(eq(resources.instanceId, instanceId), eq(resources.moduleKey, moduleKey)))
        .all();
      for (const row of rows) map.set(row.externalId, row.id);
      lookups.set(moduleKey, map);
      return map;
    };

    let resolved = 0;
    let unresolved = 0;
    for (const row of pending) {
      const target = RELATION_TARGETS[row.sourceModule]?.[row.relationType];
      const targetId = target ? lookupFor(target).get(row.ref) : undefined;
      if (targetId === undefined) {
        unresolved += 1;
        continue;
      }
      tx.update(resourceRelations).set({ toResourceId: targetId }).where(eq(resourceRelations.id, row.id)).run();
      resolved += 1;
    }
    return { resolved, unresolved };
  });
}
