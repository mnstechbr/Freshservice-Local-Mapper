import { vi } from 'vitest';
import { createAuditLogger } from '@/lib/audit/logger';
import type { AuthDeps } from '@/lib/auth/deps';
import { ACTIVE_INSTANCE_KEY, saveConnection, writeSetting } from '@/lib/auth/repo';
import type { AppDb } from '@/lib/db/client';
import type { SecretVault } from '@/lib/secrets/vault';
import { SYNTHETIC_API_KEY, SYNTHETIC_ORIGIN_A } from '../fixtures/freshservice';
import { createAppTestDb, insertRealInstance, type AppTestDb } from './app-db';
import { useFakePublicDns } from './dns';

export interface SyncEnv {
  app: AppTestDb;
  db: AppDb;
  auth: AuthDeps;
  instanceId: number;
}

type Status = 'connected' | 'session_expired' | 'disconnected';

/** Cofre em memória com referências sintéticas. */
export function memoryVault(): SecretVault {
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

/** Banco novo, instância real (ativa se active=true) e conexão de API key (se status não for null). */
export async function createSyncEnv(status: Status | null = 'connected', active = true): Promise<SyncEnv> {
  const app = createAppTestDb();
  const db = app.db;
  const vault = memoryVault();
  const instanceId = insertRealInstance(db, SYNTHETIC_ORIGIN_A);
  if (active) writeSetting(db, ACTIVE_INSTANCE_KEY, instanceId);
  if (status) {
    const secretRef = await vault.store(SYNTHETIC_API_KEY);
    saveConnection(db, instanceId, Date.now(), {
      authMode: 'api_key_personal',
      status,
      accountLabel: 'Chave sintética',
      secretRef,
    });
  }
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
  return { app, db, auth, instanceId };
}

export type FetchHandler = (url: URL, init: RequestInit) => Response | Promise<Response>;

/** Substitui o fetch global. Registra cada URL chamada. Use vi.unstubAllGlobals() no afterEach. */
export function stubFetch(handler: FetchHandler): URL[] {
  useFakePublicDns();
  const calls: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(url);
      return handler(url, init ?? {});
    }),
  );
  return calls;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** Resposta válida para qualquer listagem (lista vazia). */
export function emptyPage(): Response {
  return json({});
}
