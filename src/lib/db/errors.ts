export type DatabaseErrorKind =
  | 'data_dir'
  | 'open'
  | 'corrupt'
  | 'not_sqlite'
  | 'migration'
  | 'native_module';

/** Erro de banco com diagnóstico. Mensagens são em português e não incluem segredos. */
export class DatabaseError extends Error {
  readonly kind: DatabaseErrorKind;
  readonly sqliteCode?: string;

  constructor(
    kind: DatabaseErrorKind,
    message: string,
    options: { cause?: unknown; sqliteCode?: string } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'DatabaseError';
    this.kind = kind;
    this.sqliteCode = options.sqliteCode;
  }
}

export function errorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const FS_MESSAGES: Record<string, string> = {
  EACCES: 'sem permissão',
  EPERM: 'operação não permitida',
  EISDIR: 'o caminho é um diretório',
  ENOTDIR: 'parte do caminho não é um diretório',
  ENOSPC: 'sem espaço em disco',
  EROFS: 'sistema de arquivos somente leitura',
};

export function describeSystemError(err: unknown): string {
  const code = errorCode(err);
  const text = code && FS_MESSAGES[code] ? FS_MESSAGES[code] : errorMessage(err);
  return code ? `${text} (${code})` : text;
}

export function isNativeLoadError(err: unknown): boolean {
  const message = errorMessage(err);
  return (
    errorCode(err) === 'ERR_DLOPEN_FAILED' ||
    message.includes('better_sqlite3.node') ||
    message.includes('NODE_MODULE_VERSION')
  );
}

export function nativeModuleError(err: unknown): DatabaseError {
  return new DatabaseError(
    'native_module',
    `O módulo nativo better-sqlite3 não pôde ser carregado neste Node (${process.version}). Rode "pnpm rebuild better-sqlite3" (ou "npm rebuild better-sqlite3") e tente de novo. Detalhe: ${errorMessage(err)}`,
    { cause: err },
  );
}

/** Erro ao abrir o arquivo de banco, com a causa traduzida. */
export function openError(dbPath: string, err: unknown): DatabaseError {
  if (isNativeLoadError(err)) return nativeModuleError(err);
  const sqliteCode = errorCode(err)?.startsWith('SQLITE_') ? errorCode(err) : undefined;
  return new DatabaseError(
    'open',
    `Não foi possível abrir o banco ${dbPath}: ${describeSystemError(err)}. Verifique as permissões e se o caminho não é um diretório. Nada foi alterado.`,
    { cause: err, sqliteCode },
  );
}
