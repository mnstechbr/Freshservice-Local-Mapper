/*
 * Regras das rotas /api/sync/* e /api/diagnostics (Fase 4). Todo estado é validado antes de gravar.
 * Erros do motor viram AuthError com código estável (409 ou 404), sem detalhes internos.
 */
import 'server-only';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { requireActiveInstance } from '../auth/instances';
import type { AuthDeps } from '../auth/deps';
import { AuthError, type AuthErrorCode } from '../auth/errors';
import { findConnection, type InstanceRow } from '../auth/repo';
import { invalidFields } from '../auth/route-utils';
import type { AppDb } from '../db/client';
import { syncModuleResults, syncRuns } from '../db/schema';
import { MODULE_ADAPTERS, MODULE_GROUPS, syncableAdapters } from '../freshservice/modules';
import { cancel, getProgress, runSync, SyncError } from './engine';
import { diagnosticsRunning } from './diagnostics';
import {
  adapterMatchesPreference,
  PREFERENCE_KEYS,
  readPreferencesView,
  readStoredPreferences,
  writeStoredPreferences,
  type StoredPreferences,
} from './prefs';
import { ensureSyncReady } from './reconcile';
import { activeSync } from './registry';
import type { SyncErrorCode, SyncRunKind } from './types';

const ENGINE_HTTP: Record<SyncErrorCode, [AuthErrorCode, number]> = {
  instance_not_found: ['no_active_instance', 409],
  demo_instance: ['demo_instance', 409],
  invalid_origin: ['invalid_url', 409],
  no_connection: ['no_connection', 409],
  connection_not_ready: ['connection_not_ready', 409],
  sync_already_running: ['sync_already_running', 409],
  invalid_modules: ['invalid_modules', 409],
  retry_run_not_found: ['retry_run_not_found', 404],
  no_failed_modules: ['no_failed_modules', 409],
};

/** Instância ativa, real e com conexão 'connected'. Cada caso tem código e mensagem próprios. */
export function requireConnectedInstance(deps: AuthDeps): InstanceRow {
  ensureSyncReady(deps);
  const instance = requireActiveInstance(deps);
  if (instance.isDemo) {
    throw new AuthError('demo_instance', 409, 'A instância ativa é demonstrativa. Cadastre uma instância real para sincronizar.');
  }
  const connection = findConnection(deps.db, instance.id);
  if (!connection) {
    throw new AuthError('no_connection', 409, 'A instância não tem conexão configurada. Configure a API key ou o OAuth.');
  }
  if (connection.status === 'session_expired') {
    throw new AuthError('session_expired', 409, 'Sessão expirada. Reconecte antes de sincronizar.');
  }
  if (connection.status !== 'connected') {
    throw new AuthError('connection_not_ready', 409, 'Conexão desconectada. Reconecte antes de sincronizar.');
  }
  return instance;
}

function assertNoDiagnostics(instanceId: number): void {
  if (diagnosticsRunning(instanceId)) {
    throw new AuthError('diagnostics_running', 409, 'Há um diagnóstico em andamento. Aguarde o fim para sincronizar.');
  }
}

function assertNoSync(instanceId: number): void {
  if (activeSync(instanceId)) {
    throw new AuthError('sync_already_running', 409, 'Há uma sincronização em andamento nesta instância.');
  }
}

/** Módulos coletados (preferências) expandidos para chaves de adaptador consultáveis. */
export function selectedModuleKeys(db: AppDb): string[] {
  const { modules } = readStoredPreferences(db);
  return syncableAdapters()
    .filter((adapter) => modules.some((key) => adapterMatchesPreference(adapter, key)))
    .map((adapter) => adapter.key);
}

function hasCompletedRun(db: AppDb, instanceId: number): boolean {
  const row = db
    .select({ id: syncRuns.id })
    .from(syncRuns)
    .where(and(eq(syncRuns.instanceId, instanceId), inArray(syncRuns.status, ['completed', 'partial'])))
    .limit(1)
    .get();
  return row !== undefined;
}

async function launch(input: Parameters<typeof runSync>[0]): Promise<number> {
  try {
    return await runSync(input);
  } catch (error) {
    if (error instanceof SyncError) {
      const [code, status] = ENGINE_HTTP[error.code];
      throw new AuthError(code, status, error.message);
    }
    throw error;
  }
}

