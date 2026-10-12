import { NextRequest } from 'next/server';
import type { AuthDeps } from '@/lib/auth/deps';
import { createAuditLogger } from '@/lib/audit/logger';
import { prepareDatabase } from '@/lib/db/bootstrap';
import type { AppDb } from '@/lib/db/client';
import { loadOrCreateSigningKey } from '@/lib/security/signing';
import { proxy } from '@/proxy';
import { createMemoryVault, type MemoryVault } from '../auth/helpers';
import { MIGRATIONS_FOLDER, makeTempDir, openTestDb, removeTempDir } from '../helpers/db';
import { FakeFreshservice } from './fake-freshservice';

export const E2E_PORT = 3000;
export const LOCAL_ORIGIN = `http://127.0.0.1:${E2E_PORT}`;
/** Chave fictícia. Usada só para checar que nunca vaza para respostas, banco ou audit. */
export const E2E_API_KEY = 'fake-key-123';
export const E2E_BASE_URL = 'https://acme-test.freshservice.com';

const MUTABLE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface E2eEnv {
  deps: AuthDeps;
  db: AppDb;
  sqlite: ReturnType<typeof openTestDb>['sqlite'];
  vault: MemoryVault;
  fake: FakeFreshservice;
  /** Corpo de toda resposta devolvida por `call`, para checar vazamentos. */
  bodies: string[];
  cleanup(): void;
}

/** Banco temporário com migrations, cofre em memória, relógio real e fetch sintético. */
export function createE2eEnv(): E2eEnv {
  const dir = makeTempDir();
  const prepared = prepareDatabase({ dataDir: dir, migrationsFolder: MIGRATIONS_FOLDER });
  const { sqlite, db } = openTestDb(prepared.dbPath);
  const fake = new FakeFreshservice();
  const vault = createMemoryVault();
  const signingKey = loadOrCreateSigningKey(dir);
  const now = () => Date.now();
  const deps: AuthDeps = {
    db,
    vault,
    audit: createAuditLogger(db, { now }),
    dataDir: dir,
    port: E2E_PORT,
    dev: false,
    fetchImpl: fake.fetch as unknown as typeof fetch,
    now,
    timeoutMs: 2_000,
    getSigningKey: () => signingKey,
  };
  const previousPort = process.env.PORT;
  process.env.PORT = String(E2E_PORT);
  return {
    deps,
    db,
    sqlite,
    vault,
    fake,
    bodies: [],
    cleanup() {
      if (previousPort === undefined) delete process.env.PORT;
      else process.env.PORT = previousPort;
      sqlite.close();
      removeTempDir(dir);
    },
  };
}

export interface RouteContext {
  params: Promise<{ id: string }>;
}

export type RouteHandler = (request: Request, context: RouteContext) => Response | Promise<Response>;

export interface CallOptions {
  body?: unknown;
  /** Origin do navegador. Padrão: origem local (só métodos mutáveis enviam Origin). */
  origin?: string;
  /** Parâmetro de rota dinâmica (ex.: id de /api/changes/[id]). */
  id?: string;
}

/**
 * Chama uma rota como o servidor faria: antes passa pelo guarda de Host e Origin de src/proxy.ts;
 * se o guarda recusar, a resposta 403 é devolvida e a rota não roda.
 */
export async function call(
  env: E2eEnv,
  handler: RouteHandler,
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<Response> {
  const url = `${LOCAL_ORIGIN}${path}`;
  const guardHeaders: Record<string, string> = { host: `127.0.0.1:${E2E_PORT}` };
  const headers: Record<string, string> = {};
  if (MUTABLE_METHODS.has(method)) {
    guardHeaders.origin = options.origin ?? LOCAL_ORIGIN;
    headers.origin = guardHeaders.origin;
  }
  const guard = proxy(new NextRequest(url, { method, headers: guardHeaders }));
  if (guard.status === 403) {
    env.bodies.push(await guard.clone().text());
    return guard;
  }
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const request = new Request(url, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const response = await handler(request, { params: Promise.resolve({ id: options.id ?? '' }) });
  env.bodies.push(await response.clone().text());
  return response;
}

/** Todas as tabelas do banco em JSON, para procurar segredos em qualquer lugar. */
export function dumpDatabase(sqlite: E2eEnv['sqlite']): string {
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
    name: string;
  }>;
  return tables.map(({ name }) => JSON.stringify(sqlite.prepare(`SELECT * FROM "${name}"`).all())).join('\n');
}
