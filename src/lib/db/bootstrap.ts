import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { DB_FILE_NAME } from '../config/paths';
import { DatabaseError, describeSystemError, errorCode, openError } from './errors';
import { checkDatabaseIntegrity } from './integrity';
import { applyMigrations, countAppliedMigrations, readJournalCount } from './migrate';

export interface PrepareDatabaseOptions {
  /** Diretório de dados já resolvido (ver resolveDataDir). Testes passam um diretório temporário. */
  dataDir: string;
  /** Pasta com as migrations do drizzle-kit (padrão: <cwd>/drizzle). */
  migrationsFolder?: string;
}

export interface PrepareDatabaseResult {
  dbPath: string;
  /** true se o arquivo foi criado nesta execução. */
  createdFile: boolean;
  /** Migrations aplicadas nesta execução. */
  migrationsApplied: number;
  /** Migrations previstas pelo journal. */
  migrationsTotal: number;
  journalMode: string;
}

const IS_POSIX = process.platform !== 'win32';
const BUSY_TIMEOUT_MS = 5000;

/**
 * Prepara o banco de dados de forma idempotente:
 * cria diretório (0700) e arquivo (0600) se faltam; verifica integridade sem modificar um
 * banco existente; ativa WAL e foreign_keys; aplica migrations pendentes; valida com SELECT 1.
 * Nunca apaga nem sobrescreve um arquivo existente.
 */
export function prepareDatabase(options: PrepareDatabaseOptions): PrepareDatabaseResult {
  const migrationsFolder = options.migrationsFolder ?? resolve(process.cwd(), 'drizzle');

  ensureDataDir(options.dataDir);
  const dbPath = join(options.dataDir, DB_FILE_NAME);

  const createdFile = !existsSync(dbPath) && createEmptyDbFile(dbPath);
  checkDatabaseIntegrity(dbPath);
  restrictPermissions(dbPath);

  const sqlite = openForWrite(dbPath);
  try {
    const journalMode = configureConnection(sqlite);
    const before = countAppliedMigrations(sqlite);
    applyMigrations(sqlite, migrationsFolder);
    const after = countAppliedMigrations(sqlite);
    const total = readJournalCount(migrationsFolder);
    if (after !== total) {
      throw new DatabaseError(
        'migration',
        `Após aplicar as migrations, o banco tem ${after} registradas, mas o journal prevê ${total}.`,
      );
    }

    const ping = sqlite.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
    if (ping?.ok !== 1) {
      throw new DatabaseError('open', 'Validação SELECT 1 falhou após preparar o banco.');
    }

    restrictPermissions(dbPath);
    return {
      dbPath,
      createdFile,
      migrationsApplied: after - before,
      migrationsTotal: total,
      journalMode,
    };
  } finally {
    sqlite.close();
  }
}

function ensureDataDir(dataDir: string): void {
  try {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    if (IS_POSIX) chmodSync(dataDir, 0o700);
  } catch (err) {
    throw new DatabaseError(
      'data_dir',
      `Não foi possível criar ou acessar o diretório de dados ${dataDir}: ${describeSystemError(err)}. Ajuste as permissões ou defina FSLM_DATA_DIR.`,
      { cause: err },
    );
  }
}

/** Cria um arquivo vazio (0600) apenas se não existir. Retorna true se criou. */
function createEmptyDbFile(dbPath: string): boolean {
  try {
    closeSync(openSync(dbPath, 'wx', 0o600));
    return true;
  } catch (err) {
    if (errorCode(err) === 'EEXIST') return false;
    throw new DatabaseError(
      'open',
      `Não foi possível criar o banco ${dbPath}: ${describeSystemError(err)}.`,
      { cause: err },
    );
  }
}

function openForWrite(dbPath: string): Database.Database {
  try {
    return new Database(dbPath, { fileMustExist: true, timeout: BUSY_TIMEOUT_MS });
  } catch (err) {
    throw openError(dbPath, err);
  }
}

function configureConnection(sqlite: Database.Database): string {
  const journalMode = String(sqlite.pragma('journal_mode = WAL', { simple: true })).toLowerCase();
  if (journalMode !== 'wal') {
    throw new DatabaseError('open', `Não foi possível ativar o modo WAL (modo atual: ${journalMode}).`);
  }
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  return journalMode;
}

/** Restringe banco e arquivos auxiliares WAL/SHM a 0600 (somente POSIX). */
function restrictPermissions(dbPath: string): void {
  if (!IS_POSIX) return;
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    // turbopackIgnore: o caminho vem do diretório de dados (runtime); evita rastrear o projeto inteiro.
    if (!existsSync(/* turbopackIgnore: true */ file)) continue;
    try {
      chmodSync(/* turbopackIgnore: true */ file, 0o600);
    } catch (err) {
      if (file === dbPath) {
        throw new DatabaseError(
          'open',
          `Não foi possível restringir as permissões (0600) de ${file}: ${describeSystemError(err)}.`,
          { cause: err },
        );
      }
    }
  }
}
