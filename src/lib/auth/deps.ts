import 'server-only';
import type { createAuditLogger } from '../audit/logger';
import type { AppDb } from '../db/client';
import type { SecretVault } from '../secrets/vault';
import { SecretStoreError, SecretStoreUnavailableError } from '../secrets/types';
import { AuthError } from './errors';

/** Timeout das chamadas ao Freshservice e ao Freshworks (validação, token). */
export const FRESHSERVICE_TIMEOUT_MS = 15_000;

/**
 * Dependências injetáveis do domínio de autenticação. A aplicação monta uma instância única
 * (context.ts); os testes montam a sua, com banco temporário, cofre simulado e fetch mockado.
 */
export interface AuthDeps {
  db: AppDb;
  vault: SecretVault;
  audit: ReturnType<typeof createAuditLogger>;
  /** Diretório de dados (chave de assinatura do OAuth fica aqui). */
  dataDir: string;
  /** Porta do servidor local (usada na redirect_uri). */
  port: number;
  dev: boolean;
  fetchImpl: typeof fetch;
  now: () => number;
  timeoutMs: number;
  getSigningKey: () => Buffer;
}

/** Remove um segredo antigo sem derrubar o fluxo principal; falha vira aviso de auditoria. */
export async function removeOldSecret(deps: AuthDeps, ref: string | null | undefined): Promise<void> {
  if (!ref) return;
  try {
    await deps.vault.remove(ref);
  } catch {
    deps.audit.log({
      level: 'warn',
      eventType: 'vault.remove_failed',
      message: 'Não foi possível remover um segredo antigo do cofre.',
    });
  }
}

/** Remove um segredo que precisa sumir (desconexão). Se o cofre falhar, a operação para. */
export async function removeSecretOrFail(deps: AuthDeps, ref: string): Promise<void> {
  try {
    await deps.vault.remove(ref);
  } catch {
    throw new AuthError(
      'vault_unavailable',
      503,
      'Não foi possível apagar o segredo no cofre. A conexão não foi alterada; tente de novo.',
    );
  }
}

/** Traduz erros do cofre para AuthError. As mensagens do cofre não contêm segredos. */
export function toVaultError(error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  if (error instanceof SecretStoreUnavailableError) {
    return new AuthError('vault_unavailable', 503, error.message);
  }
  if (error instanceof SecretStoreError) return new AuthError('vault_error', 500, error.message);
  return new AuthError('vault_error', 500, 'Falha no cofre de segredos.');
}

export async function storeSecret(deps: AuthDeps, value: string): Promise<string> {
  try {
    return await deps.vault.store(value);
  } catch (error) {
    throw toVaultError(error);
  }
}

export async function readSecret(deps: AuthDeps, ref: string): Promise<string | null> {
  try {
    return await deps.vault.read(ref);
  } catch (error) {
    throw toVaultError(error);
  }
}
