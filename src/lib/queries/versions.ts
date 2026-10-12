import { and, desc, eq, lte } from 'drizzle-orm';
import type { AppDb } from '@/lib/db/client';
import { resourceVersions } from '@/lib/db/schema';

export interface ResourceVersion {
  id: number;
  resourceId: number;
  runId: number;
  contentHash: string;
  name: string | null;
  category: string | null;
  normalized: Record<string, unknown>;
  sourceEndpoint: string | null;
  capturedAt: number;
}

const versionColumns = {
  id: resourceVersions.id,
  resourceId: resourceVersions.resourceId,
  runId: resourceVersions.runId,
  contentHash: resourceVersions.contentHash,
  name: resourceVersions.name,
  category: resourceVersions.category,
  normalized: resourceVersions.normalizedJson,
  sourceEndpoint: resourceVersions.sourceEndpoint,
  capturedAt: resourceVersions.capturedAt,
};

/** Versão vigente de um recurso na execução `runId` (a mais recente capturada até ela). */
export function versionAtOrBefore(
  db: AppDb,
  resourceId: number,
  runId: number,
): ResourceVersion | null {
  return (
    db
      .select(versionColumns)
      .from(resourceVersions)
      .where(
        and(eq(resourceVersions.resourceId, resourceId), lte(resourceVersions.runId, runId)),
      )
      .orderBy(desc(resourceVersions.runId), desc(resourceVersions.id))
      .limit(1)
      .get() ?? null
  );
}

export function listVersions(db: AppDb, resourceId: number): ResourceVersion[] {
  return db
    .select(versionColumns)
    .from(resourceVersions)
    .where(eq(resourceVersions.resourceId, resourceId))
    .orderBy(desc(resourceVersions.capturedAt), desc(resourceVersions.id))
    .all();
}
