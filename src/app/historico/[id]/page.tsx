import { Clock, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { RetryFailedButton } from '@/components/history/retry-failed-button';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardTitle } from '@/components/ui/card';
import { getDb } from '@/lib/db/client';
import { formatDateTime, formatDuration, formatInt } from '@/lib/format';
import { moduleLabel } from '@/lib/modules/catalog';
import { listModuleResults } from '@/lib/queries/history';
import { getActiveInstance } from '@/lib/queries/instances';
import { getSyncRun } from '@/lib/queries/runs';
import { moduleResultInfo, syncRunStatusInfo } from '@/lib/ui/status';

// Lê o banco a cada requisição e nunca é pré-renderizado no build.
export const dynamic = 'force-dynamic';

const KIND_LABELS: Record<'full' | 'resync', string> = { full: 'Mapeamento completo', resync: 'Ressincronização' };

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words font-medium text-foreground">{children}</dd>
    </div>
  );
}

export default async function HistoricoDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  if (!/^[1-9]\d{0,9}$/.test(rawId)) notFound();
  const db = getDb();
  const instance = getActiveInstance(db);
  if (!instance) notFound();
  const run = getSyncRun(db, instance.id, Number(rawId));
  if (!run) notFound();

  const modules = listModuleResults(db, run.id);
  const failed = modules.filter((module) => module.status === 'failed');
  const status = syncRunStatusInfo(run.status);

  return (
    <div className="flex min-w-0 flex-col gap-[15px]">
      <PageHeader
        icon={<Clock />}
        title={`Execução #${run.id}`}
        description={`${KIND_LABELS[run.kind]} · ${formatDateTime(run.startedAt)}`}
        aside={<Badge tone={status.tone}>{status.label}</Badge>}
      />

      <div className="grid min-w-0 gap-[15px] lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card aria-labelledby="modulos-title" className="min-w-0">
          <CardTitle icon={<Clock />}>
            <span id="modulos-title">Resultado por módulo</span>
          </CardTitle>
          <div className="mt-3 min-w-0">
            <table className="w-full table-fixed border-collapse text-sm">
              <thead className="border-b border-border text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th scope="col" className="w-[38%] px-2 py-2 md:w-[30%]">Módulo</th>
                  <th scope="col" className="w-[120px] px-2 py-2">Status</th>
                  <th scope="col" className="hidden w-[100px] px-2 py-2 sm:table-cell">Registros</th>
                  <th scope="col" className="hidden w-[80px] px-2 py-2 md:table-cell">Páginas</th>
                  <th scope="col" className="hidden w-[70px] px-2 py-2 md:table-cell">HTTP</th>
                  <th scope="col" className="px-2 py-2">Erro</th>
                </tr>
              </thead>
              <tbody>
                {modules.length > 0 ? (
                  modules.map((module) => {
                    const info = moduleResultInfo(module.status);
                    return (
                      <tr key={module.id} className="border-b border-border/70 align-top last:border-0">
                        <td className="break-words px-2 py-2.5 font-medium text-foreground">{moduleLabel(module.moduleKey)}</td>
                        <td className="px-2 py-2.5">
                          <Badge tone={info.tone}>{info.label}</Badge>
                        </td>
                        <td className="hidden px-2 py-2.5 text-muted-foreground sm:table-cell">{formatInt(module.recordsCount)}</td>
                        <td className="hidden px-2 py-2.5 text-muted-foreground md:table-cell">{formatInt(module.pagesFetched)}</td>
                        <td className="hidden px-2 py-2.5 text-muted-foreground md:table-cell">{module.httpStatus ?? '—'}</td>
                        <td className="break-words px-2 py-2.5 text-xs text-danger">{module.errorMessage ?? '—'}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                      Esta execução não registrou resultados por módulo.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="flex min-w-0 flex-col gap-[15px]">
          <Card aria-labelledby="resumo-title">
            <CardTitle icon={<Clock />}>
              <span id="resumo-title">Resumo</span>
            </CardTitle>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-1">
              <Item label="Instância">{instance.displayName}</Item>
              <Item label="Identidade">{run.identityLabel}</Item>
              <Item label="Início">{formatDateTime(run.startedAt)}</Item>
              <Item label="Término">{formatDateTime(run.finishedAt)}</Item>
              <Item label="Duração">{formatDuration(run.startedAt, run.finishedAt)}</Item>
              <Item label="Módulos processados">
                {formatInt(run.modulesProcessed)} de {formatInt(run.modulesRequested.length)}
              </Item>
              <Item label="Registros">{formatInt(run.recordsCount)}</Item>
              <Item label="Falhas">{formatInt(run.failuresCount)}</Item>
              <Item label="Alterações">{formatInt(run.changesCount)}</Item>
              <Item label="Comparada com">
                {run.comparedToRunId ? (
                  <Link
                    href={`/historico/comparar?a=${run.comparedToRunId}&b=${run.id}`}
                    className="text-primary hover:underline"
                  >
                    Execução #{run.comparedToRunId}
                  </Link>
                ) : (
                  'Nenhuma'
                )}
              </Item>
            </dl>
          </Card>

          {failed.length > 0 && (
            <Card aria-labelledby="repetir-title">
              <CardTitle icon={<RefreshCw />}>
                <span id="repetir-title">Repetir falhas</span>
              </CardTitle>
              <p className="mt-3 text-sm text-muted-foreground">
                Repete somente os módulos com falha desta execução. O resultado aparece na próxima atualização.
              </p>
              <div className="mt-3">
                <RetryFailedButton runId={run.id} failedCount={failed.length} />
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
