/**
 * Cliente HTTP base para a API Freshservice (e para o endpoint de token do Freshworks).
 * Reutilizado pela Fase 4. Regras:
 * - só https, sem credenciais na URL, sem porta não padrão;
 * - só hosts da allowlist (host da instância ativa e host de autenticação Freshworks);
 * - redirect: 'manual'. Redirecionamento para outro host é recusado. Em GET, redirecionamento para
 *   o mesmo host é seguido até 3 vezes. POST nunca segue redirecionamento;
 * - timeout por AbortSignal.timeout, combinado com o cancelamento do chamador (signal);
 * - resposta com limite de tamanho (2 MiB no básico; 20 MiB no cliente de leitura);
 * - só os cabeçalhos link, retry-after e x-ratelimit-* voltam ao chamador;
 * - erros classificados e sanitizados: nunca incluem cabeçalhos, Authorization nem corpo da resposta;
 * - antes de cada salto, o DNS do host é resolvido e a chamada é recusada se QUALQUER endereço
 *   não for público (loopback, privado, link-local, CGNAT, metadados, multicast, IPv4 mapeado).
 */
import 'server-only';
import { DnsGuardError, ensurePublicDnsTarget } from '../security/dns-guard';
import { FreshserviceError, type FreshserviceErrorKind } from './errors';
import type { OAuthPathPrefix } from '../oauth-path';
import { isSimulatedHost } from '../simulator/config';
import { simulatorFetch } from '../simulator/dispatch';
import { normalizeFreshworksOrgUrl } from '../security/url';

// Erros ficam em ./errors.ts (sem node:, usados pelo registro de módulos no cliente).
// Re-exportados aqui para os consumidores existentes continuarem funcionando.
export { FreshserviceError, type FreshserviceErrorKind };

export interface SafeRequest {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  /** Hostnames em minúsculas. Qualquer outro host é recusado antes da conexão. */
  allowedHosts: readonly string[];
  timeoutMs: number;
  /** Cancelamento do chamador. Combinado com o timeout. Abortar gera erro 'cancelled'. */
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Redirecionamentos seguidos (só GET e só mesmo host). Padrão 3. */
  maxRedirects?: number;
  /** Limite do corpo em bytes. Padrão 2 MiB. */
  maxBodyBytes?: number;
}

export interface SafeResponse {
  status: number;
  body: string;
  /** Só link, retry-after e x-ratelimit-*. Nomes em minúsculas. */
  headers: Record<string, string>;
}

const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;
/** Limite do cliente de leitura: 100 itens por página com campos de descrição. */
export const CLIENT_MAX_BODY_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const KEPT_HEADER_RE = /^(link|retry-after|x-ratelimit-[a-z-]+)$/;
/** Caminhos de recurso Freshservice: /api/v2/<recurso>[/<subrecurso>]. */
const RESOURCE_PATH_RE = /^\/api\/v2\/[a-z0-9_]+(?:\/[a-z0-9_]+)*$/;
/** Caminho do endpoint de token Freshworks, documentado em developers.freshworks.com. */
export const OAUTH_TOKEN_PATH = '/oauth/v2/token';

/** Política runtime, inclusive para chamadas sem TypeScript. Verificada antes de DNS/transporte. */
function assertReadOnlyRequest(method: unknown, url: URL): void {
  if (method === 'GET') return;
  if (
    method === 'POST' &&
    (url.pathname === OAUTH_TOKEN_PATH || url.pathname === `/org${OAUTH_TOKEN_PATH}`) &&
    url.search === '' && url.hash === ''
  ) {
    try {
      normalizeFreshworksOrgUrl(url.origin);
      return;
    } catch {
      // A única exceção é a emissão de token numa organização Freshworks validada.
    }
  }
  throw new FreshserviceError('read_only_violation', 'Operação recusada pela política de somente leitura.');
}

