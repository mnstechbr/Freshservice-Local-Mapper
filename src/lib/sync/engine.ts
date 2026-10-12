/*
 * Motor de sincronização. runSync valida, cria sync_runs e devolve o runId logo; os módulos rodam em
 * segundo plano, controlados pelo registro por instância (um run por vez, cancelamento via
 * AbortController). Só a conexão ativa da própria instância é usada.
 */
import 'server-only';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { ACCOUNT_LABELS, type ApiKeyMode } from '../auth/api-key';
import type { AuthDeps } from '../auth/deps';
import { AuthError } from '../auth/errors';
import { OAUTH_ACCOUNT_LABEL } from '../auth/oauth';
import { findConnection, findInstance, saveConnection, type ConnectionRow } from '../auth/repo';
import type { AppDb } from '../db/client';
import { resourceObservations, resourceVersions, resources, syncModuleResults, syncRuns } from '../db/schema';
import { detectChangesForRun } from '@/lib/diff';
import { createFreshserviceClient, FreshserviceError } from '../freshservice/http';
import { getAdapter, MODULE_ADAPTERS, syncableAdapters, type ModuleAdapter } from '../freshservice/modules';
import { normalizeInstanceUrl } from '../security/url';
import { persistPage, recordAccess, writeModuleResult, type PersistItem } from './persist';
import { paginate, type HttpClient, type PageContext, type RetryPolicy } from './fetch-pages';
import { resolveRelationTargets } from './relations';
import { isMetadataOnly, readSyncPreferences } from './prefs';
import { claimInstance, releaseInstance, type ActiveSync } from './registry';
import { grantedScopesFor, scopeBlockFor, scopeNotGrantedMessage } from './scopes';
import { createAuthorizationProvider } from './token';
import {
  ModuleIncompleteError,
  SYNC_DEFAULTS,
  SyncError,
  type FailureKind,
  type ModuleOutcome,
  type RunSyncInput,
  type SyncDeps,
  type SyncOptions,
  type SyncPreferences,
  type SyncRunKind,
  type SyncRunStatus,
} from './types';

export { cancelSync as cancel, getProgress, waitForSync } from './registry';
export { SyncError } from './types';
export type { RunSyncInput, SyncDeps, SyncOptions, SyncPreferences, SyncProgress } from './types';

interface ResolvedOptions {
  concurrency: number;
  timeoutMs: number;
  maxPages: number;
  policy: RetryPolicy;
}

