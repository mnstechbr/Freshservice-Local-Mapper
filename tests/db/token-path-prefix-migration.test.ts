import Database from 'better-sqlite3';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../../src/lib/db/migrate';
import { MIGRATIONS_FOLDER, makeTempDir, removeTempDir } from '../helpers/db';

/**
 * Migration 0005 (M1 e L3): aditiva. Perfis que já existiam mantêm o comportamento anterior, em que o token
 * usa o mesmo prefixo do authorize. Perfis novos recebem o padrão ''. Dados sintéticos.
 */
const EXISTING_ENTRIES = 5; // 0000 a 0004: estado anterior à 0005.
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) removeTempDir(dir);
});

/** Pasta de migrations só com as primeiras entradas do journal (estado anterior à 0005). */
function migrationsUpTo(count: number): string {
  const folder = makeTempDir();
  dirs.push(folder);
  mkdirSync(join(folder, 'meta'));
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string }>;
  };
  const entries = journal.entries.slice(0, count);
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
  for (const entry of entries) copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  return folder;
}

/** Insere um perfil no formato anterior à 0005 (sem token_path_prefix). */
function insertLegacyRow(sqlite: Database.Database, name: string, pathPrefix: string): void {
  sqlite
    .prepare(
      `INSERT INTO integration_profiles (name, org_origin, client_id, client_secret_ref, scopes, path_prefix,
        redirect_host, freshservice_domains, allow_manage_scopes, created_at, updated_at)
       VALUES (?, 'https://fslm-org.myfreshworks.com', 'cid-sintetico', 'ref-sintetica', '[]', ?, 'localhost', '[]', 0, 1, 1)`,
    )
    .run(name, pathPrefix);
}

function openAfter(count: number): { sqlite: Database.Database; dbPath: string } {
  const dir = makeTempDir();
  dirs.push(dir);
  const dbPath = join(dir, 'teste.sqlite');
  const sqlite = new Database(dbPath);
  applyMigrations(sqlite, migrationsUpTo(count));
  return { sqlite, dbPath };
}

describe('migration 0005: token_path_prefix e oauth_consumed_states', () => {
  it('perfis anteriores recebem token_path_prefix igual a path_prefix (comportamento anterior preservado)', () => {
    const { sqlite } = openAfter(EXISTING_ENTRIES);
    try {
      insertLegacyRow(sqlite, 'com prefixo', '/org');
      insertLegacyRow(sqlite, 'sem prefixo', '');

      applyMigrations(sqlite, MIGRATIONS_FOLDER);

      const rows = sqlite
        .prepare('SELECT name, path_prefix, token_path_prefix FROM integration_profiles ORDER BY id')
        .all() as Array<{ name: string; path_prefix: string; token_path_prefix: string }>;
      expect(rows).toEqual([
        { name: 'com prefixo', path_prefix: '/org', token_path_prefix: '/org' },
        { name: 'sem prefixo', path_prefix: '', token_path_prefix: '' },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it("perfil novo sem o campo usa o padrão '' e a tabela de states existe", () => {
    const { sqlite } = openAfter(EXISTING_ENTRIES);
    try {
      applyMigrations(sqlite, MIGRATIONS_FOLDER);
      insertLegacyRow(sqlite, 'novo', '/org');
      const row = sqlite.prepare("SELECT path_prefix, token_path_prefix FROM integration_profiles WHERE name = 'novo'").get();
      expect(row).toEqual({ path_prefix: '/org', token_path_prefix: '' });
      const table = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'oauth_consumed_states'").get();
      expect(table).toEqual({ name: 'oauth_consumed_states' });
    } finally {
      sqlite.close();
    }
  });

  it('CHECK do banco recusa token_path_prefix fora da allowlist', () => {
    const { sqlite } = openAfter(EXISTING_ENTRIES);
    try {
      applyMigrations(sqlite, MIGRATIONS_FOLDER);
      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO integration_profiles (name, org_origin, client_id, client_secret_ref, scopes, path_prefix,
              token_path_prefix, redirect_host, freshservice_domains, allow_manage_scopes, created_at, updated_at)
             VALUES ('invalido', 'https://fslm-org.myfreshworks.com', 'cid', 'ref', '[]', '/org', '/outro', 'localhost', '[]', 0, 1, 1)`,
          )
          .run(),
      ).toThrow(/CHECK constraint failed/);
    } finally {
      sqlite.close();
    }
  });
});
