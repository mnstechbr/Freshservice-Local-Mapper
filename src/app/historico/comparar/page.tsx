import { GitCompare } from 'lucide-react';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { RunPairForm } from '@/components/history/run-pair-form';
import { Badge } from '@/components/ui/badge';
import { Card, CardTitle } from '@/components/ui/card';
import { getDb } from '@/lib/db/client';
import { formatDateTime, formatInt } from '@/lib/format';
import { moduleLabel } from '@/lib/modules/catalog';
import { loadRunComparison, runInstanceIds, type RunComparisonView } from '@/lib/queries/history';
import { getActiveInstance } from '@/lib/queries/instances';
import { changeTypeInfo } from '@/lib/ui/status';
import { firstParam, type SearchParams } from '@/lib/queries/params';
import { listSyncRuns } from '@/lib/queries/runs';
import { type ComparisonGuard, comparisonGuard, parseRunPair } from '@/lib/ui/filters';

// Lê o banco a cada requisição e nunca é pré-renderizado no build.
export const dynamic = 'force-dynamic';

const LIST_LIMIT = 50;

const GUARD_MESSAGES: Record<Exclude<ComparisonGuard, 'ok'>, string> = {
  same_run: 'Escolha duas execuções diferentes para comparar.',
  missing: 'Uma das execuções não existe nesta instância.',
  other_instance:
    'As execuções são de instâncias diferentes. A comparação está bloqueada, porque essas execuções são incompatíveis.',
};

function Notice({ tone = 'info', children }: { tone?: 'info' | 'danger'; children: ReactNode }) {
  return (
    <p
      role={tone === 'danger' ? 'alert' : 'status'}
      className={tone === 'danger' ? 'rounded-lg border border-danger-soft bg-danger-soft px-4 py-3 text-sm text-danger' : 'rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground'}
    >
      {children}
    </p>
  );
}

/** Resumo por tipo e listas. Usa só o resultado de loadRunComparison, sem cálculo próprio. */
const KINDS = ['added', 'removed', 'name_changed', 'possible_id_change', 'fields_changed', 'not_observed'] as const;
const LIST_ROWS = 50;

/** Resultado do motor oficial (compareRuns de src/lib/diff). Sem cálculo próprio. */
function ComparisonView({ comparison }: { comparison: RunComparisonView }) {
  const { baseline, target, result } = comparison;
  const total = result.changes.length;
  const shown = result.changes.slice(0, LIST_ROWS);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card aria-labelledby="resumo-comparacao">
        <CardTitle icon={<GitCompare />} aside={<Badge tone="info">{formatInt(total)} mudanças</Badge>}>
          <span id="resumo-comparacao">Resumo por tipo</span>
        </CardTitle>
        <p className="mt-2 text-sm text-muted-foreground">
          Base: execução #{baseline.id} ({formatDateTime(baseline.finishedAt ?? baseline.startedAt)}). Comparada: execução #
          {target.id} ({formatDateTime(target.finishedAt ?? target.startedAt)}).
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {KINDS.map((kind) => (
            <div key={kind} className="rounded-lg border border-border p-2.5">
              <dt className="text-xs text-muted-foreground">{changeTypeInfo(kind).label}</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">{formatInt(result.counts[kind] ?? 0)}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {result.notes.map((note, index) => (
        <Notice key={`${note.moduleKey}-${index}`}>
          {moduleLabel(note.moduleKey)}: {note.reason}
        </Notice>
      ))}

      <Card aria-labelledby="lista-mudancas">
        <CardTitle icon={<GitCompare />}>
          <span id="lista-mudancas">Mudanças ({formatInt(total)})</span>
        </CardTitle>
        {total === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nenhuma diferença entre as duas execuções.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {shown.map((change, index) => (
              <li key={`${change.changeType}-${change.resourceId ?? change.previousResourceId ?? index}`} className="min-w-0 py-3 first:pt-0 last:pb-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge tone={changeTypeInfo(change.changeType).tone}>{changeTypeInfo(change.changeType).label}</Badge>
                  <span className="min-w-0 truncate text-sm font-medium">
                    {change.currentName ?? change.previousName ?? 'Sem nome'}
                  </span>
                </div>
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  {moduleLabel(change.moduleKey)} · ID {change.previousExternalId ?? '—'} → {change.currentExternalId ?? '—'}
                </p>
                {change.fieldDiffs && change.fieldDiffs.length > 0 && (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {change.fieldDiffs.slice(0, 8).map((field) => (
                      <li key={field.path} className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {field.path}
                      </li>
                    ))}
                  </ul>
                )}
                {change.matches.map((match) => (
                  <p key={`${match.oldResourceId}-${match.newResourceId}`} className="mt-1.5 text-xs text-orange-text">
                    Possível troca de ID: {match.oldExternalId} → {match.newExternalId} (score {Math.round(match.score * 100)}%)
                  </p>
                ))}
              </li>
            ))}
          </ul>
        )}
        {total > LIST_ROWS && (
          <p className="mt-3 text-xs text-muted-foreground">
            Mostrando {LIST_ROWS} de {formatInt(total)}. Use a página de diferenças para filtrar.
          </p>
        )}
      </Card>
    </div>
  );
}

export default async function CompararPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const pair = parseRunPair(firstParam(params, 'a'), firstParam(params, 'b'));
  const db = getDb();
  const instance = getActiveInstance(db);
  const runs = instance ? listSyncRuns(db, instance.id, 50) : [];

  let body: ReactNode;
  if (!instance) {
    body = <Notice>Nenhuma instância ativa. Ative o modo demonstrativo em Configurações para ver exemplos.</Notice>;
  } else if (!pair) {
    body = <Notice>Escolha duas execuções no formulário acima ou na página de histórico.</Notice>;
  } else {
    const guard = comparisonGuard(pair, runInstanceIds(db, [pair.a, pair.b]), instance.id);
    if (guard !== 'ok') {
      body = <Notice tone="danger">{GUARD_MESSAGES[guard]}</Notice>;
    } else {
      const comparison = loadRunComparison(db, instance.id, pair.a, pair.b);
      body = comparison ? <ComparisonView comparison={comparison} /> : <Notice>Não foi possível comparar estas execuções.</Notice>;
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-[15px]">
      <PageHeader icon={<GitCompare />} title="Comparar execuções" description="Diferenças entre duas execuções da mesma instância." />
      <Card aria-labelledby="escolha-execucoes">
        <CardTitle icon={<GitCompare />} aside={null}>
          <span id="escolha-execucoes">Execuções</span>
        </CardTitle>
        <div className="mt-3">
          <RunPairForm runs={runs} a={pair?.a} b={pair?.b} />
        </div>
      </Card>
      {body}
    </div>
  );
}
