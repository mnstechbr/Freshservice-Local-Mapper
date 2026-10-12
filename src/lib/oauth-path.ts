/**
 * Prefixo dos caminhos OAuth Freshworks (authorize e token), campo `path_prefix` da configuração.
 *
 * A doc oficial é ambígua: o texto cita `https://<org>/oauth/v2/...`, e os exemplos usam
 * `https://<org>/org/oauth/v2/...`. O padrão para configurações novas é '/org', porque é a forma
 * dos exemplos concretos da doc. '' fica disponível para quem precisar do texto literal.
 * Configurações salvas antes deste campo existir são lidas como '' (comportamento anterior).
 *
 * Constantes puras, sem imports de servidor: são usadas pelo servidor (src/lib/auth/oauth.ts,
 * src/lib/freshservice/http.ts) e pelo formulário (use client). Não mover para lib/auth/.
 */
export const OAUTH_PATH_PREFIXES = ['', '/org'] as const;

export type OAuthPathPrefix = (typeof OAUTH_PATH_PREFIXES)[number];

/** Padrão para a primeira configuração e para o formulário. */
export const OAUTH_PATH_PREFIX_DEFAULT: OAuthPathPrefix = '/org';

/** Valor assumido para configurações salvas sem o campo (não quebra o fluxo já configurado). */
export const OAUTH_PATH_PREFIX_LEGACY: OAuthPathPrefix = '';

/** Normaliza um valor lido do banco: só '/org' é aceito; qualquer outra coisa vira ''. */
export function normalizeOAuthPathPrefix(value: unknown): OAuthPathPrefix {
  return value === '/org' ? '/org' : OAUTH_PATH_PREFIX_LEGACY;
}