interface RunContext {
  db: AppDb;
  auth: AuthDeps;
  instanceId: number;
  runId: number;
  connectionId: number;
  origin: string;
  kind: SyncRunKind;
  keys: string[];
  modules: Map<string, ModuleAdapter>;
  parentKeys: Set<string>;
  deps: SyncDeps;
  prefs: SyncPreferences;
  options: ResolvedOptions;
  entry: ActiveSync;
  /** Escopos do perfil OAuth da conexão. Null: sem checagem de escopo (API key ou sem perfil). */
  grantedScopes: ReadonlySet<string> | null;
  /** Verdadeiro quando a execução foi interrompida por 401 ou falha de autenticação. */
  fatal: boolean;
  finishedModules: number;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

interface Classified {
  status: 'failed' | 'cancelled';
  failureKind: FailureKind;
  httpStatus: number | null;
  message: string;
  stopRun: boolean;
  markSession: boolean;
}

const STATUS_LABEL: Record<SyncRunStatus, string> = {
  completed: 'concluída',
  partial: 'parcial',
  failed: 'falhou',
  cancelled: 'cancelada',
  running: 'em andamento',
};

/**
 * Inicia uma sincronização da instância e devolve o runId. A execução continua em segundo plano.
 * Lança SyncError se a validação falhar (nada é gravado) ou se já houver execução ativa.
 */
export async function runSync(input: RunSyncInput): Promise<number> {
  const entry = claimInstance(input.instanceId);
  let ctx: RunContext;
  try {
    ctx = prepareRun(input, entry);
  } catch (error) {
    releaseInstance(entry);
    throw error;
  }
  entry.runId = ctx.runId;
  entry.progress = { ...entry.progress, runId: ctx.runId, message: 'Sincronização iniciada.' };
  entry.done = executeRun(ctx)
    .catch(() => undefined)
    .finally(() => releaseInstance(entry));
  return ctx.runId;
}

function prepareRun(input: RunSyncInput, entry: ActiveSync): RunContext {
  const { db, instanceId } = input;
  const deps = resolveDeps(input.deps);
  const adapters = input.options?.adapters ?? MODULE_ADAPTERS;
  const instance = findInstance(db, instanceId);
  if (!instance) throw new SyncError('instance_not_found', 'Instância não encontrada.');
  if (instance.isDemo) {
    throw new SyncError('demo_instance', 'Instância demonstrativa não sincroniza com o Freshservice.');
  }
  let origin: string;
  try {
    origin = normalizeInstanceUrl(instance.baseUrl).origin;
  } catch {
    throw new SyncError('invalid_origin', 'A URL da instância não é um domínio Freshservice válido.');
  }
  const connection = findConnection(db, instanceId);
  if (!connection) throw new SyncError('no_connection', 'A instância não tem conexão configurada.');
  if (connection.status !== 'connected') {
    throw new SyncError('connection_not_ready', 'A conexão não está ativa. Reconecte antes de sincronizar.');
  }
  const keys = resolveKeys(input, adapters);
  const modules = new Map(adapters.map((adapter) => [adapter.key, adapter] as const));
  const parentKeys = new Set(
    keys.flatMap((key) => {
      const child = modules.get(key)?.child;
      return child ? [child.parentKey] : [];
    }),
  );
  const runId = db
    .insert(syncRuns)
    .values({
      instanceId,
      connectionId: connection.id,
      identityLabel: identityLabelOf(connection),
      kind: input.kind,
      status: 'running',
      startedAt: deps.now(),
      modulesRequested: keys,
    })
    .returning({ id: syncRuns.id })
    .get().id;
  return {
    db,
    auth: input.auth,
    instanceId,
    runId,
    connectionId: connection.id,
    origin,
    kind: input.kind,
    keys,
    modules,
    parentKeys,
    deps,
    prefs: readSyncPreferences(db),
    options: resolveOptions(input.options),
    entry,
    grantedScopes: grantedScopesFor(db, connection, instance.baseUrl),
    fatal: false,
    finishedModules: 0,
  };
}

/** Módulos a executar, em ordem do registro (pais antes dos filhos). Retry: só os que falharam. */
function resolveKeys(input: RunSyncInput, adapters: readonly ModuleAdapter[]): string[] {
  const syncable = new Set(syncableAdapters(adapters).map((adapter) => adapter.key));
  let keys: string[];
  if (input.retryOfRunId !== undefined) {
    const source = input.db
      .select({ id: syncRuns.id, instanceId: syncRuns.instanceId })
      .from(syncRuns)
      .where(eq(syncRuns.id, input.retryOfRunId))
      .get();
    if (!source || source.instanceId !== input.instanceId) {
      throw new SyncError('retry_run_not_found', 'Execução de origem não encontrada para esta instância.');
    }
    const failed = input.db
      .select({ moduleKey: syncModuleResults.moduleKey })
      .from(syncModuleResults)
      .where(and(eq(syncModuleResults.runId, source.id), eq(syncModuleResults.status, 'failed')))
      .all();
    keys = failed
      .map((row) => row.moduleKey)
      .filter((key) => syncable.has(key) && (!input.modules || input.modules.includes(key)));
    if (keys.length === 0) {
      throw new SyncError('no_failed_modules', 'A execução de origem não tem módulos com falha para repetir.');
    }
  } else {
    keys = input.modules ?? [...syncable];
    if (keys.length === 0) throw new SyncError('invalid_modules', 'Nenhum módulo foi selecionado.');
    if (keys.some((key) => !syncable.has(key))) {
      throw new SyncError('invalid_modules', 'Há módulo inexistente ou não consultável na lista.');
    }
  }
  const order = new Map(adapters.map((adapter, index) => [adapter.key, index] as const));
  return [...new Set(keys)].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

function resolveDeps(partial: Partial<SyncDeps> = {}): SyncDeps {
  return {
    fetch: partial.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)),
    now: partial.now ?? (() => Date.now()),
    sleep: partial.sleep ?? defaultSleep,
    random: partial.random ?? Math.random,
  };
}

