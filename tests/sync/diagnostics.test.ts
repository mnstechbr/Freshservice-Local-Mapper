import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as diagnosticsGet, POST as diagnosticsPost } from '@/app/api/diagnostics/route';
import type { AuthDeps } from '@/lib/auth/deps';
import { findConnection } from '@/lib/auth/repo';
import { getAdapter } from '@/lib/freshservice/modules';
import { waitForDiagnostics } from '@/lib/sync/diagnostics';
import { createSyncEnv, json, stubFetch, type SyncEnv } from '../helpers/sync-env';
import { SYNTHETIC_ORIGIN_A } from '../fixtures/freshservice';

const current = vi.hoisted(() => ({ deps: null as AuthDeps | null }));
vi.mock('@/lib/auth/context', () => ({
  getAuthDeps: () => {
    if (!current.deps) throw new Error('dependências de teste não definidas');
    return current.deps;
  },
}));

interface ModuleView {
  key: string;
  accessStatus: string;
  httpStatus: number | null;
  errorMessage: string | null;
}

const envs: SyncEnv[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  current.deps = null;
  while (envs.length > 0) envs.pop()?.app.close();
});

async function setup(status: Parameters<typeof createSyncEnv>[0] = 'connected'): Promise<SyncEnv> {
  const env = await createSyncEnv(status);
  envs.push(env);
  current.deps = env.auth;
  return env;
}

function pathOf(key: string): string {
  const adapter = getAdapter(key);
  if (!adapter) throw new Error(`adaptador ausente no teste: ${key}`);
  return adapter.path;
}

async function listed(): Promise<Map<string, ModuleView>> {
  const data = (await (await diagnosticsGet()).json()) as { modules: ModuleView[] };
  return new Map(data.modules.map((module) => [module.key, module] as const));
}

describe('diagnóstico de acesso', () => {
  it('classifica 200, 403, 404 e 429 e não chama adaptadores unsupported nem filhos', async () => {
    const env = await setup();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const calls = stubFetch((url) => {
      if (url.pathname === pathOf('users_groups.agents')) return json({}, 403);
      if (url.pathname === pathOf('settings.vendors')) return json({}, 404);
      if (url.pathname === pathOf('assets.assets')) return json({}, 429, { 'retry-after': '0' });
      return json({});
    });

    const response = await diagnosticsPost();
    expect(response.status).toBe(202);
    await waitForDiagnostics(env.instanceId);

    const modules = await listed();
    expect(modules.get('tickets.tickets')?.accessStatus).toBe('accessible');
    expect(modules.get('tickets.tickets')?.httpStatus).toBe(200);
    expect(modules.get('users_groups.agents')).toMatchObject({ accessStatus: 'forbidden', httpStatus: 403 });
    expect(modules.get('settings.vendors')).toMatchObject({ accessStatus: 'not_found', httpStatus: 404 });
    expect(modules.get('assets.assets')?.accessStatus).toBe('temporarily_unavailable');
    expect(calls.filter((url) => url.pathname === pathOf('assets.assets'))).toHaveLength(3);
    expect(modules.get('automations.workflows')?.accessStatus).toBe('unsupported');
    expect(modules.get('knowledge_base.folders')?.accessStatus).toBe('untested');
    expect(calls.some((url) => url.pathname === pathOf('automations.workflows'))).toBe(false);
    expect(calls.some((url) => url.pathname === pathOf('knowledge_base.folders'))).toBe(false);
    expect(calls.every((url) => url.searchParams.get('per_page') === '1' && url.searchParams.get('page') === '1')).toBe(true);

    const message = modules.get('users_groups.agents')?.errorMessage ?? '';
    expect(message).not.toContain(SYNTHETIC_ORIGIN_A);
    expect(message).not.toContain('freshservice');
  });

  it('401 marca a conexão como session_expired', async () => {
    const env = await setup();
    stubFetch((url) => (url.pathname === pathOf('users_groups.agents') ? json({}, 401) : json({})));
    await diagnosticsPost();
    await waitForDiagnostics(env.instanceId);
    expect(findConnection(env.db, env.instanceId)?.status).toBe('session_expired');
  });

  it('diagnóstico sem conexão responde 409 no_connection', async () => {
    await setup(null);
    const response = await diagnosticsPost();
    expect(response.status).toBe(409);
    const data = (await response.json()) as { error: { code: string } };
    expect(data.error.code).toBe('no_connection');
  });
});
