import { getActiveInstance } from './instances';
import { and, asc, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { AppDb } from '@/lib/db/client';
import {
  apiModules,
  instances,
  resourceRelations,
  resources,
  resourceVersions,
  syncRuns,
} from '@/lib/db/schema';
import { listChangesForResource, type ChangeRow } from './changes';
import { offsetFor, resolvePaging, type Paging } from './paging';
import { getLatestFinishedRun } from './runs';
import { moduleFilter } from './module-filter';
import { listVersions, type ResourceVersion } from './versions';

/** new: criado na última execução. updated: versão nova na última execução. unchanged: sem mudança. */
export type ResourceStatus = 'new' | 'updated' | 'unchanged';

export const RESOURCE_SORT_KEYS = ['id', 'name', 'category', 'module', 'status', 'lastSeen'] as const;
export type ResourceSortKey = (typeof RESOURCE_SORT_KEYS)[number];

export interface ListResourcesInput {
  instanceId: number;
  module?: string | null;
  search?: string | null;
  status?: ResourceStatus | null;
  sort?: ResourceSortKey;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  /** Mínimo aceito para pageSize (padrão 5). O painel inicial usa 3. */
  minPageSize?: number;
}

export interface ResourceListRow {
  id: number;
  moduleKey: string;
  externalId: string;
  name: string | null;
  category: string | null;
  status: ResourceStatus;
  lastSeenAt: number | null;
}

export interface ResourceListResult extends Paging {
  rows: ResourceListRow[];
  total: number;
  /** Execução usada como "estado atual". Null se a instância nunca concluiu um mapeamento. */
  runId: number | null;
}

/**
 * Recursos vistos na última execução concluída da instância. Pesquisa por nome ou ID,
 * ordenação, filtro de status e paginação ficam no SQL.
 */
export function listResources(db: AppDb, input: ListResourcesInput): ResourceListResult {
  const run = getLatestFinishedRun(db, input.instanceId);
  const empty = resolvePaging(0, 1, input.pageSize, 100, input.minPageSize);
  if (!run) return { rows: [], total: 0, runId: null, ...empty };

  const cv = alias(resourceVersions, 'cv');
  const status = sql<ResourceStatus>`(case
    when ${resources.firstSeenRunId} = ${run.id} then 'new'
    when ${cv.runId} = ${run.id} then 'updated'
    else 'unchanged' end)`;

  const conditions: SQL[] = [
    eq(resources.instanceId, input.instanceId),
    eq(resources.lastSeenRunId, run.id),
  ];
  if (input.module) conditions.push(moduleFilter(resources.moduleKey, input.module));
  const term = input.search?.trim();
  if (term) {
    conditions.push(
      sql`(instr(lower(${resources.currentName}), lower(${term})) > 0 or instr(${resources.externalId}, ${term}) > 0)`,
    );
  }
  if (input.status) conditions.push(sql`${status} = ${input.status}`);
  const where = and(...conditions);

  const joinVersion = eq(cv.id, resources.currentVersionId);
  const total =
    db
      .select({ value: count() })
      .from(resources)
      .leftJoin(cv, joinVersion)
      .where(where)
      .get()?.value ?? 0;
  const paging = resolvePaging(total, input.page, input.pageSize, 100, input.minPageSize);

  const sortExpressions: Record<ResourceSortKey, SQL> = {
    id: sql`cast(${resources.externalId} as integer)`,
    name: sql`lower(${resources.currentName})`,
    category: sql`lower(${resources.currentCategory})`,
    module: sql`${resources.moduleKey}`,
    status: sql`${status}`,
    lastSeen: sql`${resources.lastSeenRunId}`,
  };
  const sortExpr = sortExpressions[input.sort ?? 'id'];
  const direction = input.dir === 'desc' ? desc(sortExpr) : asc(sortExpr);

  const rows = db
    .select({
      id: resources.id,
      moduleKey: resources.moduleKey,
      externalId: resources.externalId,
      name: resources.currentName,
      category: resources.currentCategory,
      status,
      lastSeenAt: syncRuns.finishedAt,
    })
    .from(resources)
    .leftJoin(cv, joinVersion)
    .innerJoin(syncRuns, eq(syncRuns.id, resources.lastSeenRunId))
    .where(where)
    .orderBy(direction, asc(resources.externalId))
    .limit(paging.pageSize)
    .offset(offsetFor(paging))
    .all();

  return { rows, total, runId: run.id, ...paging };
}

export interface ResourceRelationRow {
  relationType: string;
  otherResourceId: number | null;
  otherExternalRef: string;
  otherName: string | null;
}

export interface ResourceDetail {
  id: number;
  instanceId: number;
  moduleKey: string;
  externalId: string;
  workspaceId: number | null;
  name: string | null;
  category: string | null;
  firstSeenRunId: number;
  lastSeenRunId: number;
  lastSeenAt: number | null;
  instance: { baseUrl: string; displayName: string; isDemo: boolean };
  currentVersion: ResourceVersion | null;
  versions: ResourceVersion[];
  changes: ChangeRow[];
  relations: { outgoing: ResourceRelationRow[]; incoming: ResourceRelationRow[] };
  /** Endpoint de origem (versão atual) e o módulo da API que o produziu. */
  origin: {
    sourceEndpoint: string | null;
    apiModule: { name: string; method: string; path: string } | null;
  };
}

/** Detalhe com versões, mudanças e relações da instância ativa. Null sem instância ou recurso nela. */
export function getResourceDetail(db: AppDb, id: number): ResourceDetail | null {
  const instance = getActiveInstance(db);
  if (!instance) return null;
  const row = db
    .select({
      id: resources.id,
      instanceId: resources.instanceId,
      moduleKey: resources.moduleKey,
      externalId: resources.externalId,
      workspaceId: resources.workspaceId,
      name: resources.currentName,
      category: resources.currentCategory,
      currentVersionId: resources.currentVersionId,
      firstSeenRunId: resources.firstSeenRunId,
      lastSeenRunId: resources.lastSeenRunId,
      lastSeenAt: syncRuns.finishedAt,
      baseUrl: instances.baseUrl,
      displayName: instances.displayName,
      isDemo: instances.isDemo,
    })
    .from(resources)
    .innerJoin(instances, eq(instances.id, resources.instanceId))
    .innerJoin(syncRuns, eq(syncRuns.id, resources.lastSeenRunId))
    .where(and(eq(resources.id, id), eq(resources.instanceId, instance.id)))
    .get();
  if (!row) return null;

  const versions = listVersions(db, id);
  const currentVersion = versions.find((version) => version.id === row.currentVersionId) ?? null;

  const target = alias(resources, 'relation_target');
  const source = alias(resources, 'relation_source');
  const outgoing = db
    .select({
      relationType: resourceRelations.relationType,
      otherResourceId: target.id,
      otherExternalRef: resourceRelations.toExternalRef,
      otherName: target.currentName,
    })
    .from(resourceRelations)
    .leftJoin(target, and(eq(target.id, resourceRelations.toResourceId), eq(target.instanceId, instance.id)))
    .where(and(eq(resourceRelations.fromResourceId, id), eq(resourceRelations.instanceId, instance.id)))
    .all();
  const incoming = db
    .select({
      relationType: resourceRelations.relationType,
      otherResourceId: resourceRelations.fromResourceId,
      otherExternalRef: source.externalId,
      otherName: source.currentName,
    })
    .from(resourceRelations)
    .innerJoin(source, and(eq(source.id, resourceRelations.fromResourceId), eq(source.instanceId, instance.id)))
    .where(and(eq(resourceRelations.toResourceId, id), eq(resourceRelations.instanceId, instance.id)))
    .all();

  const apiModule =
    db
      .select({ name: apiModules.name, method: apiModules.method, path: apiModules.path })
      .from(apiModules)
      .where(and(eq(apiModules.instanceId, row.instanceId), eq(apiModules.moduleKey, row.moduleKey)))
      .get() ?? null;

  return {
    id: row.id,
    instanceId: row.instanceId,
    moduleKey: row.moduleKey,
    externalId: row.externalId,
    workspaceId: row.workspaceId,
    name: row.name,
    category: row.category,
    firstSeenRunId: row.firstSeenRunId,
    lastSeenRunId: row.lastSeenRunId,
    lastSeenAt: row.lastSeenAt,
    instance: { baseUrl: row.baseUrl, displayName: row.displayName, isDemo: row.isDemo },
    currentVersion,
    versions,
    changes: listChangesForResource(db, id),
    relations: { outgoing, incoming },
    origin: {
      sourceEndpoint: currentVersion?.sourceEndpoint ?? null,
      apiModule,
    },
  };
}