function resolveOptions(options: SyncOptions = {}): ResolvedOptions {
  return {
    concurrency: Math.max(1, Math.floor(options.concurrency ?? SYNC_DEFAULTS.concurrency)),
    timeoutMs: options.timeoutMs ?? SYNC_DEFAULTS.timeoutMs,
    maxPages: options.maxPagesPerModule ?? SYNC_DEFAULTS.maxPagesPerModule,
    policy: {
      maxRetries: options.maxRetries ?? SYNC_DEFAULTS.maxRetries,
      retryAfterCapMs: options.retryAfterCapMs ?? SYNC_DEFAULTS.retryAfterCapMs,
      backoffBaseMs: options.backoffBaseMs ?? SYNC_DEFAULTS.backoffBaseMs,
      backoffCapMs: options.backoffCapMs ?? SYNC_DEFAULTS.backoffCapMs,
    },
  };
}

/** Espera com cancelamento: rejeita ao abortar. */
export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abortError = () => new DOMException('Aguardo cancelado.', 'AbortError');
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function identityLabelOf(connection: ConnectionRow): string {
  if (connection.accountLabel) return connection.accountLabel;
  if (connection.authMode === 'oauth') return OAUTH_ACCOUNT_LABEL;
  return ACCOUNT_LABELS[connection.authMode as ApiKeyMode] ?? 'Conexão';
}

async function executeRun(ctx: RunContext): Promise<void> {
  const { auth, instanceId, runId } = ctx;
  auth.audit.log({
    level: 'info',
    eventType: 'sync.run.started',
    instanceId,
    runId,
    message: 'Sincronização iniciada.',
    context: { kind: ctx.kind, modules: ctx.keys.length },
  });
  let outcomes: ModuleOutcome[] = [];
  let changesCount = 0;
  let status: SyncRunStatus = 'failed';
  try {
    const client = createFreshserviceClient({
      origin: ctx.origin,
      authorization: createAuthorizationProvider({ db: ctx.db, auth, instanceId }),
      timeoutMs: ctx.options.timeoutMs,
      fetchImpl: ctx.deps.fetch,
    });
    outcomes = await runModules(ctx, client);
    status = computeStatus(ctx, outcomes);
    resolveRelations(ctx);
    changesCount = bridgeChanges(ctx, status);
  } catch (error) {
    auth.audit.log({
      level: 'error',
      eventType: 'sync.run.error',
      instanceId,
      runId,
      message: 'Sincronização interrompida por erro interno.',
      context: { error: errorName(error) },
    });
    status = ctx.entry.cancelRequested && !ctx.fatal ? 'cancelled' : 'failed';
  }
  finalize(ctx, outcomes, status, changesCount);
}

function computeStatus(ctx: RunContext, outcomes: readonly ModuleOutcome[]): SyncRunStatus {
  if (ctx.fatal) return 'failed';
  if (ctx.entry.cancelRequested) return 'cancelled';
  const complete = outcomes.filter((outcome) => outcome.complete).length;
  if (outcomes.length > 0 && complete === outcomes.length) return 'completed';
  return complete > 0 ? 'partial' : 'failed';
}

async function runModules(ctx: RunContext, client: HttpClient): Promise<ModuleOutcome[]> {
  const gates = new Map(ctx.keys.map((key) => [key, createDeferred<ModuleOutcome>()] as const));
  const outcomes: ModuleOutcome[] = [];
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < ctx.keys.length) {
      const key = ctx.keys[cursor] ?? '';
      cursor += 1;
      let outcome: ModuleOutcome;
      try {
        outcome = await runModule(ctx, client, key, gates);
      } catch {
        // Falha ao gravar o resultado: o módulo conta como falho e os filhos não ficam pendurados.
        outcome = blankOutcome(key, 'failed', 'Erro interno ao registrar o módulo.', 'unexpected', null);
      }
      outcomes.push(outcome);
      gates.get(key)?.resolve(outcome);
    }
  };
  // Os pais vêm antes dos filhos na lista, então o worker que pega um filho nunca espera um pai não iniciado.
  await Promise.all(Array.from({ length: Math.min(ctx.options.concurrency, ctx.keys.length) }, () => worker()));
  return outcomes;
}

