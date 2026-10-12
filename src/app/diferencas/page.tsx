import { ArrowLeftRight } from 'lucide-react';
import { ChangeDot } from '@/components/diffs/change-badges';
import { ChangeFilterForm } from '@/components/diffs/change-filters';
import { ChangesTable } from '@/components/diffs/changes-table';
import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { getDb } from '@/lib/db/client';
import { MODULE_KEYS, MODULES } from '@/lib/modules/catalog';
import { listChanges } from '@/lib/queries/changes';
import { getActiveInstance } from '@/lib/queries/instances';
import type { SearchParams } from '@/lib/queries/params';
import { changeRange, parseChangeFilters } from '@/lib/ui/filters';
import { changeTypeInfo } from '@/lib/ui/status';

// Lê o banco a cada requisição e nunca é pré-renderizado no build.
export const dynamic = 'force-dynamic';

const LEGEND_TYPES = ['possible_id_change', 'name_changed', 'added', 'removed', 'not_observed'] as const;
const MODULE_OPTIONS = MODULES.map((module) => ({ key: module.key, label: module.label }));

export default async function DiferencasPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const db = getDb();
  const instance = getActiveInstance(db);
  const filters = parseChangeFilters(params, MODULE_KEYS);
  const range = changeRange(filters);
  const result = instance
    ? listChanges(db, {
        instanceId: instance.id,
        type: filters.type || null,
        module: filters.module || null,
        severity: filters.severity || null,
        review: filters.review || null,
        from: range.from,
        to: range.to,
        page: filters.page,
        pageSize: 20,
      })
    : null;
  const filtered = Boolean(filters.type || filters.module || filters.severity || filters.review || filters.from || filters.to);

  return (
    <div className="flex min-w-0 flex-col gap-[15px]">
      <PageHeader
        icon={<ArrowLeftRight />}
        title="Diferenças detectadas"
        description="Mudanças entre execuções da instância ativa. A revisão é local e não altera o Freshservice."
      />
      <Card aria-label="Filtros de diferenças">
        <ChangeFilterForm filters={filters} modules={MODULE_OPTIONS} />
      </Card>
      <ChangesTable result={result} filters={filters} filtered={filtered} hasInstance={instance !== null} />
      <ul aria-label="Legenda das cores" className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
        {LEGEND_TYPES.map((type) => (
          <li key={type} className="flex items-center gap-2">
            <ChangeDot type={type} className="size-3.5" />
            {changeTypeInfo(type).label}
          </li>
        ))}
      </ul>
    </div>
  );
}
