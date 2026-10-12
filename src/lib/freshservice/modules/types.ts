import { FreshserviceError } from '../errors';

/** Grupos da UI (chaves de src/lib/modules/catalog.ts, mais automations). */
export const MODULE_GROUPS = [
  'service_catalog',
  'knowledge_base',
  'tickets',
  'users_groups',
  'assets',
  'itsm',
  'settings',
  'automations',
] as const;
export type ModuleGroup = (typeof MODULE_GROUPS)[number];

/**
 * Origem da informação de caminho: confirmed (lido na documentação), named_in_index (ação aparece
 * no índice da documentação, caminho exato não confirmado; validado no diagnóstico) ou unsupported
 * (sem endpoint GET documentado, ou fora da política de privacidade).
 */
export type DocStatus = 'confirmed' | 'named_in_index' | 'unsupported';

/**
 * Ruído global, removido de todo registro (normalized e raw_json, em qualquer nível): links, paginação e URLs temporárias
 * (anexos trazem tokens que mudam a cada leitura). Voláteis como updated_at NÃO entram aqui:
 * o motor de diff os ignora (src/lib/diff/volatile.ts), e created_at é estável e fica.
 */
export const GLOBAL_EXCLUDED_KEYS: readonly string[] = [
  '_links',
  'links',
  'meta',
  'pagination',
  'icon_url',
  'avatar_url',
  'image_url',
  'logo_url',
  'attachments',
  // Contato pessoal: nunca entra em normalized, com ou sem metadataOnly (regra da whitelist anterior).
  'email',
  'emails',
  'primary_email',
  'secondary_emails',
  'cc_emails',
  'fwd_emails',
  'reply_cc_emails',
  'to_emails',
  'phone',
  'mobile',
  'work_phone_number',
  'mobile_phone_number',
];

const GLOBAL_EXCLUDED_SET: ReadonlySet<string> = new Set(GLOBAL_EXCLUDED_KEYS);

/**
 * Nomes com cara de segredo (D3, 2026-10-11): api_key, api-key, apikey (qualquer caixa), e qualquer
 * chave que contenha "token", "secret" ou "password". Removidos de normalized e de raw_json em qualquer
 * nível. Falso positivo aceito: campo personalizado com um desses termos no nome também sai.
 * Conferido por grep em src/lib/freshservice/modules: nenhum adaptador declara campo com esses nomes.
 */
export const SECRET_KEY_PATTERN = /api[_-]?key|token|secret|password/i;

/** Chave que nunca é guardada (normalized e raw_json), em qualquer nível: lista global ou nome de segredo. */
export function isNeverStoredKey(key: string): boolean {
  return GLOBAL_EXCLUDED_SET.has(key) || SECRET_KEY_PATTERN.test(key);
}

/** Arrays cuja ordem na API não é estável: ordenados por id/name/value/label antes do hash. */
const STABLE_ARRAY_KEYS = new Set(['custom_fields', 'choices']);

export interface ResourceRelation {
  type: string;
  toExternalId: string;
}

export interface ResourceRecord {
  externalId: string;
  /** Valor de referência para módulos filhos (ex.: display_id). Null se o adaptador não tem. */
  refValue: string | null;
  workspaceId: number | null;
  name: string | null;
  category: string | null;
  /**
   * Todos os atributos retornados, menos GLOBAL_EXCLUDED_KEYS e nomes de segredo (em qualquer nível) e
   * excludeFields do adaptador (em qualquer nível).
   * A privacidade (metadataOnly: contentFields/sensitiveFields) é aplicada depois, no persist.
   */
  normalized: Record<string, unknown>;
  relations: ResourceRelation[];
}

export interface ChildSpec {
  parentKey: string;
  /** Nome do parâmetro com o valor do pai (ex.: display_id). */
  parentParam: string;
  /** query (padrão): vai na query string. path: substitui {parentParam} no caminho. */
  placement?: 'query' | 'path';
}

