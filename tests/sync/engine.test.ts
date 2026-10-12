import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFakePublicDns } from '../helpers/dns';
import { createAuditLogger } from '@/lib/audit/logger';
import type { AuthDeps } from '@/lib/auth/deps';
import { findConnection, saveConnection, writeSetting } from '@/lib/auth/repo';
import type { AppDb } from '@/lib/db/client';
import {
  apiModules,
  auditEvents,
  connections,
  instances,
  resourceObservations,
  resources,
  resourceVersions,
  syncModuleResults,
  syncRuns,
} from '@/lib/db/schema';
import { detectChangesForRun } from '@/lib/diff';
import type { SecretVault } from '@/lib/secrets/vault';
import { cancel, getProgress, runSync, SyncError, waitForSync } from '@/lib/sync/engine';
import { createAuthorizationProvider } from '@/lib/sync/token';
import type { RunSyncInput, SyncDeps, SyncOptions } from '@/lib/sync/types';
import { createAppTestDb, insertRealInstance, type AppTestDb } from '../helpers/app-db';
import {
  articlesBody,
  categoriesBody,
  foldersBody,
  linkNext,
  SYNTHETIC_API_KEY,
  SYNTHETIC_ORIGIN_A,
  SYNTHETIC_ORIGIN_B,
  ticketsPage,
} from '../fixtures/freshservice';

// Espiona a ponte com F5 sem trocar o comportamento: a chamada real continua acontecendo.
vi.mock('@/lib/diff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/diff')>();
  return { ...actual, detectChangesForRun: vi.fn(actual.detectChangesForRun) };
});

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

interface Env {
  app: AppTestDb;
  db: AppDb;
  auth: AuthDeps;
  instanceId: number;
  connectionId: number;
}

const BASE_OPTIONS: SyncOptions = { concurrency: 2, maxRetries: 1, timeoutMs: 2_000, backoffBaseMs: 500 };
const TICKETS = 'tickets.tickets';
const CATEGORIES = 'knowledge_base.categories';

const envs: Env[] = [];
afterEach(() => {
  while (envs.length > 0) envs.pop()?.app.close();
});

function memoryVault(): SecretVault {
  const values = new Map<string, string>();
  let counter = 0;
  return {
    async store(value: string) {
      counter += 1;
      const ref = `ref-sintetica-${counter}`;
      values.set(ref, value);
      return ref;
    },
    async read(ref: string) {
      return values.get(ref) ?? null;
    },
    async remove(ref: string) {
      values.delete(ref);
    },
    async status() {
      return [];
    },
  };
}

async function createEnv(origin = SYNTHETIC_ORIGIN_A, label = 'Chave sintética'): Promise<Env> {
  const app = createAppTestDb();
  const db = app.db;
  const vault = memoryVault();
  const instanceId = insertRealInstance(db, origin);
  const secretRef = await vault.store(SYNTHETIC_API_KEY);
  const connectionId = saveConnection(db, instanceId, Date.now(), {
    authMode: 'api_key_personal',
    status: 'connected',
    accountLabel: label,
    secretRef,
  }).id;
  const auth: AuthDeps = {
    db,
    vault,
    audit: createAuditLogger(db),
    dataDir: '',
    port: 3102,
    dev: false,
    fetchImpl: (() => Promise.reject(new Error('não usado nestes testes'))) as unknown as typeof fetch,
    now: () => Date.now(),
    timeoutMs: 15_000,
    getSigningKey: () => Buffer.alloc(32, 7),
  };
  const env = { app, db, auth, instanceId, connectionId };
  envs.push(env);
  return env;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** Fetch mockado. Registra cada URL chamada e as esperas de backoff (sem tempo real). */
function harness(handler: Handler) {
  const calls: URL[] = [];
  const sleeps: number[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url);
    return handler(url, init ?? {});
  });
  const deps: Partial<SyncDeps> = {
    fetch: fetchMock as unknown as typeof fetch,
    now: () => Date.now(),
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    random: () => 0,
  };
  return { calls, sleeps, deps };
}

