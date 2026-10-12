import 'server-only';
import { handleApiGet } from './api';
import { SIMULATOR_HEADER, isSimulatorInstanceHost, isSimulatorOrgHost } from './config';
import { handleToken } from './provider';
import { simState } from './state';

/**
 * Despacho EM PROCESSO das chamadas HTTP para os hosts simulados. Não abre socket nem consulta DNS.
 * Chamado só pelo hook de safeRequest (src/lib/freshservice/http.ts), e só para hosts que passam por
 * isSimulatedHost(). Qualquer outro host é recusado aqui.
 */
export interface DispatchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

const TOKEN_PATHS = new Set(['/oauth/v2/token', '/org/oauth/v2/token']);

function headerValue(headers: Record<string, string> | undefined, name: string): string | null {
  if (!headers) return null;
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key === undefined ? null : (headers[key] ?? null);
}

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...SIMULATOR_HEADER, ...headers },
  });
}

/** Falha de rede simulada (controle 'network'). A mensagem não traz host nem detalhe. */
function networkFails(pathname: string): boolean {
  const { network } = simState().scenario;
  if (network === 'none') return false;
  if (network === 'all') return true;
  const rel = pathname.replace(/^\/api\/v2\//, '');
  return network.some((module) => rel === module || rel.startsWith(`${module}/`));
}

export async function simulatorFetch(url: URL, init: DispatchInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  if (init.signal?.aborted) throw new DOMException('Chamada cancelada.', 'AbortError');
  if (networkFails(url.pathname)) throw new TypeError('fetch failed');

  if (isSimulatorOrgHost(url.hostname)) {
    if (!TOKEN_PATHS.has(url.pathname)) return reply(404, { error: 'not_found', error_description: 'Caminho inexistente no simulador.' });
    if (method !== 'POST') return reply(405, { error: 'method_not_allowed' }, { allow: 'POST' });
    const result = handleToken(headerValue(init.headers, 'authorization'), new URLSearchParams(init.body ?? ''));
    return reply(result.status, result.body, result.headers);
  }

  if (isSimulatorInstanceHost(url.hostname)) {
    if (!url.pathname.startsWith('/api/v2/')) return reply(404, { code: 'not_found', message: 'Caminho inexistente no simulador.' });
    if (method !== 'GET') {
      return reply(405, { code: 'method_not_allowed', message: 'Somente GET é permitido neste simulador.' }, { allow: 'GET' });
    }
    const result = handleApiGet(url, headerValue(init.headers, 'authorization'));
    return reply(result.status, result.body, result.headers);
  }

  // Host fora do simulador: nunca deveria chegar aqui. Recusa sem tocar em rede.
  throw new TypeError('fetch failed');
}
