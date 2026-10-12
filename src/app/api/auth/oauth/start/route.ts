import { getAuthDeps } from '../../../../../lib/auth/context';
import { AuthError } from '../../../../../lib/auth/errors';
import { ADMIN_CONFIG_MISSING_MESSAGE, consumeOAuthLaunch, oauthPreflight, startOAuth } from '../../../../../lib/auth/oauth';
import { errorResponse, jsonResponse } from '../../../../../lib/auth/route-utils';
import { oauthStartHostMessage, oauthStartRedirectTarget } from '../../../../../lib/security/origin';

export const dynamic = 'force-dynamic';

function redirect(location: string, setCookie?: string): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  if (setCookie) headers.append('Set-Cookie', setCookie);
  return new Response(null, { status: 303, headers });
}

/**
 * Início do OAuth. Aceita Host localhost:PORT ou 127.0.0.1:PORT.
 * - Se o Host difere do redirect_host do perfil, responde 303 para a mesma URL no host do perfil,
 *   antes de gravar o cookie de state (cookie e retorno precisam do mesmo host).
 * - Navegação de topo (Sec-Fetch-Mode: navigate): 303 direto para a URL de autorização.
 * - Demais chamadas: JSON com authorization_url (e o cookie de state).
 * Recusa origem cruzada, porque este GET altera o estado.
 */
export async function GET(request: Request) {
  try {
    const deps = getAuthDeps();
    const host = request.headers.get('host');
    const hostError = oauthStartHostMessage(host, deps.port);
    if (hostError) throw new AuthError('use_loopback_host', 400, hostError);

    const pre = oauthPreflight(deps);
    if (!pre.ready || pre.redirect_host === null) {
      throw new AuthError('admin_config_missing', 409, pre.message || ADMIN_CONFIG_MISSING_MESSAGE);
    }
    const target = new URL(request.url);
    const location = oauthStartRedirectTarget(host, pre.redirect_host, deps.port, `${target.pathname}${target.search}`);
    if (location) {
      // Nenhum estado mudou aqui: a checagem de origem fica para o host definitivo.
      return redirect(location);
    }

    const origin = request.headers.get('origin');
    if (origin && origin !== `http://${host?.toLowerCase()}`) {
      throw new AuthError('forbidden_origin', 403, 'Requisição de origem cruzada recusada.');
    }
    const site = request.headers.get('sec-fetch-site');
    if (site && site !== 'same-origin' && site !== 'none') {
      throw new AuthError('forbidden_origin', 403, 'Requisição de origem cruzada recusada.');
    }
    const ticket = target.searchParams.get('launch');
    if (ticket !== null) consumeOAuthLaunch(deps, ticket, `http://${host?.toLowerCase()}`);
    const { result, setCookie } = await startOAuth(deps);
    if (request.headers.get('sec-fetch-mode') === 'navigate' && result.authorization_url) {
      return redirect(result.authorization_url, setCookie);
    }
    return jsonResponse(result, 200, setCookie);
  } catch (error) {
    return errorResponse(error);
  }
}