/** Responde só quando a requisição for abortada (o sinal já abortado também conta). */
function hangUntilAbort(init: RequestInit): Promise<never> {
  return new Promise<never>((_, reject) => {
    const fail = () => reject(init.signal?.reason ?? new DOMException('Abortado.', 'AbortError'));
    if (init.signal?.aborted) fail();
    else init.signal?.addEventListener('abort', fail, { once: true });
  });
}

function pageOf(url: URL): number {
  return Number(url.searchParams.get('page'));
}

async function sync(
  env: Env,
  deps: Partial<SyncDeps>,
  extra: Partial<RunSyncInput> = {},
  options: SyncOptions = BASE_OPTIONS,
): Promise<number> {
  const runId = await runSync({
    db: env.db,
    auth: env.auth,
    instanceId: env.instanceId,
    kind: 'full',
    deps,
    options,
    ...extra,
  });
  await waitForSync(extra.instanceId ?? env.instanceId);
  return runId;
}

const runRow = (db: AppDb, runId: number) => db.select().from(syncRuns).where(eq(syncRuns.id, runId)).get();
const moduleRow = (db: AppDb, runId: number, key: string) =>
  db
    .select()
    .from(syncModuleResults)
    .where(and(eq(syncModuleResults.runId, runId), eq(syncModuleResults.moduleKey, key)))
    .get();
const versionsOf = (db: AppDb, runId: number) =>
  db.select().from(resourceVersions).where(eq(resourceVersions.runId, runId)).all();
const observationsOf = (db: AppDb, runId: number) =>
  db.select().from(resourceObservations).where(eq(resourceObservations.runId, runId)).all();
const resourceCount = (db: AppDb, instanceId: number) =>
  db.select().from(resources).where(eq(resources.instanceId, instanceId)).all().length;

useFakePublicDns();

