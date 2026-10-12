import 'server-only';
import { dirname } from 'node:path';
import { createAuditLogger } from '../audit/logger';
import { parseEnv } from '../config/env';
import { getDbHandle } from '../db/client';
import { createSecretVault } from '../secrets/vault';
import { loadOrCreateSigningKey } from '../security/signing';
import { type AuthDeps, FRESHSERVICE_TIMEOUT_MS } from './deps';

const CACHE_KEY = '__fslmAuthDeps';

/**
 * Dependências reais do processo (banco, cofre, relógio, fetch). Fica em globalThis para sobreviver
 * ao HMR do Next em dev, como a conexão do banco. Os testes não usam esta função.
 */
export function getAuthDeps(): AuthDeps {
  const globalState = globalThis as unknown as Record<string, AuthDeps | undefined>;
  const cached = globalState[CACHE_KEY];
  if (cached) return cached;

  const handle = getDbHandle();
  const dataDir = dirname(handle.dbPath);
  const env = parseEnv(process.env);
  const now = () => Date.now();
  let signingKey: Buffer | null = null;

  const deps: AuthDeps = {
    db: handle.db,
    vault: createSecretVault({ dataDir, env: process.env, platform: process.platform }),
    audit: createAuditLogger(handle.db, { now }),
    dataDir,
    port: env.PORT,
    dev: process.env.NODE_ENV === 'development',
    fetchImpl: fetch,
    now,
    timeoutMs: FRESHSERVICE_TIMEOUT_MS,
    getSigningKey: () => {
      signingKey ??= loadOrCreateSigningKey(dataDir);
      return signingKey;
    },
  };
  globalState[CACHE_KEY] = deps;
  return deps;
}