async function runModule(
  ctx: RunContext,
  client: HttpClient,
  key: string,
  gates: Map<string, Deferred<ModuleOutcome>>,
): Promise<ModuleOutcome> {
  const adapter = ctx.modules.get(key);
  const startedAt = ctx.deps.now();
  const blockedBy = adapter ? scopeBlockFor(adapter, ctx.grantedScopes) : null;
  let outcome: ModuleOutcome;
  if (!adapter) {
    outcome = blankOutcome(key, 'failed', 'Módulo desconhecido.', 'unexpected', startedAt);
  } else if (ctx.entry.abort.signal.aborted) {
    outcome = blankOutcome(key, 'skipped', 'Não executado: a sincronização foi interrompida.', null, null);
  } else if (blockedBy) {
    // Escopo não concedido ao perfil OAuth: nenhuma chamada à API. Não é falha, então não entra em "repetir falhas".
    outcome = {
      ...blankOutcome(key, 'skipped', scopeNotGrantedMessage(blockedBy), 'scope_not_granted', startedAt),
      finishedAt: ctx.deps.now(),
    };
  } else {
    outcome = await executeModule(ctx, client, adapter, gates, startedAt);
  }

  writeModuleResult(ctx.db, ctx.runId, outcome);
  // Bloqueio por escopo grava access (forbidden + scope_not_granted). Os outros 'skipped' não gravam.
  if (adapter && (outcome.status !== 'skipped' || outcome.failureKind === 'scope_not_granted')) {
    recordAccess(ctx.db, ctx.instanceId, adapter, outcome, ctx.deps.now());
  }
  if (outcome.status === 'completed') {
    ctx.auth.audit.log({
      level: 'info',
      eventType: 'sync.module.finished',
      instanceId: ctx.instanceId,
      runId: ctx.runId,
      message: `Módulo ${key} concluído.`,
      context: { module: key, records: outcome.recordsCount, pages: outcome.pagesFetched },
    });
  } else if (outcome.failureKind === 'scope_not_granted') {
    ctx.auth.audit.log({
      level: 'info',
      eventType: 'sync.module.scope_not_granted',
      instanceId: ctx.instanceId,
      runId: ctx.runId,
      message: `Módulo ${key} não consultado: escopo não concedido ao perfil OAuth.`,
      context: { module: key, scopes: blockedBy ?? [] },
    });
  } else if (outcome.status !== 'failed') {
    ctx.auth.audit.log({
      level: 'info',
      eventType: 'sync.module.interrupted',
      instanceId: ctx.instanceId,
      runId: ctx.runId,
      message: `Módulo ${key} não concluído (${outcome.status}).`,
      context: { module: key, status: outcome.status },
    });
  }
  ctx.finishedModules += 1;
  ctx.entry.progress = {
    ...ctx.entry.progress,
    percent: Math.floor((ctx.finishedModules * 100) / ctx.keys.length),
    currentModule: null,
  };
  return outcome;
}

