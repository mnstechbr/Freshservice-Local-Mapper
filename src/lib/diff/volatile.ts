/*
 * Políticas por módulo, usadas pelo diff e pelo hash de conteúdo.
 *
 * VOLÁTEIS: metadados que mudam sem mudança de conteúdo. São removidos (em qualquer
 * profundidade) antes da canonicalização e do hash. A chave "*" vale para todos os módulos.
 *
 * SEMPRE RETORNADAS: chaves que a API sempre devolve para o módulo. Só nelas uma ausência
 * em um dos lados conta como added/removed. Chave ausente em um lado e fora dessa lista é
 * ignorada, porque pode ser omissão da API e não remoção do dado.
 *
 * Os módulos abaixo vêm de src/lib/modules/catalog.ts. A lista exata por módulo deve ser
 * revisada com as respostas reais da API (pendência da Fase 4/5).
 */

// Revisão da etapa 4 (recuperação): created_at NÃO é volátil (não muda sem alteração do registro).
export const VOLATILE_KEYS_BY_MODULE: Readonly<Record<string, readonly string[]>> = {
  '*': [
    'updated_at',
    'updated_time',
    'last_updated_at',
    'last_modified_at',
    'last_login',
    'last_login_at',
    'last_sign_in_at',
    'last_active',
    'last_active_at',
    'last_activity_at',
    'last_seen',
    'last_seen_at',
    'last_sync_at',
    'synced_at',
    'captured_at',
    'fetched_at',
  ],
};

export const ALWAYS_RETURNED_BY_MODULE: Readonly<Record<string, readonly string[]>> = {
  '*': ['name'],
};

export function volatileKeysFor(moduleKey: string): ReadonlySet<string> {
  return new Set([...(VOLATILE_KEYS_BY_MODULE['*'] ?? []), ...(VOLATILE_KEYS_BY_MODULE[moduleKey] ?? [])]);
}

export function alwaysReturnedFor(moduleKey: string): ReadonlySet<string> {
  return new Set([
    ...(ALWAYS_RETURNED_BY_MODULE['*'] ?? []),
    ...(ALWAYS_RETURNED_BY_MODULE[moduleKey] ?? []),
  ]);
}
