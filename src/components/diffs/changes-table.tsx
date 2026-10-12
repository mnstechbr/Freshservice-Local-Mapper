import { ArrowLeftRight, ChevronLeft, ChevronRight, Ellipsis } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { formatInt, formatRelativeDay } from '@/lib/format';
import { moduleLabel } from '@/lib/modules/catalog';
import type { ChangeListResult } from '@/lib/queries/changes';
import type { ChangeFilters } from '@/lib/ui/filters';
import { describeChange, reviewStatusInfo } from '@/lib/ui/status';
import { cn } from '@/lib/utils';
import { ChangeTypeBadge, SEVERITY_LABELS } from './change-badges';

/** Link de página preservando os filtros atuais. */
export function changesPageHref(filters: ChangeFilters, page: number): string {
  const search = new URLSearchParams();
  if (filters.type) search.set('tipo', filters.type);
  if (filters.module) search.set('modulo', filters.module);
  if (filters.severity) search.set('severidade', filters.severity);
  if (filters.review) search.set('revisao', filters.review);
  if (filters.from) search.set('de', filters.from);
  if (filters.to) search.set('ate', filters.to);
  if (page > 1) search.set('page', String(page));
  const qs = search.toString();
  return qs ? `/diferencas?${qs}` : '/diferencas';
}

/** Lista de diferenças com paginação. Vazio: distingue "sem filtro" de "filtros sem resultado". */
export function ChangesTable({
  result,
  filters,
  filtered,
  hasInstance,
}: {
  result: ChangeListResult | null;
  filters: ChangeFilters;
  filtered: boolean;
  hasInstance: boolean;
}) {
  const emptyMessage = !hasInstance
    ? 'Nenhuma instância ativa. Ative o modo demonstrativo em Configurações para ver exemplos.'
    : filtered
      ? 'Nenhuma diferença encontrada com estes filtros.'
      : 'Nenhuma diferença detectada ainda. Elas aparecem depois de duas execuções concluídas da mesma instância.';

  return (
    <Card aria-labelledby="changes-title" className="min-w-0">
      <CardTitle
        icon={<ArrowLeftRight />}
        aside={
          result && (
            <span className="text-sm text-muted-foreground">
              {formatInt(result.total)} {result.total === 1 ? 'diferença' : 'diferenças'}
            </span>
          )
        }
      >
        <span id="changes-title">Diferenças</span>
      </CardTitle>

      <div className="mt-3 min-w-0">
        <div className="min-w-0 overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-sm">
          <thead className="border-b border-border">
            <tr className="text-left text-xs font-medium text-muted-foreground">
              <th scope="col" className="w-[150px] px-3 py-2 md:w-[236px]">Tipo</th>
              <th scope="col" className="hidden w-[180px] px-3 py-2 lg:table-cell">Módulo</th>
              <th scope="col" className="px-3 py-2">Mudança</th>
              <th scope="col" className="hidden w-[100px] px-3 py-2 lg:table-cell">Severidade</th>
              <th scope="col" className="hidden w-[130px] px-3 py-2 sm:table-cell">Revisão</th>
              <th scope="col" className="hidden w-[130px] px-3 py-2 xl:table-cell">Detectada</th>
              <th scope="col" className="w-[44px] px-2 py-2">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {result && result.rows.length > 0 ? (
              result.rows.map((row) => {
                const review = reviewStatusInfo(row.reviewStatus);
                return (
                  <tr key={row.id} className="border-b border-border/70 last:border-0 hover:bg-secondary/40">
                    <td className="px-3 py-2.5">
                      <ChangeTypeBadge type={row.changeType} />
                    </td>
                    <td className="hidden px-3 py-2.5 text-muted-foreground lg:table-cell">
                      <span className="block truncate">{moduleLabel(row.moduleKey)}</span>
                    </td>
                    <td className="min-w-0 px-3 py-2.5">
                      <Link
                        href={`/diferencas/${row.id}`}
                        className="block truncate text-foreground hover:text-primary hover:underline"
                      >
                        {describeChange(row)}
                      </Link>
                    </td>
                    <td className="hidden px-3 py-2.5 text-muted-foreground lg:table-cell">{SEVERITY_LABELS[row.severity]}</td>
                    <td className="hidden px-3 py-2.5 sm:table-cell">
                      <Badge tone={review.tone}>{review.label}</Badge>
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-2.5 text-muted-foreground xl:table-cell">
                      {formatRelativeDay(row.detectedAt)}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <Link
                        href={`/diferencas/${row.id}`}
                        aria-label={`Ver diferença ${row.id}`}
                        className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        <Ellipsis className="size-4" aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </div>

      {result && result.pageCount > 1 && (
        <nav aria-label="Paginação" className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Página {result.page} de {result.pageCount}
          </span>
          <div className="flex gap-2">
            <PageLink
              enabled={result.page > 1}
              href={changesPageHref(filters, result.page - 1)}
              label="Anterior"
              icon={<ChevronLeft className="size-4" aria-hidden="true" />}
            />
            <PageLink
              enabled={result.page < result.pageCount}
              href={changesPageHref(filters, result.page + 1)}
              label="Próxima"
              icon={<ChevronRight className="size-4" aria-hidden="true" />}
            />
          </div>
        </nav>
      )}
    </Card>
  );
}

function PageLink({ enabled, href, label, icon }: { enabled: boolean; href: string; label: string; icon: ReactNode }) {
  const className = buttonVariants({ variant: 'outline', size: 'sm' });
  if (!enabled) {
    return (
      <span aria-disabled="true" className={cn(className, 'pointer-events-none opacity-50')}>
        {label}
      </span>
    );
  }
  return (
    <Link href={href} className={className}>
      {label}
      {icon}
    </Link>
  );
}
