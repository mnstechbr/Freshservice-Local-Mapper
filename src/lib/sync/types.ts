/*
 * Contratos do motor de sincronização (Fase 4). Só tipos, erros e padrões; sem efeitos colaterais.
 */
import type { AuthDeps } from '../auth/deps';
import type { AppDb } from '../db/client';
import type { SYNC_RUN_KINDS, SYNC_RUN_STATUSES } from '../db/schema';
import type { FreshserviceErrorKind } from '../freshservice/http';
import type { ModuleAdapter } from '../freshservice/modules/types';

export type SyncRunKind = (typeof SYNC_RUN_KINDS)[number];
export type SyncRunStatus = (typeof SYNC_RUN_STATUSES)[number];
export type ModuleStatus = 'completed' | 'failed' | 'skipped' | 'cancelled';

/** Padrões do motor. Testes trocam por valores pequenos via options. */
export const SYNC_DEFAULTS = {
  concurrency: 2,
  timeoutMs: 30_000,
  maxPagesPerModule: 10_000,
  maxRetries: 4,
  retryAfterCapMs: 120_000,
  backoffBaseMs: 500,
  backoffCapMs: 30_000,
} as const;

/** per_page fixo: máximo documentado pela API para listas. */
export const PER_PAGE = 100;

export interface SyncOptions {
  /** Módulos em paralelo. Padrão 2. */
  concurrency?: number;
  /** Timeout por requisição. Padrão 30 s. */
  timeoutMs?: number;
  /** Teto de páginas por módulo (filhos somam). Atingido = módulo incompleto. */
  maxPagesPerModule?: number;
  /** Novas tentativas por requisição em 429, 5xx, timeout e rede. */
  maxRetries?: number;
  /** Teto para a espera pedida por Retry-After. Padrão 120 s. */
  retryAfterCapMs?: number;
  backoffBaseMs?: number;
  backoffCapMs?: number;
  /** Registro de módulos. Padrão: MODULE_ADAPTERS. */
  adapters?: readonly ModuleAdapter[];
}

export interface SyncDeps {
  fetch: typeof fetch;
  now: () => number;
  /** Espera do backoff. Deve rejeitar quando o sinal for abortado. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  random: () => number;
}

export interface RunSyncInput {
  db: AppDb;
  /** Autenticação (cofre e renovação OAuth). Em produção: getAuthDeps(). */
  auth: AuthDeps;
  instanceId: number;
  kind: SyncRunKind;
  /** Chaves de módulo desejadas. Padrão: todos os consultáveis. */
  modules?: string[];
  /** Repete só os módulos com status failed nesta execução. */
  retryOfRunId?: number;
  deps?: Partial<SyncDeps>;
  options?: SyncOptions;
}

export type SyncErrorCode =
  | 'instance_not_found'
  | 'demo_instance'
  | 'invalid_origin'
  | 'no_connection'
  | 'connection_not_ready'
  | 'sync_already_running'
  | 'invalid_modules'
  | 'retry_run_not_found'
  | 'no_failed_modules';

/** Erro de validação antes da execução começar (nada é gravado em sync_runs). */
export class SyncError extends Error {
  readonly code: SyncErrorCode;

  constructor(code: SyncErrorCode, message: string) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
  }
}

/** Módulo parado sem erro HTTP: o resultado não pode ser considerado completo. */
export type IncompleteKind = 'page_limit' | 'loop' | 'parent_incomplete' | 'dropped_records';

export class ModuleIncompleteError extends Error {
  readonly kind: IncompleteKind;

  constructor(kind: IncompleteKind, message: string) {
    super(message);
    this.name = 'ModuleIncompleteError';
    this.kind = kind;
  }
}

/** 'scope_not_granted': módulo não consultado porque o perfil OAuth não tem o escopo GET (sem chamada). */
export type FailureKind = FreshserviceErrorKind | IncompleteKind | 'auth' | 'unexpected' | 'scope_not_granted';

export interface ModuleOutcome {
  moduleKey: string;
  status: ModuleStatus;
  /** Verdadeiro só se todas as páginas foram lidas, sem descarte e sem cancelamento. */
  complete: boolean;
  recordsCount: number;
  pagesFetched: number;
  httpStatus: number | null;
  errorMessage: string | null;
  failureKind: FailureKind | null;
  startedAt: number | null;
  finishedAt: number | null;
  /** IDs externos observados. Usados pelos módulos filhos (ex.: pastas por categoria). */
  externalIds: string[];
}

/** Contrato de app_settings 'sync_preferences' (o mesmo usado pela tela de preferências). */
export interface SyncPreferences {
  metadataOnly: Record<string, boolean>;
  storeRaw: boolean;
}

export interface SyncProgress {
  running: boolean;
  runId: number | null;
  percent: number;
  message: string;
  currentModule: string | null;
  recordsProcessed: number;
}
