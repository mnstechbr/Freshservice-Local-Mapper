import { Users } from 'lucide-react';
import { ModulePage } from '@/components/modules/module-page';
import { getDb } from '@/lib/db/client';
import { getActiveInstance } from '@/lib/queries/instances';
import { loadModulePage } from '@/lib/queries/module-pages';
import type { SearchParams } from '@/lib/queries/params';
import { endpointKeysOf } from '@/lib/modules/catalog';

// Lê o banco a cada requisição e nunca é pré-renderizado no build.
export const dynamic = 'force-dynamic';

const MODULE_KEYS = endpointKeysOf('users_groups');

export default async function UsuariosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const db = getDb();
  const instance = getActiveInstance(db);
  const data = loadModulePage(db, instance, params, { moduleKey: 'users_groups', moduleKeys: MODULE_KEYS });

  return (
    <ModulePage
      title="Usuários e grupos"
      description="Agentes, requisitantes e grupos visíveis com a permissão atual. Somente leitura."
      icon={<Users />}
      moduleKeys={MODULE_KEYS}
      apiRows={data.apiRows}
      resources={data.resources}
      query={data.query}
      basePath="/usuarios"
      hasInstance={instance !== null}
    />
  );
}
