import { Clock, ExternalLink, FileText, GitCompare, Layers, ListChecks } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ChangeTypeBadge } from '@/components/diffs/change-badges';
import { PageHeader } from '@/components/layout/page-header';
import { FormFieldsTable } from '@/components/resources/form-fields-table';
import { IdLineageCard } from '@/components/resources/id-lineage-card';
import { JsonTree } from '@/components/resources/json-tree';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { getDb } from '@/lib/db/client';
import { getIdLineage } from '@/lib/diff';
import { formatDateTime, formatRelativeDay } from '@/lib/format';
import { moduleLabel } from '@/lib/modules/catalog';
import { flattenJson } from '@/lib/queries/compare';
import { getResourceDetail } from '@/lib/queries/resources';
import { freshserviceResourceUrl } from '@/lib/ui/external-links';
import { formFieldRows } from '@/lib/ui/form-fields';
import { describeChange } from '@/lib/ui/status';

// Lê o banco a cada requisição e nunca é pré-renderizado no build.
export const dynamic = 'force-dynamic';

const MAX_FIELDS = 200;
const MAX_RAW_CHARS = 4000;

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words font-medium text-foreground">{children}</dd>
    </div>
  );
}

export default async function RecursoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  if (!/^[1-9]\d{0,9}$/.test(rawId)) notFound();
  const db = getDb();
  const detail = getResourceDetail(db, Number(rawId));
  if (!detail) notFound();
  const lineage = getIdLineage(db, Number(rawId));

  const version = detail.currentVersion;
  const fields = version ? [...flattenJson(version.normalized).entries()] : [];
  const rawJson = version ? JSON.stringify(version.normalized, null, 2) ?? '' : '';
  // Itens do catálogo (item_details): custom_fields em tabela, em vez de caminhos planos.
  const formRows = version ? formFieldRows((version.normalized as { custom_fields?: unknown } | null)?.custom_fields) : [];
  const externalUrl = freshserviceResourceUrl({
    baseUrl: detail.instance.baseUrl,
    isDemo: detail.instance.isDemo,
    moduleKey: detail.moduleKey,
    externalId: detail.externalId,
  });
  const relations = [
    ...detail.relations.outgoing.map((relation) => ({ direction: 'Saída', ...relation })),
    ...detail.relations.incoming.map((relation) => ({ direction: 'Entrada', ...relation })),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-[15px]">
      <PageHeader
        icon={<FileText />}
        title={detail.name ?? detail.externalId}
        description={`${moduleLabel(detail.moduleKey)} · ID ${detail.externalId}`}
        aside={
          externalUrl && (
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'secondary' })}
            >
              Abrir no Freshservice
              <ExternalLink aria-hidden="true" />
            </a>
          )
        }
      />

      <div className="grid min-w-0 gap-[15px] lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-[15px]">
          <Card aria-labelledby="identificacao">
            <CardTitle icon={<ListChecks />}>
              <span id="identificacao">Identificação</span>
            </CardTitle>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <Item label="ID externo">{detail.externalId}</Item>
              <Item label="Nome">{detail.name ?? '—'}</Item>
              <Item label="Categoria">{detail.category ?? '—'}</Item>
              <Item label="Workspace">{detail.workspaceId ?? '—'}</Item>
              <Item label="Módulo">{moduleLabel(detail.moduleKey)}</Item>
              <Item label="Primeira execução">#{detail.firstSeenRunId}</Item>
              <Item label="Última execução">#{detail.lastSeenRunId}</Item>
              <Item label="Última coleta">{formatDateTime(detail.lastSeenAt)}</Item>
            </dl>
          </Card>

          <Card aria-labelledby="campos">
            <CardTitle icon={<Layers />}>
              <span id="campos">Campos e propriedades</span>
            </CardTitle>
            {fields.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Nenhuma versão capturada para este recurso.</p>
            ) : (
              <div className="mt-3 min-w-0">
                <table className="w-full table-fixed border-collapse text-sm">
                  <thead className="border-b border-border text-left text-xs font-medium text-muted-foreground">
                    <tr>
                      <th scope="col" className="w-[38%] px-2 py-2">Campo</th>
                      <th scope="col" className="px-2 py-2">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.slice(0, MAX_FIELDS).map(([path, value]) => (
                      <tr key={path} className="border-b border-border/70 align-top last:border-0">
                        <td className="break-all px-2 py-2 font-medium text-foreground">{path}</td>
                        <td className="min-w-0 px-2 py-2">
                          <JsonTree value={value} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {fields.length > MAX_FIELDS && (
                  <p className="mt-2 text-xs text-muted-foreground">Mostrando {MAX_FIELDS} de {fields.length} campos.</p>
                )}
              </div>
            )}
          </Card>

          {formRows.length > 0 && (
            <Card aria-labelledby="formulario">
              <CardTitle icon={<ListChecks />}>
                <span id="formulario">Campos do formulário</span>
              </CardTitle>
              <FormFieldsTable rows={formRows} />
            </Card>
          )}

          {version && (
            <Card aria-labelledby="conteudo">
              <CardTitle icon={<FileText />}>
                <span id="conteudo">Conteúdo retornado</span>
              </CardTitle>
              <pre className="mt-3 max-h-[360px] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-background p-3 text-xs text-foreground">
                {rawJson.length > MAX_RAW_CHARS ? `${rawJson.slice(0, MAX_RAW_CHARS)}\n… (truncado)` : rawJson}
              </pre>
            </Card>
          )}

          <Card aria-labelledby="relacoes">
            <CardTitle icon={<Layers />}>
              <span id="relacoes">Relações</span>
            </CardTitle>
            {relations.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Nenhuma relação registrada.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2 text-sm">
                {relations.map((relation, index) => (
                  <li key={`${relation.direction}-${index}`} className="min-w-0 break-words rounded-lg border border-border p-2.5">
                    <span className="text-xs text-muted-foreground">
                      {relation.direction} · {relation.relationType}
                    </span>
                    <p className="font-medium text-foreground">
                      {relation.otherResourceId ? (
                        <Link href={`/recursos/${relation.otherResourceId}`} className="text-primary hover:underline">
                          {relation.otherName ?? relation.otherExternalRef}
                        </Link>
                      ) : (
                        (relation.otherName ?? relation.otherExternalRef)
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <IdLineageCard lineage={lineage} />
        </div>

        <div className="flex min-w-0 flex-col gap-[15px]">
          <Card aria-labelledby="origem">
            <CardTitle icon={<Layers />}>
              <span id="origem">Origem</span>
            </CardTitle>
            <dl className="mt-3 flex flex-col gap-3 text-sm">
              <Item label="Instância">
                {detail.instance.displayName}
                {detail.instance.isDemo && (
                  <Badge tone="warning" className="ml-2">
                    Demonstração
                  </Badge>
                )}
              </Item>
              <Item label="Endpoint de origem">{detail.origin.sourceEndpoint ?? '—'}</Item>
              <Item label="Módulo da API">
                {detail.origin.apiModule
                  ? `${detail.origin.apiModule.method} ${detail.origin.apiModule.path}`
                  : '—'}
              </Item>
            </dl>
          </Card>

          <Card aria-labelledby="versoes">
            <CardTitle icon={<Clock />}>
              <span id="versoes">Histórico de versões</span>
            </CardTitle>
            {detail.versions.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Nenhuma versão capturada.</p>
            ) : (
              <ol className="mt-3 flex flex-col gap-2 text-sm">
                {detail.versions.map((item) => (
                  <li key={item.id} className="min-w-0 break-words rounded-lg border border-border p-2.5">
                    <p className="font-medium text-foreground">
                      <Link href={`/historico/${item.runId}`} className="text-primary hover:underline">
                        Execução #{item.runId}
                      </Link>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(item.capturedAt)} · hash {item.contentHash.slice(0, 12)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card aria-labelledby="mudancas">
            <CardTitle icon={<GitCompare />}>
              <span id="mudancas">Histórico de mudanças</span>
            </CardTitle>
            {detail.changes.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Nenhuma mudança envolvendo este recurso.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2 text-sm">
                {detail.changes.map((change) => (
                  <li key={change.id} className="min-w-0 rounded-lg border border-border p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <ChangeTypeBadge type={change.changeType} />
                      <span className="text-xs text-muted-foreground">{formatRelativeDay(change.detectedAt)}</span>
                    </div>
                    <Link href={`/diferencas/${change.id}`} className="mt-1.5 block break-words text-primary hover:underline">
                      {describeChange(change)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
