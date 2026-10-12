import { NextResponse, type NextRequest } from 'next/server';
import { parseEnv } from './lib/config/env';
import { applySecurityHeaders } from './lib/security/headers';
import { checkLocalRequest, localhostPageRedirect } from './lib/security/origin';

/**
 * Proxy do Next 16 (antigo middleware). Aplica a todas as rotas, exceto assets estáticos:
 * - Host deve ser 127.0.0.1:PORT ou localhost:PORT (anti DNS rebinding);
 * - páginas (fora de /api) pedidas por localhost:PORT vão para 127.0.0.1:PORT pela regra de
 *   next.config.ts (mesmo caminho e query), exceto as páginas de passagem/conclusão OAuth e simulador,
 *   que preservam o host dos cookies;
 * - métodos mutáveis exigem Origin local (sem CORS: nenhuma origem externa é aceita);
 * - cabeçalhos de segurança (CSP, X-Frame-Options, Referrer-Policy, nosniff).
 */
export function proxy(request: NextRequest) {
  const { PORT: port } = parseEnv(process.env);
  const dev = process.env.NODE_ENV === 'development';
  const api = request.nextUrl.pathname.startsWith('/api/');

  const canonical = localhostPageRedirect({
    method: request.method,
    host: request.headers.get('host'),
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    port,
  });
  if (canonical) {
    // A regra de next.config.ts redireciona localhost:PORT antes deste proxy. Chegar aqui significa
    // Host divergente da porta do build. Um 307 daqui viraria loop (ver localhostPageRedirectRule).
    const misdirected = NextResponse.json(
      { error: { code: 'use_loopback_host', message: `Abra ${canonical} (o app usa 127.0.0.1).` } },
      { status: 400 },
    );
    applySecurityHeaders(misdirected.headers, { dev, port, api: true });
    return misdirected;
  }

  const verdict = checkLocalRequest({
    method: request.method,
    host: request.headers.get('host'),
    origin: request.headers.get('origin'),
    fetchSite: request.headers.get('sec-fetch-site'),
    port,
  });

  if (!verdict.ok) {
    const denied = NextResponse.json(
      { error: { code: verdict.code, message: verdict.message } },
      { status: 403 },
    );
    applySecurityHeaders(denied.headers, { dev, port, api: true });
    return denied;
  }

  const response = NextResponse.next();
  applySecurityHeaders(response.headers, { dev, port, api });
  return response;
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
