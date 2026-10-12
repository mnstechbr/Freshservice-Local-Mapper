import { and, asc, count, eq } from 'drizzle-orm';
import type { AppDb } from '@/lib/db/client';
import { ACCESS_STATUSES, apiModules, resources } from '@/lib/db/schema';
import { getLatestFinishedRun } from './runs';
import { moduleFilter } from './module-filter';

export type AccessStatus = (typeof ACCESS_STATUSES)[number];

export interface ApiModuleRow {
  id: number;
  moduleKey: string;
  name: string;
  method: string;
  path: string;
  paginated: boolean;
  accessStatus: AccessStatus;
  accessDetail: string | null;
  httpStatus: number | null;
  lastAttemptAt: number | null;
  errorMessage: string | null;
}

const moduleColumns = {
  id: apiModules.id,
  moduleKey: apiModules.moduleKey,
  name: apiModules.name,
  method: apiModules.method,
  path: apiModules.path,
  paginated: apiModules.paginated,
  accessStatus: apiModules.accessStatus,
  accessDetail: apiModules.accessDetail,
  httpStatus: apiModules.httpStatus,
  lastAttemptAt: apiModules.lastAttemptAt,
  errorMessage: apiModules.errorMessage,
};

export function listApiModules(db: AppDb, instanceId: number): ApiModuleRow[] {
  return db
    .select(moduleColumns)
    .from(apiModules)
    .where(eq(apiModules.instanceId, instanceId))
    .orderBy(asc(apiModules.moduleKey))
    .all();
}

export interface ModuleOverview {
  /** Endpoints do grupo (ou da chave pontuada) com o estado de acesso. */
  endpoints: ApiModuleRow[];
  /** Quantidade de recursos do grupo vistos na última execução concluída. */
  resourceCount: number;
  runId: number | null;
  runFinishedAt: number | null;
}

/** Estado de um grupo (ex.: tickets) ou de uma chave pontuada (ex.: itsm.releases). */
export function getModuleOverview(db: AppDb, instanceId: number, moduleKey: string): ModuleOverview {
  const endpoints = db
    .select(moduleColumns)
    .from(apiModules)
    .where(and(eq(apiModules.instanceId, instanceId), moduleFilter(apiModules.moduleKey, moduleKey)))
    .orderBy(asc(apiModules.moduleKey))
    .all();
  const run = getLatestFinishedRun(db, instanceId);
  const resourceCount = run
    ? (db
        .select({ value: count() })
        .from(resources)
        .where(
          and(
            eq(resources.instanceId, instanceId),
            moduleFilter(resources.moduleKey, moduleKey),
            eq(resources.lastSeenRunId, run.id),
          ),
        )
        .get()?.value ?? 0)
    : 0;

  return {
    endpoints,
    resourceCount,
    runId: run?.id ?? null,
    runFinishedAt: run?.finishedAt ?? null,
  };
}
