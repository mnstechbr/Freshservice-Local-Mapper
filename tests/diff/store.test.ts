import { count, eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDb } from '@/lib/db/client';
import {
  changeMatches,
  connections,
  detectedChanges,
  instances,
  resources,
  resourceVersions,
  syncModuleResults,
  syncRuns,
} from '@/lib/db/schema';
import {
  ChangeReviewError,
  compareRuns,
  detectChangesForRun,
  getIdLineage,
  reviewChange,
} from '@/lib/diff';
import { contentHashOf } from '@/lib/diff/canonical';
import { createAppTestDb, type AppTestDb } from '../helpers/app-db';
import { catalogBody } from './fixtures';

/*
 * Cenário sintético em três execuções (r1, r2, r3):
 * - 32 "Instalação de software" existe em r1; em r2 o mesmo item aparece com ID 25 (troca de ID).
 * - 40 "Acesso VPN" existe nas três; só muda um campo volátil entre r1 e r2.
 * - 50 "Impressora" existe só em r1 (removido em r2).
 * - 25 é renomeado para "Instalação de Software homologado" em r3.
 */

interface Seeded {
  instanceId: number;
  r1: number;
  r2: number;
  r3: number;
  res32: number;
  res40: number;
  res50: number;
  res25: number;
  ver32_1: number;
  ver40_1: number;
  ver40_2: number;
  ver50_1: number;
  ver25_2: number;
  ver25_3: number;
}

function seed(db: AppDb): Seeded {
  const now = 1_000_000;
  const instanceId = db
    .insert(instances)
    .values({ baseUrl: 'https://sintetico.invalid', displayName: 'Instância sintética', isDemo: true, createdAt: now, updatedAt: now })
    .returning({ id: instances.id })
    .get().id;
  const connectionId = db
    .insert(connections)
    .values({ instanceId, authMode: 'api_key_personal', status: 'connected', createdAt: now, updatedAt: now })
    .returning({ id: connections.id })
    .get().id;

  const newRun = (startedAt: number): number =>
    db
      .insert(syncRuns)
      .values({
        instanceId,
        connectionId,
        identityLabel: 'sintetico',
        kind: 'full',
        status: 'completed',
        startedAt,
        finishedAt: startedAt + 1,
        modulesRequested: ['service_catalog'],
      })
      .returning({ id: syncRuns.id })
      .get().id;
  const r1 = newRun(1000);
  const r2 = newRun(2000);
  const r3 = newRun(3000);
  for (const runId of [r1, r2, r3]) {
    db.insert(syncModuleResults)
      .values({ runId, moduleKey: 'service_catalog', status: 'completed', complete: true })
      .run();
  }

  const resource = (externalId: string, first: number, last: number, name: string, category: string): number =>
    db
      .insert(resources)
      .values({
        instanceId,
        moduleKey: 'service_catalog',
        externalId,
        workspaceId: 1,
        firstSeenRunId: first,
        lastSeenRunId: last,
        currentName: name,
        currentCategory: category,
      })
      .returning({ id: resources.id })
      .get().id;
  const version = (resourceId: number, runId: number, name: string, category: string, normalized: Record<string, unknown>): number =>
    db
      .insert(resourceVersions)
      .values({
        resourceId,
        runId,
        contentHash: contentHashOf(normalized, 'service_catalog'),
        name,
        category,
        normalizedJson: normalized,
        capturedAt: now,
      })
      .returning({ id: resourceVersions.id })
      .get().id;

  const body32 = catalogBody('Instalação de software');
  const res32 = resource('32', r1, r1, 'Instalação de software', 'Software');
  const ver32_1 = version(res32, r1, 'Instalação de software', 'Software', body32);

  const body40 = catalogBody('Acesso VPN');
  const res40 = resource('40', r1, r3, 'Acesso VPN', 'Rede');
  const ver40_1 = version(res40, r1, 'Acesso VPN', 'Rede', body40);
  const ver40_2 = version(res40, r2, 'Acesso VPN', 'Rede', { ...body40, updated_at: '2026-02-02' });
  version(res40, r3, 'Acesso VPN', 'Rede', { ...body40, updated_at: '2026-03-03' });

  const res50 = resource('50', r1, r1, 'Impressora', 'Hardware');
  const ver50_1 = version(res50, r1, 'Impressora', 'Hardware', catalogBody('Impressora'));

  const res25 = resource('25', r2, r3, 'Instalação de Software homologado', 'Software');
  const ver25_2 = version(res25, r2, 'Instalação de software', 'Software', body32);
  const ver25_3 = version(res25, r3, 'Instalação de Software homologado', 'Software', {
    ...body32,
    name: 'Instalação de Software homologado',
  });

  return { instanceId, r1, r2, r3, res32, res40, res50, res25, ver32_1, ver40_1, ver40_2, ver50_1, ver25_2, ver25_3 };
}

