import { ArrowLeftRight, ArrowUpDown, ChevronDown, ChevronUp, Ellipsis, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AutoSubmitSelect } from '@/components/resources/auto-submit-select';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatInt, formatRelativeDay } from '@/lib/format';
import { moduleLabel } from '@/lib/modules/catalog';
import type { ResourceListResult, ResourceSortKey, ResourceStatus } from '@/lib/queries/resources';
import { resourceStatusInfo } from '@/lib/ui/status';
import { cn } from '@/lib/utils';

/** Estado da busca, ordenação e página. Vem de searchParams, então funciona sem JavaScript. */
export interface ResourceTableQuery {
  q: string;
  status: ResourceStatus | '';
  sort: ResourceSortKey;
  dir: 'asc' | 'desc';
  page: number;
}

export interface ModuleFilterOption {
  value: string;
  label: string;
}

interface ResourceTableProps {
  title: string;
  icon: ReactNode;
  result: ResourceListResult | null;
  query: ResourceTableQuery;
  /** Rota onde a tabela está (formulário e links). */
  basePath: string;
  /** Parâmetros extras preservados em busca, ordenação e paginação. */
  keepParams?: Record<string, string>;
  emptyMessage: string;
  /** Placeholder do campo de busca. */
  searchPlaceholder?: string;
  /** Seletor de módulo (parâmetro "modulo"). Quando informado, o valor segue nos links de ordenação e paginação. */
  moduleFilter?: { value: string; options: readonly ModuleFilterOption[] };
  /** Linhas e ações mais baixas, para caber no painel inicial (medidas da referência). */
  dense?: boolean;
}

type Column = { key: ResourceSortKey; label: string; className: string };

// Colunas ocultas por largura para a tabela caber sem rolagem horizontal da página.
const COLUMNS: readonly Column[] = [
  { key: 'id', label: 'ID atual', className: 'w-[72px] xl:w-[96px]' },
  { key: 'name', label: 'Nome', className: '' },
  { key: 'category', label: 'Categoria', className: 'hidden w-[120px] xl:table-cell' },
  { key: 'module', label: 'Módulo', className: 'hidden w-[128px] 2xl:table-cell' },
  { key: 'lastSeen', label: 'Última coleta', className: 'hidden w-[120px] 2xl:table-cell' },
  { key: 'status', label: 'Status', className: 'w-[112px] sm:w-[128px]' },
];

const STATUS_OPTIONS: readonly { value: ResourceStatus; label: string }[] = [
  { value: 'new', label: 'Novo' },
  { value: 'updated', label: 'Atualizado' },
  { value: 'unchanged', label: 'Sem alteração' },
];

const SELECT_CLASS =
  'h-9 max-w-[190px] rounded-lg border border-input bg-card px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25';

function buildHref(basePath: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

function SortHeader({
  column,
  query,
  hrefFor,
}: {
  column: Column;
  query: ResourceTableQuery;
  hrefFor: (overrides: Record<string, string>) => string;
}) {
  const active = query.sort === column.key;
  const nextDir = active && query.dir === 'asc' ? 'desc' : 'asc';
  const Icon = !active ? ArrowUpDown : query.dir === 'asc' ? ChevronUp : ChevronDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (query.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cn('whitespace-nowrap px-3 py-1.5 text-left align-middle text-xs font-medium text-muted-foreground', column.className)}
    >
      <Link
        href={hrefFor({ sort: column.key, dir: nextDir, page: '1' })}
        className={cn('inline-flex items-center gap-1 hover:text-foreground', active && 'text-foreground')}
      >
        {column.label}
        <Icon className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
      </Link>
    </th>
  );
}

