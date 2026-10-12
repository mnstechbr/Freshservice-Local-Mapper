import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as postReview } from '@/app/api/changes/[id]/review/route';
import { POST as postApiKey } from '@/app/api/connection/api-key/route';
import { POST as postDisconnect } from '@/app/api/connection/disconnect/route';
import { GET as getStatus } from '@/app/api/connection/status/route';
import { GET as getDiagnostics, POST as postDiagnostics } from '@/app/api/diagnostics/route';
import { POST as postInstance } from '@/app/api/instances/route';
import { POST as postFull } from '@/app/api/sync/full/route';
import { PUT as putPrefs } from '@/app/api/sync/preferences/route';
import { POST as postResync } from '@/app/api/sync/resync/route';
import type { AuthDeps } from '@/lib/auth/deps';
import type { AppDb } from '@/lib/db/client';
import { detectedChanges, resourceVersions, syncModuleResults, syncRuns } from '@/lib/db/schema';
import { compareRuns, getIdLineage } from '@/lib/diff';
import { setDnsLookupForTests } from '@/lib/security/dns-guard';
import { waitForDiagnostics } from '@/lib/sync/diagnostics';
import { waitForSync } from '@/lib/sync/engine';
import { useFakePublicDns } from '../helpers/dns';
import { FAKE_PATHS, NEW_ITEM, VPN_ITEM_NEW_ID } from './fake-freshservice';
import { E2E_API_KEY, E2E_BASE_URL, type E2eEnv, call, createE2eEnv, dumpDatabase } from './harness';

// Mesmo padrão de tests/sync/routes.test.ts: as rotas leem dependências de funções getter.
const current = vi.hoisted(() => ({ deps: null as AuthDeps | null, db: null as AppDb | null }));
vi.mock('@/lib/auth/context', () => ({
  getAuthDeps: () => {
    if (!current.deps) throw new Error('dependências e2e não definidas');
    return current.deps;
  },
}));
// A rota de revisão usa getDb() diretamente (não AuthDeps.db). Aponta para o banco temporário.
vi.mock('@/lib/db/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/client')>();
  return {
    ...actual,
    getDb: () => {
      if (!current.db) throw new Error('banco e2e não definido');
      return current.db;
    },
  };
});

/** Só endpoints de catálogo e assets: mantém a sincronização curta e determinística. */
const MODULE_KEYS = ['service_catalog.items', 'service_catalog.categories', 'assets.assets'];
const EXPECTED_TYPES = ['name_changed', 'possible_id_change', 'added', 'removed', 'fields_changed'] as const;

async function json<T = unknown>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function changesOf(db: AppDb, runId: number) {
  return db.select().from(detectedChanges).where(eq(detectedChanges.runId, runId)).all();
}

function modulesOf(db: AppDb, runId: number) {
  const rows = db.select().from(syncModuleResults).where(eq(syncModuleResults.runId, runId)).all();
  return new Map(rows.map((row) => [row.moduleKey, row] as const));
}

function versionsOf(db: AppDb, runId: number) {
  return db
    .select({
      id: resourceVersions.id,
      resourceId: resourceVersions.resourceId,
      contentHash: resourceVersions.contentHash,
    })
    .from(resourceVersions)
    .where(eq(resourceVersions.runId, runId))
    .orderBy(resourceVersions.id)
    .all();
}

