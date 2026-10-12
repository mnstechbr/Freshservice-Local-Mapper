/*
 * Leitura segura de searchParams. Cada valor passa por uma lista permitida ou um limite,
 * então parâmetros inválidos caem no padrão em vez de chegar ao SQL.
 */

export type SearchParams = Record<string, string | string[] | undefined>;

export function firstParam(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export function enumParam<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | null {
  return value !== undefined && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function pageParam(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100_000) : 1;
}

export function textParam(value: string | undefined, maxLength = 120): string | null {
  const trimmed = value?.trim().slice(0, maxLength) ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Início (00:00) do dia local em `YYYY-MM-DD`. Retorna null se inválido. */
export function dayStart(value: string | undefined): number | null {
  const match = DAY_PATTERN.exec(value ?? '');
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 ? date.getTime() : null;
}

/** Último instante (23:59:59.999) do dia local em `YYYY-MM-DD`. */
export function dayEnd(value: string | undefined): number | null {
  const start = dayStart(value);
  return start === null ? null : start + 86_400_000 - 1;
}
