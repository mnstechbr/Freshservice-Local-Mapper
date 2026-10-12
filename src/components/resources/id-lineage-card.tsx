import { GitBranch } from 'lucide-react';
import type { IdLineage } from '@/lib/diff';
import { formatDateTime } from '@/lib/format';
import { moduleLabel } from '@/lib/modules/catalog';
import { Card, CardTitle } from '@/components/ui/card';

/** Linhagem de IDs confirmada (getIdLineage). Mostra só trocas que o revisor confirmou. */
export function IdLineageCard({ lineage }: { lineage: IdLineage }) {
  const byId = new Map(lineage.nodes.map((node) => [node.resourceId, node]));
  const externalIdOf = (resourceId: number) => byId.get(resourceId)?.externalId ?? `#${resourceId}`;

  return (
    <Card aria-labelledby="linhagem-ids">
      <CardTitle icon={<GitBranch />}>
        <span id="linhagem-ids">Linhagem de IDs</span>
      </CardTitle>
      {lineage.links.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nenhuma troca de ID confirmada para este recurso.</p>
      ) : (
        <ol className="mt-3 space-y-2.5">
          {lineage.links.map((link) => {
            const module = byId.get(link.oldResourceId)?.moduleKey;
            return (
              <li key={link.changeId} className="min-w-0 rounded-lg border border-border p-2.5 text-sm">
                <p className="break-all font-medium text-foreground">
                  {externalIdOf(link.oldResourceId)} → {externalIdOf(link.newResourceId)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {module ? `${moduleLabel(module)} · ` : ''}confiança {Math.round(link.score * 100)}%
                  {link.decidedAt ? ` · confirmada em ${formatDateTime(link.decidedAt)}` : ''}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