describe('motor de sincronização: paginação', () => {
  it('pagina por link em 3 páginas (100 + 100 + 50) e confere o total', async () => {
    const env = await createEnv();
    const h = harness((url) => {
      if (url.pathname !== '/api/v2/tickets') return jsonResponse({}, 404);
      if (pageOf(url) === 1) {
        return jsonResponse(ticketsPage(1, 100), 200, {
          link: linkNext(`${SYNTHETIC_ORIGIN_A}/api/v2/tickets?per_page=100&page=2`),
        });
      }
      if (pageOf(url) === 2) {
        return jsonResponse(ticketsPage(101, 100), 200, {
          link: linkNext(`${SYNTHETIC_ORIGIN_A}/api/v2/tickets?per_page=100&page=3`),
        });
      }
      return jsonResponse(ticketsPage(201, 50));
    });
    const runId = await sync(env, h.deps, { modules: [TICKETS] });
    expect(runRow(env.db, runId)?.status).toBe('completed');
    expect(moduleRow(env.db, runId, TICKETS)).toMatchObject({ status: 'completed', complete: true, pagesFetched: 3, recordsCount: 250 });
    expect(h.calls.map(pageOf)).toEqual([1, 2, 3]);
    expect(h.calls.every((url) => url.searchParams.get('per_page') === '100')).toBe(true);
    expect(resourceCount(env.db, env.instanceId)).toBe(250);
  });

  it('para na página curta (100 + 100 + 20, sem link) e confere o total', async () => {
    const env = await createEnv();
    const h = harness((url) => {
      if (pageOf(url) === 1) return jsonResponse(ticketsPage(1, 100));
      if (pageOf(url) === 2) return jsonResponse(ticketsPage(101, 100));
      return jsonResponse(ticketsPage(201, 20));
    });
    const runId = await sync(env, h.deps, { modules: [TICKETS] });
    expect(moduleRow(env.db, runId, TICKETS)).toMatchObject({ complete: true, pagesFetched: 3, recordsCount: 220 });
    expect(h.calls.map(pageOf)).toEqual([1, 2, 3]);
  });

  it('teto de páginas atingido com próxima página marca o módulo incompleto', async () => {
    const env = await createEnv();
    const h = harness((url) =>
      jsonResponse(ticketsPage(pageOf(url) * 100, 100), 200, {
        link: linkNext(`${SYNTHETIC_ORIGIN_A}/api/v2/tickets?per_page=100&page=${pageOf(url) + 1}`),
      }),
    );
    const runId = await sync(env, h.deps, { modules: [TICKETS] }, { ...BASE_OPTIONS, maxPagesPerModule: 2 });
    expect(runRow(env.db, runId)?.status).toBe('failed');
    expect(moduleRow(env.db, runId, TICKETS)).toMatchObject({ status: 'failed', complete: false, pagesFetched: 2 });
    expect(moduleRow(env.db, runId, TICKETS)?.errorMessage).toContain('Limite de 2 páginas');
  });

  it('expande módulos filhos: pastas por category_id e artigos por folder_id', async () => {
    const env = await createEnv();
    const h = harness((url) => {
      if (url.pathname === '/api/v2/solutions/categories') return jsonResponse(categoriesBody([10, 20]));
      if (url.pathname === '/api/v2/solutions/folders') {
        const category = url.searchParams.get('category_id');
        return jsonResponse(category === '10' ? foldersBody(10, [101, 102]) : foldersBody(20, [201]));
      }
      if (url.pathname === '/api/v2/solutions/articles') {
        const folder = Number(url.searchParams.get('folder_id'));
        const ids = folder === 101 ? [1001] : folder === 201 ? [2001, 2002] : [];
        return jsonResponse(articlesBody(folder, ids));
      }
      return jsonResponse({}, 404);
    });
    const modules = ['knowledge_base.categories', 'knowledge_base.folders', 'knowledge_base.articles'];
    const runId = await sync(env, h.deps, { modules });
    expect(runRow(env.db, runId)?.status).toBe('completed');
    expect(moduleRow(env.db, runId, 'knowledge_base.folders')).toMatchObject({ complete: true, recordsCount: 3 });
    expect(moduleRow(env.db, runId, 'knowledge_base.articles')).toMatchObject({ complete: true, recordsCount: 3 });
    const folderCalls = h.calls.filter((url) => url.pathname === '/api/v2/solutions/folders');
    expect(folderCalls.map((url) => url.searchParams.get('category_id')).sort()).toEqual(['10', '20']);
  });

  it('filho sem o pai no run usa os IDs da última execução completa do pai', async () => {
    const env = await createEnv();
    const handler: Handler = (url) => {
      if (url.pathname === '/api/v2/solutions/categories') return jsonResponse(categoriesBody([10, 20]));
      if (url.pathname === '/api/v2/solutions/folders') {
        return jsonResponse(
          url.searchParams.get('category_id') === '10' ? foldersBody(10, [101, 102]) : foldersBody(20, [201]),
        );
      }
      return jsonResponse(articlesBody(Number(url.searchParams.get('folder_id')), []));
    };
    await sync(env, harness(handler).deps, { modules: ['knowledge_base.categories', 'knowledge_base.folders'] });
    const h = harness(handler);
    await sync(env, h.deps, { modules: ['knowledge_base.articles'] });
    const folderIds = h.calls.map((url) => url.searchParams.get('folder_id')).sort();
    expect(folderIds).toEqual(['101', '102', '201']);
  });

  it('run anterior sem display_id: item_details vira parent_incomplete com pedido de nova sincronização, sem consultar às cegas', async () => {
    const env = await createEnv();
    // Itens sintéticos sem display_id: é o formato de um run feito antes da normalização ampla.
    await sync(
      env,
      harness((url) =>
        url.pathname === '/api/v2/service_catalog/items'
          ? jsonResponse({ service_items: [{ id: 7, name: 'Item sintético' }] })
          : jsonResponse({ unexpected: url.pathname }, 500),
      ).deps,
      { modules: ['service_catalog.items'] },
    );
    const h = harness(() => jsonResponse({ unexpected: true }, 500));
    const runId = await sync(env, h.deps, { modules: ['service_catalog.item_details'] });

    expect(h.calls.filter((url) => url.pathname.startsWith('/api/v2/service_catalog/items/'))).toHaveLength(0);
    const row = moduleRow(env.db, runId, 'service_catalog.item_details');
    expect(row?.complete).toBe(false);
    expect(JSON.stringify(row)).toContain('Re-sincronize itens do catálogo');
  });

  it('resposta sem a lista esperada ou em JSON inválido vira falha do módulo', async () => {
    const env = await createEnv();
    const h = harness((url) =>
      url.pathname === '/api/v2/tickets' ? jsonResponse({ outro: [] }) : new Response('não é json', { status: 200 }),
    );
    const runId = await sync(env, h.deps, { modules: [TICKETS, CATEGORIES] });
    expect(runRow(env.db, runId)?.status).toBe('failed');
    expect(moduleRow(env.db, runId, TICKETS)).toMatchObject({ status: 'failed', complete: false });
    expect(moduleRow(env.db, runId, CATEGORIES)).toMatchObject({ status: 'failed', complete: false });
  });
});

