import { getAuthDeps } from '../../../../lib/auth/context';
import { errorResponse, jsonResponse, readJsonBody } from '../../../../lib/auth/route-utils';
import {
  DEFAULT_PROFILE_SCOPES,
  createProfile,
  listProfileRows,
  profileView,
} from '../../../../lib/auth/profiles';
import { PATH_PREFIXES, REDIRECT_HOSTS } from '../../../../lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * Perfis de integração (administração local). Não expõe client_secret: só has_secret.
 * Escopos padrão: os .view dos módulos suportados.
 */
export function GET() {
  try {
    const deps = getAuthDeps();
    return jsonResponse({
      profiles: listProfileRows(deps.db).map((row) => profileView(row, deps.port)),
      default_scopes: DEFAULT_PROFILE_SCOPES,
      redirect_hosts: REDIRECT_HOSTS,
      path_prefixes: PATH_PREFIXES,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Cria um perfil. Body: { name, org_url, client_id, client_secret, freshservice_domains: string[],
 * scopes?: string[], allow_manage_scopes?: boolean, path_prefix?: '' | '/org' (authorize, padrão '/org'),
 * token_path_prefix?: '' | '/org' (token, padrão '' = /oauth/v2/token), redirect_host?: 'localhost' | '127.0.0.1' }.
 * Resposta 201: { profile, warnings }.
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const result = await createProfile(getAuthDeps(), body);
    return jsonResponse(result, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