let env: AppTestDb;
let s: Seeded;

beforeEach(() => {
  env = createAppTestDb();
  s = seed(env.db);
});

afterEach(() => {
  env.close();
});

const changesOf = (runId: number, baseRunId: number) =>
  env.db
    .select()
    .from(detectedChanges)
    .where(eq(detectedChanges.runId, runId))
    .all()
    .filter((c) => c.baseRunId === baseRunId);

describe('detectChangesForRun (banco)', () => {
  it('detecta troca de ID e remoção entre r2 e r1, e grava o par', () => {
    const { changesCount } = detectChangesForRun(env.db, { runId: s.r2, baseRunId: s.r1 }, { now: 5000 });
    const rows = changesOf(s.r2, s.r1);
    expect(changesCount).toBe(2);
    expect(rows.map((r) => r.changeType).sort()).toEqual(['possible_id_change', 'removed']);
    const id = rows.find((r) => r.changeType === 'possible_id_change');
    expect(id).toMatchObject({ previousExternalId: '32', currentExternalId: '25', reviewStatus: 'pending', severity: 'high' });
    expect(id?.evidence).toMatchObject({ snapshotSource: { base: 'fallback', current: 'fallback' } });
    const matches = env.db.select().from(changeMatches).where(eq(changeMatches.changeId, id?.id ?? -1)).all();
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ status: 'suggested', oldResourceId: s.res32, newResourceId: s.res25 });
    expect(matches[0].score).toBeGreaterThanOrEqual(0.75);
    const run = env.db.select().from(syncRuns).where(eq(syncRuns.id, s.r2)).get();
    expect(run).toMatchObject({ changesCount: 2, comparedToRunId: s.r1 });
  });

  it('é idempotente: rodar de novo o mesmo par não duplica linhas', () => {
    detectChangesForRun(env.db, { runId: s.r2, baseRunId: s.r1 }, { now: 5000 });
    const before = changesOf(s.r2, s.r1).length;
    const second = detectChangesForRun(env.db, { runId: s.r2, baseRunId: s.r1 }, { now: 6000 });
    expect(second.changesCount).toBe(before);
    expect(changesOf(s.r2, s.r1)).toHaveLength(before);
    const matchCount = env.db.select({ value: count() }).from(changeMatches).get()?.value;
    expect(matchCount).toBe(1);
  });

  it('name_changed entre r3 e r2, e nada para o campo volátil de 40', () => {
    const { changesCount } = detectChangesForRun(env.db, { runId: s.r3, baseRunId: s.r2 });
    expect(changesCount).toBe(1);
    expect(changesOf(s.r3, s.r2)[0]).toMatchObject({
      changeType: 'name_changed',
      previousName: 'Instalação de software',
      currentName: 'Instalação de Software homologado',
      severity: 'medium',
    });
  });

  it('base nula: sem comparação, sem linhas e changes_count zero', () => {
    const { changesCount } = detectChangesForRun(env.db, { runId: s.r1, baseRunId: null });
    expect(changesCount).toBe(0);
    const run = env.db.select().from(syncRuns).where(eq(syncRuns.id, s.r1)).get();
    expect(run).toMatchObject({ changesCount: 0, comparedToRunId: null });
  });

  it('rejeita base igual ou posterior à execução comparada', () => {
    expect(() => detectChangesForRun(env.db, { runId: s.r1, baseRunId: s.r2 })).toThrow(/anterior/);
  });

  it('usa resource_observations (migration 0002) quando a execução tem observações (fonte exata)', () => {
    const rows: Array<[number, number, number]> = [
      [s.r1, s.res32, s.ver32_1],
      [s.r1, s.res40, s.ver40_1],
      [s.r1, s.res50, s.ver50_1],
      [s.r2, s.res25, s.ver25_2],
      [s.r2, s.res40, s.ver40_2],
    ];
    for (const [runId, resourceId, versionId] of rows) {
      env.db.run(sql`insert into resource_observations (run_id, resource_id, version_id) values (${runId}, ${resourceId}, ${versionId})`);
    }
    detectChangesForRun(env.db, { runId: s.r2, baseRunId: s.r1 });
    const types = changesOf(s.r2, s.r1).map((r) => r.changeType).sort();
    expect(types).toEqual(['possible_id_change', 'removed']);
    expect(changesOf(s.r2, s.r1)[0].evidence).toMatchObject({ snapshotSource: { base: 'observations', current: 'observations' } });
  });
});

