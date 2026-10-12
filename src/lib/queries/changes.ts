import { getActiveInstance } from './instances';
import { and, count, desc, eq, gte, lte, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { AppDb } from '@/lib/db/client';
import {
  type CHANGE_TYPES,
  changeMatches,
  detectedChanges,
  type REVIEW_STATUSES,
  resources,
  type SEVERITIES,
} from '@/lib/db/schema';
import { diffFields, type FieldDiff } from './compare';
import { offsetFor, resolvePaging, type Paging } from './paging';
import { versionAtOrBefore, type ResourceVersion } from './versions';
import { moduleFilter } from './module-filter';

export type ChangeType = (typeof CHANGE_TYPES)[number];
export type ChangeSeverity = (typeof SEVERITIES)[number];
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface ChangeRow {
  id: number;
  runId: number;
  baseRunId: number;
  moduleKey: string;
  changeType: ChangeType;
  severity: ChangeSeverity;
  reviewStatus: ReviewStatus;
  resourceId: number | null;
  previousResourceId: number | null;
  previousExternalId: string | null;
  currentExternalId: string | null;
  previousName: string | null;
  currentName: string | null;
  detectedAt: number;
}

const changeColumns = {
  id: detectedChanges.id,
  runId: detectedChanges.runId,
  baseRunId: detectedChanges.baseRunId,
  moduleKey: detectedChanges.moduleKey,
  changeType: detectedChanges.changeType,
  severity: detectedChanges.severity,
  reviewStatus: detectedChanges.reviewStatus,
  resourceId: detectedChanges.resourceId,
  previousResourceId: detectedChanges.previousResourceId,
  previousExternalId: detectedChanges.previousExternalId,
  currentExternalId: detectedChanges.currentExternalId,
  previousName: detectedChanges.previousName,
  currentName: detectedChanges.currentName,
  detectedAt: detectedChanges.detectedAt,
};

export interface ListChangesInput {
  instanceId: number;
  type?: ChangeType | null;
  module?: string | null;
  severity?: ChangeSeverity | null;
  review?: ReviewStatus | null;
  /** Instante inicial (inclusive), em epoch ms. */
  from?: number | null;
  /** Instante final (inclusive), em epoch ms. */
  to?: number | null;
  page?: number;
  pageSize?: number;
}

export interface ChangeListResult extends Paging {
  rows: ChangeRow[];
  total: number;
}

/** Diferenças de todas as execuções da instância, com filtros opcionais. */
export function listChanges(db: AppDb, input: ListChangesInput): ChangeListResult {
  const conditions = [eq(detectedChanges.instanceId, input.instanceId)];
  if (input.type) conditions.push(eq(detectedChanges.changeType, input.type));
  if (input.module) conditions.push(moduleFilter(detectedChanges.moduleKey, input.module));
  if (input.severity) conditions.push(eq(detectedChanges.severity, input.severity));
  if (input.review) conditions.push(eq(detectedChanges.reviewStatus, input.review));
  if (input.from !== null && input.from !== undefined) {
    conditions.push(gte(detectedChanges.detectedAt, input.from));
  }
  if (input.to !== null && input.to !== undefined) {
    conditions.push(lte(detectedChanges.detectedAt, input.to));
  }
  const where = and(...conditions);

  const total = db.select({ value: count() }).from(detectedChanges).where(where).get()?.value ?? 0;
  const paging = resolvePaging(total, input.page, input.pageSize, 100);
  const rows = db
    .select(changeColumns)
    .from(detectedChanges)
    .where(where)
    .orderBy(desc(detectedChanges.detectedAt), desc(detectedChanges.id))
    .limit(paging.pageSize)
    .offset(offsetFor(paging))
    .all();

  return { rows, total, ...paging };
}

/** Diferenças de uma execução específica (usado no resumo do painel). */
export function listChangesForRun(db: AppDb, runId: number, limit = 4): ChangeRow[] {
  return db
    .select(changeColumns)
    .from(detectedChanges)
    .where(eq(detectedChanges.runId, runId))
    .orderBy(desc(detectedChanges.detectedAt), detectedChanges.id)
    .limit(limit)
    .all();
}

/** Diferenças que envolvem um recurso, como atual ou como anterior. */
export function listChangesForResource(db: AppDb, resourceId: number, limit = 50): ChangeRow[] {
  return db
    .select(changeColumns)
    .from(detectedChanges)
    .where(
      or(
        eq(detectedChanges.resourceId, resourceId),
        eq(detectedChanges.previousResourceId, resourceId),
      ),
    )
    .orderBy(desc(detectedChanges.detectedAt), desc(detectedChanges.id))
    .limit(limit)
    .all();
}

export interface ChangeSide {
  resourceId: number;
  externalId: string | null;
  name: string | null;
  /** Versão vigente na execução do lado (anterior: base; atual: execução da mudança). */
  version: ResourceVersion | null;
}

export interface ChangeMatchRow {
  id: number;
  score: number;
  scoreBreakdown: unknown;
  status: string;
  oldExternalId: string;
  newExternalId: string;
}

export interface ChangeDetail {
  change: ChangeRow & { evidence: unknown };
  previous: ChangeSide | null;
  current: ChangeSide | null;
  /** Campo a campo, calculado a partir das versões. Se faltarem versões, usa o gravado. */
  fieldDiffs: FieldDiff[];
  matches: ChangeMatchRow[];
}

/** Detalhe acessível apenas quando a diferença pertence à instância ativa. */
export function getChangeDetail(db: AppDb, id: number): ChangeDetail | null {
  const instance = getActiveInstance(db);
  if (!instance) return null;
  const change = db
    .select({ ...changeColumns, evidence: detectedChanges.evidence, storedFieldDiffs: detectedChanges.fieldDiffs })
    .from(detectedChanges)
    .where(and(eq(detectedChanges.id, id), eq(detectedChanges.instanceId, instance.id)))
    .get();
  if (!change) return null;

  const previous =
    change.previousResourceId === null
      ? null
      : {
          resourceId: change.previousResourceId,
          externalId: change.previousExternalId,
          name: change.previousName,
          version: versionAtOrBefore(db, change.previousResourceId, change.baseRunId),
        };
  const current =
    change.resourceId === null
      ? null
      : {
          resourceId: change.resourceId,
          externalId: change.currentExternalId,
          name: change.currentName,
          version: versionAtOrBefore(db, change.resourceId, change.runId),
        };

  const stored = Array.isArray(change.storedFieldDiffs) ? (change.storedFieldDiffs as FieldDiff[]) : [];
  const fieldDiffs =
    previous?.version && current?.version
      ? diffFields(previous.version.normalized, current.version.normalized)
      : stored;

  const oldResource = alias(resources, 'old_resource');
  const newResource = alias(resources, 'new_resource');
  const matches = db
    .select({
      id: changeMatches.id,
      score: changeMatches.score,
      scoreBreakdown: changeMatches.scoreBreakdown,
      status: changeMatches.status,
      oldExternalId: oldResource.externalId,
      newExternalId: newResource.externalId,
    })
    .from(changeMatches)
    .innerJoin(oldResource, eq(oldResource.id, changeMatches.oldResourceId))
    .innerJoin(newResource, eq(newResource.id, changeMatches.newResourceId))
    .where(and(eq(changeMatches.changeId, id), eq(oldResource.instanceId, instance.id), eq(newResource.instanceId, instance.id)))
    .orderBy(desc(changeMatches.score))
    .all();

  const { storedFieldDiffs: _stored, ...base } = change;
  return {
    change: base,
    previous,
    current,
    fieldDiffs,
    matches,
  };
}
