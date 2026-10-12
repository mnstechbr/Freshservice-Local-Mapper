import { eq, isNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getStatus } from '@/lib/auth/connection';
import type { AuthDeps } from '@/lib/auth/deps';
import { appSettings, auditEvents, connections, instances } from '@/lib/db/schema';
import { activateDemo, DEMO_SEED_VERSION, removeDemo } from '@/lib/demo/seed';
import { connectionStatusInfo } from '@/lib/ui/status';
import { createAppTestDb, type AppTestDb } from '../helpers/app-db';

let ctx: AppTestDb;

beforeEach(() => {
  ctx = createAppTestDb();
});

afterEach(() => {
  ctx.close();
});

function statusView() {
  return getStatus({ db: ctx.db } as unknown as AuthDeps);
}

describe('status da demonstração', () => {
  it('a API devolve "demo" para a instância demonstrativa, nunca "connected"', () => {
    activateDemo(ctx.db);
    expect(statusView().status).toBe('demo');
    expect(statusView().instance).toMatchObject({ origin: expect.stringContaining('freshservice.invalid') });
  });

  it('o seed não grava conexão com status connected', () => {
    const { instanceId } = activateDemo(ctx.db);
    const rows = ctx.db
      .select({ status: connections.status })
      .from(connections)
      .where(eq(connections.instanceId, instanceId))
      .all();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.status !== 'connected')).toBe(true);
  });

  it('sem instância ativa o status continua disconnected', () => {
    activateDemo(ctx.db);
    removeDemo(ctx.db);
    expect(statusView().status).toBe('disconnected');
  });

  it('rótulo de UI para demo é "Demonstração", nunca "Conectado"', () => {
    expect(connectionStatusInfo('demo')).toMatchObject({ label: 'Demonstração', tone: 'warning' });
  });
});

describe('versão do seed da demonstração', () => {
  it('grava demo_seed_version com a versão atual', () => {
    activateDemo(ctx.db);
    const row = ctx.db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, 'demo_seed_version'))
      .get();
    expect(row?.value).toBe(DEMO_SEED_VERSION);
  });

  it('recria a demo quando a versão gravada é diferente, sem duplicar', () => {
    const first = activateDemo(ctx.db);
    ctx.db
      .update(appSettings)
      .set({ value: DEMO_SEED_VERSION - 1 })
      .where(eq(appSettings.key, 'demo_seed_version'))
      .run();

    const second = activateDemo(ctx.db);
    expect(second.created).toBe(true);
    expect(second.instanceId).not.toBe(first.instanceId);
    expect(ctx.db.select().from(instances).where(eq(instances.isDemo, true)).all()).toHaveLength(1);
    expect(ctx.db.select().from(instances).where(eq(instances.id, first.instanceId)).all()).toHaveLength(0);
  });

  it('com a versão atual, ativar de novo reaproveita a demo', () => {
    const first = activateDemo(ctx.db);
    const again = activateDemo(ctx.db);
    expect(again).toEqual({ instanceId: first.instanceId, created: false });
  });
});

describe('remoção da demonstração', () => {
  it('remover não deixa auditoria órfã da demo (instance_id NULL)', () => {
    activateDemo(ctx.db);
    expect(ctx.db.select().from(auditEvents).where(isNull(auditEvents.instanceId)).all()).toHaveLength(0);
    removeDemo(ctx.db);
    expect(ctx.db.select().from(auditEvents).where(isNull(auditEvents.instanceId)).all()).toHaveLength(0);
  });

  it('remover apaga a versão do seed', () => {
    activateDemo(ctx.db);
    removeDemo(ctx.db);
    expect(
      ctx.db.select().from(appSettings).where(eq(appSettings.key, 'demo_seed_version')).all(),
    ).toHaveLength(0);
  });
});
