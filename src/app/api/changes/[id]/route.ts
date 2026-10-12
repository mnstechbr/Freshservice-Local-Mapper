import { errorResponse, jsonResponse } from '@/lib/auth/route-utils';
import { getDb } from '@/lib/db/client';
import { getChangeDetail } from '@/lib/queries/changes';

export const dynamic = 'force-dynamic';

/** Detalhe de uma mudança: lados, campos (calculados a partir das versões) e candidatos. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const changeId = /^\d+$/.test(id) ? Number(id) : NaN;
    const detail = Number.isSafeInteger(changeId) ? getChangeDetail(getDb(), changeId) : null;
    if (!detail) {
      return jsonResponse({ error: { code: 'not_found', message: 'Mudança não encontrada.' } }, 404);
    }
    return jsonResponse(detail);
  } catch (error) {
    return errorResponse(error);
  }
}