export function assertAllowedUrl(url: URL, allowedHosts: readonly string[]): void {
  if (url.protocol !== 'https:') {
    throw new FreshserviceError('unsafe_url', 'Somente https é permitido nas chamadas.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new FreshserviceError('unsafe_url', 'URL com credenciais não é permitida.');
  }
  if (url.port !== '') {
    throw new FreshserviceError('unsafe_url', 'Porta diferente da padrão não é permitida.');
  }
  if (!allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new FreshserviceError('host_not_allowed', 'Host fora da allowlist desta chamada.');
  }
}

/** Retry-After aceita segundos ou data HTTP. Retorna undefined se ausente ou inválido. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

export function classifyHttpStatus(
  status: number,
  retryAfterHeader: string | null,
  now: number = Date.now(),
): FreshserviceError {
  if (status === 401) {
    return new FreshserviceError('unauthorized', 'Credenciais rejeitadas (401).', { status });
  }
  if (status === 403) {
    return new FreshserviceError('forbidden', 'Sem permissão para este recurso (403).', { status });
  }
  if (status === 404) {
    return new FreshserviceError(
      'not_found',
      'Recurso não encontrado (404). Confira a URL da instância.',
      { status },
    );
  }
  if (status === 429) {
    const retryAfterSeconds = parseRetryAfter(retryAfterHeader, now);
    const hint = retryAfterSeconds === undefined ? '' : `; tente após ${retryAfterSeconds} s`;
    return new FreshserviceError(
      'rate_limited',
      `Limite de requisições atingido (429)${hint}.`,
      { status, retryAfterSeconds },
    );
  }
  if (status >= 500) {
    return new FreshserviceError('server_error', `Erro no servidor Freshservice (${status}).`, {
      status,
    });
  }
  return new FreshserviceError('client_error', `Requisição recusada pela API (${status}).`, {
    status,
  });
}

/** Mantém apenas os cabeçalhos que o motor de sincronização usa (paginação e limite de taxa). */
export function pickResponseHeaders(headers: Headers): Record<string, string> {
  const kept: Record<string, string> = {};
  headers.forEach((value, name) => {
    const key = name.toLowerCase();
    if (KEPT_HEADER_RE.test(key)) kept[key] = value;
  });
  return kept;
}

function timeoutSignal(request: SafeRequest): AbortSignal {
  const timeout = AbortSignal.timeout(request.timeoutMs);
  return request.signal ? AbortSignal.any([timeout, request.signal]) : timeout;
}

function toTransportError(error: unknown, callerSignal?: AbortSignal): FreshserviceError {
  if (error instanceof FreshserviceError) return error;
  // Cancelamento do chamador tem prioridade sobre timeout para não confundir os dois.
  if (callerSignal?.aborted) return new FreshserviceError('cancelled', 'Chamada cancelada.');
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new FreshserviceError('timeout', 'Tempo limite excedido ao falar com o Freshservice.');
  }
  // Mensagem genérica: detalhes de rede podem conter a URL.
  return new FreshserviceError('network', 'Falha de rede ao falar com o Freshservice.');
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new FreshserviceError('too_large', 'Resposta maior que o limite permitido.');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new FreshserviceError('too_large', 'Resposta maior que o limite permitido.');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Executa uma requisição com todas as proteções. Lança FreshserviceError em qualquer falha. */
/**
 * Recusa o host se a resolução DNS apontar para endereço não público. Erro sanitizado: sem host,
 * sem IP e sem resposta do DNS na mensagem.
 */
async function assertPublicDestination(hostname: string): Promise<void> {
  try {
    await ensurePublicDnsTarget(hostname);
  } catch (error) {
    if (error instanceof DnsGuardError && error.code === 'unsafe_destination') {
      throw new FreshserviceError('unsafe_url', error.message);
    }
    throw new FreshserviceError(
      'network',
      error instanceof DnsGuardError ? error.message : 'Não foi possível verificar o domínio.',
    );
  }
}

export async function safeRequest(request: SafeRequest): Promise<SafeResponse> {
  // Copia antes do primeiro await: o chamador não pode mudar o método durante a consulta DNS.
  request = {
    ...request,
    headers: request.headers ? { ...request.headers } : undefined,
    allowedHosts: [...request.allowedHosts],
  };
  const fetchImpl = request.fetchImpl ?? fetch;
  const maxRedirects = request.method === 'GET' ? (request.maxRedirects ?? DEFAULT_MAX_REDIRECTS) : 0;
  const maxBodyBytes = request.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  let url = new URL(request.url);

  for (let hop = 0; ; hop += 1) {
    assertReadOnlyRequest(request.method, url);
    assertAllowedUrl(url, request.allowedHosts);
    await assertPublicDestination(url.hostname);
    if (request.signal?.aborted) throw new FreshserviceError('cancelled', 'Chamada cancelada.');

    let response: Response;
    const init = {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'manual' as const,
      signal: timeoutSignal(request),
    };
    try {
      // Hook do simulador: host simulado (com FSLM_SIMULATOR=1) é atendido em processo, sem socket.
      response = isSimulatedHost(url.hostname) ? await simulatorFetch(url, init) : await fetchImpl(url, init);
    } catch (error) {
      throw toTransportError(error, request.signal);
    }

    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      const location = response.headers.get('location');
      if (request.method !== 'GET' || hop >= maxRedirects || !location) {
        throw new FreshserviceError(
          'redirect_refused',
          `Redirecionamento recusado (${response.status}).`,
          { status: response.status },
        );
      }
      const next = new URL(location, url);
      if (next.hostname.toLowerCase() !== url.hostname.toLowerCase() || next.protocol !== url.protocol) {
        throw new FreshserviceError(
          'redirect_refused',
          'Redirecionamento para outro host recusado.',
          { status: response.status },
        );
      }
      url = next;
      continue;
    }

    if (response.status < 200 || response.status > 299) {
      await response.body?.cancel().catch(() => undefined);
      throw classifyHttpStatus(response.status, response.headers.get('retry-after'));
    }

    try {
      const body = await readLimitedText(response, maxBodyBytes);
      return { status: response.status, body, headers: pickResponseHeaders(response.headers) };
    } catch (error) {
      throw toTransportError(error, request.signal);
    }
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new FreshserviceError('invalid_response', 'Resposta não é JSON válido.');
  }
}

