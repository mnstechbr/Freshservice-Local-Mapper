/*
 * Diagnóstico de acesso (Fase 4). Um GET por adaptador consultável (página 1, per_page=1) pelo mesmo
 * provedor de autorização e cliente HTTP da sincronização. Só grava api_modules. Roda em segundo plano.
 * Mensagens de erro são fixas: nunca carregam URL, domínio, cabeçalho ou resposta da API.
 */
import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { AuthDeps } from '../auth/deps';
import { FRESHSERVICE_TIMEOUT_MS } from '../auth/deps';
import { AuthError } from '../auth/errors';
import { findConnection, findInstance, saveConnection } from '../auth/repo';
import type { AppDb } from '../db/client';
import { apiModules } from '../db/schema';
import { createFreshserviceClient, FreshserviceError, type FreshserviceErrorKind } from '../freshservice/http';
import { MODULE_ADAPTERS, type ModuleAdapter } from '../freshservice/modules';
import { normalizeInstanceUrl } from '../security/url';
import type { AccessStatus } from './persist';
import { grantedScopesFor, scopeBlockFor, scopeNotGrantedMessage, type AccessDetail } from './scopes';
import { createAuthorizationProvider } from './token';
import { SYNC_DEFAULTS, type SyncDeps } from './types';

export interface DiagnosticsOptions {
  /** Módulos em paralelo. Padrão 2. */
  concurrency?: number;
  timeoutMs?: number;
  /** Novas tentativas por módulo (429, 5xx, timeout, rede). Padrão 2: no máximo 3 chamadas. */
  maxRetries?: number;
  retryAfterCapMs?: number;
  backoffBaseMs?: number;
  backoffCapMs?: number;
  adapters?: readonly ModuleAdapter[];
}

export interface DiagnosticsInput {
  db: AppDb;
  auth: AuthDeps;
  instanceId: number;
  deps?: Partial<SyncDeps>;
  options?: DiagnosticsOptions;
}

export interface DiagnosticsSummary {
  instanceId: number;
  startedAt: number;
  finishedAt: number;
  counts: Record<AccessStatus, number>;
  /** Módulos com access_detail 'scope_not_granted' (também contados em counts.forbidden). Sem chamada à API. */
  scopeNotGranted: number;
  sessionExpired: boolean;
}

interface Verdict {
  access: AccessStatus;
  httpStatus: number | null;
  errorMessage: string | null;
  attempted: boolean;
  accessDetail?: AccessDetail;
}

type Probe = Verdict | 'session_expired';

const RETRYABLE: ReadonlySet<FreshserviceErrorKind> = new Set(['rate_limited', 'server_error', 'timeout', 'network']);

const MESSAGES: Partial<Record<FreshserviceErrorKind, string>> = {
  forbidden: 'Sem permissão para este recurso (403).',
  not_found: 'Recurso não encontrado (404). Confira a URL da instância.',
  rate_limited: 'Limite de requisições atingido (429). Teste não conclusivo.',
  server_error: 'Erro no servidor Freshservice (5xx). Teste não conclusivo.',
  timeout: 'Tempo esgotado na chamada à API. Teste não conclusivo.',
  network: 'Falha de rede na chamada à API. Teste não conclusivo.',
  client_error: 'Requisição recusada pela API. Teste não conclusivo.',
  invalid_response: 'Resposta não é JSON válido. Teste não conclusivo.',
  too_large: 'Resposta maior que o limite permitido. Teste não conclusivo.',
  redirect_refused: 'Redirecionamento recusado. Teste não conclusivo.',
  unsafe_url: 'URL recusada pela validação de segurança.',
  host_not_allowed: 'Host fora da lista permitida.',
};

/** Classifica um erro do cliente HTTP. 401 é tratado antes, pelo chamador. */
function verdictFor(error: unknown): Verdict {
  if (!(error instanceof FreshserviceError)) {
    return { access: 'untested', httpStatus: null, errorMessage: 'Falha inesperada no teste. Teste não conclusivo.', attempted: true };
  }
  const httpStatus = error.status ?? null;
  const message = MESSAGES[error.kind] ?? 'Teste não conclusivo.';
  if (error.kind === 'forbidden') return { access: 'forbidden', httpStatus, errorMessage: message, attempted: true };
  if (error.kind === 'not_found') return { access: 'not_found', httpStatus, errorMessage: message, attempted: true };
  if (RETRYABLE.has(error.kind)) {
    return { access: 'temporarily_unavailable', httpStatus, errorMessage: message, attempted: true };
  }
  return { access: 'untested', httpStatus, errorMessage: message, attempted: true };
}

function resolveOptions(o: DiagnosticsOptions = {}) {
  return {
    concurrency: Math.max(1, Math.floor(o.concurrency ?? SYNC_DEFAULTS.concurrency)),
    timeoutMs: o.timeoutMs ?? FRESHSERVICE_TIMEOUT_MS,
    maxRetries: Math.max(0, Math.floor(o.maxRetries ?? 2)),
    retryAfterCapMs: o.retryAfterCapMs ?? SYNC_DEFAULTS.retryAfterCapMs,
    backoffBaseMs: o.backoffBaseMs ?? SYNC_DEFAULTS.backoffBaseMs,
    backoffCapMs: o.backoffCapMs ?? SYNC_DEFAULTS.backoffCapMs,
  };
}

