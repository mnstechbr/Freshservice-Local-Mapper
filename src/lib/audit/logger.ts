import { getDb, type AppDb } from '../db/client';
import { auditEvents, type AUDIT_LEVELS } from '../db/schema';
import { redactString, redactValue } from './redact';

export type AuditLevel = (typeof AUDIT_LEVELS)[number];

export interface AuditEventInput {
  level: AuditLevel;
  eventType: string;
  message: string;
  instanceId?: number | null;
  runId?: number | null;
  context?: Record<string, unknown>;
}

export interface AuditLoggerOptions {
  /** Relógio injetável (testes). Padrão: Date.now(). */
  now?: () => number;
}

/**
 * Logger local que grava em audit_events. Mensagem e contexto são redigidos antes da gravação,
 * então o banco nunca recebe Authorization, token, api_key, password, secret ou cookie.
 */
export function createAuditLogger(db: AppDb, options: AuditLoggerOptions = {}) {
  const now = options.now ?? Date.now;
  return {
    log(event: AuditEventInput): void {
      db.insert(auditEvents)
        .values({
          instanceId: event.instanceId ?? null,
          runId: event.runId ?? null,
          level: event.level,
          eventType: event.eventType,
          message: redactString(event.message),
          context:
            event.context === undefined
              ? null
              : (redactValue(event.context) as Record<string, unknown>),
          createdAt: now(),
        })
        .run();
    },
  };
}

/** Atalho que usa a conexão padrão do processo. */
export function auditLog(event: AuditEventInput): void {
  createAuditLogger(getDb()).log(event);
}
