import { desc, eq } from 'drizzle-orm';
import type { AppDb } from '@/lib/db/client';
import {
  AUTH_MODES,
  appSettings,
  CONNECTION_STATUSES,
  connections,
  instances,
} from '@/lib/db/schema';

export const ACTIVE_INSTANCE_KEY = 'active_instance_id';

export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
export type AuthMode = (typeof AUTH_MODES)[number];

export interface ActiveInstance {
  id: number;
  baseUrl: string;
  displayName: string;
  isDemo: boolean;
}

export interface ConnectionSummary {
  id: number;
  authMode: AuthMode;
  status: ConnectionStatus;
  accountLabel: string | null;
  lastCheckedAt: number | null;
  lastError: string | null;
}

/** Instância ativa (app_settings.active_instance_id). Null se não houver ou se a instância sumiu. */
export function getActiveInstance(db: AppDb): ActiveInstance | null {
  const setting = db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, ACTIVE_INSTANCE_KEY))
    .get();
  if (typeof setting?.value !== 'number') return null;

  return (
    db
      .select({
        id: instances.id,
        baseUrl: instances.baseUrl,
        displayName: instances.displayName,
        isDemo: instances.isDemo,
      })
      .from(instances)
      .where(eq(instances.id, setting.value))
      .get() ?? null
  );
}

export function setActiveInstanceId(db: AppDb, instanceId: number | null): void {
  if (instanceId === null) {
    db.delete(appSettings).where(eq(appSettings.key, ACTIVE_INSTANCE_KEY)).run();
    return;
  }
  db.insert(appSettings)
    .values({ key: ACTIVE_INSTANCE_KEY, value: instanceId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: instanceId } })
    .run();
}

/** Conexão mais recente da instância. Só leitura: quem grava conexões é o módulo de autenticação. */
export function getLatestConnection(db: AppDb, instanceId: number): ConnectionSummary | null {
  return (
    db
      .select({
        id: connections.id,
        authMode: connections.authMode,
        status: connections.status,
        accountLabel: connections.accountLabel,
        lastCheckedAt: connections.lastCheckedAt,
        lastError: connections.lastError,
      })
      .from(connections)
      .where(eq(connections.instanceId, instanceId))
      .orderBy(desc(connections.updatedAt), desc(connections.id))
      .limit(1)
      .get() ?? null
  );
}
