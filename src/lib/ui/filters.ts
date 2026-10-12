/*
 * Leitura de searchParams para as páginas (sem banco e sem React). Valores inválidos viram o padrão.
 * Testado em tests/ui/filters.test.ts.
 */
import { AUDIT_LEVELS, CHANGE_TYPES, REVIEW_STATUSES, SEVERITIES } from '@/lib/db/schema';
import {
  dayEnd,
  dayStart,
  enumParam,
  firstParam,
  pageParam,
  type SearchParams,
  textParam,
} from '@/lib/queries/params';
import type { ChangeSeverity, ChangeType, ReviewStatus } from '@/lib/queries/changes';
import { RESOURCE_SORT_KEYS, type ResourceSortKey } from '@/lib/queries/resources';

const RESOURCE_STATUSES = ['new', 'updated', 'unchanged'] as const;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RUN_ID = /^[1-9]\d{0,9}$/;

export interface ResourceQuery {
  q: string;
  status: (typeof RESOURCE_STATUSES)[number] | '';
  sort: ResourceSortKey;
  dir: 'asc' | 'desc';
  page: number;
}

/** Busca, filtro de status, ordenação e página das tabelas de recursos. */
export function parseResourceQuery(params: SearchParams): ResourceQuery {
  return {
    q: textParam(firstParam(params, 'q')) ?? '',
    status: enumParam(firstParam(params, 'status'), RESOURCE_STATUSES) ?? '',
    sort: enumParam(firstParam(params, 'sort'), RESOURCE_SORT_KEYS) ?? 'id',
    dir: firstParam(params, 'dir') === 'desc' ? 'desc' : 'asc',
    page: pageParam(firstParam(params, 'page')),
  };
}

export interface ChangeFilters {
  type: ChangeType | '';
  module: string;
  severity: ChangeSeverity | '';
  review: ReviewStatus | '';
  /** Datas no formato AAAA-MM-DD (valor do campo) ou vazio. */
  from: string;
  to: string;
  page: number;
}

function dateParam(value: string | undefined): string {
  return value !== undefined && DATE_PATTERN.test(value) && dayStart(value) !== null ? value : '';
}

/** Filtros de /diferencas: tipo, módulo, severidade, revisão, período e página. */
export function parseChangeFilters(params: SearchParams, moduleKeys: readonly string[]): ChangeFilters {
  const module = firstParam(params, 'modulo') ?? '';
  return {
    type: enumParam(firstParam(params, 'tipo'), CHANGE_TYPES) ?? '',
    module: moduleKeys.includes(module) ? module : '',
    severity: enumParam(firstParam(params, 'severidade'), SEVERITIES) ?? '',
    review: enumParam(firstParam(params, 'revisao'), REVIEW_STATUSES) ?? '',
    from: dateParam(firstParam(params, 'de')),
    to: dateParam(firstParam(params, 'ate')),
    page: pageParam(firstParam(params, 'page')),
  };
}

/** Intervalo em epoch ms: início do dia "de" e fim do dia "até", ambos inclusivos. */
export function changeRange(filters: Pick<ChangeFilters, 'from' | 'to'>): { from: number | null; to: number | null } {
  return { from: dayStart(filters.from || undefined), to: dayEnd(filters.to || undefined) };
}

export interface AuditFilters {
  level: (typeof AUDIT_LEVELS)[number] | '';
  eventType: string;
  runId: number | null;
  page: number;
}

/** Filtros de /logs: nível, tipo de evento, execução e página. */
export function parseAuditFilters(params: SearchParams): AuditFilters {
  const run = firstParam(params, 'run');
  return {
    level: enumParam(firstParam(params, 'nivel'), AUDIT_LEVELS) ?? '',
    eventType: textParam(firstParam(params, 'tipo'), 60) ?? '',
    runId: run !== undefined && RUN_ID.test(run) ? Number(run) : null,
    page: pageParam(firstParam(params, 'page')),
  };
}

export interface RunPair {
  a: number;
  b: number;
}

/** IDs de execução de /historico/comparar?a=&b=. Null se faltar ou não for inteiro positivo. */
export function parseRunPair(a: string | undefined, b: string | undefined): RunPair | null {
  if (a === undefined || b === undefined || !RUN_ID.test(a) || !RUN_ID.test(b)) return null;
  return { a: Number(a), b: Number(b) };
}

export type ComparisonGuard = 'ok' | 'same_run' | 'missing' | 'other_instance';

/**
 * Regra de bloqueio da comparação. `instanceOf` mapeia ID da execução para ID da instância.
 * Execuções de instâncias diferentes são incompatíveis e não são comparadas.
 */
export function comparisonGuard(pair: RunPair, instanceOf: ReadonlyMap<number, number>, instanceId: number): ComparisonGuard {
  if (pair.a === pair.b) return 'same_run';
  const a = instanceOf.get(pair.a);
  const b = instanceOf.get(pair.b);
  if (a === undefined || b === undefined) return 'missing';
  if (a !== instanceId || b !== instanceId) return 'other_instance';
  return 'ok';
}