export interface ModuleAdapter {
  /** Chave única, ex.: 'tickets.tickets'. É o module_key gravado no banco. */
  key: string;
  /** Campo do item -> tipo da relação (ex.: category_id -> category). Usado pelos testes de consistência. */
  relationFields: Readonly<Record<string, string>>;
  moduleGroup: ModuleGroup;
  name: string;
  method: 'GET';
  path: string;
  paginated: boolean;
  docStatus: DocStatus;
  docNote: string;
  /** Módulo filho: uma requisição por valor de referência do pai (ver ChildSpec). */
  child: ChildSpec | null;
  extraQuery: Record<string, string | number>;
  /** Removidos de normalized quando metadataOnly = true. */
  contentFields: readonly string[];
  sensitiveFields: readonly string[];
  /** Exclusões específicas do adaptador (somadas a GLOBAL_EXCLUDED_KEYS). */
  excludeFields: readonly string[];
  /** Campo usado como referência por filhos (padrão: id). */
  refField: string;
  extractList(json: unknown): unknown[];
  toResource(item: unknown): ResourceRecord | null;
}

export interface AdapterSpec {
  key: string;
  moduleGroup: ModuleGroup;
  name: string;
  path: string;
  paginated: boolean;
  docStatus?: 'confirmed' | 'named_in_index';
  docNote: string;
  /** Chave da lista na resposta. Sem ela, usa a raiz (array) ou o único array do objeto. */
  listKey?: string;
  /** Chave de um objeto único na resposta (ex.: detalhe). A resposta vira lista de 1 item. */
  itemKey?: string;
  /** Destaque opcional para a tela. Não filtra a normalização. */
  fields?: readonly string[];
  excludeFields?: readonly string[];
  contentFields?: readonly string[];
  sensitiveFields?: readonly string[];
  nameField?: string;
  categoryField?: string;
  workspaceField?: string;
  /** Campo usado como referência por filhos (padrão: id). Ex.: items usa display_id. */
  refField?: string;
  /** Campo de referência -> tipo da relação (ex.: requester_id -> requester). */
  relationFields?: Record<string, string>;
  child?: { parentKey: string; parentParam: string; placement?: 'query' | 'path' };
  extraQuery?: Record<string, string | number>;
}

function extractList(json: unknown, listKey: string | undefined, itemKey: string | undefined): unknown[] {
  if (itemKey) {
    const one = json && typeof json === 'object' ? (json as Record<string, unknown>)[itemKey] : undefined;
    if (one && typeof one === 'object' && !Array.isArray(one)) return [one];
    throw new FreshserviceError('invalid_response', 'Resposta da API fora do formato esperado.');
  }
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    if (listKey && Array.isArray(obj[listKey])) return obj[listKey] as unknown[];
    if (!listKey) {
      const arrays = Object.values(obj).filter(Array.isArray);
      if (arrays.length === 1) return arrays[0] as unknown[];
    }
  }
  throw new FreshserviceError('invalid_response', 'Resposta da API fora do formato esperado.');
}

const scalarToString = (value: unknown): string | null =>
  typeof value === 'number' || typeof value === 'string' ? String(value) : null;

function identityText(item: unknown): string {
  if (!item || typeof item !== 'object') return String(item ?? '');
  const obj = item as Record<string, unknown>;
  return String(obj.id ?? obj.name ?? obj.value ?? obj.label ?? '');
}

/** Copia profunda que ordena os arrays estáveis (custom_fields, choices). Não altera o original. */
function stableDeep(value: unknown, key: string, excluded: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) {
    const items = value.map((entry) => stableDeep(entry, key, excluded));
    if (!STABLE_ARRAY_KEYS.has(key)) return items;
    return items.sort((x, y) => {
      const a = identityText(x);
      const b = identityText(y);
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !excluded.has(k) && !isNeverStoredKey(k))
        .map(([k, v]) => [k, stableDeep(v, k, excluded)]),
    );
  }
  return value;
}

