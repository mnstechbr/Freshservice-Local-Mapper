import { getAuthDeps } from '../../../../../lib/auth/context';
import { AuthError } from '../../../../../lib/auth/errors';
import { errorResponse, jsonResponse, readJsonBody } from '../../../../../lib/auth/route-utils';
import { deleteProfile, updateProfile } from '../../../../../lib/auth/profiles';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

async function profileId(context: Context): Promise<number> {
  const { id } = await context.params;
  const value = Number(id);
  if (!Number.isInteger(value) || value <= 0) {
    throw new AuthError('invalid_input', 400, 'Identificador de perfil inválido.');
  }
  return value;
}

/** Atualiza um perfil. Campos ausentes mantêm o valor salvo. client_secret só é gravado se enviado. */
export async function PUT(request: Request, context: Context) {
  try {
    const id = await profileId(context);
    const body = await readJsonBody(request);
    return jsonResponse(await updateProfile(getAuthDeps(), id, body));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Remove um perfil (e o segredo no cofre). Recusa se houver conexão usando o perfil. */
export async function DELETE(_request: Request, context: Context) {
  try {
    const id = await profileId(context);
    await deleteProfile(getAuthDeps(), id);
    return jsonResponse({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
