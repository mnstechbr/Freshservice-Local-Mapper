/*
 * Runs deixados em 'running' por queda do processo. Na primeira chamada por banco e processo, viram
 * 'failed' com finished_at e evento de auditoria. Execuções ativas neste processo não são tocadas.
 */
import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { createAuditLogger } from '../audit/logger';
import type { AppDb } from '../db/client';
import { syncRuns } from '../db/schema';
import type { AuthDeps } from '../auth/deps';
import { activeSync } from './registry';

export const ORPHAN_MESSAGE = 'Sincronização interrompida (processo encerrado).';

export function reconcileOrphanRuns(
  db: AppDb,
  audit: ReturnType<typeof createAuditLogger>,
  now: number,
): number {
  const running = db
    .select({ id: syncRuns.id, instanceId: syncRuns.instanceId })
    .from(syncRuns)
    .where(eq(syncRuns.status, 'running'))
    .all();
  let count = 0;
  for (const row of running) {
    if (activeSync(row.instanceId)?.runId === row.id) continue;
    const changed = db
      .update(syncRuns)
      .set({ status: 'failed', finishedAt: now })
      .where(and(eq(syncRuns.id, row.id), eq(syncRuns.status, 'running')))
      .run();
    if (changed.changes === 0) continue;
    count += 1;
    audit.log({
      level: 'warn',
      eventType: 'sync.run.orphaned',
      instanceId: row.instanceId,
      runId: row.id,
      message: ORPHAN_MESSAGE,
      context: {},
    });
  }
  return count;
}

const reconciled = new WeakSet<AppDb>();

/** Primeiro uso do registro neste processo e banco: reconcilia órfãos. Falha não derruba a rota. */
export function ensureSyncReady(deps: AuthDeps): void {
  if (reconciled.has(deps.db)) return;
  reconciled.add(deps.db);
  try {
    reconcileOrphanRuns(deps.db, deps.audit, deps.now());
  } catch {
    console.error('[fslm] Não foi possível reconciliar execuções antigas de sincronização.');
  }
}
