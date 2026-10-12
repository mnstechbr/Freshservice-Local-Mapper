import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { findConnection } from '@/lib/auth/repo';
import { auditEvents, syncRuns } from '@/lib/db/schema';
import { getAdapter } from '@/lib/freshservice/modules';
import { applyPrivacy, isMetadataOnly } from '@/lib/sync/prefs';
import { ensureSyncReady, ORPHAN_MESSAGE, reconcileOrphanRuns } from '@/lib/sync/reconcile';
import { claimInstance, releaseInstance } from '@/lib/sync/registry';
import { createSyncEnv, type SyncEnv } from '../helpers/sync-env';

const envs: SyncEnv[] = [];
afterEach(() => {
  while (envs.length > 0) envs.pop()?.app.close();
});

async function setup(): Promise<SyncEnv> {
  const env = await createSyncEnv('connected');
  envs.push(env);
  return env;
}

function insertRunning(env: SyncEnv): number {
  const connectionId = findConnection(env.db, env.instanceId)?.id ?? 0;
  return env.db
    .insert(syncRuns)
    .values({
      instanceId: env.instanceId,
      connectionId,
      identityLabel: 'Chave sintética',
      kind: 'full',
      status: 'running',
      startedAt: 1,
      modulesRequested: ['tickets.tickets'],
    })
    .returning({ id: syncRuns.id })
    .get().id;
}

function statusOf(env: SyncEnv, runId: number): string | undefined {
  return env.db.select().from(syncRuns).where(eq(syncRuns.id, runId)).get()?.status;
}

describe('reconciliação de runs órfãos', () => {
  it('vira failed com finished_at e evento de auditoria', async () => {
    const env = await setup();
    const runId = insertRunning(env);
    expect(reconcileOrphanRuns(env.db, env.auth.audit, 5_000)).toBe(1);
    const row = env.db.select().from(syncRuns).where(eq(syncRuns.id, runId)).get();
    expect(row?.status).toBe('failed');
    expect(row?.finishedAt).toBe(5_000);
    const events = env.db.select().from(auditEvents).where(eq(auditEvents.runId, runId)).all();
    expect(events.some((event) => event.message === ORPHAN_MESSAGE && event.level === 'warn')).toBe(true);
    expect(ORPHAN_MESSAGE).toContain('processo encerrado');
  });

  it('não altera execução ativa neste processo', async () => {
    const env = await setup();
    const runId = insertRunning(env);
    const entry = claimInstance(env.instanceId);
    entry.runId = runId;
    try {
      expect(reconcileOrphanRuns(env.db, env.auth.audit, 5_000)).toBe(0);
    } finally {
      releaseInstance(entry);
    }
    expect(statusOf(env, runId)).toBe('running');
  });

  it('ensureSyncReady reconcilia uma vez por banco e processo', async () => {
    const env = await setup();
    const first = insertRunning(env);
    ensureSyncReady(env.auth);
    expect(statusOf(env, first)).toBe('failed');
    const second = insertRunning(env);
    ensureSyncReady(env.auth);
    expect(statusOf(env, second)).toBe('running');
  });
});

describe('privacidade dos adaptadores', () => {
  it('metadataOnly remove conteúdo e campos sensíveis; sem metadataOnly mantém tudo', () => {
    const tickets = getAdapter('tickets.tickets');
    const agents = getAdapter('users_groups.agents');
    if (!tickets || !agents) throw new Error('adaptadores ausentes no teste');
    const ticket = { id: 1, subject: 'assunto', description: 'corpo', description_text: 'corpo' };
    expect(applyPrivacy(ticket, tickets, true)).toEqual({ id: 1, subject: 'assunto' });
    expect(applyPrivacy(ticket, tickets, false)).toEqual(ticket);
    const person = { id: 2, first_name: 'Ana', primary_email: 'ana@exemplo.invalido' };
    expect(applyPrivacy(person, agents, true)).toEqual({ id: 2, first_name: 'Ana' });
    expect(applyPrivacy(person, agents, false)).toEqual({ id: 2, first_name: 'Ana' });
  });

  it('preferência por grupo ou por item cobre os adaptadores certos', () => {
    const defaults = { metadataOnly: {}, storeRaw: false };
    expect(isMetadataOnly(defaults, 'tickets.tickets')).toBe(true);
    expect(isMetadataOnly(defaults, 'users_groups.agents')).toBe(false);
    expect(isMetadataOnly({ metadataOnly: { users_groups: true }, storeRaw: false }, 'users_groups.agents')).toBe(true);
    expect(isMetadataOnly({ metadataOnly: { locations: true }, storeRaw: false }, 'settings.locations')).toBe(true);
    expect(isMetadataOnly({ metadataOnly: { settings: true }, storeRaw: false }, 'settings.locations')).toBe(false);
  });
});
