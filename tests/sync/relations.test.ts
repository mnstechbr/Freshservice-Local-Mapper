import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connections, resourceRelations, resources, syncRuns } from '../../src/lib/db/schema';
import { MODULE_ADAPTERS, getAdapter } from '../../src/lib/freshservice/modules';
import { RELATION_TARGETS, resolveRelationTargets } from '../../src/lib/sync/relations';
import { type AppTestDb, createAppTestDb, insertRealInstance } from '../helpers/app-db';

/**
 * M3 (docs/AUDITORIA-OPUS.md): resolução de relações por instância. Dados sintéticos, banco temporário.
 */
interface Seed {
  instA: number;
  instB: number;
  runA: number;
  runB: number;
  catA: number;
  catB: number;
  itemA: number;
  relOk: number;
  relMissing: number;
  relOtherInstance: number;
  relUnmapped: number;
}

function seed(t: AppTestDb): Seed {
  const now = Date.now();
  const instA = insertRealInstance(t.db, 'https://relacao-a.freshservice.com');
  const instB = insertRealInstance(t.db, 'https://relacao-b.freshservice.com');
  const connFor = (instanceId: number): number =>
    t.db
      .insert(connections)
      .values({ instanceId, authMode: 'api_key_personal', status: 'connected', createdAt: now, updatedAt: now })
      .returning({ id: connections.id })
      .get().id;
  const connA = connFor(instA);
  const connB = connFor(instB);
  const runFor = (instanceId: number, connectionId: number): number =>
    t.db
      .insert(syncRuns)
      .values({
        instanceId,
        connectionId,
        identityLabel: 'sintetico',
        kind: 'full',
        status: 'completed',
        startedAt: now,
        modulesRequested: ['service_catalog.items'],
      })
      .returning({ id: syncRuns.id })
      .get().id;
  const runA = runFor(instA, connA);
  const runB = runFor(instB, connB);

  const resourceFor = (instanceId: number, moduleKey: string, externalId: string, runId: number): number =>
    t.db
      .insert(resources)
      .values({ instanceId, moduleKey, externalId, firstSeenRunId: runId, lastSeenRunId: runId })
      .returning({ id: resources.id })
      .get().id;
  // O mesmo external_id existe nas duas instâncias: só o da instância da relação pode ser ligado.
  const catB = resourceFor(instB, 'service_catalog.categories', '101', runB);
  const catA = resourceFor(instA, 'service_catalog.categories', '101', runA);
  resourceFor(instB, 'service_catalog.categories', '202', runB);
  const itemA = resourceFor(instA, 'service_catalog.items', '1', runA);

  const relationFor = (toExternalRef: string, relationType: string): number =>
    t.db
      .insert(resourceRelations)
      .values({ instanceId: instA, fromResourceId: itemA, toExternalRef, relationType, runId: runA })
      .returning({ id: resourceRelations.id })
      .get().id;

  return {
    instA,
    instB,
    runA,
    runB,
    catA,
    catB,
    itemA,
    relOk: relationFor('101', 'category'),
    relMissing: relationFor('999', 'category'),
    relOtherInstance: relationFor('202', 'category'),
    relUnmapped: relationFor('101', 'tipo_fora_do_mapa'),
  };
}

function targetOf(t: AppTestDb, relationId: number): number | null {
  return (
    t.db
      .select({ to: resourceRelations.toResourceId })
      .from(resourceRelations)
      .where(eq(resourceRelations.id, relationId))
      .get()?.to ?? null
  );
}

describe('resolveRelationTargets (M3)', () => {
  let t: AppTestDb;

  beforeEach(() => {
    t = createAppTestDb();
  });

  afterEach(() => {
    t.close();
  });

  it('category_id liga ao recurso da mesma instância, nunca ao de outra com o mesmo external_id', () => {
    const s = seed(t);
    expect(resolveRelationTargets(t.db, s.instA, s.runA)).toEqual({ resolved: 1, unresolved: 3 });
    expect(targetOf(t, s.relOk)).toBe(s.catA);
    expect(targetOf(t, s.relOk)).not.toBe(s.catB);
  });

  it('alvo inexistente, alvo que só existe em outra instância e tipo fora do mapa ficam com to_resource_id nulo', () => {
    const s = seed(t);
    resolveRelationTargets(t.db, s.instA, s.runA);
    expect(targetOf(t, s.relMissing)).toBeNull();
    expect(targetOf(t, s.relOtherInstance)).toBeNull();
    expect(targetOf(t, s.relUnmapped)).toBeNull();
  });

  it('não cria nem remove recursos, e não toca relações de outro run', () => {
    const s = seed(t);
    const countResources = () => t.db.select({ id: resources.id }).from(resources).all().length;
    const before = countResources();

    expect(resolveRelationTargets(t.db, s.instB, s.runB)).toEqual({ resolved: 0, unresolved: 0 });
    expect(targetOf(t, s.relOk)).toBeNull();

    resolveRelationTargets(t.db, s.instA, s.runA);
    expect(countResources()).toBe(before);
  });

  it('é idempotente: relações já ligadas não são recontadas', () => {
    const s = seed(t);
    resolveRelationTargets(t.db, s.instA, s.runA);
    expect(resolveRelationTargets(t.db, s.instA, s.runA)).toEqual({ resolved: 0, unresolved: 3 });
    expect(targetOf(t, s.relOk)).toBe(s.catA);
  });
});

describe('RELATION_TARGETS é consistente com o registro de adaptadores', () => {
  const keys = new Set(MODULE_ADAPTERS.map((adapter) => adapter.key));

  it('toda origem e todo alvo do mapa existem no registro', () => {
    const problems: string[] = [];
    for (const [source, relations] of Object.entries(RELATION_TARGETS)) {
      if (!keys.has(source)) problems.push(`origem ausente: ${source}`);
      for (const [type, target] of Object.entries(relations)) {
        if (!keys.has(target)) problems.push(`alvo ausente: ${source}.${type} -> ${target}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('cada tipo mapeado é um relationFields declarado pelo adaptador de origem', () => {
    const problems: string[] = [];
    for (const [source, relations] of Object.entries(RELATION_TARGETS)) {
      const declared = new Set(Object.values(getAdapter(source)?.relationFields ?? {}));
      for (const type of Object.keys(relations)) {
        if (!declared.has(type)) problems.push(`${source}: tipo ${type} não declarado no adaptador`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('toda relação declarada em relationFields tem destino no mapa (sem relação que nunca será ligada)', () => {
    const problems: string[] = [];
    for (const adapter of MODULE_ADAPTERS) {
      for (const type of Object.values(adapter.relationFields)) {
        if (!RELATION_TARGETS[adapter.key]?.[type]) problems.push(`${adapter.key}: ${type} sem alvo no mapa`);
      }
    }
    expect(problems).toEqual([]);
  });
});
