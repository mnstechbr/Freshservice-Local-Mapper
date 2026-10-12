import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_FILE_NAME } from '../../src/lib/config/paths';
import { prepareDatabase } from '../../src/lib/db/bootstrap';
import { DatabaseError } from '../../src/lib/db/errors';
import { MIGRATIONS_TABLE, readJournalCount } from '../../src/lib/db/migrate';
import {
  EXPECTED_TABLES,
  MIGRATIONS_FOLDER,
  isRoot,
  makeTempDir,
  openTestDb,
  removeTempDir,
} from '../helpers/db';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = makeTempDir();
  dbPath = join(dir, DB_FILE_NAME);
});

afterEach(() => {
  try {
    chmodSync(dir, 0o700);
  } catch {
    // diretório pode não existir mais; a remoção abaixo trata
  }
  removeTempDir(dir);
});

function run(dataDir: string = dir) {
  return prepareDatabase({ dataDir, migrationsFolder: MIGRATIONS_FOLDER });
}

function countMigrations(sqlite: ReturnType<typeof openTestDb>['sqlite']): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS n FROM "${MIGRATIONS_TABLE}"`).get() as { n: number }).n;
}

describe('prepareDatabase', () => {
  it('primeira inicialização cria o arquivo e todas as tabelas em modo WAL', () => {
    const result = run();
    expect(result.createdFile).toBe(true);
    expect(result.journalMode).toBe('wal');
    expect(existsSync(dbPath)).toBe(true);

    const { sqlite } = openTestDb(dbPath);
    try {
      const names = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name);
      for (const table of EXPECTED_TABLES) {
        expect(names).toContain(table);
      }
    } finally {
      sqlite.close();
    }
  });

  it.skipIf(process.platform === 'win32')('usa permissões 0700 no diretório e 0600 no banco', () => {
    run();
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(dbPath).mode & 0o777).toBe(0o600);
  });

  it('aplica todas as migrations versionadas do journal', () => {
    const result = run();
    const total = readJournalCount(MIGRATIONS_FOLDER);
    expect(total).toBeGreaterThan(0);
    expect(result.migrationsApplied).toBe(total);
    expect(result.migrationsTotal).toBe(total);

    const { sqlite } = openTestDb(dbPath);
    try {
      expect(countMigrations(sqlite)).toBe(total);
    } finally {
      sqlite.close();
    }
  });

  it('segunda execução é idempotente: não duplica migrations e preserva dados', () => {
    run();

    const first = openTestDb(dbPath);
    first.sqlite
      .prepare("INSERT INTO app_settings (key, value) VALUES ('preferencia', '{\"modo\":\"sensivel\"}')")
      .run();
    const migrationsBefore = countMigrations(first.sqlite);
    first.sqlite.close();

    const second = run();
    expect(second.createdFile).toBe(false);
    expect(second.migrationsApplied).toBe(0);

    const check = openTestDb(dbPath);
    try {
      expect(countMigrations(check.sqlite)).toBe(migrationsBefore);
      expect(check.sqlite.prepare('SELECT key, value FROM app_settings').all()).toEqual([
        { key: 'preferencia', value: '{"modo":"sensivel"}' },
      ]);
    } finally {
      check.sqlite.close();
    }
  });

  it('arquivo que não é SQLite gera erro de diagnóstico sem apagar nem alterar os bytes', () => {
    writeFileSync(dbPath, Buffer.alloc(8192, 0x41));
    const before = readFileSync(dbPath);

    let caught: unknown;
    try {
      run();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DatabaseError);
    expect((caught as DatabaseError).kind).toBe('not_sqlite');
    expect((caught as Error).message).toContain('não é um banco SQLite válido');
    expect(readFileSync(dbPath).equals(before)).toBe(true);
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    expect(existsSync(`${dbPath}-journal`)).toBe(false);
  });

  it('banco com página corrompida é reportado pelo quick_check e não é alterado', () => {
    run();
    // Mantém o cabeçalho e invalida a página 2 (offset 4096).
    const damaged = readFileSync(dbPath);
    damaged.fill(0xff, 4096, 8192);
    writeFileSync(dbPath, damaged);
    const before = readFileSync(dbPath);

    let caught: unknown;
    try {
      run();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DatabaseError);
    expect((caught as DatabaseError).kind).toBe('corrupt');
    expect(readFileSync(dbPath).equals(before)).toBe(true);
  });

  it('caminho do banco ocupado por diretório gera erro de abertura claro e não remove nada', () => {
    mkdirSync(dbPath);

    let caught: unknown;
    try {
      run();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DatabaseError);
    expect((caught as Error).message).toContain('Não foi possível abrir o banco');
    expect(statSync(dbPath).isDirectory()).toBe(true);
  });

  it.skipIf(isRoot || process.platform === 'win32')(
    'diretório pai sem permissão de escrita gera erro claro',
    () => {
      const locked = join(dir, 'bloqueado');
      mkdirSync(locked, { mode: 0o500 });
      chmodSync(locked, 0o500);

      let caught: unknown;
      try {
        run(join(locked, 'dados'));
      } catch (err) {
        caught = err;
      } finally {
        chmodSync(locked, 0o700);
      }

      expect(caught).toBeInstanceOf(DatabaseError);
      expect((caught as DatabaseError).kind).toBe('data_dir');
      expect((caught as Error).message).toContain('sem permissão');
    },
  );
});

describe('prepareDatabase: diretório sem permissão de escrita (EACCES)', () => {
  // Como root, a permissão de escrita não se aplica: o caso é pulado nesse caso.
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  let base = '';

  beforeEach(() => {
    base = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(base);
  });

  it.skipIf(isRoot || process.platform === 'win32')('criar o diretório de dados dentro de pasta só leitura gera erro data_dir e não cria nada', () => {
    const locked = join(base, 'somente-leitura');
    mkdirSync(locked, { mode: 0o700 });
    chmodSync(locked, 0o500);
    const target = join(locked, 'dados');

    let caught: unknown;
    try {
      prepareDatabase({ dataDir: target, migrationsFolder: MIGRATIONS_FOLDER });
    } catch (err) {
      caught = err;
    } finally {
      chmodSync(locked, 0o700);
    }

    expect(caught).toBeInstanceOf(DatabaseError);
    expect((caught as Error).message).toContain('Não foi possível criar ou acessar o diretório de dados');
    expect((caught as Error).message).toContain('Ajuste as permissões');
    expect(existsSync(target)).toBe(false);
  });
});
