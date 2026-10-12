import { z } from 'zod';
import { getAuthDeps } from '@/lib/auth/context';
import { errorResponse, invalidFields, jsonResponse, readJsonBody } from '@/lib/auth/route-utils';
import { startRetry } from '@/lib/sync/service';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ runId: z.number().int().positive() }).strict();

/** Repete só os módulos com falha do run indicado. Body: { runId }. 202 com o novo runId. */
export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw invalidFields(parsed.error);
    const runId = await startRetry(getAuthDeps(), parsed.data.runId);
    return jsonResponse({ ok: true, runId, status: 'running' }, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
