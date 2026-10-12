/** Métodos que alteram estado: exigem Origin local e Sec-Fetch-Site compatível. */
export const MUTATING_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface LocalRequestInfo {
  method: string;
  /** Cabeçalho Host (pode vir nulo). */
  host: string | null;
  /** Cabeçalho Origin (pode vir nulo). */
  origin: string | null;
  /** Cabeçalho Sec-Fetch-Site (pode vir nulo). */
  fetchSite: string | null;
  port: number;
}

export type LocalGuardResult =
  | { ok: true }
  | { ok: false; code: 'forbidden_host' | 'forbidden_origin'; message: string };

export function localHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`];
}

export function localOrigins(port: number): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

/**
 * Guarda local contra DNS rebinding e CSRF:
 * - Host (todos os métodos) precisa ser 127.0.0.1:PORT ou localhost:PORT;
 * - métodos mutáveis exigem Origin igual a http://127.0.0.1:PORT ou http://localhost:PORT
 *   e, se Sec-Fetch-Site vier, same-origin ou none.
 * Sem CORS: nenhuma origem externa recebe permissão.
 */
export function checkLocalRequest(info: LocalRequestInfo): LocalGuardResult {
  const host = info.host?.toLowerCase() ?? null;
  if (!host || !localHosts(info.port).includes(host)) {
    return {
      ok: false,
      code: 'forbidden_host',
      message: `Host não permitido. Acesse o app por http://127.0.0.1:${info.port}.`,
    };
  }

  if (MUTATING_METHODS.has(info.method.toUpperCase())) {
    if (!info.origin || !localOrigins(info.port).includes(info.origin)) {
      return {
        ok: false,
        code: 'forbidden_origin',
        message: 'Origin ausente ou diferente da origem local.',
      };
    }
    if (info.fetchSite && info.fetchSite !== 'same-origin' && info.fetchSite !== 'none') {
      return {
        ok: false,
        code: 'forbidden_origin',
        message: 'Requisição de origem cruzada recusada.',
      };
    }
  }
  return { ok: true };
}

/** Origem loopback do app: usada pelo painel; o callback OAuth também pode usar localhost. */
export function loopbackOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/**
 * Página (não /api), em GET, pedida por localhost:PORT: destino 127.0.0.1:PORT com o mesmo caminho
 * e query. Retorna null quando não há redirecionamento. O destino tem host fixo: não é open redirect.
 * O redirecionamento real é a regra de next.config.ts (localhostPageRedirectRule). O proxy usa esta
 * função só para responder erro com o destino correto quando a regra não cobriu a requisição.
 */
export function localhostPageRedirect(info: {
  method: string;
  host: string | null;
  pathname: string;
  search: string;
  port: number;
}): string | null {
  if (info.method.toUpperCase() !== 'GET') return null;
  if (info.pathname === '/auth/iniciar' || info.pathname === '/auth/concluido' || info.pathname === '/simulador' || info.pathname.startsWith('/simulador/')) return null;
  if (info.pathname === '/api' || info.pathname.startsWith('/api/')) return null;
  if (info.host?.toLowerCase() !== `localhost:${info.port}`) return null;
  return `${loopbackOrigin(info.port)}${info.pathname}${info.search}`;
}

/** Formato de redirect de next.config.ts (redirects): campos usados pela regra do projeto. */
export interface LocalhostRedirectRule {
  source: string;
  has: { type: 'header'; key: 'host'; value: string }[];
  destination: string;
  permanent: false;
}

/**
 * Regra de configuração do Next para páginas em localhost:PORT (ver docs/VALIDACAO.md, D1).
 * Por que config e não proxy: o router do Next reescreve Location absoluta de middleware quando ela
 * aponta para a própria origem do servidor (127.0.0.1:PORT), trocando por "/" e causando loop.
 * Redirect de configuração não passa por essa reescrita. A porta é fixa no build/dev (routes manifest).
 * /api fica fora da regra: continua indo ao proxy e às rotas, com a checagem de Host existente.
 */
export function localhostPageRedirectRule(port: number): LocalhostRedirectRule {
  return {
    source: '/:path((?!(?:api|simulador)(?:/|$)|auth/(?:iniciar|concluido)(?:/|$)).*)*',
    has: [{ type: 'header', key: 'host', value: `localhost:${port}` }],
    destination: `${loopbackOrigin(port)}/:path*`,
    permanent: false,
  };
}

/**
 * O início do OAuth aceita Host localhost:PORT ou 127.0.0.1:PORT. O host do perfil (redirect_host)
 * é conferido à parte: se diferir, o start responde 303 para o host do perfil, antes do cookie de state.
 * Retorna a mensagem de erro, ou null se estiver ok.
 */
export function oauthStartHostMessage(host: string | null, port: number): string | null {
  if (host !== null && localHosts(port).includes(host.toLowerCase())) return null;
  return `Abra http://127.0.0.1:${port} ou http://localhost:${port} para iniciar a conexão OAuth.`;
}

/** Hostname (sem porta) do Host da requisição, em minúsculas. */
export function hostnameOf(host: string | null): string {
  return (host ?? '').toLowerCase().replace(/:\d+$/, '');
}

/**
 * Destino do 303 do início do OAuth quando o Host difere do redirect_host do perfil. Null: sem
 * redirecionamento. pathAndQuery é o caminho e a query da requisição original.
 */
export function oauthStartRedirectTarget(
  host: string | null,
  redirectHost: string,
  port: number,
  pathAndQuery: string,
): string | null {
  if (hostnameOf(host) === redirectHost) return null;
  return `http://${redirectHost}:${port}${pathAndQuery}`;
}
