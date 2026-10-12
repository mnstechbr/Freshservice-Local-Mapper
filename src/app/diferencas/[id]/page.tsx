import { ArrowLeftRight, Clock, GitCompare, ListChecks, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChangeTypeBadge, SEVERITY_LABELS } from '@/components/diffs/change-badges';
import { ReviewActions } from '@/components/diffs/review-actions';
import { PageHeader } from '@/components/layout/page-header';
import { JsonTree } from '@/components/resources/json-tree';
import { Badge } from '@/components/ui/badge';
import { Card, CardTitle } from '@/components/ui/card';
import { getDb } from '@/lib/db/client';
import { formatDateTime } from '@/lib/format';
import { moduleLabel } from '@/lib/modules/catalog';
import { getChangeDetail } from '@/lib/queries/changes';
import type { FieldDiffKind } from '@/lib/queries/compare';
import { changeTypeInfo, describeChange, reviewStatusInfo } from '@/lib/ui/status';
import type { ReactNode } from 'react';

// Lê o banco a cada requisição e nunca é pré-renderizado no build.
export const dynamic = 'force-dynamic';

const KIND_LABELS: Record<FieldDiffKind, string> = { added: 'Adicionado', removed: 'Removido', changed: 'Alterado' };
const MAX_FIELD_ROWS = 200;

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words font-medium text-foreground">{children}</dd>
    </div>
  );
}

