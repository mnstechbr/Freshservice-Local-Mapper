import { getAuthDeps } from '../../../../../lib/auth/context';
import { clearStateCookie, doneLocation, handleOAuthCallback } from '../../../../../lib/auth/oauth';

import { localHosts } from '../../../../../lib/security/origin';

export const dynamic = 'force-dynamic';

function redirectTo(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: location,
      'Set-Cookie': clearStateCookie(),
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Retorno do Freshworks. Redireciona para /auth/concluido?conn=<estado> e apaga o cookie de state.
 * Nenhum código, token ou parâmetro da URL aparece na resposta.
 */
export async function GET(request: Request) {
  try {
    const deps = getAuthDeps();
    const host = request.headers.get('host')?.toLowerCase();
    if (!host || !localHosts(deps.port).includes(host)) return redirectTo(doneLocation('error'));
    // Next pode montar request.url com localhost mesmo quando o Host público é 127.0.0.1.
    // Host tem allowlist estrita; nunca usamos X-Forwarded-Host para escolher a origem.
    const callbackUrl = new URL(request.url);
    callbackUrl.host = host;
    const location = await handleOAuthCallback(deps, callbackUrl, request.headers.get('cookie'));
    return redirectTo(location);
  } catch (error) {
    console.error(
      '[fslm] Falha no retorno OAuth:',
      error instanceof Error ? error.name : typeof error,
    );
    return redirectTo(doneLocation('connection_error'));
  }
}