// Vitest executa os `it` de um mesmo describe em ordem (sem concurrent): cada etapa usa o estado da anterior.
describe('fluxo e2e sintético: instância → chave → diagnóstico → sync → mudanças → revisão → desconexão', () => {
  let env: E2eEnv;
  let instanceId = 0;
  let run1 = 0;
  let run2 = 0;
  let run3 = 0;
  let run1Versions: ReturnType<typeof versionsOf> = [];
  let possibleChangeId = 0;

  beforeAll(() => {
    env = createE2eEnv();
    current.deps = env.deps;
    current.db = env.db;
    // Sem DNS real: a guarda de destino público (createInstance e safeRequest) resolve para IP fictício.
    useFakePublicDns();
    // Sincronização usa globalThis.fetch e a diagnose usa deps.fetch: ambos apontam para o sintético.
    vi.stubGlobal('fetch', env.fake.fetch);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    setDnsLookupForTests(null);
    current.deps = null;
    current.db = null;
    env.cleanup();
  });

  it('1. cadastra a instância sintética por base_url e a deixa ativa', async () => {
    const response = await call(env, postInstance, 'POST', '/api/instances', {
      body: { base_url: E2E_BASE_URL },
    });
    expect(response.status).toBe(201);
    const body = await json<{ active_instance_id: number; instance: { id: number; origin: string } }>(response);
    expect(body.instance.origin).toBe(E2E_BASE_URL);
    expect(body.active_instance_id).toBe(body.instance.id);
    instanceId = body.instance.id;
  });

  it('2. salva a API key, conecta e nunca devolve o segredo (respostas, banco e cofre)', async () => {
    const saved = await call(env, postApiKey, 'POST', '/api/connection/api-key', {
      body: { mode: 'api_key_personal', api_key: E2E_API_KEY },
    });
    expect(saved.status).toBe(200);
    expect(await json(saved)).toMatchObject({ status: 'connected' });

    const status = await call(env, getStatus, 'GET', '/api/connection/status');
    expect(await json(status)).toMatchObject({ status: 'connected' });

    // O segredo fica só no cofre (referência no banco). Nenhuma resposta ou tabela o contém.
    expect(env.vault.entries.size).toBe(1);
    expect(env.bodies.join('\n')).not.toContain(E2E_API_KEY);
    expect(dumpDatabase(env.sqlite)).not.toContain(E2E_API_KEY);
  });

  it('3. diagnóstico: service_catalog acessível e assets.assets forbidden (403)', async () => {
    const started = await call(env, postDiagnostics, 'POST', '/api/diagnostics');
    expect(started.status).toBe(202);
    await waitForDiagnostics(instanceId);

    const view = await json<{ modules: Array<{ key: string; accessStatus: string }> }>(
      await call(env, getDiagnostics, 'GET', '/api/diagnostics'),
    );
    const access = new Map(view.modules.map((module) => [module.key, module.accessStatus]));
    expect(access.get('service_catalog.items')).toBe('accessible');
    expect(access.get('service_catalog.categories')).toBe('accessible');
    expect(access.get('assets.assets')).toBe('forbidden');
  });

  it('4. sincronização completa com 3 endpoints termina partial por causa do 403', async () => {
    const prefs = await call(env, putPrefs, 'PUT', '/api/sync/preferences', {
      body: { modules: MODULE_KEYS, metadataOnly: {}, storeRaw: false },
    });
    expect(prefs.status).toBe(200);

    const started = await call(env, postFull, 'POST', '/api/sync/full');
    expect(started.status).toBe(202);
    run1 = (await json<{ runId: number }>(started)).runId;
    await waitForSync(instanceId);

    expect(env.db.select().from(syncRuns).where(eq(syncRuns.id, run1)).get()?.status).toBe('partial');
    const modules = modulesOf(env.db, run1);
    expect(modules.get('service_catalog.items')?.status).toBe('completed');
    expect(modules.get('service_catalog.categories')?.status).toBe('completed');
    expect(modules.get('assets.assets')?.httpStatus).toBe(403);

    run1Versions = versionsOf(env.db, run1);
    expect(run1Versions.length).toBeGreaterThan(0);
  });

  it('5. altera o servidor sintético: renomeia 32, troca 40 por 45, adiciona 78, remove 19, altera 27', () => {
    const { fake } = env;
    fake.rename(32, 'Instalação de Software homologado');
    fake.remove(40);
    fake.add(VPN_ITEM_NEW_ID);
    fake.add(NEW_ITEM);
    fake.remove(19);
    fake.setVisibility(27, 2);
    expect([...fake.items.keys()].sort((a, b) => a - b)).toEqual([27, 32, 45, 55, 78]);
  });

  it('6. resync detecta name_changed, possible_id_change (40→45), added, removed e fields_changed', async () => {
    const started = await call(env, postResync, 'POST', '/api/sync/resync');
    expect(started.status).toBe(202);
    run2 = (await json<{ runId: number }>(started)).runId;
    await waitForSync(instanceId);

    const changes = changesOf(env.db, run2);
    const types = new Set(changes.map((change) => change.changeType));
    for (const type of EXPECTED_TYPES) expect(types.has(type), type).toBe(true);

    const possible = changes.find((change) => change.changeType === 'possible_id_change');
    expect(possible).toMatchObject({ previousExternalId: '40', currentExternalId: '45' });
    possibleChangeId = possible?.id ?? 0;
  });

  it('7. versões do run1 continuam intactas após o resync (contagem e hashes)', () => {
    expect(versionsOf(env.db, run1)).toEqual(run1Versions);
  });

  it('8. compareRuns(run1, run2) é coerente com detected_changes do run2', () => {
    const diff = compareRuns(env.db, run1, run2);
    const stored = new Map<string, number>();
    for (const change of changesOf(env.db, run2)) {
      stored.set(change.changeType, (stored.get(change.changeType) ?? 0) + 1);
    }
    for (const [type, count] of stored) expect(diff.counts[type] ?? 0, type).toBe(count);
  });

  it('9. catálogo com 500 persistente: run3 não gera removed de service_catalog.items', async () => {
    env.fake.force(FAKE_PATHS.items, 500);
    try {
      const started = await call(env, postResync, 'POST', '/api/sync/resync');
      expect(started.status).toBe(202);
      run3 = (await json<{ runId: number }>(started)).runId;
      await waitForSync(instanceId);
    } finally {
      env.fake.force(FAKE_PATHS.items, null);
    }

    // Módulo que falhou não pode produzir removed (nem added/fields_changed espúrios): só not_observed ou nada.
    const catalogChanges = changesOf(env.db, run3).filter((change) => change.moduleKey === 'service_catalog.items');
    expect(catalogChanges.filter((change) => change.changeType === 'removed')).toEqual([]);
    expect(catalogChanges.every((change) => change.changeType === 'not_observed')).toBe(true);
    expect(modulesOf(env.db, run3).get('service_catalog.items')?.status).toBe('failed');
  }, 60_000);

  it('10. confirmar a possible_id_change liga 40 ↔ 45 no histórico de IDs', async () => {
    const before = env.db.select().from(detectedChanges).where(eq(detectedChanges.id, possibleChangeId)).get();
    if (!before) throw new Error('possible_id_change do passo 6 não encontrada');

    const response = await call(env, postReview, 'POST', `/api/changes/${possibleChangeId}/review`, {
      body: { decision: 'confirm' },
      id: String(possibleChangeId),
    });
    expect(response.status).toBe(200);

    // A revisão atualiza a linha no lugar: o id da mudança revisada não muda.
    expect(await response.json()).toEqual({ changeId: possibleChangeId, status: 'confirmed' });
    const current = changesOf(env.db, run2).find(
      (change) =>
        change.changeType === 'possible_id_change' &&
        change.previousExternalId === '40' &&
        change.currentExternalId === '45',
    );
    if (!current?.resourceId || !current.previousResourceId) throw new Error('mudança revisada sem par de recursos');
    expect(current.id).toBe(possibleChangeId);
    expect(current.reviewStatus).toBe('confirmed');

    const lineage = getIdLineage(env.db, current.resourceId);
    expect(lineage.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          oldResourceId: current.previousResourceId,
          newResourceId: current.resourceId,
          changeId: current.id,
        }),
      ]),
    );
  });

  it('11. desconectar apaga o segredo do cofre e o status volta a disconnected', async () => {
    const response = await call(env, postDisconnect, 'POST', '/api/connection/disconnect');
    expect(response.status).toBe(200);
    const status = await json(await call(env, getStatus, 'GET', '/api/connection/status'));
    expect(status).toMatchObject({ status: 'disconnected' });
    expect(env.vault.entries.size).toBe(0);
  });

  it('12. audit_events (message e context) não contém a API key nem Authorization', () => {
    const rows = env.sqlite.prepare('SELECT event_type, message, context FROM audit_events').all();
    const text = JSON.stringify(rows);
    expect(rows.length).toBeGreaterThan(0);
    expect(text).not.toContain(E2E_API_KEY);
    expect(text.toLowerCase()).not.toContain('authorization');
  });

  it('13. o servidor sintético recebeu só Authorization Basic, nunca a chave em texto puro', () => {
    const headers = env.fake.log
      .map((entry) => entry.authorization)
      .filter((value): value is string => value !== null);
    expect(headers.length).toBeGreaterThan(0);
    expect(headers.every((value) => value.startsWith('Basic '))).toBe(true);
    expect(JSON.stringify(env.fake.log)).not.toContain(E2E_API_KEY);
    // Regressão Read-Only: diagnóstico, mapeamento e resync só enviam GET aos recursos.
    expect(env.fake.log.every((entry) => entry.method === 'GET')).toBe(true);
  });

  it('14. requisição mutável com Origin externo recebe 403 e não cria execução de sync', async () => {
    const before = env.db.select().from(syncRuns).all().length;
    const response = await call(env, postFull, 'POST', '/api/sync/full', { origin: 'https://evil.example' });
    expect(response.status).toBe(403);
    expect(await json(response)).toMatchObject({ error: { code: 'forbidden_origin' } });
    expect(env.db.select().from(syncRuns).all().length).toBe(before);
  });
});
