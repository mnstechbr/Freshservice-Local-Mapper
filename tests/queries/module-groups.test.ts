import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activateDemo } from '@/lib/demo/seed';
import { endpointKeysOf } from '@/lib/modules/catalog';
import { getModuleOverview, listApiModules } from '@/lib/queries/modules';
import { listResources } from '@/lib/queries/resources';
import { getActiveInstance } from '@/lib/queries/instances';
import { createAppTestDb, type AppTestDb } from '../helpers/app-db';

let ctx: AppTestDb;
let instanceId: number;

beforeAll(() => {
  ctx = createAppTestDb();
  activateDemo(ctx.db);
  instanceId = getActiveInstance(ctx.db)!.id;
});

afterAll(() => ctx.close());

describe('agregação por grupo no banco (demo)', () => {
  it('filtro por grupo traz recursos de todas as chaves pontuadas do grupo', () => {
    const result = listResources(ctx.db, { instanceId, module: 'service_catalog', page: 1, pageSize: 500, sort: 'id', dir: 'asc', search: null, status: null });
    expect(result.total).toBeGreaterThan(0);
    expect(result.rows.every((row) => row.moduleKey.startsWith('service_catalog.'))).toBe(true);
  });

  it('filtro por chave exata não mistura chaves do mesmo grupo', () => {
    const result = listResources(ctx.db, { instanceId, module: 'service_catalog.items', page: 1, pageSize: 500, sort: 'id', dir: 'asc', search: null, status: null });
    expect(result.rows.every((row) => row.moduleKey === 'service_catalog.items')).toBe(true);
  });

  it('o grupo "assets" não casa com chaves de outro grupo que só começam igual', () => {
    const result = listResources(ctx.db, { instanceId, module: 'asset', page: 1, pageSize: 500, sort: 'id', dir: 'asc', search: null, status: null });
    expect(result.total).toBe(0);
  });

  it('overview de grupo agrega os endpoints do grupo e conta recursos', () => {
    const overview = getModuleOverview(ctx.db, instanceId, 'itsm');
    const keys = overview.endpoints.map((row) => row.moduleKey).sort();
    expect(keys).toEqual(endpointKeysOf('itsm').sort());
    expect(overview.resourceCount).toBeGreaterThan(0);
  });

  it('endpoints listados têm chaves pontuadas coerentes com o registro', () => {
    const keys = listApiModules(ctx.db, instanceId).map((row) => row.moduleKey);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((key) => key.includes('.'))).toBe(true);
  });
});
