import { asc, eq, inArray } from 'drizzle-orm';
import type { AppDb } from '@/lib/db/client';
import { syncModuleResults, syncRuns, type MODULE_RESULT_STATUSES } from '@/lib/db/schema';
import { compareRuns as compareDiffRuns, type DiffResult } from '@/lib/diff';
import { getSyncRun, type SyncRunRow } from './runs';

export type ModuleResultStatus = (typeof MODULE_RESULT_STATUSES)[number];

export interface ModuleResultRow {
  id: number;
  moduleKey: string;
  status: ModuleResultStatus;
  complete: boolean;
  recordsCount: number;
  pagesFetched: number;
  httpStatus: number | null;
  errorMessage: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

/** Resultado de cada módulo em uma execução, em ordem alfabética de módulo. */
export function listModuleResults(db: AppDb, runId: number): ModuleResultRow[] {
  return db
    .select({
      id: syncModuleResults.id,
      moduleKey: syncModuleResults.moduleKey,
      status: syncModuleResults.status,
      complete: syncModuleResults.complete,
      recordsCount: syncModuleResults.recordsCount,
      pagesFetched: syncModuleResults.pagesFetched,
      httpStatus: syncModuleResults.httpStatus,
      errorMessage: syncModuleResults.errorMessage,
      startedAt: syncModuleResults.startedAt,
      finishedAt: syncModuleResults.finishedAt,
    })
    .from(syncModuleResults)
    .where(eq(syncModuleResults.runId, runId))
    .orderBy(asc(syncModuleResults.moduleKey))
    .all();
}

/**
 * Instância de cada execução pedida, sem filtrar pela instância ativa. Permite detectar
 * execuções de instâncias diferentes antes de comparar.
 */
export function runInstanceIds(db: AppDb, runIds: readonly number[]): Map<number, number> {
  if (runIds.length === 0) return new Map();
  const rows = db
    .select({ id: syncRuns.id, instanceId: syncRuns.instanceId })
    .from(syncRuns)
    .where(inArray(syncRuns.id, [...runIds]))
    .all();
  return new Map(rows.map((row) => [row.id, row.instanceId]));
}

export interface RunComparisonView {
  /** Execução de referência (linha de base). */
  baseline: SyncRunRow;
  /** Execução comparada com a linha de base. */
  target: SyncRunRow;
  /** Resultado do motor oficial de diferenças (src/lib/diff). */
  result: DiffResult;
}

/**
 * Ponto único da comparação de execuções exibida em /historico/comparar. Usa o motor oficial de diferenças
 * (compareRuns de src/lib/diff). Null se alguma execução não pertence à instância ativa.
 */
export function loadRunComparison(
  db: AppDb,
  instanceId: number,
  baselineId: number,
  targetId: number,
): RunComparisonView | null {
  const baseline = getSyncRun(db, instanceId, baselineId);
  const target = getSyncRun(db, instanceId, targetId);
  if (!baseline || !target) return null;
  return { baseline, target, result: compareDiffRuns(db, baseline.id, target.id) };
}
