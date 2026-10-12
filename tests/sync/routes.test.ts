import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as cancelRoute } from '@/app/api/sync/cancel/route';
import { POST as fullRoute } from '@/app/api/sync/full/route';
import { GET as getPrefs, PUT as putPrefs } from '@/app/api/sync/preferences/route';
import { POST as resyncRoute } from '@/app/api/sync/resync/route';
import { POST as retryRoute } from '@/app/api/sync/retry/route';
import { GET as statusRoute } from '@/app/api/sync/status/route';
import type { AuthDeps } from '@/lib/auth/deps';
import { findConnection } from '@/lib/auth/repo';
import { syncModuleResults, syncRuns } from '@/lib/db/schema';
import { waitForSync } from '@/lib/sync/engine';
import { syncableAdapters } from '@/lib/freshservice/modules';
import { selectedModuleKeys } from '@/lib/sync/service';
import { createSyncEnv, emptyPage, stubFetch, type SyncEnv } from '../helpers/sync-env';

const current = vi.hoisted(() => ({ deps: null as AuthDeps | null }));
vi.mock('@/lib/auth/context', () => ({
  getAuthDeps: () => {
    if (!current.deps) throw new Error('dependências de teste não definidas');
    return current.deps;
  },
}));

type Status = Parameters<typeof createSyncEnv>[0];

const envs: SyncEnv[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  current.deps = null;
  while (envs.length > 0) envs.pop()?.app.close();
});

async function setup(status: Status = 'connected', active = true): Promise<SyncEnv> {
  const env = await createSyncEnv(status, active);
  envs.push(env);
  current.deps = env.auth;
  return env;
}