/** "Mapear tudo" (full) ou "Sincronizar novamente" (resync, exige execução anterior concluída). */
export async function startCollection(deps: AuthDeps, kind: SyncRunKind): Promise<number> {
  const instance = requireConnectedInstance(deps);
  assertNoDiagnostics(instance.id);
  if (kind === 'resync' && !hasCompletedRun(deps.db, instance.id)) {
    throw new AuthError('no_previous_run', 409, 'Não há execução anterior concluída. Use "Mapear tudo" antes de sincronizar novamente.');
  }
  return launch({ db: deps.db, auth: deps, instanceId: instance.id, kind, modules: selectedModuleKeys(deps.db) });
}

/** Repete só os módulos com falha da execução indicada. O motor confere se ela pertence à instância. */
export async function startRetry(deps: AuthDeps, runId: number): Promise<number> {
  const instance = requireConnectedInstance(deps);
  assertNoDiagnostics(instance.id);
  return launch({ db: deps.db, auth: deps, instanceId: instance.id, kind: 'resync', retryOfRunId: runId });
}

export function cancelCollection(deps: AuthDeps): void {
  ensureSyncReady(deps);
  const instance = requireActiveInstance(deps);
  if (!cancel(instance.id)) throw new AuthError('no_active_sync', 409, 'Nenhuma sincronização em andamento.');
}

/** Pré-condição do diagnóstico: conexão ativa e nenhuma sincronização em andamento. */
export function requireDiagnosticsStart(deps: AuthDeps): InstanceRow {
  const instance = requireConnectedInstance(deps);
  assertNoSync(instance.id);
  return instance;
}

function runView(db: AppDb, run: typeof syncRuns.$inferSelect) {
  const failed = db
    .select({ id: syncModuleResults.id })
    .from(syncModuleResults)
    .where(and(eq(syncModuleResults.runId, run.id), eq(syncModuleResults.status, 'failed')))
    .all().length;
  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    modulesRequested: run.modulesRequested,
    modulesProcessed: run.modulesProcessed,
    recordsCount: run.recordsCount,
    failuresCount: run.failuresCount,
    failedCount: failed,
    changesCount: run.changesCount,
  };
}

/** Progresso do run ativo (registro em memória) mais a última execução da instância. */
export function collectionStatus(deps: AuthDeps) {
  ensureSyncReady(deps);
  const instance = requireActiveInstance(deps);
  const run = deps.db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.instanceId, instance.id))
    .orderBy(desc(syncRuns.id))
    .limit(1)
    .get();
  return { ...getProgress(instance.id), lastRun: run ? runView(deps.db, run) : null };
}

const known = new Set<string>([...PREFERENCE_KEYS, ...MODULE_GROUPS, ...MODULE_ADAPTERS.map((adapter) => adapter.key)]);

/** Mesmo formato do formulário de preferências (modules, metadataOnly, storeRaw). */
export const preferencesSchema = z
  .object({
    modules: z
      .array(z.string().max(64))
      .max(64)
      .refine((list) => new Set(list).size === list.length && list.every((key) => known.has(key))),
    metadataOnly: z
      .record(z.string().max(64), z.boolean())
      .refine((record) => Object.keys(record).length <= 64 && Object.keys(record).every((key) => known.has(key))),
    storeRaw: z.boolean(),
  })
  .strict();

export function savePreferences(deps: AuthDeps, body: unknown): StoredPreferences {
  const parsed = preferencesSchema.safeParse(body);
  if (!parsed.success) throw invalidFields(parsed.error);
  const prefs: StoredPreferences = {
    modules: parsed.data.modules,
    metadataOnly: parsed.data.metadataOnly,
    storeRaw: parsed.data.storeRaw,
  };
  writeStoredPreferences(deps.db, prefs);
  deps.audit.log({
    level: 'info',
    eventType: 'sync.preferences.updated',
    message: 'Preferências de coleta atualizadas.',
    context: { modules: prefs.modules.length, storeRaw: prefs.storeRaw },
  });
  return readPreferencesView(deps.db);
}
