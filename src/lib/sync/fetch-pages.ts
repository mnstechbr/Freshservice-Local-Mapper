/*
 * Leitura paginada de um módulo: per_page=100, segue o cabeçalho link (só mesmo host) ou para na
 * página curta. Retry com Retry-After (teto) ou backoff com jitter. Nenhum laço sem limite.
 */
import 'server-only';
import { computeBackoffMs, FreshserviceError, type createFreshserviceClient, type PageResponse } from '../freshservice/http';
import type { ModuleAdapter } from '../freshservice/modules/types';
import { ModuleIncompleteError, PER_PAGE, type SyncDeps } from './types';

export type HttpClient = ReturnType<typeof createFreshserviceClient>;

/** Só estes erros valem nova tentativa. 401, 403, 404 e erros de contrato não são repetidos. */
const RETRYABLE = new Set(['rate_limited', 'server_error', 'timeout', 'network']);

export interface RetryPolicy {
  maxRetries: number;
  retryAfterCapMs: number;
  backoffBaseMs: number;
  backoffCapMs: number;
}

export interface PageContext {
  client: HttpClient;
  signal: AbortSignal;
  deps: SyncDeps;
  policy: RetryPolicy;
  maxPages: number;
  /** Contador do módulo inteiro (módulos filhos somam no mesmo contador). */
  pages: { count: number };
}

export interface NextLink {
  path: string;
  query: Record<string, string>;
}

/**
 * Extrai rel="next" do cabeçalho link. Só aceita https no mesmo host da instância; outro host vira
 * erro (nunca é seguido). Sem link next, devolve null.
 */
export function parseNextLink(header: string | undefined, hostname: string): NextLink | null {
  if (!header) return null;
  for (const match of header.matchAll(/<([^>]+)>\s*;([^,]*)/g)) {
    const rel = /rel\s*=\s*"?([^";]*)"?/i.exec(match[2] ?? '')?.[1] ?? '';
    if (!rel.toLowerCase().split(/\s+/).includes('next')) continue;
    let url: URL;
    try {
      url = new URL(match[1] ?? '', `https://${hostname}`);
    } catch {
      throw new FreshserviceError('invalid_response', 'Cabeçalho link de paginação inválido.');
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname.toLowerCase() !== hostname ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== ''
    ) {
      throw new FreshserviceError('invalid_response', 'Link de paginação aponta para fora da instância.');
    }
    return { path: url.pathname, query: Object.fromEntries(url.searchParams) };
  }
  return null;
}

/** Uma chamada com até policy.maxRetries novas tentativas. A espera nunca passa de retryAfterCapMs. */
export async function requestWithRetry<T>(
  attempt: () => Promise<T>,
  ctx: Pick<PageContext, 'signal' | 'deps' | 'policy'>,
): Promise<T> {
  for (let retry = 0; ; retry += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof FreshserviceError) || !RETRYABLE.has(error.kind)) throw error;
      if (retry >= ctx.policy.maxRetries || ctx.signal.aborted) throw error;
      const delayMs =
        error.kind === 'rate_limited' && error.retryAfterSeconds !== undefined
          ? Math.min(error.retryAfterSeconds * 1000, ctx.policy.retryAfterCapMs)
          : computeBackoffMs(retry, {
              baseMs: ctx.policy.backoffBaseMs,
              capMs: ctx.policy.backoffCapMs,
              random: ctx.deps.random,
            });
      await ctx.deps.sleep(delayMs, ctx.signal).catch(() => undefined);
      if (ctx.signal.aborted) throw new FreshserviceError('cancelled', 'Chamada cancelada.');
    }
  }
}

/**
 * Gera uma lista de itens por página. Para quando: não há link next e a página é curta; ou quando o
 * link repete (loop, erro); ou quando o teto de páginas é atingido com ainda haver próxima página.
 */
/**
 * Caminho e query da primeira requisição. Com child.placement = 'path', o valor do pai substitui
 * {parentParam} no caminho (codificado) e sai da query. Sem valor do pai, falha sem chamar a API.
 */
export function requestTarget(
  adapter: ModuleAdapter,
  base: Record<string, string>,
): { path: string; query: Record<string, string> } {
  const child = adapter.child;
  if (!child || child.placement !== 'path') return { path: adapter.path, query: { ...base } };
  const value = base[child.parentParam];
  if (value === undefined || value === '') {
    throw new ModuleIncompleteError('parent_incomplete', 'Referência do pai ausente para o caminho do módulo filho.');
  }
  const query = { ...base };
  delete query[child.parentParam];
  return { path: adapter.path.replace(`{${child.parentParam}}`, encodeURIComponent(value)), query };
}

export async function* paginate(
  adapter: ModuleAdapter,
  baseQuery: Record<string, string>,
  ctx: PageContext,
): AsyncGenerator<unknown[]> {
  const first = requestTarget(adapter, baseQuery);
  const pageParams = (page: number): Record<string, number> => (adapter.paginated ? { per_page: PER_PAGE, page } : {});
  let path = first.path;
  let query: Record<string, string | number> = { ...adapter.extraQuery, ...first.query, ...pageParams(1) };
  let requestedPage = 1;
  const visited = new Set<string>();
  for (;;) {
    if (ctx.pages.count >= ctx.maxPages) {
      throw new ModuleIncompleteError('page_limit', `Limite de ${ctx.maxPages} páginas atingido; módulo incompleto.`);
    }
    const page: PageResponse = await requestWithRetry(
      () => ctx.client.getPage(path, query, { signal: ctx.signal }),
      ctx,
    );
    ctx.pages.count += 1;
    const items = adapter.extractList(page.json);
    const next = parseNextLink(page.headers.link, ctx.client.hostname);
    yield items;
    // Detalhe (não paginado): uma resposta por requisição, sem seguir link nem página seguinte.
    if (!adapter.paginated) return;
    requestedPage += 1;
    if (next) {
      const key = `${next.path}?${new URLSearchParams(next.query).toString()}`;
      if (visited.has(key)) throw new ModuleIncompleteError('loop', 'A paginação repetiu uma página; módulo incompleto.');
      visited.add(key);
      path = next.path;
      query = next.query;
      continue;
    }
    if (items.length < PER_PAGE) return;
    query = { ...adapter.extraQuery, ...first.query, ...pageParams(requestedPage) };
  }
}