export default async function DiferencaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  if (!/^[1-9]\d{0,9}$/.test(rawId)) notFound();
  const detail = getChangeDetail(getDb(), Number(rawId));
  if (!detail) notFound();

  const { change, previous, current, fieldDiffs, matches } = detail;
  const review = reviewStatusInfo(change.reviewStatus);
  const shownDiffs = fieldDiffs.slice(0, MAX_FIELD_ROWS);

  return (
    <div className="flex min-w-0 flex-col gap-[15px]">
      <PageHeader
        icon={<ArrowLeftRight />}
        title={`Diferença ${change.id}`}
        description={`${moduleLabel(change.moduleKey)} · ${describeChange(change)}`}
        aside={
          <>
            <ChangeTypeBadge type={change.changeType} />
            <Badge tone={review.tone}>{review.label}</Badge>
          </>
        }
      />

      <div className="grid min-w-0 gap-[15px] lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-[15px]">
          <Card aria-labelledby="identificacao">
            <CardTitle icon={<ListChecks />}>
              <span id="identificacao">Identificação</span>
            </CardTitle>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Item label="Tipo">{changeTypeInfo(change.changeType).label}</Item>
              <Item label="Módulo">{moduleLabel(change.moduleKey)}</Item>
              <Item label="ID anterior">{change.previousExternalId ?? '—'}</Item>
              <Item label="Nome anterior">{change.previousName ?? '—'}</Item>
              <Item label="ID atual">{change.currentExternalId ?? '—'}</Item>
              <Item label="Nome atual">{change.currentName ?? '—'}</Item>
              <Item label="Severidade">{SEVERITY_LABELS[change.severity]}</Item>
              <Item label="Detectada em">{formatDateTime(change.detectedAt)}</Item>
            </dl>
            {(previous?.resourceId || current?.resourceId) && (
              <p className="mt-3 flex flex-wrap gap-4 text-sm">
                {previous?.resourceId && (
                  <Link href={`/recursos/${previous.resourceId}`} className="font-medium text-primary hover:underline">
                    Recurso anterior
                  </Link>
                )}
                {current?.resourceId && (
                  <Link href={`/recursos/${current.resourceId}`} className="font-medium text-primary hover:underline">
                    Recurso atual
                  </Link>
                )}
              </p>
            )}
          </Card>

          <Card aria-labelledby="campos">
            <CardTitle icon={<GitCompare />}>
              <span id="campos">Campos alterados</span>
            </CardTitle>
            {fieldDiffs.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Nenhum campo diferente entre as versões comparadas.</p>
            ) : (
              <div className="mt-3 min-w-0">
                <table className="w-full table-fixed border-collapse text-sm">
                  <thead className="border-b border-border text-left text-xs font-medium text-muted-foreground">
                    <tr>
                      <th scope="col" className="w-[32%] px-2 py-2">Campo</th>
                      <th scope="col" className="hidden w-[110px] px-2 py-2 sm:table-cell">Tipo</th>
                      <th scope="col" className="px-2 py-2">Antes</th>
                      <th scope="col" className="px-2 py-2">Depois</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownDiffs.map((diff) => (
                      <tr key={diff.path} className="border-b border-border/70 align-top last:border-0">
                        <td className="break-all px-2 py-2 font-medium text-foreground">{diff.path}</td>
                        <td className="hidden px-2 py-2 text-muted-foreground sm:table-cell">{KIND_LABELS[diff.kind]}</td>
                        <td className="min-w-0 px-2 py-2">
                          <JsonTree value={diff.before} />
                        </td>
                        <td className="min-w-0 px-2 py-2">
                          <JsonTree value={diff.after} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {fieldDiffs.length > shownDiffs.length && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Mostrando {shownDiffs.length} de {fieldDiffs.length} campos.
                  </p>
                )}
              </div>
            )}
          </Card>

          <Card aria-labelledby="evidencias">
            <CardTitle icon={<ListChecks />}>
              <span id="evidencias">Evidências</span>
            </CardTitle>
            <div className="mt-3 min-w-0">
              {change.evidence === null || change.evidence === undefined ? (
                <p className="text-sm text-muted-foreground">Sem evidências registradas.</p>
              ) : (
                <JsonTree value={change.evidence} />
              )}
            </div>
          </Card>

          {change.changeType === 'possible_id_change' && (
            <Card aria-labelledby="score">
              <CardTitle icon={<GitCompare />}>
                <span id="score">Score breakdown</span>
              </CardTitle>
              {matches.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">Nenhuma correspondência registrada para esta mudança.</p>
              ) : (
                <ul className="mt-3 flex flex-col gap-4">
                  {matches.map((match) => (
                    <li key={match.id} className="min-w-0 rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 break-words font-medium text-foreground">
                          ID {match.oldExternalId} → ID {match.newExternalId}
                        </span>
                        <span className="text-muted-foreground">
                          Score {Math.round(match.score * 100)}% · {match.status}
                        </span>
                      </div>
                      <div className="mt-2">
                        <JsonTree value={match.scoreBreakdown} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-[15px]">
          <Card aria-labelledby="revisao">
            <CardTitle icon={<ShieldCheck />}>
              <span id="revisao">Revisão</span>
            </CardTitle>
            <p className="mt-3 text-sm text-muted-foreground">
              Status: <Badge tone={review.tone}>{review.label}</Badge>
            </p>
            <div className="mt-3">
              <ReviewActions
                changeId={change.id}
                candidates={matches
                  .filter((match) => match.status === 'suggested')
                  .sort((a, b) => b.score - a.score)
                  .map((match) => ({ id: match.id, oldExternalId: match.oldExternalId, newExternalId: match.newExternalId, score: match.score }))}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">A decisão fica registrada apenas no banco local.</p>
          </Card>

          <Card aria-labelledby="execucoes">
            <CardTitle icon={<Clock />}>
              <span id="execucoes">Execuções comparadas</span>
            </CardTitle>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              <li>
                <Link href={`/historico/${change.baseRunId}`} className="font-medium text-primary hover:underline">
                  Execução base #{change.baseRunId}
                </Link>
              </li>
              <li>
                <Link href={`/historico/${change.runId}`} className="font-medium text-primary hover:underline">
                  Execução da mudança #{change.runId}
                </Link>
              </li>
              <li>
                <Link
                  href={`/historico/comparar?a=${change.baseRunId}&b=${change.runId}`}
                  className="font-medium text-primary hover:underline"
                >
                  Comparar as duas execuções
                </Link>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
