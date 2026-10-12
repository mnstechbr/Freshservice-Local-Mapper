import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../src/lib/db/schema';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export const EXPECTED_TABLES = [
  'instances',
  'connections',
  'api_modules',
  'sync_runs',
  'sync_module_results',
  'resources',
  'resource_versions',
  'resource_relations',
  'detected_changes',
  'change_matches',
  'audit_events',
  'app_settings',
] as const;

export const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

/** Diretório temporário isolado. Testes nunca usam o diretório de dados real do usuário. */
export function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'fslm-test-'));
}

export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export function openTestDb(dbPath: string) {
  const sqlite = new Database(dbPath, { fileMustExist: true });
  sqlite.pragma('foreign_keys = ON');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}
