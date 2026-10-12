import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFakePublicDns } from '../helpers/dns';
import { apiModules, auditEvents, connections, integrationProfiles, syncModuleResults, syncRuns } from '@/lib/db/schema';
import { getAdapter } from '@/lib/freshservice/modules';
import type { ModuleAdapter } from '@/lib/freshservice/modules/types';
import { accessForOutcome } from '@/lib/sync/persist';
import { runDiagnostics } from '@/lib/sync/diagnostics';
import { runSync, waitForSync } from '@/lib/sync/engine';
import { grantedScopesFor, requiredScopesOf, scopeBlockFor, scopePathOf } from '@/lib/sync/scopes';
import type { ModuleOutcome, RunSyncInput, SyncDeps, SyncOptions } from '@/lib/sync/types';
import { findConnection } from '@/lib/auth/repo';
import { createSyncEnv, json, type SyncEnv } from '../helpers/sync-env';
import { SYNTHETIC_ORIGIN_A, ticketsPage } from '../fixtures/freshservice';

// O fetch é trocado por um registrador: cada chamada guarda caminho e método.
useFakePublicDns();

const AGENTS = 'users_groups.agents';
const TICKETS = 'tickets.tickets';
const AGENTS_PATH = '/api/v2/agents';
const TICKETS_PATH = '/api/v2/tickets';
const FOLDERS = 'knowledge_base.folders';
const FOLDERS_PATH = '/api/v2/solutions/folders';
const CONVERSATIONS_PATH = '/api/v2/tickets/{id}/conversations';
const SCOPE_AGENTS = 'freshservice.agents.manage';
const SCOPE_CONVERSATIONS_VIEW = 'freshservice.tickets.conversations.view';
/** Perfil com os escopos de leitura de tickets e solicitantes, sem o escopo de agentes. */
const SCOPES_WITHOUT_AGENTS = ['freshservice.tickets.view', 'freshservice.requesters.view'];
const OPTIONS: SyncOptions = { concurrency: 2, maxRetries: 1, timeoutMs: 2_000, backoffBaseMs: 500 };

const envs: SyncEnv[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  while (envs.length > 0) envs.pop()?.app.close();
});

interface Call {
  path: string;
  method: string;
}

function recorder(handler: (url: URL) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, method: (init?.method ?? 'GET').toUpperCase() });
    return handler(url);
  });
  const deps: Partial<SyncDeps> = {
    fetch: fetchMock as unknown as typeof fetch,
    now: () => Date.now(),
    sleep: async () => undefined,
    random: () => 0,
  };
  return { calls, deps, paths: () => calls.map((call) => call.path) };
}

/** Respostas do cenário: tickets com dados, agentes com 403 (escopo concedido, papel sem permissão). */
const ticketsOkAgentsForbidden = (url: URL): Response =>
  url.pathname === TICKETS_PATH ? json(ticketsPage(1, 2)) : json({ message: 'sem permissão' }, 403);

async function createEnv(): Promise<SyncEnv> {
  const env = await createSyncEnv('connected');
  envs.push(env);
  return env;
}

/** Troca a conexão para OAuth com perfil. O token fica no cofre e vale por uma hora (sem renovação). */
async function useOAuthProfile(env: SyncEnv, scopes: string[]): Promise<number> {
  const now = Date.now();
  const profile = env.db
    .insert(integrationProfiles)
    .values({
      name: 'Perfil sintético',
      orgOrigin: SYNTHETIC_ORIGIN_A,
      clientId: 'cliente-sintetico',
      clientSecretRef: 'ref-segredo-sintetico',
      scopes,
      pathPrefix: '',
      redirectHost: 'localhost',
      freshserviceDomains: [new URL(SYNTHETIC_ORIGIN_A).hostname],
      allowManageScopes: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: integrationProfiles.id })
    .get();
  const secretRef = await env.auth.vault.store(
    JSON.stringify({ accessToken: 'token-sintetico', refreshToken: 'refresh-sintetico', tokenType: 'Bearer', scopes: null }),
  );
  env.db
    .update(connections)
    .set({ authMode: 'oauth', integrationProfileId: profile.id, secretRef, tokenExpiresAt: now + 3_600_000 })
    .where(eq(connections.instanceId, env.instanceId))
    .run();
  return profile.id;
}

async function syncModules(env: SyncEnv, deps: Partial<SyncDeps>, modules: string[]): Promise<number> {
  const input: RunSyncInput = { db: env.db, auth: env.auth, instanceId: env.instanceId, kind: 'full', modules, deps, options: OPTIONS };
  const runId = await runSync(input);
  await waitForSync(env.instanceId);
  return runId;
}

function adapter(key: string): ModuleAdapter {
  const found = getAdapter(key);
  if (!found) throw new Error(`Módulo de teste inexistente: ${key}`);
  return found;
}