type Options = ReturnType<typeof resolveOptions>;

function resolveDeps(partial: Partial<SyncDeps> = {}): SyncDeps {
  return {
    fetch: partial.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)),
    now: partial.now ?? (() => Date.now()),
    sleep: partial.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    random: partial.random ?? Math.random,
  };
}

/** Espera antes de nova tentativa: Retry-After (com teto) ou backoff exponencial, mais jitter. */
function waitFor(error: FreshserviceError, attempt: number, o: Options, random: () => number): number {
  const jitter = Math.floor(random() * 250);
  if (error.retryAfterSeconds !== undefined) {
    return Math.min(error.retryAfterSeconds * 1000, o.retryAfterCapMs) + jitter;
  }
  return Math.min(o.backoffBaseMs * 2 ** attempt, o.backoffCapMs) + jitter;
}

async function probe(
  client: ReturnType<typeof createFreshserviceClient>,
  adapter: ModuleAdapter,
  o: Options,
  deps: SyncDeps,
): Promise<Probe> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const page = await client.getPage(adapter.path, { ...adapter.extraQuery, page: 1, per_page: 1 });
      return { access: 'accessible', httpStatus: page.status, errorMessage: null, attempted: true };
    } catch (error) {
      if (error instanceof FreshserviceError && error.kind === 'unauthorized') return 'session_expired';
      if (error instanceof AuthError && error.code === 'session_expired') return 'session_expired';
      const retryable = error instanceof FreshserviceError && RETRYABLE.has(error.kind);
      if (!retryable || attempt >= o.maxRetries) return verdictFor(error);
      await deps.sleep(waitFor(error as FreshserviceError, attempt, o, deps.random));
    }
  }
}

function markSessionExpired(db: AppDb, instanceId: number, now: number): void {
  const connection = findConnection(db, instanceId);
  if (!connection) return;
  saveConnection(
    db,
    instanceId,
    now,
    { status: 'session_expired', lastCheckedAt: now, lastError: 'Sessão expirada (401). Reconecte a conexão.' },
    connection,
  );
}

function upsertApiModule(db: AppDb, instanceId: number, adapter: ModuleAdapter, verdict: Verdict, now: number): void {
  const patch = {
    name: adapter.name,
    method: adapter.method,
    path: adapter.path,
    paginated: adapter.paginated,
    accessStatus: verdict.access,
    accessDetail: verdict.accessDetail ?? null,
    httpStatus: verdict.httpStatus,
    lastAttemptAt: verdict.attempted ? now : null,
    errorMessage: verdict.errorMessage,
  };
  const existing = db
    .select({ id: apiModules.id })
    .from(apiModules)
    .where(and(eq(apiModules.instanceId, instanceId), eq(apiModules.moduleKey, adapter.key)))
    .get();
  if (existing) {
    db.update(apiModules).set(patch).where(eq(apiModules.id, existing.id)).run();
    return;
  }
  db.insert(apiModules).values({ instanceId, moduleKey: adapter.key, ...patch }).run();
}

/**
 * Executa o diagnóstico. O chamador valida a conexão (connected) antes. Uma chamada por módulo testado,
 * com até 2 novas tentativas em 429, 5xx, timeout e rede. 401 encerra e marca a conexão como session_expired.
 */
