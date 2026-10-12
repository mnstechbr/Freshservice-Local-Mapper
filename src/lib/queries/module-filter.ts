import { eq, sql, type Column, type SQL } from 'drizzle-orm';

/** Chave aceita: grupo (ex.: tickets, service_catalog) ou chave pontuada (ex.: itsm.releases). */
export const MODULE_KEY_RE = /^[a-z_]+(\.[a-z_]+)?$/;

export function isModuleKey(value: string): boolean {
  return MODULE_KEY_RE.test(value);
}

/** Escapa os metacaracteres do GLOB do SQLite (* ? [ ]), cada um dentro de uma classe. */
export function escapeGlob(value: string): string {
  return value.replace(/[*?[\]]/g, (char) => `[${char}]`);
}

/**
 * Filtro por módulo sobre uma coluna `module_key`.
 * - Chave inválida (ex.: "*", "a.b.c", texto livre) não casa nenhuma linha: "0 = 1". Curingas nunca
 *   viram "casa tudo". As rotas respondem 400 antes de chegar aqui.
 * - Chave pontuada (ex.: itsm.releases): igualdade.
 * - Grupo (ex.: tickets): GLOB "<grupo>.*", com metacaracteres escapados. GLOB é usado no lugar de
 *   LIKE, porque o "_" de service_catalog seria curinga no LIKE.
 */
export function moduleFilter(column: Column, value: string): SQL {
  if (!isModuleKey(value)) return sql`0 = 1`;
  return value.includes('.') ? eq(column, value) : sql`${column} GLOB ${`${escapeGlob(value)}.*`}`;
}
