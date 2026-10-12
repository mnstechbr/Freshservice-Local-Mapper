import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DB_FILE_NAME } from '@/lib/config/paths';
import { prepareDatabase } from '@/lib/db/bootstrap';
import type { AppDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { activateDemo } from '@/lib/demo/seed';

/*
 * Migration 0003 (auditoria H1): demo legada sai no bootstrap. Usa diretório temporário próprio,
 * nunca o diretório de dados do usuário.
 */
const FULL_FOLDER = resolve(process.cwd(), 'drizzle');
const LEGACY_ENTRIES = 3; // 0000, 0001 e 0002: antes da migration de dados 0003.

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Pasta de migrations só com as primeiras entradas do journal (estado anterior à 0003). */
function migrationsUpTo(count: number): string {
  const folder = tempDir('fslm-mig-');
  mkdirSync(join(folder, 'meta'));
  const journal = JSON.parse(readFileSync(join(FULL_FOLDER, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string }>;
  };
  const entries = journal.entries.slice(0, count);
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
  for (const entry of entries) copyFileSync(join(FULL_FOLDER, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  return folder;
}

describe('migration 0003: demo legada no bootstrap', () => {
  it('remove a demo legada com seus dados e limpa app_settings.active_instance_id; instância real fica', () => {
    const dataDir = tempDir('fslm-legacy-');
    const dbPath = join(dataDir, DB_FILE_NAME);
    prepareDatabase({ dataDir, migrationsFolder: migrationsUpTo(LEGACY_ENTRIES) });
    // Colunas aditivas da 0004 (perfis) antes de semear: o schema atual as referencia em toda gravação.
    const pre0004 = new Database(dbPath);
    pre0004.exec(readFileSync(join(FULL_FOLDER, '0004_integration_profiles.sql'), 'utf8').replace(/--> statement-breakpoint/g, ';'));
    pre0004.close();

    // Estado legado: demo ativa com conjunto de dados, mais uma instância real.
    const sqlite = new Database(dbPath);
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema }) as unknown as AppDb;
    const demo = activateDemo(db);
    sqlite
      .prepare("INSERT INTO instances (base_url, display_name, is_demo, created_at, updated_at) VALUES (?, ?, 0, 1, 1)")
      .run('https://cliente.freshservice.com', 'Instância real');
    const before = sqlite.prepare('SELECT COUNT(*) AS n FROM resources').get() as { n: number };
    expect(before.n).toBeGreaterThan(0);
    sqlite.close();

    const result = prepareDatabase({ dataDir, migrationsFolder: migrationsUpTo(4) });
    expect(result.migrationsApplied).toBe(1);

    const check = new Database(dbPath, { readonly: true });
    try {
      expect(check.prepare('SELECT COUNT(*) AS n FROM instances WHERE is_demo = 1').get()).toEqual({ n: 0 });
      expect(check.prepare('SELECT COUNT(*) AS n FROM instances WHERE id = ?').get(demo.instanceId)).toEqual({ n: 0 });
      expect(check.prepare('SELECT COUNT(*) AS n FROM connections').get()).toEqual({ n: 0 });
      expect(check.prepare('SELECT COUNT(*) AS n FROM resources').get()).toEqual({ n: 0 });
      expect(check.prepare('SELECT COUNT(*) AS n FROM audit_events WHERE instance_id IS NULL').get()).toEqual({ n: 0 });
      expect(check.prepare("SELECT COUNT(*) AS n FROM app_settings WHERE key = 'active_instance_id'").get()).toEqual({ n: 0 });
      expect(check.prepare('SELECT COUNT(*) AS n FROM instances WHERE is_demo = 0').get()).toEqual({ n: 1 });
    } finally {
      check.close();
    }
  });

  it('é idempotente: um segundo bootstrap não reaplica nem altera nada', () => {
    const dataDir = tempDir('fslm-idem-');
    prepareDatabase({ dataDir, migrationsFolder: migrationsUpTo(4) });
    const again = prepareDatabase({ dataDir, migrationsFolder: migrationsUpTo(4) });
    expect(again.migrationsApplied).toBe(0);
  });
});
