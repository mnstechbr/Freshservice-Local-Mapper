import { closeSync, openSync, readSync, statSync } from 'node:fs';
import Database from 'better-sqlite3';
import {
  DatabaseError,
  errorCode,
  errorMessage,
  isNativeLoadError,
  nativeModuleError,
  openError,
} from './errors';

const SQLITE_HEADER = 'SQLite format 3\u0000';

/**
 * Verifica um banco existente SEM modificá-lo: abre em modo somente leitura e roda
 * PRAGMA quick_check. Nunca apaga, recria ou sobrescreve o arquivo.
 * Lança DatabaseError com diagnóstico quando o arquivo não é um banco válido.
 */
export function checkDatabaseIntegrity(dbPath: string): void {
  let messages: string[];
  let sqlite: Database.Database | undefined;
  try {
    sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rows = sqlite.pragma('quick_check') as Array<Record<string, unknown>>;
    messages = rows.map((row) => String(Object.values(row)[0]));
  } catch (err) {
    throw describeFailure(dbPath, err);
  } finally {
    sqlite?.close();
  }

  if (messages.length === 1 && messages[0] === 'ok') return;

  const details = messages.slice(0, 5).join(' | ');
  throw new DatabaseError(
    'corrupt',
    `O banco ${dbPath} está corrompido (PRAGMA quick_check: ${details}). Nada foi apagado ou sobrescrito. Faça uma cópia de segurança do arquivo e restaure um backup; ou mova o arquivo para outro local (ou defina FSLM_DATA_DIR) para criar um banco novo.`,
  );
}

function describeFailure(dbPath: string, err: unknown): DatabaseError {
  if (isNativeLoadError(err)) return nativeModuleError(err);

  const code = errorCode(err);
  const info = fileInfo(dbPath);

  if (code === 'SQLITE_NOTADB') {
    return new DatabaseError(
      'not_sqlite',
      `O arquivo ${dbPath} não é um banco SQLite válido (${info}). Nada foi alterado: faça uma cópia de segurança e restaure um backup, ou mova o arquivo e rode de novo para criar um banco novo.`,
      { cause: err, sqliteCode: code },
    );
  }

  if (code === 'SQLITE_CORRUPT') {
    return new DatabaseError(
      'corrupt',
      `O banco ${dbPath} está corrompido (${errorMessage(err)}; ${info}). Nada foi apagado ou sobrescrito. Faça uma cópia de segurança e restaure um backup.`,
      { cause: err, sqliteCode: code },
    );
  }

  return openError(dbPath, err);
}

function fileInfo(dbPath: string): string {
  try {
    const size = statSync(dbPath).size;
    const header = readHeaderIsValid(dbPath);
    return `${size} bytes; cabeçalho SQLite ${header ? 'válido' : 'ausente ou inválido'}`;
  } catch {
    return 'arquivo ilegível';
  }
}

function readHeaderIsValid(file: string): boolean {
  const fd = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(SQLITE_HEADER.length);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return bytesRead === buffer.length && buffer.toString('latin1') === SQLITE_HEADER;
  } finally {
    closeSync(fd);
  }
}