function jsonRequest(method: string, path: string, body: unknown): Request {
  return new Request(`http://localhost:3102${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function errorCode(response: Response): Promise<string> {
  const data = (await response.json()) as { error?: { code?: string } };
  return data.error?.code ?? '';
}

function seedRun(env: SyncEnv, status: 'completed' | 'partial', modules: string[]): number {
  const connectionId = findConnection(env.db, env.instanceId)?.id ?? 0;
  return env.db
    .insert(syncRuns)
    .values({
      instanceId: env.instanceId,
      connectionId,
      identityLabel: 'Chave sintética',
      kind: 'full',
      status,
      startedAt: 1,
      finishedAt: 2,
      modulesRequested: modules,
    })
    .returning({ id: syncRuns.id })
    .get().id;
}

describe('rotas /api/sync: estado da conexão (409 com código)', () => {
  it('sem instância ativa responde 409 no_active_instance', async () => {
    await setup('connected', false);
    const response = await fullRoute();
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('no_active_instance');
  });

  it('sem conexão responde 409 no_connection', async () => {
    await setup(null);
    const response = await fullRoute();
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('no_connection');
  });

  it('sessão expirada responde 409 session_expired', async () => {
    await setup('session_expired');
    const response = await fullRoute();
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('session_expired');
  });

  it('conexão desconectada responde 409 connection_not_ready', async () => {
    await setup('disconnected');
    const response = await fullRoute();
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('connection_not_ready');
  });
});

describe('rotas /api/sync: execução', () => {
  it('full responde 202 e o status mostra o progresso até o fim', async () => {
    const env = await setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubFetch(async () => {
      await gate;
      return emptyPage();
    });
    const response = await fullRoute();
    expect(response.status).toBe(202);
    const started = (await response.json()) as { runId: number };
    const during = (await (await statusRoute()).json()) as Record<string, unknown>;
    expect(during.running).toBe(true);
    expect(during.runId).toBe(started.runId);
    release();
    await waitForSync(env.instanceId);
    const after = (await (await statusRoute()).json()) as Record<string, unknown>;
    expect(after.running).toBe(false);
    const last = after.lastRun as Record<string, unknown>;
    expect(last.id).toBe(started.runId);
    expect(last.status).not.toBe('running');
  });

  it('cancel interrompe a execução ativa; sem execução responde 409 no_active_sync', async () => {
    const env = await setup();
    const idle = await cancelRoute();
    expect(idle.status).toBe(409);
    expect(await errorCode(idle)).toBe('no_active_sync');

    stubFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Cancelado.', 'AbortError')));
    }));
    const started = (await (await fullRoute()).json()) as { runId: number };
    const response = await cancelRoute();
    expect(response.status).toBe(202);
    await waitForSync(env.instanceId);
    const row = env.db.select().from(syncRuns).where(eq(syncRuns.id, started.runId)).get();
    expect(row?.status).toBe('cancelled');
  });

  it('resync exige execução anterior concluída', async () => {
    const env = await setup();
    const blocked = await resyncRoute();
    expect(blocked.status).toBe(409);
    expect(await errorCode(blocked)).toBe('no_previous_run');

    seedRun(env, 'completed', ['tickets.tickets']);
    stubFetch(emptyPage);
    const allowed = await resyncRoute();
    expect(allowed.status).toBe(202);
    await waitForSync(env.instanceId);
  });

  it('retry repete só os módulos com falha do run indicado', async () => {
    const env = await setup();
    const runId = seedRun(env, 'partial', ['tickets.tickets', 'users_groups.agents']);
    env.db
      .insert(syncModuleResults)
      .values([
        { runId, moduleKey: 'tickets.tickets', status: 'failed' },
        { runId, moduleKey: 'users_groups.agents', status: 'completed', complete: true },
      ])
      .run();
    const calls = stubFetch(emptyPage);

    const invalid = await retryRoute(jsonRequest('POST', '/api/sync/retry', { runId: 'x' }));
    expect(invalid.status).toBe(400);
    expect(await errorCode(invalid)).toBe('invalid_input');

    const response = await retryRoute(jsonRequest('POST', '/api/sync/retry', { runId }));
    expect(response.status).toBe(202);
    await waitForSync(env.instanceId);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((url) => url.pathname === '/api/v2/tickets')).toBe(true);
  });
});

describe('rotas /api/sync/preferences', () => {
  it('GET traz o padrão; PUT valida e grava; a seleção segue as preferências', async () => {
    const env = await setup();
    const initial = (await (await getPrefs()).json()) as { modules: string[]; metadataOnly: Record<string, boolean>; storeRaw: boolean };
    // GET devolve a visão efetiva por endpoint: todos os consultáveis selecionados por padrão.
    expect(initial.modules).toEqual(syncableAdapters().map((adapter) => adapter.key));
    expect(initial.metadataOnly['tickets.tickets']).toBe(true);
    expect(initial.metadataOnly['knowledge_base.articles']).toBe(true);
    expect(initial.metadataOnly['users_groups.agents']).toBe(false);
    expect(initial.storeRaw).toBe(false);

    const unknownKey = await putPrefs(jsonRequest('PUT', '/api/sync/preferences', { modules: ['nao_existe'], metadataOnly: {}, storeRaw: false }));
    expect(unknownKey.status).toBe(400);
    expect(await errorCode(unknownKey)).toBe('invalid_input');

    const extraField = await putPrefs(jsonRequest('PUT', '/api/sync/preferences', { modules: [], metadataOnly: {}, storeRaw: false, token: 'x' }));
    expect(extraField.status).toBe(400);

    const ok = await putPrefs(jsonRequest('PUT', '/api/sync/preferences', { modules: ['tickets'], metadataOnly: { tickets: false }, storeRaw: true }));
    expect(ok.status).toBe(200);
    const saved = (await (await getPrefs()).json()) as { modules: string[]; metadataOnly: Record<string, boolean>; storeRaw: boolean };
    expect(saved.modules).toEqual(syncableAdapters().filter((adapter) => adapter.moduleGroup === 'tickets').map((adapter) => adapter.key));
    expect(saved.metadataOnly['tickets.tickets']).toBe(false);
    expect(saved.storeRaw).toBe(true);
    const keys = selectedModuleKeys(env.db);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((key) => key.startsWith('tickets.'))).toBe(true);
  });
});
