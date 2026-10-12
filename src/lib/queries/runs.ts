import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AppDb } from '@/lib/db/client';
import { syncRuns, type SYNC_RUN_KINDS, type SYNC_RUN_STATUSES } from '@/lib/db/schema';

export type SyncRunKind = (typeof SYNC_RUN_KINDS)[number];
export type SyncRunStatus = (typeof SYNC_RUN_STATUSES)[number];

/** Execuções cujos dados podem ser lidos como "estado atual" da instância. */
const FINISHED_RUN_STATUSES = ['completed', 'partial'] as const;

export interface FinishedRunRef {
  id: number;
  status: SyncRunStatus;
  finishedAt: number | null;
  recordsCount: number;
  changesCount: number;
}

export interface SyncRunRow {
  id: number;
  kind: SyncRunKind;
  status: SyncRunStatus;
  identityLabel: string;
  startedAt: number;
  finishedAt: number | null;
  modulesRequested: string[];
  modulesProcessed: number;
  recordsCount: number;
  failuresCount: number;
  changesCount: number;
  comparedToRunId: number | null;
}

export function getLatestFinishedRun(db: AppDb, instanceId: number): FinishedRunRef | null {
  return (
    db
      .select({
        id: syncRuns.id,
        status: syncRuns.status,
        finishedAt: syncRuns.finishedAt,
        recordsCount: syncRuns.recordsCount,
        changesCount: syncRuns.changesCount,
      })
      .from(syncRuns)
      .where(
        and(
          eq(syncRuns.instanceId, instanceId),
          inArray(syncRuns.status, [...FINISHED_RUN_STATUSES]),
        ),
      )
      .orderBy(desc(syncRuns.id))
      .limit(1)
      .get() ?? null
  );
}

const runColumns = {
  id: syncRuns.id,
  kind: syncRuns.kind,
  status: syncRuns.status,
  identityLabel: syncRuns.identityLabel,
  startedAt: syncRuns.startedAt,
  finishedAt: syncRuns.finishedAt,
  modulesRequested: syncRuns.modulesRequested,
  modulesProcessed: syncRuns.modulesProcessed,
  recordsCount: syncRuns.recordsCount,
  failuresCount: syncRuns.failuresCount,
  changesCount: syncRuns.changesCount,
  comparedToRunId: syncRuns.comparedToRunId,
};

export function listSyncRuns(db: AppDb, instanceId: number, limit = 50): SyncRunRow[] {
  return db
    .select(runColumns)
    .from(syncRuns)
    .where(eq(syncRuns.instanceId, instanceId))
    .orderBy(desc(syncRuns.id))
    .limit(Math.min(Math.max(limit, 1), 200))
    .all();
}

export function getSyncRun(db: AppDb, instanceId: number, runId: number): SyncRunRow | null {
  return (
    db
      .select(runColumns)
      .from(syncRuns)
      .where(and(eq(syncRuns.instanceId, instanceId), eq(syncRuns.id, runId)))
      .get() ?? null
  );
}
