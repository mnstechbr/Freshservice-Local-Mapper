import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { instances, resources, syncRuns } from '@/lib/db/schema';
import { activateDemo, DEMO_BASE_URL, DemoConflictError, removeDemo } from '@/lib/demo/seed';
import { getActiveInstance } from '@/lib/queries/instances';
import { createAppTestDb, insertRealInstance, type AppTestDb } from '../helpers/app-db';

let ctx: AppTestDb;

beforeEach(() => {
  ctx = createAppTestDb();
});

afterEach(() => ctx.close());

function count(table: typeof instances | typeof resources | typeof syncRuns): number {
  return ctx.db.select().from(table).all().length;
}

describe('semente demonstrativa', () => {
  it('ativar duas vezes não duplica nada e marca a instância como demonstrativa', () => {
    const first = activateDemo(ctx.db);
    const resourcesAfterFirst = count(resources);
    const runsAfterFirst = count(syncRuns);

    const second = activateDemo(ctx.db);

    expect(first.created).toBe(true);
    expect(second).toMatchObject({ instanceId: first.instanceId, created: false });
    expect(count(instances)).toBe(1);
    expect(count(resources)).toBe(resourcesAfterFirst);
    expect(count(syncRuns)).toBe(runsAfterFirst);
    expect(getActiveInstance(ctx.db)).toMatchObject({ id: first.instanceId, isDemo: true, baseUrl: DEMO_BASE_URL });
  });

  it('não altera instâncias reais existentes e não ativa dados reais como demo', () => {
    const realId = insertRealInstance(ctx.db);
    activateDemo(ctx.db);

    const real = ctx.db.select().from(instances).where(eq(instances.id, realId)).get();
    expect(real?.isDemo).toBe(false);
    expect(getActiveInstance(ctx.db)?.isDemo).toBe(true);
    expect(ctx.db.select().from(syncRuns).where(eq(syncRuns.instanceId, realId)).all()).toHaveLength(0);
  });

  it('recusa criar a demo se já existir uma instância real com o mesmo endereço', () => {
    insertRealInstance(ctx.db, DEMO_BASE_URL);
    expect(() => activateDemo(ctx.db)).toThrow(DemoConflictError);
    expect(count(resources)).toBe(0);
  });

  it('remover apaga só a demonstração e limpa a instância ativa', () => {
    const realId = insertRealInstance(ctx.db);
    activateDemo(ctx.db);

    expect(removeDemo(ctx.db)).toEqual({ removed: 1 });

    expect(ctx.db.select().from(instances).where(eq(instances.id, realId)).get()).toBeTruthy();
    expect(count(resources)).toBe(0);
    expect(getActiveInstance(ctx.db)).toBeNull();
    expect(removeDemo(ctx.db)).toEqual({ removed: 0 });
  });

  it('depois de remover, ativar de novo recria o conjunto completo', () => {
    activateDemo(ctx.db);
    const resourceCount = count(resources);
    removeDemo(ctx.db);

    const again = activateDemo(ctx.db);
    expect(again.created).toBe(true);
    expect(count(resources)).toBe(resourceCount);
  });
});

describe('nomes da semente demonstrativa', () => {
  function namesOf(moduleKey: string): Map<string, string | null> {
    const rows = ctx.db
      .select({ externalId: resources.externalId, name: resources.currentName, moduleKey: resources.moduleKey })
      .from(resources)
      .all()
      .filter((row) => row.moduleKey === moduleKey);
    return new Map(rows.map((row) => [row.externalId, row.name]));
  }

  it('mantém os IDs de referência do painel com os nomes fictícios esperados', () => {
    activateDemo(ctx.db);
    const catalog = namesOf('service_catalog.items');

    expect(catalog.get('25')).toBe('Instalação de software');
    expect(catalog.get('41')).toBe('Acesso VPN');
    expect(catalog.get('78')).toBe('Solicitação de notebook');
    expect(catalog.get('19')).toBe('Criação de e-mail');
  });

  it('todos os nomes gravados são fictícios: sem e-mail, URL ou domínio real', () => {
    activateDemo(ctx.db);
    const names = ctx.db
      .select({ name: resources.currentName })
      .from(resources)
      .all()
      .map((row) => row.name ?? '');

    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).not.toMatch(/@|https?:|\.com|\.br|freshservice\.(com|io)/i);
    }
  });

  it('reativar não altera os nomes já gravados', () => {
    activateDemo(ctx.db);
    const before = namesOf('service_catalog.items');

    activateDemo(ctx.db);

    expect(namesOf('service_catalog.items')).toEqual(before);
  });
});
