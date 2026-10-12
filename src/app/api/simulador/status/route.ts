import { isSimulatorEnabled, SIMULATOR_HEADER } from '@/lib/simulator/config';

export const dynamic = 'force-dynamic';

/** {enabled:true} somente com FSLM_SIMULATOR=1. Sem a variável, 404 (o simulador não existe). */
export function GET(): Response {
  if (!isSimulatorEnabled()) return new Response(null, { status: 404 });
  return Response.json({ enabled: true }, { headers: { 'cache-control': 'no-store', ...SIMULATOR_HEADER } });
}
