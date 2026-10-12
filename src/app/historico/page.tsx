import { Clock, Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { RunPairForm } from '@/components/history/run-pair-form';
import { Badge } from '@/components/ui/badge';
import { Card, CardTitle } from '@/components/ui/card';
import { getDb } from '@/lib/db/client';
import { formatDateTime, formatDuration, formatInt } from '@/lib/format';
import { getActiveInstance } from '@/lib/queries/instances';
import { listSyncRuns } from '@/lib/queries/runs';
import { syncRunStatusInfo } from '@/lib/ui/status';

// Lê o banco a cada requisição e nunca é pré-renderizado no build.
export const dynamic = 'force-dynamic';

export default async function HistoricoPage() {
  const db = getDb();
  const instance = getActiveInstance(db);
  const runs = instance ? listSyncRuns(db, instance.id, 50) : [];

  return (
    <div className="flex min-w-0 flex-col gap-[15px]">
      <PageHeader
        icon={<Clock />}
        title="Histórico de sincronização"
        description="Execuções de mapeamento da instância ativa, da mais recente para a mais antiga."
      />

      <Card aria-labelledby="runs-title" className="min-w-0">
        <CardTitle icon={<Clock />} aside={<RunPairForm runs={runs} />}>
          <span id="runs-title">Execuções</span>
        </CardTitle>

        <div className="mt-3 min-w-0">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead className="border-b border-border text-left text-xs font-medium text-muted-foreground">
              <tr>
                <th scope="col" className="w-[64px] px-2 py-2">ID</th>
                <th scope="col" className="hidden px-2 py-2 xl:table-cell">Instância</th>
                <th scope="col" className="hidden px-2 py-2 lg:table-cell">Identidade</th>
                <th scope="col" className="w-[150px] px-2 py-2 md:w-[170px]">Início</th>
                <th scope="col" className="hidden px-2 py-2 md:table-cell">Término</th>
                <th scope="col" className="hidden w-[90px] px-2 py-2 lg:table-cell">Duração</th>
                <th scope="col" className="hidden w-[100px] px-2 py-2 lg:table-cell">Módulos</th>
                <th scope="col" className="hidden w-[90px] px-2 py-2 md:table-cell">Registros</th>
                <th scope="col" className="hidden w-[80px] px-2 py-2 md:table-cell">Falhas</th>
                <th scope="col" className="w-[120px] px-2 py-2">Status</th>
                <th scope="col" className="hidden w-[100px] px-2 py-2 sm:table-cell">Alterações</th>
                <th scope="col" className="w-[44px] px-2 py-2">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.length > 0 ? (
                runs.map((run) => {
                  const status = syncRunStatusInfo(run.status);
                  return (
                    <tr key={run.id} className="border-b border-border/70 last:border-0 hover:bg-secondary/40">
                      <td className="px-2 py-2.5 font-medium text-foreground">#{run.id}</td>
                      <td className="hidden px-2 py-2.5 text-muted-foreground xl:table-cell">
                        <span className="block truncate">{instance?.displayName}</span>
                      </td>
                      <td className="hidden px-2 py-2.5 text-muted-foreground lg:table-cell">
                        <span className="block truncate">{run.identityLabel}</span>
                      </td>
                      <td className="px-2 py-2.5 text-muted-foreground">
                        <span className="block truncate">{formatDateTime(run.startedAt)}</span>
                      </td>
                      <td className="hidden whitespace-nowrap px-2 py-2.5 text-muted-foreground md:table-cell">
                        {formatDateTime(run.finishedAt)}
                      </td>
                      <td className="hidden whitespace-nowrap px-2 py-2.5 text-muted-foreground lg:table-cell">
                        {formatDuration(run.startedAt, run.finishedAt)}
                      </td>
                      <td className="hidden px-2 py-2.5 text-muted-foreground lg:table-cell">
                        {formatInt(run.modulesProcessed)} de {formatInt(run.modulesRequested.length)}
                      </td>
                      <td className="hidden px-2 py-2.5 text-muted-foreground md:table-cell">{formatInt(run.recordsCount)}</td>
                      <td className="hidden px-2 py-2.5 text-muted-foreground md:table-cell">{formatInt(run.failuresCount)}</td>
                      <td className="px-2 py-2.5">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                      <td className="hidden px-2 py-2.5 text-muted-foreground sm:table-cell">{formatInt(run.changesCount)}</td>
                      <td className="px-1 py-2.5 text-right">
                        <Link
                          href={`/historico/${run.id}`}
                          aria-label={`Ver detalhes da execução ${run.id}`}
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
                  <td colSpan={12} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {instance
                      ? 'Nenhuma execução ainda. O histórico aparece depois da primeira sincronização.'
                      : 'Nenhuma instância ativa. Ative o modo demonstrativo em Configurações para ver exemplos.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