/** Tabela de recursos mapeados, server-rendered: busca, filtros, ordenação e paginação. */
export function ResourceTable({
  title,
  icon,
  result,
  query,
  basePath,
  keepParams = {},
  emptyMessage,
  searchPlaceholder = 'Buscar por nome ou ID...',
  moduleFilter,
  dense = false,
}: ResourceTableProps) {
  const current: Record<string, string> = {
    q: query.q,
    status: query.status,
    sort: query.sort,
    dir: query.dir,
    ...(moduleFilter ? { modulo: moduleFilter.value } : {}),
    ...keepParams,
  };
  const hrefFor = (overrides: Record<string, string>) =>
    buildHref(basePath, { ...current, page: String(query.page), ...overrides });
  const hasFilter = query.q !== '' || query.status !== '';
  const clearHref = buildHref(basePath, {
    ...keepParams,
    ...(moduleFilter ? { modulo: moduleFilter.value } : {}),
    sort: query.sort,
    dir: query.dir,
  });
  const toggleHref = hrefFor({ dir: query.dir === 'asc' ? 'desc' : 'asc', page: '1' });
  const toggleLabel = query.dir === 'asc' ? 'Ordem crescente. Alternar para decrescente' : 'Ordem decrescente. Alternar para crescente';

  return (
    <Card aria-labelledby="resource-table-title" className={dense ? 'p-3' : undefined}>
      <CardTitle
        icon={icon}
        aside={
          <form action={basePath} method="get" role="search" className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
            {Object.entries(keepParams).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <input type="hidden" name="sort" value={query.sort} />
            <input type="hidden" name="dir" value={query.dir} />
            <div className="relative min-w-0 flex-1 sm:w-[220px] sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                name="q"
                type="search"
                defaultValue={query.q}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-9 pl-9"
              />
            </div>
            {moduleFilter && (
              <AutoSubmitSelect
                name="modulo"
                defaultValue={moduleFilter.value}
                aria-label="Filtrar por módulo"
                className={SELECT_CLASS}
              >
                {moduleFilter.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </AutoSubmitSelect>
            )}
            <AutoSubmitSelect name="status" defaultValue={query.status} aria-label="Filtrar por status" className={SELECT_CLASS}>
              <option value="">Todos os status</option>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </AutoSubmitSelect>
            <Button type="submit" variant="ghost" size="icon" className="size-9" aria-label="Aplicar busca e filtro">
              <SlidersHorizontal />
            </Button>
            <Link
              href={toggleHref}
              aria-label={toggleLabel}
              title={toggleLabel}
              className={cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'size-9')}
            >
              <ArrowLeftRight />
            </Link>
            {hasFilter && (
              <Link
                href={clearHref}
                aria-label="Limpar busca e filtros"
                title="Limpar busca e filtros"
                className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'size-9')}
              >
                <RotateCcw />
              </Link>
            )}
          </form>
        }
      >
        <span id="resource-table-title">{title}</span>
      </CardTitle>

      <div className={cn('min-w-0 overflow-x-auto', dense ? 'mt-2' : 'mt-3')}>
        <table
          className={cn(
            'w-full table-fixed border-collapse text-sm',
            // Seletores de descendente vencem py-1.5 e py-2 das células; o ícone de ação fica com 24 px.
            dense && '[&_td]:py-0.5 [&_th]:py-1',
          )}
        >
          <thead className="border-b border-border">
            <tr>
              {COLUMNS.map((column) => (
                <SortHeader key={column.key} column={column} query={query} hrefFor={hrefFor} />
              ))}
              <th scope="col" className="hidden w-[40px] sm:table-cell">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {result && result.rows.length > 0 ? (
              result.rows.map((row) => {
                const status = resourceStatusInfo(row.status);
                const name = row.name ?? row.externalId;
                return (
                  <tr key={row.id} className="border-b border-border/70 last:border-0 hover:bg-secondary/40">
                    <td className="px-3 py-1.5 font-medium text-foreground">{row.externalId}</td>
                    <td className="min-w-0 px-3 py-1.5">
                      <Link
                        href={`/recursos/${row.id}`}
                        className="block truncate text-foreground hover:text-primary hover:underline"
                      >
                        {row.name ?? '—'}
                      </Link>
                    </td>
                    <td className="hidden px-3 py-1.5 text-muted-foreground xl:table-cell">
                      <span className="block truncate">{row.category ?? '—'}</span>
                    </td>
                    <td className="hidden px-3 py-1.5 text-xs text-muted-foreground 2xl:table-cell">
                      <span className="block truncate">{moduleLabel(row.moduleKey)}</span>
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-1.5 text-muted-foreground 2xl:table-cell">
                      {formatRelativeDay(row.lastSeenAt)}
                    </td>
                    <td className="px-3 py-1.5">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    <td className="hidden px-2 py-2 text-right sm:table-cell">
                      <Link
                        href={`/recursos/${row.id}`}
                        aria-label={`Ver detalhes de ${name}`}
                        className={cn(
                          'inline-flex items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground',
                          dense ? 'size-6' : 'size-7',
                        )}
                      >
                        <Ellipsis className="size-4" aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-3 py-5 text-center text-sm text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {result && (
        <div
          className={cn(
            'flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground',
            dense ? 'mt-1.5 [&_a]:h-7 [&_span[aria-disabled]]:h-7' : 'mt-2',
          )}
        >
          <span>
            {formatInt(result.total)} {result.total === 1 ? 'recurso' : 'recursos'} · página {result.page} de {result.pageCount}
          </span>
          <div className="flex gap-2">
            {result.page > 1 ? (
              <Link href={hrefFor({ page: String(result.page - 1) })} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Anterior
              </Link>
            ) : (
              <span aria-disabled="true" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'pointer-events-none opacity-50')}>
                Anterior
              </span>
            )}
            {result.page < result.pageCount ? (
              <Link href={hrefFor({ page: String(result.page + 1) })} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Próxima
              </Link>
            ) : (
              <span aria-disabled="true" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'pointer-events-none opacity-50')}>
                Próxima
              </span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