/**
 * Normalização ampla: todos os atributos de topo, menos os excluídos (adaptador) e os que nunca são
 * guardados (GLOBAL_EXCLUDED_KEYS e nomes de segredo). Em níveis internos, as mesmas exclusões são aplicadas. Ausente vira ausente.
 */
function normalizeAll(obj: Record<string, unknown>, excluded: ReadonlySet<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || excluded.has(key) || isNeverStoredKey(key)) continue;
    out[key] = stableDeep(value, key, excluded);
  }
  return out;
}

/** Cópia profunda sem as chaves que nunca são guardadas, em qualquer nível (raw_json). Não ordena nem altera o original. */
export function withoutNeverStoredKeys(value: unknown, excluded: ReadonlySet<string> = new Set()): unknown {
  if (Array.isArray(value)) return value.map((entry) => withoutNeverStoredKeys(entry, excluded));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !excluded.has(k) && !isNeverStoredKey(k))
        .map(([k, v]) => [k, withoutNeverStoredKeys(v, excluded)]),
    );
  }
  return value;
}

/** Fábrica dos adaptadores de leitura. Um módulo novo = um arquivo + uma entrada no índice. */
export function makeAdapter(spec: AdapterSpec): ModuleAdapter {
  const nameField = spec.nameField ?? 'name';
  const refField = spec.refField ?? 'id';
  const excluded = new Set<string>([...GLOBAL_EXCLUDED_KEYS, ...(spec.excludeFields ?? [])]);
  return {
    key: spec.key,
    relationFields: spec.relationFields ?? {},
    moduleGroup: spec.moduleGroup,
    name: spec.name,
    method: 'GET',
    path: spec.path,
    paginated: spec.paginated,
    // Todos os caminhos consultáveis aparecem na documentação (checkpoint F4). 'named_in_index' fica
    // disponível para módulos novos ainda não conferidos.
    docStatus: spec.docStatus ?? 'confirmed',
    docNote: spec.docNote,
    child: spec.child ? { parentKey: spec.child.parentKey, parentParam: spec.child.parentParam, placement: spec.child.placement ?? 'query' } : null,
    extraQuery: spec.extraQuery ?? {},
    contentFields: spec.contentFields ?? [],
    sensitiveFields: spec.sensitiveFields ?? [],
    excludeFields: spec.excludeFields ?? [],
    refField,
    extractList: (json) => extractList(json, spec.listKey, spec.itemKey),
    toResource(item) {
      if (!item || typeof item !== 'object') return null;
      const obj = item as Record<string, unknown>;
      const externalId = scalarToString(obj.id);
      if (externalId === null) return null;
      const relations = Object.entries(spec.relationFields ?? {}).flatMap(([field, type]) => {
        const target = scalarToString(obj[field]);
        return target === null ? [] : [{ type, toExternalId: target }];
      });
      const ws = spec.workspaceField ? obj[spec.workspaceField] : obj.workspace_id;
      return {
        externalId,
        refValue: scalarToString(obj[refField]),
        workspaceId: typeof ws === 'number' ? ws : null,
        name: typeof obj[nameField] === 'string' ? (obj[nameField] as string) : null,
        category: spec.categoryField ? scalarToString(obj[spec.categoryField]) : null,
        normalized: normalizeAll(obj, excluded),
        relations,
      };
    },
  };
}

/** Entrada registrada sem chamada: documentada como não suportada. Nunca é consultada. */
export function unsupportedAdapter(spec: {
  key: string;
  moduleGroup: ModuleGroup;
  name: string;
  path: string;
  docNote: string;
}): ModuleAdapter {
  return {
    key: spec.key,
    relationFields: {},
    moduleGroup: spec.moduleGroup,
    name: spec.name,
    method: 'GET',
    path: spec.path,
    paginated: false,
    docStatus: 'unsupported',
    docNote: spec.docNote,
    child: null,
    extraQuery: {},
    contentFields: [],
    sensitiveFields: [],
    excludeFields: [],
    refField: 'id',
    extractList: () => {
      throw new FreshserviceError('unsafe_url', 'Módulo não suportado.');
    },
    toResource: () => null,
  };
}