async function executeModule(
  ctx: RunContext,
  client: HttpClient,
  adapter: ModuleAdapter,
  gates: Map<string, Deferred<ModuleOutcome>>,
  startedAt: number,
): Promise<ModuleOutcome> {
  const { instanceId, runId } = ctx;
  const pages = { count: 0 };
  const externalIds: string[] = [];
  const collectIds = ctx.parentKeys.has(adapter.key);
  const metadataOnly = isMetadataOnly(ctx.prefs, adapter.key);
  const pageCtx: PageContext = {
    client,
    signal: ctx.entry.abort.signal,
    deps: ctx.deps,
    policy: ctx.options.policy,
    maxPages: ctx.options.maxPages,
    pages,
  };
  let records = 0;
  ctx.entry.progress = { ...ctx.entry.progress, currentModule: adapter.key, message: `Consultando ${adapter.name}.` };
  ctx.auth.audit.log({
    level: 'info',
    eventType: 'sync.module.started',
    instanceId,
    runId,
    message: `Módulo ${adapter.key} iniciado.`,
    context: { module: adapter.key },
  });
  try {
    let dropped = 0;
    for (const base of await resolveBases(ctx, adapter, gates)) {
      for await (const items of paginate(adapter, base, pageCtx)) {
        const batch: PersistItem[] = [];
        for (const raw of items) {
          const record = adapter.toResource(raw);
          if (record) batch.push({ record, raw });
          else dropped += 1;
        }
        const counts = persistPage(
          ctx.db,
          { instanceId, runId, adapter, metadataOnly, storeRaw: ctx.prefs.storeRaw, now: ctx.deps.now() },
          batch,
        );
        records += counts.observed;
        if (collectIds) for (const item of batch) if (item.record.refValue !== null) externalIds.push(item.record.refValue);
        ctx.entry.progress = {
          ...ctx.entry.progress,
          recordsProcessed: ctx.entry.progress.recordsProcessed + batch.length,
          message: `${adapter.name}: ${records} registro(s).`,
        };
      }
    }
    if (dropped > 0) {
      throw new ModuleIncompleteError('dropped_records', `${dropped} registro(s) sem identificador foram descartados.`);
    }
    return {
      moduleKey: adapter.key,
      status: 'completed',
      complete: true,
      recordsCount: records,
      pagesFetched: pages.count,
      httpStatus: 200,
      errorMessage: null,
      failureKind: null,
      startedAt,
      finishedAt: ctx.deps.now(),
      externalIds,
    };
  } catch (error) {
    return failureOutcome(ctx, adapter, error, { records, pages: pages.count, startedAt });
  }
}

/** Converte a falha em resultado do módulo. 401 e falha de autenticação param a execução inteira. */
function failureOutcome(
  ctx: RunContext,
  adapter: ModuleAdapter,
  error: unknown,
  partial: { records: number; pages: number; startedAt: number },
): ModuleOutcome {
  const info = classify(error);
  if (info.markSession) markSessionExpired(ctx);
  if (info.stopRun) {
    ctx.fatal = true;
    ctx.entry.abort.abort();
    ctx.auth.audit.log({
      level: 'error',
      eventType: info.markSession ? 'sync.run.unauthorized' : 'sync.run.auth_failed',
      instanceId: ctx.instanceId,
      runId: ctx.runId,
      message: info.markSession
        ? 'Credenciais rejeitadas pela API (401). Execução interrompida.'
        : 'Falha de autenticação. Execução interrompida.',
      context: { module: adapter.key, httpStatus: info.httpStatus },
    });
  }
  if (info.status === 'failed') {
    ctx.auth.audit.log({
      level: info.failureKind === 'unexpected' ? 'error' : 'warn',
      eventType: 'sync.module.failed',
      instanceId: ctx.instanceId,
      runId: ctx.runId,
      message: `Módulo ${adapter.key} falhou.`,
      context: {
        module: adapter.key,
        kind: info.failureKind,
        httpStatus: info.httpStatus,
        ...(info.failureKind === 'unexpected' ? { error: errorName(error) } : {}),
      },
    });
  }
  return {
    moduleKey: adapter.key,
    status: info.status,
    complete: false,
    recordsCount: partial.records,
    pagesFetched: partial.pages,
    httpStatus: info.httpStatus,
    errorMessage: info.message,
    failureKind: info.failureKind,
    startedAt: partial.startedAt,
    finishedAt: ctx.deps.now(),
    externalIds: [],
  };
}