describe('compareRuns (sem gravar)', () => {
  it('compara execuções não consecutivas (r1 vs r3) sem criar linhas', () => {
    const before = env.db.select({ value: count() }).from(detectedChanges).get()?.value;
    const result = compareRuns(env.db, s.r1, s.r3);
    const after = env.db.select({ value: count() }).from(detectedChanges).get()?.value;
    expect(after).toBe(before);
    const idChange = result.changes.find((c) => c.changeType === 'possible_id_change');
    expect(idChange).toMatchObject({ previousExternalId: '32', currentExternalId: '25' });
    expect(result.changes.filter((c) => c.changeType === 'removed').map((c) => c.previousExternalId)).toEqual(['50']);
  });

  it('runs de instâncias diferentes são recusadas', () => {
    const now = 1;
    const other = env.db
      .insert(instances)
      .values({ baseUrl: 'https://outra.invalid', displayName: 'Outra', isDemo: true, createdAt: now, updatedAt: now })
      .returning({ id: instances.id })
      .get().id;
    const connectionId = env.db
      .insert(connections)
      .values({ instanceId: other, authMode: 'api_key_personal', status: 'connected', createdAt: now, updatedAt: now })
      .returning({ id: connections.id })
      .get().id;
    const otherRun = env.db
      .insert(syncRuns)
      .values({ instanceId: other, connectionId, identityLabel: 'x', kind: 'full', status: 'completed', startedAt: now, modulesRequested: [] })
      .returning({ id: syncRuns.id })
      .get().id;
    expect(() => compareRuns(env.db, s.r1, otherRun)).toThrow(/instâncias/);
  });
});

