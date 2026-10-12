// Diagnóstico do ambiente local (SO, Node.js, dependências, banco, cofre, pasta de dados e bootstrap).
// NÃO confundir com /api/diagnostics: aquela rota diagnostica as conexões com o Freshservice.
import { collectEnvironmentDiagnostics } from '../../../lib/environment/diagnostics';

// Sempre avaliado na requisição (nunca cacheado nem executado no build).
export const dynamic = 'force-dynamic';

export async function GET() {
  const report = await collectEnvironmentDiagnostics();
  return Response.json(report, { headers: { 'Cache-Control': 'no-store' } });
}