function classify(error: unknown): Classified {
  if (error instanceof ModuleIncompleteError) {
    return { status: 'failed', failureKind: error.kind, httpStatus: null, message: error.message, stopRun: false, markSession: false };
  }
  if (error instanceof AuthError) {
    return { status: 'failed', failureKind: 'auth', httpStatus: error.httpStatus, message: error.message, stopRun: true, markSession: false };
  }
  if (error instanceof FreshserviceError) {
    if (error.kind === 'cancelled') {
      return { status: 'cancelled', failureKind: 'cancelled', httpStatus: null, message: 'Interrompido antes de concluir.', stopRun: false, markSession: false };
    }
    const unauthorized = error.kind === 'unauthorized';
    return {
      status: 'failed',
      failureKind: error.kind,
      httpStatus: error.status ?? null,
      message: error.message,
      stopRun: unauthorized,
      markSession: unauthorized,
    };
  }
  return {
    status: 'failed',
    failureKind: 'unexpected',
    httpStatus: null,
    message: 'Erro inesperado ao processar o módulo.',
    stopRun: false,
    markSession: false,
  };
}

function markSessionExpired(ctx: RunContext): void {
  const now = ctx.deps.now();
  const connection = findConnection(ctx.db, ctx.instanceId);
  if (!connection) return;
  saveConnection(
    ctx.db,
    ctx.instanceId,
    now,
    { status: 'session_expired', lastCheckedAt: now, lastError: 'Sessão expirada (401). Reconecte a conexão.' },
    connection,
  );
}

/** IDs de resolução dos módulos filhos: do pai desta execução ou da última execução completa do pai. */
async function resolveBases(
  ctx: RunContext,
  adapter: ModuleAdapter,
  gates: Map<string, Deferred<ModuleOutcome>>,
): Promise<Record<string, string>[]> {
  if (!adapter.child) return [{}];
  const { parentKey, parentParam } = adapter.child;
  let ids: string[];
  const parentGate = gates.get(parentKey);
  if (parentGate) {
    const parent = await parentGate.promise;
    if (!parent.complete) {
      throw new ModuleIncompleteError('parent_incomplete', 'Módulo pai incompleto; filhos não consultados.');
    }
    ids = parent.externalIds;
  } else {
    const stored = loadParentIds(ctx.db, ctx.instanceId, parentKey);
    // Run antigo sem display_id: filhos não são consultados, e a tela pede nova sincronização do pai.
    if (stored === 'missing_ref') {
      throw new ModuleIncompleteError(
        'parent_incomplete',
        'Re-sincronize itens do catálogo: o run anterior não guardou display_id. Filhos não consultados.',
      );
    }
    if (!stored) throw new ModuleIncompleteError('parent_incomplete', 'Sem dados completos do módulo pai.');
    ids = stored;
  }
  return ids.map((id) => ({ [parentParam]: id }));
}

/** 'missing_ref': run completo sem a referência do pai (ex.: display_id antes da normalização ampla). */
function loadParentIds(db: AppDb, instanceId: number, parentKey: string): string[] | 'missing_ref' | null {
  const source = db
    .select({ id: syncRuns.id })
    .from(syncRuns)
    .innerJoin(syncModuleResults, eq(syncModuleResults.runId, syncRuns.id))
    .where(
      and(
        eq(syncRuns.instanceId, instanceId),
        inArray(syncRuns.status, ['completed', 'partial']),
        eq(syncModuleResults.moduleKey, parentKey),
        eq(syncModuleResults.complete, true),
      ),
    )
    .orderBy(desc(syncRuns.id))
    .limit(1)
    .get();
  if (!source) return null;
  // A referência do pai (ex.: display_id) fica no JSON normalizado da versão observada.
  const refField = getAdapter(parentKey)?.refField ?? 'id';
  const rows = db
    .select({ externalId: resources.externalId, normalized: resourceVersions.normalizedJson })
    .from(resourceObservations)
    .innerJoin(resources, eq(resources.id, resourceObservations.resourceId))
    .leftJoin(resourceVersions, eq(resourceVersions.id, resourceObservations.versionId))
    .where(and(eq(resourceObservations.runId, source.id), eq(resources.moduleKey, parentKey)))
    .all();
  if (refField === 'id') return rows.map((row) => row.externalId);
  const ids: string[] = [];
  for (const row of rows) {
    const value = (row.normalized as Record<string, unknown> | null)?.[refField];
    // Run anterior sem a referência (ex.: display_id antes da normalização ampla): filhos não são consultados às cegas.
    if (typeof value !== 'number' && typeof value !== 'string') return 'missing_ref';
    ids.push(String(value));
  }
  return ids;
}

