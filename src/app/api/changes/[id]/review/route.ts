import { z } from 'zod';
import { errorResponse, invalidFields, jsonResponse, readJsonBody } from '@/lib/auth/route-utils';
import { getAuthDeps } from '@/lib/auth/context';
import { ChangeReviewError, reviewChange } from '@/lib/diff';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    decision: z.enum(['confirm', 'reject']),
    /** Obrigatório quando a mudança tem mais de um candidato. */
    matchId: z.number().int().positive().nullable().optional(),
  })
  .strict();

const STATUS: Record<ChangeReviewError['code'], number> = {
  not_found: 404,
  not_reviewable: 409,
  conflict: 409,
  match_required: 400,
  invalid_match: 400,
};

/**
 * Revisão de uma possível troca de ID. Nunca chama o Freshservice.
 * Origem local já validada por src/proxy.ts (métodos mutáveis).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^\d+$/.test(id)) throw new ChangeReviewError('not_found', 'Mudança não encontrada.');
    const parsed = bodySchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw invalidFields(parsed.error);
    const outcome = reviewChange(getAuthDeps().db, Number(id), {
      decision: parsed.data.decision,
      matchId: parsed.data.matchId ?? null,
    });
    // Mesmo id da mudança revisada: a revisão nunca troca o id da linha.
    return jsonResponse({ changeId: outcome.changeId, status: outcome.status });
  } catch (error) {
    if (error instanceof ChangeReviewError) {
      return jsonResponse({ error: { code: error.code, message: error.message } }, STATUS[error.code]);
    }
    return errorResponse(error);
  }
}
