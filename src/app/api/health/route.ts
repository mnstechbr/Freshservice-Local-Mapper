import { getDbHealth } from '../../../lib/db/status';

// Sempre avaliado na requisição (nunca cacheado nem executado no build).
export const dynamic = 'force-dynamic';

export function GET() {
  const health = getDbHealth();
  return Response.json(health, {
    status: health.db === 'ok' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
