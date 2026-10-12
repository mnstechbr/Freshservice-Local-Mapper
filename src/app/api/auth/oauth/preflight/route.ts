import { getAuthDeps } from '../../../../../lib/auth/context';
import { oauthPreflight } from '../../../../../lib/auth/oauth';
import { errorResponse, jsonResponse } from '../../../../../lib/auth/route-utils';

export const dynamic = 'force-dynamic';

/**
 * Pré-verificação antes de abrir a aba de autorização. Não contacta o Freshworks e não grava nada.
 * Sem parâmetros: instância ativa. Com ?url=<link do cliente>: o link digitado, ainda não salvo
 * (link inválido: 400 com code invalid_url).
 * Resposta: { ready, status, message, profile_name, redirect_host, redirect_uri, start_url, app_url }.
 * start_url é o endereço para abrir em nova aba (null quando a instância não está salva ou não é a ativa).
 * app_url é o painel canônico em 127.0.0.1.
 */
export function GET(request: Request) {
  try {
    const instanceUrl = new URL(request.url).searchParams.get('url');
    return jsonResponse(oauthPreflight(getAuthDeps(), instanceUrl ?? undefined));
  } catch (error) {
    return errorResponse(error);
  }
}
