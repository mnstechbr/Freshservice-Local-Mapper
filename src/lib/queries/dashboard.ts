import { and, count, eq } from 'drizzle-orm';
import type { AppDb } from '@/lib/db/client';
import { apiModules, detectedChanges, resources } from '@/lib/db/schema';
import { groupOf } from '@/lib/modules/catalog';
import type { SyncRunStatus } from './runs';
import { getLatestFinishedRun } from './runs';

export interface DashboardStats {
  lastRun: { id: number; status: SyncRunStatus; finishedAt: number | null } | null;
  /** Recursos vistos na última execução concluída. */
  itemsCollected: number;
  /** Diferenças detectadas na última execução concluída. */
  changesDetected: number;
  /** Grupos (ex.: tickets, itsm) com pelo menos um endpoint acessível. É o número do indicador "Módulos acessíveis". */
  accessibleModules: number;
  /** Endpoints acessíveis (api_modules com access_status = accessible). */
  accessibleEndpoints: number;
  /** Endpoints diagnosticados nesta instância (linhas de api_modules). */
  totalEndpoints: number;
}

/** Indicadores do painel. Sem execução concluída, tudo zero: nada é inventado. */
export function getDashboardStats(db: AppDb, instanceId: number): DashboardStats {
  const run = getLatestFinishedRun(db, instanceId);
  const endpoints = db
    .select({ moduleKey: apiModules.moduleKey, accessStatus: apiModules.accessStatus })
    .from(apiModules)
    .where(eq(apiModules.instanceId, instanceId))
    .all();
  const accessible = endpoints.filter((endpoint) => endpoint.accessStatus === 'accessible');
  const endpointStats = {
    accessibleModules: new Set(accessible.map((endpoint) => groupOf(endpoint.moduleKey))).size,
    accessibleEndpoints: accessible.length,
    totalEndpoints: endpoints.length,
  };

  if (!run) {
    return { lastRun: null, itemsCollected: 0, changesDetected: 0, ...endpointStats };
  }

  const itemsCollected = db
    .select({ value: count() })
    .from(resources)
    .where(and(eq(resources.instanceId, instanceId), eq(resources.lastSeenRunId, run.id)))
    .get()?.value ?? 0;
  const changesDetected = db
    .select({ value: count() })
    .from(detectedChanges)
    .where(and(eq(detectedChanges.instanceId, instanceId), eq(detectedChanges.runId, run.id)))
    .get()?.value ?? 0;

  return {
    lastRun: { id: run.id, status: run.status, finishedAt: run.finishedAt },
    itemsCollected,
    changesDetected,
    ...endpointStats,
  };
}
