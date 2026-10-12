import 'server-only';
import { requiredScopesFor, roleKeyFor, SIM_RESOURCES, type SimResource, type SimUser } from './fixtures';
import { checkBearer } from './provider';
import { simState } from './state';

/** API v2 SIMULADA (somente GET). Respostas no formato do recurso; não é a API real do Freshservice. */

export interface ApiResult {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

const PER_PAGE_DEFAULT = 30;
const PER_PAGE_MAX = 100;

function json(status: number, body: unknown, headers: Record<string, string> = {}): ApiResult {
  return { status, body, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } };
}

function apiError(status: number, code: string, message: string, extra: Record<string, unknown> = {}): ApiResult {
  return json(status, { code, message, ...extra });
}

type Target =
  | { kind: 'list'; resource: SimResource }
  | { kind: 'ticket_child'; ticketId: number; sub: 'conversations' | 'activities' }
  | { kind: 'detail'; itemId: number };

function resolveTarget(pathname: string): Target | undefined {
  const rel = pathname.replace(/^\/api\/v2\//, '');
  const child = /^tickets\/(\d+)\/(conversations|activities)$/.exec(rel);
  if (child) return { kind: 'ticket_child', ticketId: Number(child[1]), sub: child[2] as 'conversations' | 'activities' };
  const detail = /^service_catalog\/items\/(\d+)$/.exec(rel);
  if (detail) return { kind: 'detail', itemId: Number(detail[1]) };
  const resource = SIM_RESOURCES.find((candidate) => candidate.path === rel);
  return resource ? { kind: 'list', resource } : undefined;
}

/** Caminho usado no escopo/papel: recursos de lista usam o próprio caminho; detalhe usa o da lista. */
function pathOf(target: Target): string {
  if (target.kind === 'list') return target.resource.path;
  if (target.kind === 'detail') return 'service_catalog/items';
  return `tickets/${target.ticketId}/${target.sub}`;
}

type Caller = { user: SimUser; scopes: string[] | null };

/**
 * Autenticação: Bearer (token OAuth simulado, com escopos e expiração) ou Basic com a API key de um
 * usuário (acesso pleno dos escopos, mas o papel do usuário continua valendo).
 */
function authenticate(authorization: string | null): Caller | ApiResult {
  if (authorization && /^Basic /i.test(authorization)) {
    const key = Buffer.from(authorization.slice(6).trim(), 'base64').toString('utf8').split(':')[0] ?? '';
    const user = simState().users.find((candidate) => candidate.apiKey !== null && candidate.apiKey === key);
    if (!user) return apiError(401, 'access_token_invalid', 'API key inválida (simulador).');
    return { user, scopes: null };
  }
  const check = checkBearer(authorization);
  if (!check.ok) {
    const message = {
      missing: 'Autenticação ausente. Envie Authorization: Bearer <token>.',
      unknown: 'Token inválido (simulador).',
      expired: 'Token expirado (simulador).',
    }[check.reason];
    return apiError(401, 'access_token_invalid', message);
  }
  const user = simState().users.find((candidate) => candidate.id === check.token.userId);
  if (!user) return apiError(401, 'access_token_invalid', 'Token sem usuário válido (simulador).');
  return { user, scopes: check.token.scopes };
}

function isApiResult(value: Caller | ApiResult): value is ApiResult {
  return 'status' in value;
}

function pageOf(url: URL, records: readonly unknown[], listKey: string): ApiResult {
  const perRaw = Number(url.searchParams.get('per_page')) || PER_PAGE_DEFAULT;
  const perPage = Math.min(PER_PAGE_MAX, Math.max(1, Math.floor(perRaw)));
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
  const slice = records.slice((page - 1) * perPage, page * perPage);
  const headers: Record<string, string> = {};
  if (page * perPage < records.length) {
    const next = new URL(url.pathname, url.origin);
    next.searchParams.set('page', String(page + 1));
    next.searchParams.set('per_page', String(perPage));
    headers.link = `<${next.toString()}>; rel="next"`;
  }
  return json(200, { [listKey]: slice }, headers);
}

/**
 * GET em /api/v2/... do host simulado. Ordem das verificações: autenticação (401), escopo do token
 * (403 invalid_scope), papel do usuário no módulo (403 access_denied), existência (404), paginação.
 */
export function handleApiGet(url: URL, authorization: string | null): ApiResult {
  const target = resolveTarget(url.pathname);
  if (!target) return apiError(404, 'not_found', 'Recurso não existe no simulador.');
  const caller = authenticate(authorization);
  if (isApiResult(caller)) return caller;

  const path = pathOf(target);
  const required = requiredScopesFor(path);
  if (caller.scopes !== null && required.some((scope) => !caller.scopes?.includes(scope))) {
    return apiError(403, 'invalid_scope', 'Token sem o escopo exigido por este recurso.', {
      required_scope: required,
    });
  }
  if (caller.user.permissions[roleKeyFor(path)] !== true) {
    return apiError(403, 'access_denied', 'Usuário sem permissão para este módulo.');
  }

  const dataset = simState().dataset;
  if (target.kind === 'detail') {
    const item = (dataset.get('service_catalog/items') ?? []).find((record) => record.id === target.itemId);
    if (!item) return apiError(404, 'not_found', 'Item não encontrado.');
    return json(200, { service_item: item });
  }
  if (target.kind === 'ticket_child') {
    const ticket = (dataset.get('tickets') ?? []).find((record) => record.id === target.ticketId);
    if (!ticket) return apiError(404, 'not_found', 'Ticket não encontrado.');
    const items = [1, 2].map((n) => ({ id: target.ticketId * 10 + n, body: `Registro ${n} do ticket ${target.ticketId}` }));
    return json(200, { [target.sub]: items });
  }
  const records = dataset.get(target.resource.path) ?? [];
  if (!target.resource.paginated) return json(200, { [target.resource.listKey]: records });
  return pageOf(url, records, target.resource.listKey);
}