const runOf = (env: SyncEnv, runId: number) => env.db.select().from(syncRuns).where(eq(syncRuns.id, runId)).get();
const resultOf = (env: SyncEnv, runId: number, key: string) =>
  env.db
    .select()
    .from(syncModuleResults)
    .where(and(eq(syncModuleResults.runId, runId), eq(syncModuleResults.moduleKey, key)))
    .get();
const accessOf = (env: SyncEnv, key: string) =>
  env.db
    .select()
    .from(apiModules)
    .where(and(eq(apiModules.instanceId, env.instanceId), eq(apiModules.moduleKey, key)))
    .get();

describe('Escopo por módulo no sync', () => {
  it('OAuth sem escopo de agentes: agentes não chama a API, fica scope_not_granted e os demais são coletados', async () => {
    const env = await createEnv();
    await useOAuthProfile(env, SCOPES_WITHOUT_AGENTS);
    const h = recorder(ticketsOkAgentsForbidden);

    const runId = await syncModules(env, h.deps, [AGENTS, TICKETS]);

    expect(h.paths()).not.toContain(AGENTS_PATH);
    expect(h.paths()).toContain(TICKETS_PATH);
    expect(h.calls.every((call) => call.method === 'GET')).toBe(true);
    expect(runOf(env, runId)).toMatchObject({ status: 'partial', failuresCount: 0 });
    expect(runOf(env, runId)?.finishedAt).not.toBeNull();
    expect(resultOf(env, runId, AGENTS)).toMatchObject({ status: 'skipped', complete: false, httpStatus: null });
    expect(resultOf(env, runId, AGENTS)?.errorMessage).toContain(SCOPE_AGENTS);
    expect(resultOf(env, runId, TICKETS)).toMatchObject({ status: 'completed', complete: true, recordsCount: 2 });
    expect(accessOf(env, AGENTS)).toMatchObject({
      accessStatus: 'forbidden',
      accessDetail: 'scope_not_granted',
      httpStatus: null,
      lastAttemptAt: null,
    });
    expect(accessOf(env, TICKETS)).toMatchObject({ accessStatus: 'accessible', accessDetail: null });
    const events = env.db.select().from(auditEvents).all();
    expect(events.filter((event) => event.eventType === 'sync.module.scope_not_granted')).toHaveLength(1);
    expect(events.find((event) => event.eventType === 'sync.run.finished')?.context).toMatchObject({ scopeNotGranted: 1 });
  });

  it('módulo bloqueado por escopo não é falha: "repetir falhas" não o inclui', async () => {
    const env = await createEnv();
    await useOAuthProfile(env, SCOPES_WITHOUT_AGENTS);
    const runId = await syncModules(env, recorder(ticketsOkAgentsForbidden).deps, [AGENTS, TICKETS]);

    await expect(
      runSync({ db: env.db, auth: env.auth, instanceId: env.instanceId, kind: 'full', retryOfRunId: runId, deps: recorder(ticketsOkAgentsForbidden).deps, options: OPTIONS }),
    ).rejects.toMatchObject({ code: 'no_failed_modules' });
  });

  it('OAuth com escopo concedido e 403 da API: agentes é consultado e fica forbidden sem motivo de escopo', async () => {
    const env = await createEnv();
    await useOAuthProfile(env, [SCOPE_AGENTS, 'freshservice.tickets.view']);
    const h = recorder(ticketsOkAgentsForbidden);

    const runId = await syncModules(env, h.deps, [AGENTS, TICKETS]);

    expect(h.paths()).toContain(AGENTS_PATH);
    expect(resultOf(env, runId, AGENTS)).toMatchObject({ status: 'failed', httpStatus: 403 });
    expect(accessOf(env, AGENTS)).toMatchObject({ accessStatus: 'forbidden', accessDetail: null, httpStatus: 403 });
    expect(runOf(env, runId)).toMatchObject({ status: 'partial', failuresCount: 1 });
  });

  it('API key: sem checagem de escopo, agentes é consultado normalmente', async () => {
    const env = await createEnv();
    const h = recorder(ticketsOkAgentsForbidden);

    const runId = await syncModules(env, h.deps, [AGENTS, TICKETS]);

    expect(h.paths()).toContain(AGENTS_PATH);
    expect(resultOf(env, runId, AGENTS)).toMatchObject({ status: 'failed', httpStatus: 403 });
    expect(accessOf(env, AGENTS)).toMatchObject({ accessStatus: 'forbidden', accessDetail: null });
    expect(resultOf(env, runId, TICKETS)).toMatchObject({ status: 'completed' });
  });

  it('conceder o escopo libera a consulta e o 403 seguinte limpa access_detail', async () => {
    const env = await createEnv();
    const profileId = await useOAuthProfile(env, SCOPES_WITHOUT_AGENTS);
    await syncModules(env, recorder(ticketsOkAgentsForbidden).deps, [AGENTS, TICKETS]);
    expect(accessOf(env, AGENTS)?.accessDetail).toBe('scope_not_granted');

    env.db
      .update(integrationProfiles)
      .set({ scopes: [...SCOPES_WITHOUT_AGENTS, SCOPE_AGENTS], updatedAt: Date.now() })
      .where(eq(integrationProfiles.id, profileId))
      .run();
    const h = recorder(ticketsOkAgentsForbidden);
    await syncModules(env, h.deps, [AGENTS, TICKETS]);

    expect(h.paths()).toContain(AGENTS_PATH);
    expect(accessOf(env, AGENTS)).toMatchObject({ accessStatus: 'forbidden', accessDetail: null, httpStatus: 403 });
  });

  it('diagnóstico: escopo não concedido vira forbidden com access_detail, sem GET para o módulo', async () => {
    const env = await createEnv();
    await useOAuthProfile(env, SCOPES_WITHOUT_AGENTS);
    const h = recorder(() => json(ticketsPage(1, 1)));

    // FOLDERS é filho (depende de categoria) e seu caminho exige solutions.view, ausente no perfil.
    const summary = await runDiagnostics({
      db: env.db,
      auth: env.auth,
      instanceId: env.instanceId,
      deps: h.deps,
      options: { adapters: [adapter(AGENTS), adapter(TICKETS), adapter(FOLDERS)], concurrency: 2, maxRetries: 0 },
    });

    expect(h.paths()).not.toContain(AGENTS_PATH);
    expect(h.paths()).not.toContain(FOLDERS_PATH);
    expect(h.paths()).toContain(TICKETS_PATH);
    expect(summary.scopeNotGranted).toBe(2);
    expect(summary.counts).toMatchObject({ forbidden: 2, accessible: 1 });
    expect(accessOf(env, AGENTS)).toMatchObject({ accessStatus: 'forbidden', accessDetail: 'scope_not_granted', lastAttemptAt: null });
    expect(accessOf(env, FOLDERS)).toMatchObject({ accessStatus: 'forbidden', accessDetail: 'scope_not_granted', lastAttemptAt: null });
    expect(accessOf(env, TICKETS)).toMatchObject({ accessStatus: 'accessible', accessDetail: null });
  });
});