export async function runDiagnostics(input: DiagnosticsInput): Promise<DiagnosticsSummary> {
  const { db, auth, instanceId } = input;
  const o = resolveOptions(input.options);
  const deps = resolveDeps(input.deps);
  const instance = findInstance(db, instanceId);
  if (!instance) throw new AuthError('no_active_instance', 409, 'Instância não encontrada.');
  const connection = findConnection(db, instanceId);
  const granted = connection ? grantedScopesFor(db, connection, instance.baseUrl) : null;
  const client = createFreshserviceClient({
    origin: normalizeInstanceUrl(instance.baseUrl).origin,
    authorization: createAuthorizationProvider({ db, auth, instanceId }),
    timeoutMs: o.timeoutMs,
    fetchImpl: deps.fetch,
  });
  const startedAt = deps.now();
  const adapters = input.options?.adapters ?? MODULE_ADAPTERS;
  const verdicts = new Map<string, Verdict>();
  const queue: ModuleAdapter[] = [];
  for (const adapter of adapters) {
    // Escopo não concedido ao perfil OAuth: forbidden com motivo de escopo, sem GET. Vale também para filhos.
    const blockedBy = adapter.docStatus === 'unsupported' ? null : scopeBlockFor(adapter, granted);
    if (adapter.docStatus === 'unsupported') {
      verdicts.set(adapter.key, {
        access: 'unsupported',
        httpStatus: null,
        errorMessage: 'Sem endpoint GET documentado ou fora da política de privacidade.',
        attempted: false,
      });
    } else if (blockedBy) {
      verdicts.set(adapter.key, {
        access: 'forbidden',
        httpStatus: null,
        errorMessage: scopeNotGrantedMessage(blockedBy),
        attempted: false,
        accessDetail: 'scope_not_granted',
      });
    } else if (adapter.child) {
      verdicts.set(adapter.key, {
        access: 'untested',
        httpStatus: null,
        errorMessage: 'Depende de ID do módulo pai. Testado na sincronização.',
        attempted: false,
      });
    } else {
      queue.push(adapter);
    }
  }

  let sessionExpired = false;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (!sessionExpired && cursor < queue.length) {
      const adapter = queue[cursor];
      cursor += 1;
      if (!adapter) break;
      const result = await probe(client, adapter, o, deps);
      if (result === 'session_expired') {
        sessionExpired = true;
        break;
      }
      verdicts.set(adapter.key, result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.concurrency, queue.length) }, () => worker()));

  const now = deps.now();
  if (sessionExpired) markSessionExpired(db, instanceId, now);
  const counts: Record<AccessStatus, number> = {
    accessible: 0,
    forbidden: 0,
    not_found: 0,
    unsupported: 0,
    temporarily_unavailable: 0,
    untested: 0,
  };
  let scopeNotGranted = 0;
  for (const adapter of adapters) {
    const verdict = verdicts.get(adapter.key);
    if (!verdict) continue;
    upsertApiModule(db, instanceId, adapter, verdict, now);
    counts[verdict.access] += 1;
    if (verdict.accessDetail === 'scope_not_granted') scopeNotGranted += 1;
  }
  return { instanceId, startedAt, finishedAt: now, counts, scopeNotGranted, sessionExpired };
}

const ACTIVE_KEY = '__fslmDiagnosticsActive';

function activeMap(): Map<number, Promise<void>> {
  const holder = globalThis as unknown as Record<string, Map<number, Promise<void>> | undefined>;
  if (!holder[ACTIVE_KEY]) holder[ACTIVE_KEY] = new Map<number, Promise<void>>();
  return holder[ACTIVE_KEY];
}

export function diagnosticsRunning(instanceId: number): boolean {
  return activeMap().has(instanceId);
}

/** Espera o diagnóstico em andamento da instância (se houver). Usado em testes. */
export async function waitForDiagnostics(instanceId: number): Promise<void> {
  await activeMap().get(instanceId);
}

/** Inicia o diagnóstico em segundo plano. Uma execução por instância; a segunda recebe 409. */
export function startDiagnostics(input: DiagnosticsInput): void {
  const map = activeMap();
  if (map.has(input.instanceId)) {
    throw new AuthError('diagnostics_running', 409, 'Já há um diagnóstico em andamento nesta instância.');
  }
  const { auth, instanceId } = input;
  auth.audit.log({ level: 'info', eventType: 'diagnostics.run.started', instanceId, message: 'Diagnóstico de acesso iniciado.', context: {} });
  const done = runDiagnostics(input)
    .then((summary) => {
      auth.audit.log({
        level: 'info',
        eventType: 'diagnostics.run.finished',
        instanceId,
        message: 'Diagnóstico de acesso concluído.',
        context: { counts: summary.counts, sessionExpired: summary.sessionExpired },
      });
    })
    .catch((error: unknown) => {
      auth.audit.log({
        level: 'error',
        eventType: 'diagnostics.run.error',
        instanceId,
        message: 'Diagnóstico interrompido por erro interno.',
        context: { error: error instanceof Error ? error.name : 'desconhecido' },
      });
    })
    .finally(() => {
      map.delete(instanceId);
    });
  map.set(instanceId, done);
}

/** Lista o estado de acesso de todos os adaptadores da instância (sem chamadas à API). */
export function listDiagnostics(db: AppDb, instanceId: number, adapters: readonly ModuleAdapter[] = MODULE_ADAPTERS) {
  const rows = db.select().from(apiModules).where(eq(apiModules.instanceId, instanceId)).all();
  const byKey = new Map(rows.map((row) => [row.moduleKey, row] as const));
  return {
    running: diagnosticsRunning(instanceId),
    connectionStatus: findConnection(db, instanceId)?.status ?? null,
    modules: adapters.map((adapter) => {
      const row = byKey.get(adapter.key);
      return {
        key: adapter.key,
        moduleGroup: adapter.moduleGroup,
        name: adapter.name,
        method: adapter.method,
        path: adapter.path,
        paginated: adapter.paginated,
        docStatus: adapter.docStatus,
        accessStatus: row?.accessStatus ?? (adapter.docStatus === 'unsupported' ? 'unsupported' : 'untested'),
        httpStatus: row?.httpStatus ?? null,
        lastAttemptAt: row?.lastAttemptAt ?? null,
        errorMessage: row?.errorMessage ?? null,
      };
    }),
  };
}
