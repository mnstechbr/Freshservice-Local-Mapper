import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_FILE_NAME } from '../../src/lib/config/paths';
import { prepareDatabase } from '../../src/lib/db/bootstrap';
import { apiModules, connections, instances, resources, syncRuns } from '../../src/lib/db/schema';
import { MIGRATIONS_FOLDER, makeTempDir, openTestDb, removeTempDir } from '../helpers/db';

const NOW = 1_700_000_000_000;

type TestDb = ReturnType<typeof openTestDb>;

describe('schema: isolamento por instance_id e constraints', () => {
  let dir: string;
  let test: TestDb;
  let db: TestDb['db'];

  beforeEach(() => {
    dir = makeTempDir();
    prepareDatabase({ dataDir: dir, migrationsFolder: MIGRATIONS_FOLDER });
    test = openTestDb(join(dir, DB_FILE_NAME));
    db = test.db;
  });

  afterEach(() => {
    test.sqlite.close();
    removeTempDir(dir);
  });

  function seedInstance(baseUrl: string) {
    return db
      .insert(instances)
      .values({ baseUrl, displayName: baseUrl, createdAt: NOW, updatedAt: NOW })
      .returning()
      .get();
  }

  function seedConnection(instanceId: number) {
    return db
      .insert(connections)
      .values({
        instanceId,
        authMode: 'api_key_personal',
        status: 'connected',
        createdAt: NOW,
        updatedAt: NOW,
      })
      .returning()
      .get();
  }

  function seedRun(instanceId: number, connectionId: number) {
    return db
      .insert(syncRuns)
      .values({
        instanceId,
        connectionId,
        identityLabel: 'agente-teste',
        kind: 'full',
        status: 'running',
        startedAt: NOW,
        modulesRequested: ['agents'],
      })
      .returning()
      .get();
  }

  function seedModule(instanceId: number, moduleKey: string) {
    return db
      .insert(apiModules)
      .values({ instanceId, moduleKey, name: moduleKey, method: 'GET', path: `/api/v2/${moduleKey}` })
      .run();
  }

  it('mesmo module_key é permitido em instâncias diferentes, mas não duplicado na mesma', () => {
    const a = seedInstance('https://a.freshservice.com');
    const b = seedInstance('https://b.freshservice.com');
    seedModule(a.id, 'tickets');
    seedModule(b.id, 'tickets');
    expect(() => seedModule(a.id, 'tickets')).toThrow(/UNIQUE/);
  });

  it('chave estrangeira impede conexão para instância inexistente', () => {
    expect(() => seedConnection(999)).toThrow(/FOREIGN KEY/);
  });

  it('remover uma instância remove apenas os dados dela (cascade)', () => {
    const a = seedInstance('https://a.freshservice.com');
    const b = seedInstance('https://b.freshservice.com');
    seedModule(a.id, 'tickets');
    seedModule(b.id, 'tickets');

    db.delete(instances).where(eq(instances.id, a.id)).run();

    const remaining = db.select().from(apiModules).all();
    expect(remaining.map((row) => row.instanceId)).toEqual([b.id]);
  });

  it('resources: workspace_id NULL não burla a unicidade; workspaces distintos coexistem', () => {
    const inst = seedInstance('https://a.freshservice.com');
    const conn = seedConnection(inst.id);
    const run = seedRun(inst.id, conn.id);
    const base = {
      instanceId: inst.id,
      moduleKey: 'agents',
      firstSeenRunId: run.id,
      lastSeenRunId: run.id,
    };

    db.insert(resources).values({ ...base, externalId: '42' }).run();
    expect(() => db.insert(resources).values({ ...base, externalId: '42' }).run()).toThrow(/UNIQUE/);

    db.insert(resources).values({ ...base, externalId: '42', workspaceId: 1 }).run();
    db.insert(resources).values({ ...base, externalId: '42', workspaceId: 2 }).run();
    expect(() =>
      db.insert(resources).values({ ...base, externalId: '42', workspaceId: 1 }).run(),
    ).toThrow(/UNIQUE/);
  });

  it('CHECK rejeita valores fora dos enums', () => {
    const inst = seedInstance('https://a.freshservice.com');
    expect(() =>
      db
        .insert(apiModules)
        .values({
          instanceId: inst.id,
          moduleKey: 'x',
          name: 'x',
          method: 'GET',
          path: '/x',
          accessStatus: 'bogus' as never,
        })
        .run(),
    ).toThrow(/CHECK/);
  });
});