export interface FreshserviceClientOptions {
  /** Origem https da instância (ex.: https://empresa.freshservice.com). Já validada pelo chamador. */
  origin: string;
  /** Devolve o valor do cabeçalho Authorization (já renovado, se for OAuth). Nunca é registrado. */
  authorization: () => Promise<string>;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  /** Limite do corpo por resposta. Padrão CLIENT_MAX_BODY_BYTES (20 MiB). */
  maxBodyBytes?: number;
}

export interface PageResponse {
  json: unknown;
  status: number;
  /** Só link, retry-after e x-ratelimit-*. */
  headers: Record<string, string>;
}

export interface GetOptions {
  signal?: AbortSignal;
}

/** Cliente de leitura (GET) para recursos /api/v2/... da instância. */
export function createFreshserviceClient(options: FreshserviceClientOptions) {
  const base = new URL(options.origin);
  const hostname = base.hostname.toLowerCase();

  async function getPage(
    path: string,
    query: Record<string, string | number> = {},
    get: GetOptions = {},
  ): Promise<PageResponse> {
    if (!RESOURCE_PATH_RE.test(path)) {
      throw new FreshserviceError('unsafe_url', 'Caminho de recurso não permitido.');
    }
    const url = new URL(path, base);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const response = await safeRequest({
      url: url.toString(),
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: await options.authorization(),
      },
      allowedHosts: [hostname],
      timeoutMs: options.timeoutMs,
      signal: get.signal,
      fetchImpl: options.fetchImpl,
      maxBodyBytes: options.maxBodyBytes ?? CLIENT_MAX_BODY_BYTES,
    });
    return { json: parseJson(response.body), status: response.status, headers: response.headers };
  }

  return {
    hostname,
    getPage,
    async getJson(
      path: string,
      query: Record<string, string | number> = {},
      get: GetOptions = {},
    ): Promise<unknown> {
      return (await getPage(path, query, get)).json;
    },
  };
}

export interface TokenRequestOptions {
  /** Origem https da organização Freshworks (ex.: https://org.myfreshworks.com). */
  origin: string;
  clientId: string;
  clientSecret: string;
  form: Record<string, string>;
  timeoutMs: number;
  /**
   * Prefixo do endpoint de token (perfil: token_path_prefix). Independente do prefixo do authorize.
   * '' = https://<org>/oauth/v2/token, o caminho do texto da doc oficial Freshworks "Implement OAuth
   * authorization flow in external apps", etapa "Place access-token request": "The authorization-server
   * URL to which the access-token request should be sent: https://fws-dname.com/oauth/v2/token".
   * '/org' = https://<org>/org/oauth/v2/token, forma do exemplo curl da mesma página. Qualquer outro valor
   * é tratado como ''. Não há tentativa automática no outro caminho quando a resposta falha.
   */
  tokenPathPrefix?: OAuthPathPrefix;
  fetchImpl?: typeof fetch;
}

/**
 * POST form-urlencoded ao endpoint de token. client_id e client_secret vão só no Basic (como na
 * doc). Redirecionamentos são recusados. O prefixo vem de allowlist fixa, nunca de texto livre.
 */
export async function postTokenRequest(options: TokenRequestOptions): Promise<unknown> {
  const base = new URL(options.origin);
  const basic = Buffer.from(`${options.clientId}:${options.clientSecret}`, 'utf8').toString('base64');
  const prefix = options.tokenPathPrefix === '/org' ? '/org' : '';
  const response = await safeRequest({
    url: new URL(`${prefix}${OAUTH_TOKEN_PATH}`, base).toString(),
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams(options.form).toString(),
    allowedHosts: [base.hostname.toLowerCase()],
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
    maxRedirects: 0,
  });
  return parseJson(response.body);
}

/**
 * Backoff com jitter para a Fase 4. Retry-After, quando presente, tem prioridade e não é limitado.
 * Sem Retry-After: base * 2^tentativa, limitado a 30 s, com jitter entre 50% e 100%.
 */
export function computeBackoffMs(
  attempt: number,
  options: { retryAfterSeconds?: number; random?: () => number; baseMs?: number; capMs?: number } = {},
): number {
  if (options.retryAfterSeconds !== undefined) return options.retryAfterSeconds * 1000;
  const base = options.baseMs ?? 1000;
  const cap = options.capMs ?? 30_000;
  const exponential = Math.min(cap, base * 2 ** Math.max(0, attempt));
  const random = (options.random ?? Math.random)();
  return Math.round(exponential * (0.5 + random / 2));
}
