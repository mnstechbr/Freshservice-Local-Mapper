import { FileText, Laptop } from 'lucide-react';
import { ChangesPanel } from '@/components/dashboard/changes-panel';
import { ConnectionCard } from '@/components/dashboard/connection-card';
import { HowItWorks } from '@/components/dashboard/how-it-works';
import { type SyncSummary, SyncCard } from '@/components/dashboard/sync-card';
import { type ResourceTableQuery, ResourceTable } from '@/components/resources/resource-table';
import { getDb } from '@/lib/db/client';
import { formatRelativeDay } from '@/lib/format';
import { listChangesForRun } from '@/lib/queries/changes';
import { getActiveInstance } from '@/lib/queries/instances';
import { getDashboardStats } from '@/lib/queries/dashboard';
import { enumParam, firstParam, pageParam, type SearchParams, textParam } from '@/lib/queries/params';
import { listResources, type ResourceListResult, RESOURCE_SORT_KEYS } from '@/lib/queries/resources';

// Lê o banco a cada requisição e nunca é pré-renderizado no build.
export const dynamic = 'force-dynamic';

const RESOURCE_STATUSES = ['new', 'updated', 'unchanged'] as const;

/** Três linhas, como na referência: tabela e "Diferenças detectadas" cabem em 1672x868. */
const DASHBOARD_PAGE_SIZE = 3;

/** Valor "all" é explícito porque ausência do parâmetro significa o padrão (catálogo de serviços). */
const ALL_MODULES = 'all';
const DEFAULT_MODULE = 'service_catalog';
const MODULE_OPTIONS = [
  { value: ALL_MODULES, label: 'Todos os módulos' },
  { value: 'service_catalog', label: 'Catálogo de serviços' },
  { value: 'knowledge_base', label: 'Base de conhecimento' },
  { value: 'tickets', label: 'Tickets' },
  { value: 'users_groups', label: 'Usuários e grupos' },
  { value: 'assets', label: 'Ativos / CMDB' },
] as const;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const db = getDb();
  const instance = getActiveInstance(db);

  const requestedModule = firstParam(params, 'modulo');
  const moduleValue =
    requestedModule === undefined
      ? DEFAULT_MODULE
      : MODULE_OPTIONS.some((option) => option.value === requestedModule)
        ? requestedModule
        : ALL_MODULES;
  const isCatalog = moduleValue === DEFAULT_MODULE;
  const tableTitle =
    MODULE_OPTIONS.find((option) => option.value === moduleValue && option.value !== ALL_MODULES)?.label ?? 'Recursos mapeados';

  const query: ResourceTableQuery = {
    q: textParam(firstParam(params, 'q')) ?? '',
    status: enumParam(firstParam(params, 'status'), RESOURCE_STATUSES) ?? '',
    sort: enumParam(firstParam(params, 'sort'), RESOURCE_SORT_KEYS) ?? 'id',
    dir: firstParam(params, 'dir') === 'desc' ? 'desc' : 'asc',
    page: pageParam(firstParam(params, 'page')),
  };

  const stats = instance ? getDashboardStats(db, instance.id) : null;
  const lastRunId = stats?.lastRun?.id ?? null;
  const changes = instance && lastRunId !== null ? listChangesForRun(db, lastRunId, 4) : [];
  const resources: ResourceListResult | null = instance
    ? listResources(db, {
        instanceId: instance.id,
        module: moduleValue === ALL_MODULES ? null : moduleValue,
        search: query.q || null,
        status: query.status || null,
        sort: query.sort,
        dir: query.dir,
        page: query.page,
        pageSize: DASHBOARD_PAGE_SIZE,
        minPageSize: DASHBOARD_PAGE_SIZE,
      })
    : null;

  const summary: SyncSummary = {
    hasInstance: instance !== null,
    lastRunLabel: stats?.lastRun ? formatRelativeDay(stats.lastRun.finishedAt) : null,
    lastRunCancelled: stats?.lastRun?.status === 'cancelled',
    itemsCollected: stats?.itemsCollected ?? 0,
    changesDetected: stats?.changesDetected ?? 0,
    accessibleModules: stats?.accessibleModules ?? 0,
    accessibleEndpoints: stats?.accessibleEndpoints ?? 0,
    totalEndpoints: stats?.totalEndpoints ?? 0,
  };

  return (
    <div className="flex min-w-0 flex-col gap-3 lg:gap-3">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-[30px] sm:leading-tight">
            Mapeador Local Freshservice
          </h1>
          <p className="mt-0.5 text-[15px] text-muted-foreground sm:text-[17px]">
            Inventário, sincronização e detecção de mudanças — tudo local no seu computador
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 rounded-lg bg-badge-local px-4 py-1.5 text-sm text-foreground">
          <Laptop className="size-7 shrink-0 text-primary" aria-hidden="true" />
          <div className="leading-snug">
            <p className="font-medium">Aplicação local</p>
            <p>sem nuvem adicional</p>
            <p>somente leitura no Freshservice</p>
          </div>
        </div>
      </header>

      <ConnectionCard initialBaseUrl={instance?.baseUrl ?? ''} isDemo={instance?.isDemo ?? false} />

      <SyncCard summary={summary} />

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-3 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-3 lg:gap-3">
          <ResourceTable
            title={tableTitle}
            icon={<FileText />}
            result={resources}
            query={query}
            basePath="/"
            searchPlaceholder={isCatalog ? 'Buscar serviços...' : 'Buscar por nome ou ID...'}
            moduleFilter={{ value: moduleValue, options: MODULE_OPTIONS }}
            dense
            emptyMessage={
              instance
                ? 'Nenhum recurso mapeado ainda. Use "Mapear tudo" quando a conexão estiver ativa.'
                : 'Nenhuma instância ativa. Informe o link do cliente acima ou ative o modo demonstrativo.'
            }
          />
          <ChangesPanel changes={changes} total={summary.changesDetected} hasRun={lastRunId !== null} />
        </div>
        <HowItWorks isDemo={instance?.isDemo ?? false} />
      </div>
    </div>
  );
}
