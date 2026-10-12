import type { ReactNode } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { ResourceTable, type ResourceTableQuery } from '@/components/resources/resource-table';
import type { ApiModuleRow } from '@/lib/queries/modules';
import type { ResourceListResult } from '@/lib/queries/resources';
import { ModuleStatusPanel } from './module-status-panel';

export const NO_INSTANCE_MESSAGE =
  'Nenhuma instância ativa. Informe o link do cliente no painel ou ative o modo demonstrativo.';
const DEFAULT_EMPTY =
  'Nenhum registro deste módulo na última execução. Os dados aparecem depois de um mapeamento concluído.';

interface ModulePageProps {
  title: string;
  description: string;
  icon: ReactNode;
  moduleKeys: readonly string[];
  apiRows: readonly ApiModuleRow[];
  resources: ResourceListResult | null;
  query: ResourceTableQuery;
  basePath: string;
  keepParams?: Record<string, string>;
  hasInstance: boolean;
  /** Segmentos e avisos exibidos entre o cabeçalho e a tabela. */
  top?: ReactNode;
  emptyMessage?: string;
}

/** Página de módulo: cabeçalho, tabela de recursos filtrada pelo módulo e painel de status dos endpoints. */
export function ModulePage({
  title,
  description,
  icon,
  moduleKeys,
  apiRows,
  resources,
  query,
  basePath,
  keepParams,
  hasInstance,
  top,
  emptyMessage,
}: ModulePageProps) {
  return (
    <div className="flex min-w-0 flex-col gap-[15px]">
      <PageHeader icon={icon} title={title} description={description} />
      {top}
      <div className="grid min-w-0 gap-[15px] lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <ResourceTable
            title="Itens mapeados"
            icon={icon}
            result={resources}
            query={query}
            basePath={basePath}
            keepParams={keepParams}
            emptyMessage={hasInstance ? (emptyMessage ?? DEFAULT_EMPTY) : NO_INSTANCE_MESSAGE}
          />
        </div>
        <ModuleStatusPanel moduleKeys={moduleKeys} rows={apiRows} hasInstance={hasInstance} />
      </div>
    </div>
  );
}
