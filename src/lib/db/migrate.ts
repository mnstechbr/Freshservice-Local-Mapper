import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { DatabaseError } from './errors';

/** Tabela de controle do migrator do drizzle (nome padrão). */
export const MIGRATIONS_TABLE = '__drizzle_migrations';

/** Número de migrations previstas pelo journal gerado pelo drizzle-kit. */
export function readJournalCount(migrationsFolder: string): number {
  const journalPath = join(migrationsFolder, 'meta', '_journal.json');
  if (!existsSync(journalPath)) {
    throw new DatabaseError(
      'migration',
      `Pasta de migrations inválida: ${migrationsFolder} (arquivo meta/_journal.json não encontrado). Rode "pnpm db:generate".`,
    );
  }
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries?: unknown[] };
  return journal.entries?.length ?? 0;
}

/** Quantas migrations já foram registradas no banco (0 se a tabela de controle não existe). */
export function countAppliedMigrations(sqlite: Database.Database): number {
  const exists = sqlite
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(MIGRATIONS_TABLE);
  if (!exists) return 0;
  const row = sqlite.prepare(`SELECT COUNT(*) AS n FROM "${MIGRATIONS_TABLE}"`).get() as {
    n: number;
  };
  return row.n;
}

/** Aplica as migrations pendentes. É idempotente: migrations já registradas são ignoradas. */
export function applyMigrations(sqlite: Database.Database, migrationsFolder: string): void {
  try {
    migrate(drizzle(sqlite), { migrationsFolder, migrationsTable: MIGRATIONS_TABLE });
  } catch (err) {
    throw new DatabaseError(
      'migration',
      `Falha ao aplicar as migrations em ${migrationsFolder}: ${err instanceof Error ? err.message : String(err)}. O banco foi revertido para o estado anterior da migration que falhou.`,
      { cause: err },
    );
  }
}