describe('motor de sincronização: rede, retry e acesso', () => {
  it('429 com Retry-After espera o valor pedido e respeita o teto de 120 s', async () => {
    const env = await createEnv();
    let attempts = 0;
    const h = harness(() => {
      attempts += 1;
      if (attempts === 1) return jsonResponse({}, 429, { 'retry-after': '7' });
      if (attempts === 2) return jsonResponse({}, 429, { 'retry-after': '999' });
      return jsonResponse(ticketsPage(1, 3));
    });
    const runId = await sync(env, h.deps, { modules: [TICKETS] }, { ...BASE_OPTIONS, maxRetries: 3 });
    expect(h.sleeps).toEqual([7_000, 120_000]);
    expect(moduleRow(env.db, runId, TICKETS)).toMatchObject({ status: 'completed', complete: true, pagesFetched: 1 });
  });

  it('401: connection vira session_expired, run falha, módulos seguintes não rodam e o segredo não aparece', async () => {
    const env = await createEnv();
    const h = harness(() => jsonResponse({ mensagem: 'rejeitada' }, 401));
    const runId = await sync(env, h.deps, { modules: [TICKETS, CATEGORIES] }, { ...BASE_OPTIONS, concurrency: 1 });
    expect(runRow(env.db, runId)?.status).toBe('failed');
    expect(findConnection(env.db, env.instanceId)?.status).toBe('session_expired');
    // Ordem do registro: categories vem antes de tickets. O 401 em categories impede tickets de rodar.
    expect(moduleRow(env.db, runId, CATEGORIES)).toMatchObject({ status: 'failed', httpStatus: 401 });
    expect(moduleRow(env.db, runId, TICKETS)?.status).toBe('skipped');
    expect(h.calls).toHaveLength(1);
    const audit = env.db.select().from(auditEvents).all();
    expect(audit.some((event) => event.eventType === 'sync.run.unauthorized')).toBe(true);
    const dump = JSON.stringify({ audit, runs: env.db.select().from(syncRuns).all(), modules: env.db.select().from(syncModuleResults).all(), connections: env.db.select().from(connections).all() });
    expect(dump).not.toContain(SYNTHETIC_API_KEY);
    expect(dump).not.toContain(Buffer.from(`${SYNTHETIC_API_KEY}:X`).toString('base64'));
  });

  it('403 em um módulo: marca forbidden, segue os outros e fecha como partial', async () => {
    const env = await createEnv();
    const h = harness((url) => (url.pathname === '/api/v2/tickets' ? jsonResponse({}, 403) : jsonResponse(categoriesBody([1, 2]))));
    const runId = await sync(env, h.deps, { modules: [TICKETS, CATEGORIES] });
    expect(runRow(env.db, runId)).toMatchObject({ status: 'partial', failuresCount: 1 });
    expect(moduleRow(env.db, runId, TICKETS)).toMatchObject({ status: 'failed', httpStatus: 403 });
    expect(moduleRow(env.db, runId, CATEGORIES)).toMatchObject({ status: 'completed', complete: true });
    const access = env.db
      .select()
      .from(apiModules)
      .where(and(eq(apiModules.instanceId, env.instanceId), eq(apiModules.moduleKey, TICKETS)))
      .get();
    expect(access?.accessStatus).toBe('forbidden');
  });

  it('timeout por requisição: repete o limite de vezes e falha o módulo com tempo limite', async () => {
    const env = await createEnv();
    const h = harness((_url, init) => hangUntilAbort(init));
    const runId = await sync(env, h.deps, { modules: [TICKETS] }, { ...BASE_OPTIONS, timeoutMs: 20, maxRetries: 1 });
    expect(moduleRow(env.db, runId, TICKETS)).toMatchObject({ status: 'failed', complete: false });
    expect(moduleRow(env.db, runId, TICKETS)?.errorMessage).toContain('Tempo limite');
    expect(h.calls).toHaveLength(2);
    expect(h.sleeps).toEqual([250]);
  });

  it('falha parcial: 500 persistente falha o módulo com backoff, o outro completa e o run fica partial', async () => {
    const env = await createEnv();
    const h = harness((url) => (url.pathname === '/api/v2/tickets' ? jsonResponse({}, 500) : jsonResponse(categoriesBody([1]))));
    const runId = await sync(env, h.deps, { modules: [TICKETS, CATEGORIES] }, { ...BASE_OPTIONS, maxRetries: 1 });
    expect(runRow(env.db, runId)?.status).toBe('partial');
    expect(moduleRow(env.db, runId, TICKETS)).toMatchObject({ status: 'failed', httpStatus: 500 });
    expect(h.sleeps).toEqual([250]);
    const access = env.db
      .select()
      .from(apiModules)
      .where(and(eq(apiModules.instanceId, env.instanceId), eq(apiModules.moduleKey, TICKETS)))
      .get();
    expect(access?.accessStatus).toBe('temporarily_unavailable');
    expect(moduleRow(env.db, runId, CATEGORIES)).toMatchObject({ status: 'completed', complete: true });
  });

  it('cancelamento: run cancelled, módulo interrompido e dados do run anterior intactos', async () => {
    const env = await createEnv();
    const first = await sync(env, harness(() => jsonResponse(ticketsPage(1, 5))).deps, { modules: [TICKETS] });
    const before = { status: runRow(env.db, first)?.status, observations: observationsOf(env.db, first).length, versions: versionsOf(env.db, first).length };
    expect(before).toEqual({ status: 'completed', observations: 5, versions: 5 });

    const h = harness((url, init) => {
      if (pageOf(url) === 1) {
        return jsonResponse(ticketsPage(1, 5), 200, {
          link: linkNext(`${SYNTHETIC_ORIGIN_A}/api/v2/tickets?per_page=100&page=2`),
        });
      }
      cancel(env.instanceId);
      return hangUntilAbort(init);
    });
    const second = await sync(env, h.deps, { modules: [TICKETS] });
    expect(runRow(env.db, second)).toMatchObject({ status: 'cancelled', changesCount: 0 });
    expect(moduleRow(env.db, second, TICKETS)).toMatchObject({ status: 'cancelled', complete: false });
    expect(getProgress(env.instanceId).running).toBe(false);
    expect(runRow(env.db, first)?.status).toBe('completed');
    expect(observationsOf(env.db, first)).toHaveLength(before.observations);
    expect(versionsOf(env.db, first)).toHaveLength(before.versions);
  });

  it('retry só repete os módulos que falharam na execução de origem', async () => {
    const env = await createEnv();
    const first = harness((url) => (url.pathname === '/api/v2/tickets' ? jsonResponse({}, 500) : jsonResponse(categoriesBody([1]))));
    const runId = await sync(env, first.deps, { modules: [TICKETS, CATEGORIES] }, { ...BASE_OPTIONS, maxRetries: 0 });
    expect(runRow(env.db, runId)?.status).toBe('partial');
    const retry = harness(() => jsonResponse(ticketsPage(1, 3)));
    const retryId = await sync(env, retry.deps, { kind: 'resync', retryOfRunId: runId });
    expect(runRow(env.db, retryId)?.modulesRequested).toEqual([TICKETS]);
    expect(retry.calls.every((url) => url.pathname === '/api/v2/tickets')).toBe(true);
    expect(runRow(env.db, retryId)?.status).toBe('completed');
  });
});

