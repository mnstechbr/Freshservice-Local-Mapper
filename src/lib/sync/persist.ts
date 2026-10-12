/*
 * Persistência do motor: uma transação por página. Recurso novo ou com hash diferente gera versão;
 * toda observação entra em resource_observations (uma por recurso e execução).
 */
import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import type { AppDb } from '../db/client';
import {
  ACCESS_STATUSES,
  apiModules,
  resourceObservations,
  resourceRelations,
  resources,
  resourceVersions,
  syncModuleResults,
} from '../db/schema';
import {
  isNeverStoredKey,
  withoutNeverStoredKeys,
  type ModuleAdapter,
  type ResourceRecord,
} from '../freshservice/modules/types';
import { hashCanonical } from './canonical';
import { applyPrivacy } from './prefs';
import type { ModuleOutcome } from './types';

type Tx = Parameters<Parameters<AppDb['transaction']>[0]>[0];
export type AccessStatus = (typeof ACCESS_STATUSES)[number];

export interface PersistScope {
  instanceId: number;
  runId: number;
  adapter: ModuleAdapter;
  metadataOnly: boolean;
  storeRaw: boolean;
  now: number;
}

export interface PersistItem {
  record: ResourceRecord;
  /** Item original da API. Só é gravado em raw_json quando storeRaw. */
  raw: unknown;
}

export interface PersistCounts {
  /** Recursos observados nesta execução (sem duplicatas). */
  observed: number;
  /** Versões novas criadas (hash diferente da versão atual). */
  newVersions: number;
  /** Itens repetidos dentro da mesma execução (ignorados). */
  duplicates: number;
}

type RecordResult = 'new_version' | 'same_version' | 'duplicate';

/** Grava uma página inteira em uma transação. Erro em qualquer item desfaz a página toda. */
export function persistPage(db: AppDb, scope: PersistScope, items: readonly PersistItem[]): PersistCounts {
  return db.transaction((tx) => {
    const counts: PersistCounts = { observed: 0, newVersions: 0, duplicates: 0 };
    for (const item of items) {
      const result = persistRecord(tx, scope, item);
      if (result === 'duplicate') {
        counts.duplicates += 1;
        continue;
      }
      counts.observed += 1;
      if (result === 'new_version') counts.newVersions += 1;
    }
    return counts;
  });
}

function persistRecord(tx: Tx, scope: PersistScope, item: PersistItem): RecordResult {
  const { record } = item;
  const { instanceId, runId, adapter, now } = scope;
  const workspaceCondition =
    record.workspaceId === null ? isNull(resources.workspaceId) : eq(resources.workspaceId, record.workspaceId);
  let resource = tx
    .select()
    .from(resources)
    .where(
      and(
        eq(resources.instanceId, instanceId),
        eq(resources.moduleKey, adapter.key),
        eq(resources.externalId, record.externalId),
        workspaceCondition,
      ),
    )
    .get();
  if (!resource) {
    resource = tx
      .insert(resources)
      .values({
        instanceId,
        moduleKey: adapter.key,
        externalId: record.externalId,
        workspaceId: record.workspaceId,
        firstSeenRunId: runId,
        lastSeenRunId: runId,
        currentVersionId: null,
        currentName: null,
        currentCategory: null,
      })
      .returning()
      .get();
  }

  const alreadySeen = tx
    .select({ id: resourceObservations.id })
    .from(resourceObservations)
    .where(and(eq(resourceObservations.runId, runId), eq(resourceObservations.resourceId, resource.id)))
    .get();
  if (alreadySeen) return 'duplicate';

  const normalized = applyPrivacy(record.normalized, adapter, scope.metadataOnly);
  const contentHash = hashCanonical(normalized);
  const current =
    resource.currentVersionId === null
      ? undefined
      : tx
          .select({ id: resourceVersions.id, contentHash: resourceVersions.contentHash })
          .from(resourceVersions)
          .where(eq(resourceVersions.id, resource.currentVersionId))
          .get();

  let versionId: number;
  let result: RecordResult;
  if (current && current.contentHash === contentHash) {
    versionId = current.id;
    result = 'same_version';
    tx.update(resources).set({ lastSeenRunId: runId }).where(eq(resources.id, resource.id)).run();
  } else {
    versionId = tx
      .insert(resourceVersions)
      .values({
        resourceId: resource.id,
        runId,
        contentHash,
        name: record.name,
        category: record.category,
        normalizedJson: normalized,
        rawJson: scope.storeRaw ? sanitizeRaw(item.raw, adapter, scope.metadataOnly) : null,
        sourceEndpoint: adapter.path,
        capturedAt: now,
      })
      .returning({ id: resourceVersions.id })
      .get().id;
    result = 'new_version';
    tx.update(resources)
      .set({
        currentVersionId: versionId,
        currentName: record.name,
        currentCategory: record.category,
        lastSeenRunId: runId,
      })
      .where(eq(resources.id, resource.id))
      .run();
  }

  tx.insert(resourceObservations).values({ runId, resourceId: resource.id, versionId }).run();
  if (record.relations.length > 0) {
    tx.insert(resourceRelations)
      .values(
        record.relations.map((relation) => ({
          instanceId,
          fromResourceId: resource.id,
          toResourceId: null,
          toExternalRef: relation.toExternalId,
          relationType: relation.type,
          runId,
        })),
      )
      .run();
  }
  return result;
}