describe('revisão e linhagem de IDs', () => {
  it('confirmar fixa o par: sem removed/added do par e linhagem consultável', () => {
    detectChangesForRun(env.db, { runId: s.r2, baseRunId: s.r1 }, { now: 5000 });
    const id = changesOf(s.r2, s.r1).find((r) => r.changeType === 'possible_id_change')?.id ?? -1;

    const outcome = reviewChange(env.db, id, { decision: 'confirm' }, { now: 7000 });
    expect(outcome.decision).toMatchObject({ oldResourceId: s.res32, newResourceId: s.res25, status: 'confirmed' });

    const rows = changesOf(s.r2, s.r1);
    const confirmed = rows.find((r) => r.changeType === 'possible_id_change');
    expect(confirmed).toMatchObject({ reviewStatus: 'confirmed' });
    expect(rows.filter((r) => r.changeType === 'removed').map((r) => r.previousExternalId)).toEqual(['50']);
    expect(rows.some((r) => r.changeType === 'added')).toBe(false);

    const lineage = getIdLineage(env.db, s.res32);
    expect(lineage.nodes.map((n) => n.externalId).sort()).toEqual(['25', '32']);
    expect(lineage.links).toEqual([expect.objectContaining({ oldResourceId: s.res32, newResourceId: s.res25 })]);
  });

  it('rejeitar reclassifica: removed do antigo e added do novo, e a decisão sobrevive a nova detecção', () => {
    detectChangesForRun(env.db, { runId: s.r2, baseRunId: s.r1 }, { now: 5000 });
    const id = changesOf(s.r2, s.r1).find((r) => r.changeType === 'possible_id_change')?.id ?? -1;
    reviewChange(env.db, id, { decision: 'reject' });

    const check = () => {
      const rows = changesOf(s.r2, s.r1);
      expect(rows.find((r) => r.changeType === 'possible_id_change')).toMatchObject({ reviewStatus: 'rejected' });
      expect(rows.filter((r) => r.changeType === 'removed').map((r) => r.previousExternalId).sort()).toEqual(['32', '50']);
      expect(rows.filter((r) => r.changeType === 'added').map((r) => r.currentExternalId)).toEqual(['25']);
    };
    check();
    detectChangesForRun(env.db, { runId: s.r2, baseRunId: s.r1 });
    check();
    expect(getIdLineage(env.db, s.res32).links).toEqual([]);
  });

  it('reprocessar o par não muda ids das mudanças', () => {
    detectChangesForRun(env.db, { runId: s.r2, baseRunId: s.r1 }, { now: 5000 });
    const ids = (): Array<[number, string, string | null, string | null]> =>
      changesOf(s.r2, s.r1).map((r) => [r.id, r.changeType, r.previousExternalId, r.currentExternalId]);
    const before = ids();
    detectChangesForRun(env.db, { runId: s.r2, baseRunId: s.r1 }, { now: 6000 });
    expect(ids()).toEqual(before);
  });

  it('confirmar mantém o id da mudança revisada e muda só o status', () => {
    detectChangesForRun(env.db, { runId: s.r2, baseRunId: s.r1 }, { now: 5000 });
    const id = changesOf(s.r2, s.r1).find((r) => r.changeType === 'possible_id_change')?.id ?? -1;
    expect(reviewChange(env.db, id, { decision: 'confirm' }, { now: 7000 })).toMatchObject({ changeId: id, status: 'confirmed' });
    detectChangesForRun(env.db, { runId: s.r2, baseRunId: s.r1 }, { now: 8000 });
    expect(env.db.select().from(detectedChanges).where(eq(detectedChanges.id, id)).get()).toMatchObject({ reviewStatus: 'confirmed' });
  });

  it('rejeitar mudança pendente muda o status para rejected no mesmo id', () => {
    detectChangesForRun(env.db, { runId: s.r2, baseRunId: s.r1 }, { now: 5000 });
    const id = changesOf(s.r2, s.r1).find((r) => r.changeType === 'possible_id_change')?.id ?? -1;
    expect(reviewChange(env.db, id, { decision: 'reject' })).toMatchObject({ changeId: id, status: 'rejected' });
    expect(env.db.select().from(detectedChanges).where(eq(detectedChanges.id, id)).get()).toMatchObject({ reviewStatus: 'rejected' });
  });

  it('rejeitar mudança já confirmada e trocar a decisão mantêm o mesmo id', () => {
    detectChangesForRun(env.db, { runId: s.r2, baseRunId: s.r1 }, { now: 5000 });
    const id = changesOf(s.r2, s.r1).find((r) => r.changeType === 'possible_id_change')?.id ?? -1;
    reviewChange(env.db, id, { decision: 'confirm' });
    expect(reviewChange(env.db, id, { decision: 'reject' })).toMatchObject({ changeId: id, status: 'rejected' });
    expect(reviewChange(env.db, id, { decision: 'confirm' })).toMatchObject({ changeId: id, status: 'confirmed' });
    const rows = changesOf(s.r2, s.r1);
    expect(rows.filter((r) => r.changeType === 'possible_id_change').map((r) => r.id)).toEqual([id]);
    expect(rows.some((r) => r.changeType === 'added' && r.currentExternalId === '25')).toBe(false);
  });

  it('erros de revisão: inexistente e não revisável', () => {
    expect(() => reviewChange(env.db, 999_999, { decision: 'confirm' })).toThrow(ChangeReviewError);
    detectChangesForRun(env.db, { runId: s.r2, baseRunId: s.r1 });
    const removed = changesOf(s.r2, s.r1).find((r) => r.changeType === 'removed');
    try {
      reviewChange(env.db, removed?.id ?? -1, { decision: 'confirm' });
      expect.unreachable('deveria falhar');
    } catch (error) {
      expect(error).toMatchObject({ code: 'not_reviewable' });
    }
  });
});
