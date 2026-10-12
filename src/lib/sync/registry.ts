/*
 * Registro de execuções ativas, uma por instância, guardado em globalThis (sobrevive a recargas de
 * módulo no Next em desenvolvimento). Também guarda o AbortController que cancela a execução.
 */
import 'server-only';
import { SyncError, type SyncProgress } from './types';

export interface ActiveSync {
  instanceId: number;
  runId: number | null;
  abort: AbortController;
  cancelRequested: boolean;
  progress: SyncProgress;
  /** Promise da execução em segundo plano. Nunca rejeita. */
  done: Promise<void> | null;
}

const REGISTRY_KEY = '__fslmSyncRegistry';

function registry(): Map<number, ActiveSync> {
  const holder = globalThis as unknown as Record<string, Map<number, ActiveSync> | undefined>;
  if (!holder[REGISTRY_KEY]) holder[REGISTRY_KEY] = new Map<number, ActiveSync>();
  return holder[REGISTRY_KEY];
}

export function idleProgress(): SyncProgress {
  return {
    running: false,
    runId: null,
    percent: 0,
    message: 'Nenhuma sincronização em andamento.',
    currentModule: null,
    recordsProcessed: 0,
  };
}

/** Reserva a instância. Síncrono: sem await entre a verificação e o registro. */
export function claimInstance(instanceId: number): ActiveSync {
  const map = registry();
  if (map.has(instanceId)) {
    throw new SyncError('sync_already_running', 'Já há uma sincronização em andamento nesta instância.');
  }
  const entry: ActiveSync = {
    instanceId,
    runId: null,
    abort: new AbortController(),
    cancelRequested: false,
    progress: { ...idleProgress(), running: true, message: 'Preparando sincronização.' },
    done: null,
  };
  map.set(instanceId, entry);
  return entry;
}

export function releaseInstance(entry: ActiveSync): void {
  const map = registry();
  if (map.get(entry.instanceId) === entry) map.delete(entry.instanceId);
  entry.progress = { ...entry.progress, running: false };
}

export function activeSync(instanceId: number): ActiveSync | undefined {
  return registry().get(instanceId);
}

export function getProgress(instanceId: number): SyncProgress {
  const entry = registry().get(instanceId);
  return entry ? { ...entry.progress } : idleProgress();
}

/** Pede cancelamento. Devolve false se a instância não tem execução ativa. */
export function cancelSync(instanceId: number): boolean {
  const entry = registry().get(instanceId);
  if (!entry) return false;
  entry.cancelRequested = true;
  entry.abort.abort();
  return true;
}

/** Espera a execução atual da instância (se houver). Útil em testes e no retry encadeado. */
export async function waitForSync(instanceId: number): Promise<void> {
  const entry = registry().get(instanceId);
  if (entry?.done) await entry.done;
}
