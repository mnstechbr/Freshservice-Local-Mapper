import { prepareDatabase } from '@/lib/db/bootstrap';
import type { AppDb } from '@/lib/db/client';
import { instances } from '@/lib/db/schema';
import { MIGRATIONS_FOLDER, makeTempDir, openTestDb, removeTempDir } from './db';

export interface AppTestDb {
  db: AppDb;
  close: () => void;
}

/** Banco novo em diretório temporário, com todas as migrations aplicadas. */
export function createAppTestDb(): AppTestDb {
  const dir = makeTempDir();
  const prepared = prepareDatabase({ dataDir: dir, migrationsFolder: MIGRATIONS_FOLDER });
  const { sqlite, db } = openTestDb(prepared.dbPath);
  return {
    db,
    close: () => {
      sqlite.close();
      removeTempDir(dir);
    },
  };
}

/** Instância real (não demonstrativa), sem dados coletados. */
export function insertRealInstance(db: AppDb, baseUrl = 'https://cliente.freshservice.com'): number {
  const now = Date.now();
  return db
    .insert(instances)
    .values({ baseUrl, displayName: 'Cliente real', isDemo: false, createdAt: now, updatedAt: now })
    .returning({ id: instances.id })
    .get().id;
}
