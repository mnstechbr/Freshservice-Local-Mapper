import 'server-only';
import { createHash } from 'node:crypto';

/**
 * Serialização canônica para hash de conteúdo: chaves ordenadas em todos os níveis, undefined e
 * funções removidos, números não finitos viram null. Mesma entrada lógica gera sempre a mesma string.
 * Exportado para reuso (a Fase 5 usa o mesmo critério para comparar versões).
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}

function normalizeValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item));
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const item = source[key];
    if (item === undefined || typeof item === 'function') continue;
    out[key] = normalizeValue(item);
  }
  return out;
}

/** SHA-256 (hex) do JSON canônico. */
export function hashCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}
