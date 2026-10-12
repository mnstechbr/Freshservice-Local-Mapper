import 'server-only';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { resolveDataDir } from '../config/paths';
import { prepareDatabase } from './bootstrap';
import * as schema from './schema';

export type AppDb = BetterSQLite3Database<typeof schema>;

export interface DbHandle {
  sqlite: Database.Database;
  db: AppDb;
  dbPath: string;
  migrationsApplied: number;
}

const HANDLE_KEY = '__fslmDbHandle';

/**
 * Conexão única por processo. Fica em globalThis para sobreviver ao HMR do Next.js em dev.
 * A primeira chamada prepara o banco (cria, checa integridade e migra). Erros não são cacheados,
 * então uma nova chamada tenta de novo.
 */
export function getDbHandle(): DbHandle {
  const globalState = globalThis as unknown as Record<string, DbHandle | undefined>;
  const existing = globalState[HANDLE_KEY];
  if (existing) return existing;

  const dataDir = resolveDataDir();
  const prepared = prepareDatabase({ dataDir });

  const sqlite = new Database(prepared.dbPath, { fileMustExist: true, timeout: 5000 });
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const handle: DbHandle = {
    sqlite,
    db: drizzle(sqlite, { schema }),
    dbPath: prepared.dbPath,
    migrationsApplied: prepared.migrationsApplied,
  };
  globalState[HANDLE_KEY] = handle;
  return handle;
}

export function getDb(): AppDb {
  return getDbHandle().db;
}