describe('motor de sincronização: persistência e dedupe', () => {
  it('2º run idêntico não cria versão nova, grava observação e fecha com changes_count 0', async () => {
    const env = await createEnv();
    const h = harness(() => jsonResponse(categoriesBody([1, 2, 3])));
    const r1 = await sync(env, h.deps, { modules: [CATEGORIES] });
    const r2 = await sync(env, h.deps, { modules: [CATEGORIES] });
    expect(runRow(env.db, r2)).toMatchObject({ status: 'completed', changesCount: 0 });
    expect(versionsOf(env.db, r1)).toHaveLength(3);
    expect(versionsOf(env.db, r2)).toHaveLength(0);
    expect(observationsOf(env.db, r2)).toHaveLength(3);
    const current = env.db.select().from(resources).where(eq(resources.instanceId, env.instanceId)).all();
    expect(current.every((row) => row.lastSeenRunId === r2)).toBe(true);
  });

  it('metadataOnly remove conteúdo por padrão; preferência explícita e storeRaw liberam o conteúdo', async () => {
    const env = await createEnv();
    const h = harness(() => jsonResponse(ticketsPage(1, 2)));
    const r1 = await sync(env, h.deps, { modules: [TICKETS] });
    const v1 = versionsOf(env.db, r1);
    expect(v1.length).toBe(2);
    expect(v1.every((row) => !('description' in row.normalizedJson) && row.rawJson === null)).toBe(true);

    writeSetting(env.db, 'sync_preferences', { metadataOnly: { [TICKETS]: false }, storeRaw: true });
    const r2 = await sync(env, h.deps, { modules: [TICKETS] });
    const v2 = versionsOf(env.db, r2);
    expect(v2.length).toBe(2);
    expect(v2.every((row) => 'description' in row.normalizedJson && row.rawJson !== null)).toBe(true);
  });

  it('isolamento: duas instâncias no mesmo banco, cada uma com seus dados e seu host', async () => {
    const env = await createEnv(SYNTHETIC_ORIGIN_A, 'Conexão A');
    const instanceB = insertRealInstance(env.db, SYNTHETIC_ORIGIN_B);
    saveConnection(env.db, instanceB, Date.now(), {
      authMode: 'api_key_personal',
      status: 'connected',
      accountLabel: 'Conexão B',
      secretRef: await env.auth.vault.store(SYNTHETIC_API_KEY),
    });
    const h = harness((url) => jsonResponse(categoriesBody(url.host === 'sintetica-a.freshservice.com' ? [1, 2] : [1, 2, 3])));

    const runA = await sync(env, h.deps, { modules: [CATEGORIES] });
    const runB = await sync(env, h.deps, { modules: [CATEGORIES], auth: env.auth, instanceId: instanceB });
    expect(resourceCount(env.db, env.instanceId)).toBe(2);
    expect(resourceCount(env.db, instanceB)).toBe(3);
    expect(runRow(env.db, runA)?.identityLabel).toBe('Conexão A');
    expect(runRow(env.db, runB)?.identityLabel).toBe('Conexão B');
    expect(h.calls.filter((url) => url.host === 'sintetica-a.freshservice.com')).toHaveLength(1);
    expect(h.calls.filter((url) => url.host === 'sintetica-b.freshservice.com')).toHaveLength(1);
  });

  it('usa só a conexão ativa da própria instância; sem conexão ativa, nada é criado', async () => {
    const env = await createEnv(SYNTHETIC_ORIGIN_A, 'Conexão A');
    const instanceB = insertRealInstance(env.db, SYNTHETIC_ORIGIN_B);
    saveConnection(env.db, instanceB, Date.now(), { authMode: 'api_key_personal', status: 'disconnected' });
    const demo = env.db
      .insert(instances)
      .values({ baseUrl: 'https://demo-sintetico.freshservice.com', displayName: 'Demo', isDemo: true, createdAt: 1, updatedAt: 1 })
      .returning({ id: instances.id })
      .get().id;

    const h = harness(() => jsonResponse(categoriesBody([1])));
    const runId = await sync(env, h.deps, { modules: [CATEGORIES] });
    expect(runRow(env.db, runId)?.connectionId).toBe(env.connectionId);
    await expect(runSync({ db: env.db, auth: env.auth, instanceId: instanceB, kind: 'full', deps: h.deps })).rejects.toMatchObject({ code: 'connection_not_ready' });
    await expect(runSync({ db: env.db, auth: env.auth, instanceId: demo, kind: 'full', deps: h.deps })).rejects.toBeInstanceOf(SyncError);
    expect(env.db.select().from(syncRuns).where(eq(syncRuns.instanceId, instanceB)).all()).toHaveLength(0);
    expect(env.db.select().from(syncRuns).where(eq(syncRuns.instanceId, demo)).all()).toHaveLength(0);
  });
});

