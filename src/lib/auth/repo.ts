import 'server-only';
import { asc, desc, eq } from 'drizzle-orm';
import type { AppDb } from '../db/client';
import { appSettings, connections, instances } from '../db/schema';

export type InstanceRow = typeof instances.$inferSelect;
export type ConnectionRow = typeof connections.$inferSelect;

export const ACTIVE_INSTANCE_KEY = 'active_instance_id';
export const OAUTH_CONFIG_KEY = 'oauth_config';

export function readSetting<T>(db: AppDb, key: string): T | null {
  const row = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
  return row ? (row.value as T) : null;
}

export function writeSetting(db: AppDb, key: string, value: unknown): void {
  db.insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
    .run();
}

export function deleteSetting(db: AppDb, key: string): void {
  db.delete(appSettings).where(eq(appSettings.key, key)).run();
}

export function listInstanceRows(db: AppDb): InstanceRow[] {
  return db
    .select()
    .from(instances)
    .orderBy(asc(instances.displayName), asc(instances.id))
    .all();
}

export function findInstance(db: AppDb, id: number): InstanceRow | undefined {
  return db.select().from(instances).where(eq(instances.id, id)).get();
}

export function findInstanceByOrigin(db: AppDb, origin: string): InstanceRow | undefined {
  return db.select().from(instances).where(eq(instances.baseUrl, origin)).get();
}

export function activeInstanceId(db: AppDb): number | null {
  const value = readSetting<unknown>(db, ACTIVE_INSTANCE_KEY);
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/** Conexão da instância. Há no máximo uma por instância (garantido pela aplicação). */
export function findConnection(db: AppDb, instanceId: number): ConnectionRow | undefined {
  return db
    .select()
    .from(connections)
    .where(eq(connections.instanceId, instanceId))
    .orderBy(desc(connections.id))
    .limit(1)
    .get();
}

export type ConnectionPatch = Partial<
  Pick<
    ConnectionRow,
    | 'authMode'
    | 'status'
    | 'statusDetail'
    | 'integrationProfileId'
    | 'accountLabel'
    | 'accountId'
    | 'scopes'
    | 'secretRef'
    | 'tokenExpiresAt'
    | 'lastCheckedAt'
    | 'lastError'
  >
>;

/**
 * Cria ou atualiza a conexão da instância. Usa uma única linha por instância; trocar o modo
 * substitui o conteúdo (quem chama remove os segredos antigos).
 */
export function saveConnection(
  db: AppDb,
  instanceId: number,
  now: number,
  patch: ConnectionPatch,
  existing: ConnectionRow | undefined = findConnection(db, instanceId),
): ConnectionRow {
  if (!existing) {
    return db
      .insert(connections)
      .values({
        instanceId,
        authMode: patch.authMode ?? 'api_key_personal',
        status: patch.status ?? 'disconnected',
        statusDetail: patch.statusDetail ?? null,
        integrationProfileId: patch.integrationProfileId ?? null,
        accountLabel: patch.accountLabel ?? null,
        accountId: patch.accountId ?? null,
        scopes: patch.scopes ?? null,
        secretRef: patch.secretRef ?? null,
        tokenExpiresAt: patch.tokenExpiresAt ?? null,
        lastCheckedAt: patch.lastCheckedAt ?? null,
        lastError: patch.lastError ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  }
  // Mudou o status e o patch não define o detalhe: o detalhe antigo não vale mais.
  const clearDetail = patch.status !== undefined && patch.statusDetail === undefined ? { statusDetail: null } : {};
  return db
    .update(connections)
    .set({ ...patch, ...clearDetail, updatedAt: now })
    .where(eq(connections.id, existing.id))
    .returning()
    .get();
}
