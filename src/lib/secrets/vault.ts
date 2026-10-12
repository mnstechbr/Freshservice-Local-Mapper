import 'server-only';
import { type CommandRunner, CommandTimeoutError } from './command';
import { buildSecretStores } from './probe';
import {
  NO_VAULT_MESSAGE,
  type SecretBackend,
  type SecretStore,
  SecretStoreError,
  SecretStoreUnavailableError,
  newSecretRef,
  parseSecretRef,
} from './types';

export interface VaultOptions {
  /** Diretório de dados (já validado por resolveDataDir). */
  dataDir: string;
  /** Variáveis de ambiente (lê FSLM_SECRET_KEY). */
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  runner?: CommandRunner;
  newId?: () => string;
}

export interface VaultStatus {
  backend: SecretBackend;
  available: boolean;
  reason?: string;
}

/** Roteador de cofres. Grava no primeiro backend disponível e lê pelo prefixo da referência. */
export interface SecretVault {
  /** Grava um segredo novo e devolve a referência (nunca o valor). Falha se nenhum cofre seguro existe. */
  store(value: string): Promise<string>;
  read(ref: string): Promise<string | null>;
  remove(ref: string): Promise<void>;
  status(): Promise<VaultStatus[]>;
}

/** Motivo curto de uma gravação recusada. Nunca inclui o valor nem texto bruto de programas externos. */
function writeFailureReason(error: unknown): string {
  if (error instanceof CommandTimeoutError) {
    return 'tempo esgotado ao gravar (cofre bloqueado ou aguardando senha)';
  }
  if (error instanceof SecretStoreError || error instanceof SecretStoreUnavailableError) {
    return error.message;
  }
  return 'falha ao gravar';
}

/**
 * Ordem de gravação: Secret Service (libsecret/Keychain/DPAPI) se a sonda responder; senão arquivo
 * AES-GCM se FSLM_SECRET_KEY for válida; senão erro. Se o backend disponível recusar a gravação
 * (ex.: chaveiro bloqueado), tenta o próximo. Leitura e remoção não varrem backends: a referência
 * indica o backend que guarda o segredo, então segredos antigos continuam acessíveis.
 */
export function createSecretVault(options: VaultOptions): SecretVault {
  const newId = options.newId;
  // Mesma ordem de preferência da sonda (probe.ts): alterar a ordem exige mudar só lá.
  const stores = buildSecretStores(options);

  const byBackend = new Map(stores.map((store) => [store.backend, store]));

  const storeFor = async (ref: string): Promise<SecretStore> => {
    const { backend } = parseSecretRef(ref);
    const store = byBackend.get(backend);
    if (!store) throw new SecretStoreUnavailableError(NO_VAULT_MESSAGE);
    const availability = await store.isAvailable();
    if (!availability.available) {
      throw new SecretStoreUnavailableError(
        `Cofre indisponível (${backend}): ${availability.reason ?? 'sem detalhe'}.`,
      );
    }
    return store;
  };

  return {
    async store(value) {
      const reasons: string[] = [];
      for (const [index, store] of stores.entries()) {
        const availability = await store.isAvailable();
        if (!availability.available) {
          reasons.push(`${store.backend}: ${availability.reason ?? 'indisponível'}`);
          continue;
        }
        const ref = newSecretRef(store.backend, newId?.());
        try {
          await store.set(ref, value);
          return ref;
        } catch (error) {
          // O último backend é o arquivo criptografado: seu erro real (ex.: arquivo corrompido) é mantido.
          if (index === stores.length - 1) throw error;
          // Cofre disponível que recusou a gravação: tenta o próximo. Nada é gravado em texto aberto.
          reasons.push(`${store.backend}: ${writeFailureReason(error)}`);
        }
      }
      throw new SecretStoreUnavailableError(`${NO_VAULT_MESSAGE} Motivos: ${reasons.join(' | ')}`);
    },

    async read(ref) {
      return (await storeFor(ref)).get(ref);
    },

    async remove(ref) {
      await (await storeFor(ref)).delete(ref);
    },

    async status() {
      return Promise.all(
        stores.map(async (store) => {
          const availability = await store.isAvailable();
          return {
            backend: store.backend,
            available: availability.available,
            ...(availability.reason ? { reason: availability.reason } : {}),
          };
        }),
      );
    },
  };
}