describe('motor de sincronização: ponte com o diff, singleton e OAuth', () => {
  it('ponte com F5: primeira execução sem base; a segunda usa a primeira como baseRunId', async () => {
    vi.mocked(detectChangesForRun).mockClear();
    const env = await createEnv();
    const h = harness(() => jsonResponse(categoriesBody([1])));
    const r1 = await sync(env, h.deps, { modules: [CATEGORIES] });
    const r2 = await sync(env, h.deps, { modules: [CATEGORIES] });
    const inputs = vi.mocked(detectChangesForRun).mock.calls.map((call) => call[1]);
    expect(inputs).toEqual([
      { runId: r1, baseRunId: null },
      { runId: r2, baseRunId: r1 },
    ]);
  });

  it('falha no diff: run mantém o status, changes_count 0 e registra auditoria', async () => {
    const env = await createEnv();
    vi.mocked(detectChangesForRun).mockImplementationOnce(() => {
      throw new Error('falha sintética do diff');
    });
    const runId = await sync(env, harness(() => jsonResponse(categoriesBody([1]))).deps, { modules: [CATEGORIES] });
    expect(runRow(env.db, runId)).toMatchObject({ status: 'completed', changesCount: 0 });
    expect(env.db.select().from(auditEvents).all().some((event) => event.eventType === 'sync.diff.failed')).toBe(true);
  });

  it('singleton: segunda execução na mesma instância é recusada enquanto a primeira roda', async () => {
    const env = await createEnv();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = harness(async () => {
      await gate;
      return jsonResponse(ticketsPage(1, 2));
    });
    const input: RunSyncInput = { db: env.db, auth: env.auth, instanceId: env.instanceId, kind: 'full', modules: [TICKETS], deps: h.deps };
    const first = await runSync(input);
    await expect(runSync(input)).rejects.toMatchObject({ code: 'sync_already_running' });
    expect(getProgress(env.instanceId)).toMatchObject({ running: true, runId: first });
    release();
    await waitForSync(env.instanceId);
    expect(getProgress(env.instanceId).running).toBe(false);
    expect(runRow(env.db, first)?.status).toBe('completed');
    const second = await sync(env, h.deps, { modules: [TICKETS] });
    expect(second).not.toBe(first);
  });

  it('OAuth: três pedidos concorrentes compartilham uma única renovação', async () => {
    const env = await createEnv();
    env.db.update(connections).set({ authMode: 'oauth' }).where(eq(connections.instanceId, env.instanceId)).run();
    let renewals = 0;
    const provider = createAuthorizationProvider({
      db: env.db,
      auth: env.auth,
      instanceId: env.instanceId,
      resolveOAuth: async () => {
        renewals += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return 'token-sintetico';
      },
    });
    const headers = await Promise.all([provider(), provider(), provider()]);
    expect(renewals).toBe(1);
    expect(new Set(headers)).toEqual(new Set(['Bearer token-sintetico']));
  });
});
