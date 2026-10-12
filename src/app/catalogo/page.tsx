import { Package } from 'lucide-react';
import { ModulePage } from '@/components/modules/module-page';
import { getDb } from '@/lib/db/client';
import { getActiveInstance } from '@/lib/queries/instances';
import { loadModulePage } from '@/lib/queries/module-pages';
import type { SearchParams } from '@/lib/queries/params';
import { endpointKeysOf } from '@/lib/modules/catalog';

// Lê o banco a cada requisição e nunca é pré-renderizado no build.
export const dynamic = 'force-dynamic';

const MODULE_KEYS = endpointKeysOf('service_catalog');

export default async function CatalogoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const db = getDb();
  const instance = getActiveInstance(db);
  const data = loadModulePage(db, instance, params, { moduleKey: 'service_catalog', moduleKeys: MODULE_KEYS });

  return (
    <ModulePage
      title="Catálogo de serviços"
      description="Itens do catálogo de serviços, somente leitura."
      icon={<Package />}
      moduleKeys={MODULE_KEYS}
      apiRows={data.apiRows}
      resources={data.resources}
      query={data.query}
      basePath="/catalogo"
      hasInstance={instance !== null}
    />
  );
}
