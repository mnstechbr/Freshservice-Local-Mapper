import { jsonResponse } from '../../../../../lib/auth/route-utils';

export const dynamic = 'force-dynamic';

/**
 * Substituído pelos perfis de integração (configuração global removida). A configuração OAuth agora
 * fica em /api/admin/integration-profiles. A migração da configuração anterior é automática.
 */
function gone() {
  return jsonResponse(
    {
      error: {
        code: 'moved',
        message: 'Configuração OAuth movida para /api/admin/integration-profiles (perfis de integração).',
      },
    },
    410,
  );
}

export function GET() {
  return gone();
}

export function POST() {
  return gone();
}
