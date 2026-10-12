/*
 * Checagem de escopo antes de consultar um módulo. Vale só para conexão OAuth com perfil de
 * integração: o módulo cujo escopo GET (MODULE_GET_SCOPES) não está concedido ao perfil não gera
 * chamada à API e fica com access_detail 'scope_not_granted'. API key e conexão sem perfil: sem
 * checagem. Só leitura: o mapa lista escopos de GET.
 */
import 'server-only';
import { findProfileForInstance, findProfileRow } from '../auth/profiles';
import type { ConnectionRow } from '../auth/repo';
import type { AppDb } from '../db/client';
import type { ACCESS_DETAILS } from '../db/schema';
import { MODULE_GET_SCOPES } from '../freshservice/official-scopes';
import type { ModuleAdapter } from '../freshservice/modules/types';

/** Motivo de acesso gravado em api_modules.access_detail (mesmo conjunto da coluna). */
export type AccessDetail = (typeof ACCESS_DETAILS)[number];

/** Caminho do módulo como aparece em MODULE_GET_SCOPES: sem o prefixo /api/v2. */
export function scopePathOf(adapter: Pick<ModuleAdapter, 'path'>): string {
  return adapter.path.replace(/^\/api\/v2\//, '');
}

/** Escopos GET exigidos pelo módulo (alternativas: basta um). Null: caminho fora do mapa, sem checagem. */
export function requiredScopesOf(adapter: Pick<ModuleAdapter, 'path'>): readonly string[] | null {
  return MODULE_GET_SCOPES[scopePathOf(adapter)] ?? null;
}

/**
 * Escopos concedidos ao perfil OAuth da conexão (profile.scopes). Null: sem checagem. Isso vale para
 * API key e para conexão sem perfil (nesse caso a renovação já falha com admin_config_missing antes
 * de qualquer chamada).
 */
export function grantedScopesFor(db: AppDb, connection: ConnectionRow, baseUrl: string): ReadonlySet<string> | null {
  if (connection.authMode !== 'oauth') return null;
  const profile =
    connection.integrationProfileId !== null
      ? findProfileRow(db, connection.integrationProfileId)
      : findProfileForInstance(db, baseUrl);
  return profile ? new Set(profile.scopes) : null;
}

/**
 * Alternativas de escopo exigidas quando o perfil não cobre o módulo. Null: pode consultar (sem
 * checagem, caminho fora do mapa, ou escopo coberto).
 */
export function scopeBlockFor(
  adapter: Pick<ModuleAdapter, 'path'>,
  granted: ReadonlySet<string> | null,
): readonly string[] | null {
  if (!granted) return null;
  const required = requiredScopesOf(adapter);
  if (!required || required.some((scope) => granted.has(scope))) return null;
  return required;
}

/** Mensagem fixa e sem dados da API ou do perfil: só os nomes dos escopos exigidos. */
export function scopeNotGrantedMessage(required: readonly string[]): string {
  return `Escopo não concedido ao perfil OAuth (${required.join(' ou ')}). Módulo não consultado.`;
}