/** M3: resolve to_resource_id após a persistência do run. Falha vira auditoria; a execução é mantida. */
function resolveRelations(ctx: RunContext): void {
  try {
    const result = resolveRelationTargets(ctx.db, ctx.instanceId, ctx.runId);
    ctx.auth.audit.log({
      level: 'info',
      eventType: 'sync.relations.resolved',
      instanceId: ctx.instanceId,
      runId: ctx.runId,
      message: 'Relações resolvidas após a persistência.',
      context: { resolved: result.resolved, unresolved: result.unresolved },
    });
  } catch (error) {
    ctx.auth.audit.log({
      level: 'error',
      eventType: 'sync.relations.failed',
      instanceId: ctx.instanceId,
      runId: ctx.runId,
      message: 'Resolução de relações falhou; a execução foi mantida.',
      context: { error: errorName(error) },
    });
  }
}

/**
 * Ponte com F5. Só para execuções completed ou partial. Base = última execução anterior da mesma
 * instância e mesma conexão, com status completed ou partial. Erro vira auditoria e changes_count 0.
 */
function bridgeChanges(ctx: RunContext, status: SyncRunStatus): number {
  if (status !== 'completed' && status !== 'partial') return 0;
  const baseRunId = previousBaseRunId(ctx.db, ctx.instanceId, ctx.connectionId, ctx.runId);
  try {
    const { changesCount } = detectChangesForRun(ctx.db, { runId: ctx.runId, baseRunId });
    return changesCount;
  } catch (error) {
    ctx.auth.audit.log({
      level: 'error',
      eventType: 'sync.diff.failed',
      instanceId: ctx.instanceId,
      runId: ctx.runId,
      message: 'Detecção de alterações falhou; a execução foi mantida.',
      context: { error: errorName(error) },
    });
    return 0;
  }
}

function previousBaseRunId(db: AppDb, instanceId: number, connectionId: number, runId: number): number | null {
  const row = db
    .select({ id: syncRuns.id })
    .from(syncRuns)
    .where(
      and(
        eq(syncRuns.instanceId, instanceId),
        eq(syncRuns.connectionId, connectionId),
        inArray(syncRuns.status, ['completed', 'partial']),
        lt(syncRuns.id, runId),
      ),
    )
    .orderBy(desc(syncRuns.id))
    .limit(1)
    .get();
  return row?.id ?? null;
}

function finalize(ctx: RunContext, outcomes: readonly ModuleOutcome[], status: SyncRunStatus, changesCount: number): void {
  const failures = outcomes.filter((outcome) => outcome.status === 'failed').length;
  const records = outcomes.reduce((sum, outcome) => sum + outcome.recordsCount, 0);
  ctx.db
    .update(syncRuns)
    .set({
      status,
      finishedAt: ctx.deps.now(),
      modulesProcessed: outcomes.filter((outcome) => outcome.status !== 'skipped').length,
      recordsCount: records,
      failuresCount: failures,
      changesCount,
    })
    .where(eq(syncRuns.id, ctx.runId))
    .run();
  ctx.auth.audit.log({
    level: status === 'failed' ? 'warn' : 'info',
    eventType: 'sync.run.finished',
    instanceId: ctx.instanceId,
    runId: ctx.runId,
    message: `Sincronização ${STATUS_LABEL[status]}.`,
    context: {
      status,
      modules: outcomes.length,
      failures,
      records,
      changes: changesCount,
      scopeNotGranted: outcomes.filter((outcome) => outcome.failureKind === 'scope_not_granted').length,
    },
  });
}

function blankOutcome(
  key: string,
  status: ModuleOutcome['status'],
  message: string,
  failureKind: FailureKind | null,
  startedAt: number | null,
): ModuleOutcome {
  return {
    moduleKey: key,
    status,
    complete: false,
    recordsCount: 0,
    pagesFetched: 0,
    httpStatus: null,
    errorMessage: message,
    failureKind,
    startedAt,
    finishedAt: null,
    externalIds: [],
  };
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'desconhecido';
}
