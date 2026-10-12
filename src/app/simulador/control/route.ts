import { isSimulatorEnabled, SIMULATOR_HEADER } from '@/lib/simulator/config';
import { applyControl } from '@/lib/simulator/control';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 64 * 1024;
const NO_STORE = { 'cache-control': 'no-store', ...SIMULATOR_HEADER };

/** API de controle de teste. Sem FSLM_SIMULATOR=1 não existe (404). Exige JSON (bloqueia form cross-site). */
export function GET(): Response {
  if (!isSimulatorEnabled()) return new Response(null, { status: 404 });
  return Response.json({ ok: false, error: 'method_not_allowed' }, { status: 405, headers: { allow: 'POST', ...NO_STORE } });
}

export async function POST(request: Request): Promise<Response> {
  if (!isSimulatorEnabled()) return new Response(null, { status: 404 });
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return Response.json({ ok: false, error: 'unsupported_media_type' }, { status: 415, headers: NO_STORE });
  }
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return Response.json({ ok: false, error: 'payload_too_large' }, { status: 413, headers: NO_STORE });
  let input: unknown;
  try {
    input = JSON.parse(raw) as unknown;
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400, headers: NO_STORE });
  }
  const result = applyControl(input);
  return Response.json(result.body, { status: result.status, headers: NO_STORE });
}
