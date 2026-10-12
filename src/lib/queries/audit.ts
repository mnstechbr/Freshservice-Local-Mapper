import { and, count, desc, eq } from 'drizzle-orm';
import type { AppDb } from '@/lib/db/client';
import { auditEvents, type AUDIT_LEVELS } from '@/lib/db/schema';
import { offsetFor, resolvePaging, type Paging } from './paging';

export type AuditLevel = (typeof AUDIT_LEVELS)[number];

export interface AuditRow {
  id: number;
  level: AuditLevel;
  eventType: string;
  message: string;
  runId: number | null;
  createdAt: number;
  /** Já redigido pelo logger (ver src/lib/audit/redact.ts). */
  context: Record<string, unknown> | null;
}

export interface ListAuditInput {
  instanceId: number;
  level?: AuditLevel | null;
  /** Tipo de evento (igualdade exata). */
  eventType?: string | null;
  /** Execução de origem do evento. */
  runId?: number | null;
  page?: number;
  pageSize?: number;
}

export interface AuditListResult extends Paging {
  rows: AuditRow[];
  total: number;
}

/** Eventos de auditoria de uma instância, do mais recente para o mais antigo. */
export function listAuditEvents(db: AppDb, input: ListAuditInput): AuditListResult {
  const conditions = [eq(auditEvents.instanceId, input.instanceId)];
  if (input.level) conditions.push(eq(auditEvents.level, input.level));
  if (input.eventType) conditions.push(eq(auditEvents.eventType, input.eventType));
  if (input.runId) conditions.push(eq(auditEvents.runId, input.runId));
  const where = and(...conditions);

  const total = db.select({ value: count() }).from(auditEvents).where(where).get()?.value ?? 0;
  const paging = resolvePaging(total, input.page, input.pageSize, 100);
  const rows = db
    .select({
      id: auditEvents.id,
      level: auditEvents.level,
      eventType: auditEvents.eventType,
      message: auditEvents.message,
      runId: auditEvents.runId,
      createdAt: auditEvents.createdAt,
      context: auditEvents.context,
    })
    .from(auditEvents)
    .where(where)
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(paging.pageSize)
    .offset(offsetFor(paging))
    .all();

  return { rows, total, ...paging };
}
