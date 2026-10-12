import { ScrollText } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { JsonTree } from '@/components/resources/json-tree';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AUDIT_LEVELS } from '@/lib/db/schema';
import { getDb } from '@/lib/db/client';
import { formatDateTime, formatInt } from '@/lib/format';
import { type AuditLevel, listAuditEvents } from '@/lib/queries/audit';
import { getActiveInstance } from '@/lib/queries/instances';
import type { SearchParams } from '@/lib/queries/params';
import { type AuditFilters, parseAuditFilters } from '@/lib/ui/filters';
import { cn } from '@/lib/utils';

// Lê o banco a cada requisição e nunca é pré-renderizado no build.
export const dynamic = 'force-dynamic';

const LEVEL_LABELS: Record<AuditLevel, string> = { debug: 'Depuração', info: 'Informação', warn: 'Atenção', error: 'Erro' };
const LEVEL_TONE: Record<AuditLevel, 'neutral' | 'info' | 'warning' | 'danger'> = {
  debug: 'neutral',
  info: 'info',
  warn: 'warning',
  error: 'danger',
};
const SELECT_CLASS =
  'h-[42px] w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25';

function pageHref(filters: AuditFilters, page: number): string {
  const search = new URLSearchParams();
  if (filters.level) search.set('nivel', filters.level);
  if (filters.eventType) search.set('tipo', filters.eventType);
  if (filters.runId) search.set('run', String(filters.runId));
  if (page > 1) search.set('page', String(page));
  const qs = search.toString();
  return qs ? `/logs?${qs}` : '/logs';
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

/** Eventos de auditoria da instância ativa. O contexto já vem redigido pelo logger e é exibido escapado. */
export default async function LogsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const filters = parseAuditFilters(params);
  const db = getDb();
  const instance = getActiveInstance(db);
  const result = instance
    ? listAuditEvents(db, {
        instanceId: instance.id,
        level: filters.level || null,
        eventType: filters.eventType || null,
        runId: filters.runId,
        page: filters.page,
        pageSize: 25,
      })
    : null;

  return (
    <div className="flex min-w-0 flex-col gap-[15px]">
      <PageHeader
        icon={<ScrollText />}
        title="Logs de sincronização"
        description="Eventos registrados pela aplicação. Segredos e credenciais já são removidos antes de gravar."
      />

      <Card aria-label="Filtros de logs">
        <form action="/logs" method="get" role="search" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Nível">
            <select name="nivel" defaultValue={filters.level} className={SELECT_CLASS}>
              <option value="">Todos os níveis</option>
              {AUDIT_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {LEVEL_LABELS[level]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tipo de evento">
            <Input name="tipo" type="text" maxLength={60} defaultValue={filters.eventType} placeholder="Ex.: sync" />
          </Field>
          <Field label="Execução">
            <Input name="run" type="number" min={1} defaultValue={filters.runId ?? ''} placeholder="Ex.: 2" />
          </Field>
          <div className="flex items-end gap-2">
            <button type="submit" className={cn(buttonVariants({ variant: 'default' }), 'flex-1 md:flex-none')}>
              Aplicar
            </button>
            <Link href="/logs" className={buttonVariants({ variant: 'outline' })}>
              Limpar
            </Link>
          </div>
        </form>
      </Card>

      <Card aria-labelledby="logs-title" className="min-w-0">
        <CardTitle
          icon={<ScrollText />}
          aside={result && <span className="text-sm text-muted-foreground">{formatInt(result.total)} eventos</span>}
        >
          <span id="logs-title">Eventos</span>
        </CardTitle>
        <div className="mt-3 min-w-0">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead className="border-b border-border text-left text-xs font-medium text-muted-foreground">
              <tr>
                <th scope="col" className="w-[130px] px-2 py-2 md:w-[160px]">Data</th>
                <th scope="col" className="w-[110px] px-2 py-2">Nível</th>
                <th scope="col" className="hidden w-[150px] px-2 py-2 md:table-cell">Tipo</th>
                <th scope="col" className="px-2 py-2">Mensagem</th>
                <th scope="col" className="hidden w-[80px] px-2 py-2 sm:table-cell">Execução</th>
              </tr>
            </thead>
            <tbody>
              {result && result.rows.length > 0 ? (
                result.rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/70 align-top last:border-0">
                    <td className="whitespace-nowrap px-2 py-2.5 text-muted-foreground">{formatDateTime(row.createdAt)}</td>
                    <td className="px-2 py-2.5">
                      <Badge tone={LEVEL_TONE[row.level]}>{LEVEL_LABELS[row.level]}</Badge>
                    </td>
                    <td className="hidden break-all px-2 py-2.5 text-muted-foreground md:table-cell">{row.eventType}</td>
                    <td className="min-w-0 px-2 py-2.5">
                      <p className="break-words text-foreground">{row.message}</p>
                      {row.context && (
                        <details className="mt-1.5 text-xs text-muted-foreground">
                          <summary className="cursor-pointer text-primary hover:underline">Contexto</summary>
                          <div className="mt-2 min-w-0">
                            <JsonTree value={row.context} />
                          </div>
                        </details>
                      )}
                    </td>
                    <td className="hidden px-2 py-2.5 text-muted-foreground sm:table-cell">
                      {row.runId ? (
                        <Link href={`/historico/${row.runId}`} className="text-primary hover:underline">
                          #{row.runId}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {instance
                      ? 'Nenhum evento com estes filtros.'
                      : 'Nenhuma instância ativa. Ative o modo demonstrativo em Configurações para ver exemplos.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {result && result.pageCount > 1 && (
          <nav aria-label="Paginação" className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              Página {result.page} de {result.pageCount}
            </span>
            <div className="flex gap-2">
              {result.page > 1 && (
                <Link href={pageHref(filters, result.page - 1)} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  Anterior
                </Link>
              )}
              {result.page < result.pageCount && (
                <Link href={pageHref(filters, result.page + 1)} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  Próxima
                </Link>
              )}
            </div>
          </nav>
        )}
      </Card>
    </div>
  );
}