export function writeModuleResult(db: AppDb, runId: number, outcome: ModuleOutcome): void {
  db.insert(syncModuleResults)
    .values({
      runId,
      moduleKey: outcome.moduleKey,
      status: outcome.status,
      complete: outcome.complete,
      recordsCount: outcome.recordsCount,
      pagesFetched: outcome.pagesFetched,
      httpStatus: outcome.httpStatus,
      errorMessage: outcome.errorMessage,
      startedAt: outcome.startedAt,
      finishedAt: outcome.finishedAt,
    })
    .run();
}

/** Estado de acesso do módulo para api_modules. Null: não altera (ex.: 401 ou erro de contrato). */
export function accessForOutcome(outcome: ModuleOutcome): AccessStatus | null {
  if (outcome.complete) return 'accessible';
  switch (outcome.failureKind) {
    case 'forbidden':
    // Sem chamada à API: o motivo fica em access_detail ('scope_not_granted').
    case 'scope_not_granted':
      return 'forbidden';
    case 'not_found':
      return 'not_found';
    case 'rate_limited':
    case 'server_error':
    case 'timeout':
    case 'network':
      return 'temporarily_unavailable';
    default:
      return null;
  }
}

/** Cria ou atualiza api_modules (uma linha por instância e módulo). */
export function recordAccess(db: AppDb, instanceId: number, adapter: ModuleAdapter, outcome: ModuleOutcome, now: number): void {
  const existing = db
    .select()
    .from(apiModules)
    .where(and(eq(apiModules.instanceId, instanceId), eq(apiModules.moduleKey, adapter.key)))
    .get();
  const access = accessForOutcome(outcome);
  const scopeBlocked = outcome.failureKind === 'scope_not_granted';
  // Sem novo access_status (ex.: 401), o motivo anterior permanece. Com access_status novo, o motivo é o do
  // resultado: só o bloqueio por escopo grava 'scope_not_granted'; 403 e sucesso gravam null.
  let accessDetail: 'scope_not_granted' | null = existing?.accessDetail ?? null;
  if (access !== null) accessDetail = scopeBlocked ? 'scope_not_granted' : null;
  const patch = {
    accessStatus: access ?? existing?.accessStatus ?? 'untested',
    accessDetail,
    httpStatus: outcome.complete ? 200 : outcome.httpStatus,
    // Módulo sem escopo não foi consultado: a última tentativa real é mantida.
    lastAttemptAt: scopeBlocked ? (existing?.lastAttemptAt ?? null) : now,
    errorMessage: outcome.complete ? null : outcome.errorMessage,
  } as const;
  if (existing) {
    db.update(apiModules).set(patch).where(eq(apiModules.id, existing.id)).run();
    return;
  }
  db.insert(apiModules)
    .values({
      instanceId,
      moduleKey: adapter.key,
      name: adapter.name,
      method: adapter.method,
      path: adapter.path,
      paginated: adapter.paginated,
      ...patch,
    })
    .run();
}

/**
 * Sanitização de raw_json (mesma regra do normalized, mais contato pessoal):
 * - nunca guardado (GLOBAL_EXCLUDED_KEYS e nomes de segredo, types.ts), em qualquer nível (D2/D3);
 * - contato pessoal (sensitiveFields do módulo) sai sempre, mesmo sem metadataOnly;
 * - com metadataOnly, também saem os campos de conteúdo (contentFields).
 * Devolve cópia; o item original não muda. Item que não é objeto não é gravado (null).
 */
export function sanitizeRaw(raw: unknown, adapter: ModuleAdapter, metadataOnly: boolean): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const privacy = applyPrivacy(raw as Record<string, unknown>, adapter, metadataOnly);
  const contact = new Set<string>(adapter.sensitiveFields);
  return Object.fromEntries(
    Object.entries(privacy)
      .filter(([key]) => !contact.has(key) && !isNeverStoredKey(key))
      .map(([key, value]) => [key, withoutNeverStoredKeys(value)]),
  );
}