describe('Mapeamento de escopos (sem I/O)', () => {
  it('o caminho sem /api/v2 casa com MODULE_GET_SCOPES; caminho fora do mapa não tem escopo exigido', () => {
    expect(scopePathOf({ path: '/api/v2/solutions/folders' })).toBe('solutions/folders');
    expect(requiredScopesOf({ path: AGENTS_PATH })).toEqual([SCOPE_AGENTS]);
    expect(requiredScopesOf({ path: CONVERSATIONS_PATH })).toEqual([SCOPE_CONVERSATIONS_VIEW]);
    expect(requiredScopesOf({ path: '/api/v2/service_catalog/categories' })).toBeNull();
  });

  it('scopeBlockFor: sem conjunto de escopos, escopo coberto ou caminho fora do mapa não bloqueiam', () => {
    expect(scopeBlockFor({ path: AGENTS_PATH }, null)).toBeNull();
    expect(scopeBlockFor({ path: AGENTS_PATH }, new Set([SCOPE_AGENTS]))).toBeNull();
    expect(scopeBlockFor({ path: '/api/v2/service_catalog/categories' }, new Set<string>())).toBeNull();
    expect(scopeBlockFor({ path: AGENTS_PATH }, new Set(['freshservice.tickets.view']))).toEqual([SCOPE_AGENTS]);
  });

  it('conversas de tickets: bloqueadas sem freshservice.tickets.conversations.view e liberadas com ele', () => {
    const conversations = { path: CONVERSATIONS_PATH };
    expect(scopeBlockFor(conversations, new Set(['freshservice.tickets.view']))).toEqual([SCOPE_CONVERSATIONS_VIEW]);
    expect(scopeBlockFor(conversations, new Set([SCOPE_CONVERSATIONS_VIEW]))).toBeNull();
  });

  it('accessForOutcome: scope_not_granted vira forbidden', () => {
    const outcome: ModuleOutcome = {
      moduleKey: AGENTS,
      status: 'skipped',
      complete: false,
      recordsCount: 0,
      pagesFetched: 0,
      httpStatus: null,
      errorMessage: null,
      failureKind: 'scope_not_granted',
      startedAt: null,
      finishedAt: null,
      externalIds: [],
    };
    expect(accessForOutcome(outcome)).toBe('forbidden');
  });

  it('grantedScopesFor: API key não tem conjunto de escopos (sem checagem)', async () => {
    const env = await createEnv();
    const connection = findConnection(env.db, env.instanceId);
    expect(connection).toBeDefined();
    expect(grantedScopesFor(env.db, connection!, SYNTHETIC_ORIGIN_A)).toBeNull();
  });
});
