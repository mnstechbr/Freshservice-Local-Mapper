import { afterEach, describe, expect, it } from 'vitest';
import { apiModules } from '@/lib/db/schema';
import { getDashboardStats } from '@/lib/queries/dashboard';
import { createAppTestDb, insertRealInstance, type AppTestDb } from '../helpers/app-db';

const dbs: AppTestDb[] = [];
afterEach(() => {
  while (dbs.length > 0) dbs.pop()?.close();
});

type Access = 'accessible' | 'forbidden' | 'not_found' | 'untested';

function setup(rows: Array<[string, Access]>) {
  const app = createAppTestDb();
  dbs.push(app);
  const instanceId = insertRealInstance(app.db, 'https://sintetica.freshservice.com');
  for (const [moduleKey, accessStatus] of rows) {
    app.db
      .insert(apiModules)
      .values({ instanceId, moduleKey, name: moduleKey, method: 'GET', path: '/api/v2/sintetico', accessStatus })
      .run();
  }
  return { db: app.db, instanceId };
}

describe('getDashboardStats: módulos acessíveis contam grupos, não endpoints', () => {
  it('um grupo com vários endpoints acessíveis conta uma vez; a fração mostra endpoints', () => {
    const { db, instanceId } = setup([
      ['tickets.tickets', 'accessible'],
      ['tickets.form_fields', 'accessible'],
      ['tickets.problems', 'forbidden'],
      ['itsm.changes', 'accessible'],
      ['assets.assets', 'forbidden'],
      ['settings.locations', 'accessible'],
      ['users_groups.agents', 'untested'],
    ]);
    expect(getDashboardStats(db, instanceId)).toMatchObject({
      accessibleModules: 3,
      accessibleEndpoints: 4,
      totalEndpoints: 7,
      lastRun: null,
    });
  });

  it('sem endpoint acessível: zero grupos e zero endpoints', () => {
    const { db, instanceId } = setup([['tickets.tickets', 'forbidden']]);
    expect(getDashboardStats(db, instanceId)).toMatchObject({ accessibleModules: 0, accessibleEndpoints: 0, totalEndpoints: 1 });
  });

  it('sem diagnóstico: tudo zero', () => {
    const { db, instanceId } = setup([]);
    expect(getDashboardStats(db, instanceId)).toMatchObject({ accessibleModules: 0, accessibleEndpoints: 0, totalEndpoints: 0 });
  });
});
