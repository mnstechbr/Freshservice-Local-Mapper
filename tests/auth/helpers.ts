import { join } from 'node:path';
import { createAuditLogger } from '../../src/lib/audit/logger';
import { DB_FILE_NAME } from '../../src/lib/config/paths';
import { prepareDatabase } from '../../src/lib/db/bootstrap';
import type { AppDb } from '../../src/lib/db/client';
import type { AuthDeps } from '../../src/lib/auth/deps';
import type { SecretVault } from '../../src/lib/secrets/vault';
import { loadOrCreateSigningKey } from '../../src/lib/security/signing';
import { MIGRATIONS_FOLDER, makeTempDir, openTestDb, removeTempDir } from '../helpers/db';
import { useFakePublicDns } from '../helpers/dns';

/** Porta usada nos testes (a redirect_uri de OAuth depende dela). */
export const TEST_PORT = 3102;
export const INSTANCE_ORIGIN = 'https://acme-fslm.freshservice.com';
export const ORG_ORIGIN = 'https://fslm-org.myfreshworks.com';
export const CALLBACK_URL = `http://127.0.0.1:${TEST_PORT}/api/auth/oauth/callback`;

/** Valores sintéticos. Nunca são credenciais reais. */
export const SYNTHETIC = {
  apiKey: 'FSK-SYNTHETIC-KEY-0001',
  otherApiKey: 'FSK-SYNTHETIC-KEY-0002',
  clientId: 'client-id-synthetic-01',
  clientSecret: 'CLIENT-SECRET-SYNTHETIC-9999',
  code: 'CODE-SYNTHETIC-7777',
  accessToken: 'ACCESS-SYNTHETIC-TOKEN-AAA',
  refreshToken: 'REFRESH-SYNTHETIC-TOKEN-BBB',
  renewedAccessToken: 'ACCESS-SYNTHETIC-TOKEN-CCC',
} as const;

export const ALL_SECRET_VALUES = Object.values(SYNTHETIC);

export type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

export interface RecordedCall {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export interface MemoryVault extends SecretVault {
  entries: Map<string, string>;
}

/** Cofre em memória: a API do SecretVault sem criptografia, para testes de fluxo. */
export function createMemoryVault(): MemoryVault {
  const entries = new Map<string, string>();
  let counter = 0;
  return {
    entries,
    async store(value) {
      counter += 1;
      const ref = `encrypted-file:00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
      entries.set(ref, value);
      return ref;
    },
    async read(ref) {
      return entries.get(ref) ?? null;
    },
    async remove(ref) {
      entries.delete(ref);
    },
    async status() {
      return [{ backend: 'encrypted-file', available: true }];
    },
  };
}

export interface Harness {
  deps: AuthDeps;
  db: AppDb;
  vault: MemoryVault;
  calls: RecordedCall[];
  clock: { now: number };
  setHandler(handler: Handler): void;
  /** Texto de todas as linhas de audit_events, para checar vazamentos. */
  auditText(): string;
  cleanup(): void;
}

const BASE_TIME = 1_700_000_000_000;

/** Ambiente isolado: banco temporário, relógio manual, fetch mockado e cofre em memória. */
export function createHarness(initialHandler?: Handler): Harness {
  useFakePublicDns();
  const dir = makeTempDir();
  prepareDatabase({ dataDir: dir, migrationsFolder: MIGRATIONS_FOLDER });
  const test = openTestDb(join(dir, DB_FILE_NAME));

  const clock = { now: BASE_TIME };
  const now = () => clock.now;
  const calls: RecordedCall[] = [];
  let handler: Handler = initialHandler ?? (() => json({ unexpected: true }, 500));

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      body: typeof init?.body === 'string' ? init.body : null,
    });
    return handler(url, init ?? {});
  }) as unknown as typeof fetch;

  const vault = createMemoryVault();
  const signingKey = loadOrCreateSigningKey(dir);
  const deps: AuthDeps = {
    db: test.db,
    vault,
    audit: createAuditLogger(test.db, { now }),
    dataDir: dir,
    port: TEST_PORT,
    dev: false,
    fetchImpl,
    now,
    timeoutMs: 2_000,
    getSigningKey: () => signingKey,
  };

  return {
    deps,
    db: test.db,
    vault,
    calls,
    clock,
    setHandler(next) {
      handler = next;
    },
    auditText() {
      const rows = test.sqlite
        .prepare('SELECT event_type, message, context FROM audit_events')
        .all();
      return JSON.stringify(rows);
    },
    cleanup() {
      test.sqlite.close();
      removeTempDir(dir);
    },
  };
}

/** Cookie de state a partir do Set-Cookie devolvido (apenas o par nome=valor). */
export function cookiePair(setCookie: string | undefined): string {
  if (!setCookie) throw new Error('Set-Cookie ausente');
  return setCookie.split(';')[0] ?? '';
}
