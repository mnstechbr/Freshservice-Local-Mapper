// NÃO importe 'server-only' aqui nem em módulos de cofre usados por este arquivo: ele é carregado
// fora do Next (scripts/start-dev.mjs via tsx). Ver tests/architecture/client-boundary.test.ts.
import { existsSync } from 'node:fs';
import { type CommandRunner, defaultCommandRunner } from './command';
import { createSecretToolStore } from './linux-secret-service';
import { createKeychainStore } from './macos-keychain';
import { createEncryptedFileStore, parseSecretKey } from './encrypted-file';
import { createDpapiStore } from './windows-dpapi';
import type { Availability, SecretBackend, SecretStore } from './types';

export interface SecretStoresOptions {
  /** Diretório de dados (já validado por resolveDataDir). */
  dataDir: string;
  /** Variáveis de ambiente (lê FSLM_SECRET_KEY). Nunca são devolvidas ao chamador. */
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  runner?: CommandRunner;
}

export interface SecretBackendProbe {
  backend: SecretBackend;
  available: boolean;
  /** Motivo curto e sem segredos, quando indisponível. */
  reason?: string;
  /** true apenas para o primeiro backend disponível: é ele que recebe as gravações. */
  preferred: boolean;
}

/**
 * Stores na ordem de preferência usada por createSecretVault: Secret Service (linux), Keychain (darwin),
 * DPAPI (win32) e, por último, o arquivo AES-GCM, que existe em qualquer plataforma.
 */
export function buildSecretStores(options: SecretStoresOptions): SecretStore[] {
  const runner = options.runner ?? defaultCommandRunner;
  const stores: SecretStore[] = [];
  if (options.platform === 'linux') stores.push(createSecretToolStore(runner));
  if (options.platform === 'darwin') {
    stores.push(createKeychainStore(runner, existsSync, options.platform));
  }
  if (options.platform === 'win32') {
    stores.push(createDpapiStore(runner, options.dataDir, options.platform, options.env));
  }
  stores.push(
    createEncryptedFileStore({
      dataDir: options.dataDir,
      secretKey: parseSecretKey(options.env.FSLM_SECRET_KEY),
    }),
  );
  return stores;
}

/** Sonda cada cofre, sem gravar nem ler segredos. O primeiro disponível é o preferido. */
export async function probeSecretBackends(
  options: SecretStoresOptions,
): Promise<SecretBackendProbe[]> {
  const probes: SecretBackendProbe[] = [];
  for (const store of buildSecretStores(options)) {
    const availability = await checkAvailability(store);
    probes.push({
      backend: store.backend,
      available: availability.available,
      ...(availability.reason ? { reason: availability.reason } : {}),
      preferred: availability.available && !probes.some((probe) => probe.preferred),
    });
  }
  return probes;
}

async function checkAvailability(store: SecretStore): Promise<Availability> {
  try {
    return await store.isAvailable();
  } catch {
    return { available: false, reason: 'falha ao verificar o cofre' };
  }
}
