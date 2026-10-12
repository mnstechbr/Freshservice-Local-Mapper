import { ArrowLeftRight, CircleHelp, CircleMinus, CirclePlus, Ellipsis, Layers, PenLine, Pencil, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { formatInt, formatRelativeDay } from '@/lib/format';
import type { ChangeRow, ChangeType } from '@/lib/queries/changes';
import { changeTypeInfo, describeChange } from '@/lib/ui/status';
import { cn } from '@/lib/utils';

const CHANGE_ICON: Record<ChangeType, { Icon: LucideIcon; circle: string }> = {
  possible_id_change: { Icon: Pencil, circle: 'bg-orange' },
  name_changed: { Icon: PenLine, circle: 'bg-primary' },
  added: { Icon: CirclePlus, circle: 'bg-success' },
  removed: { Icon: CircleMinus, circle: 'bg-danger' },
  not_observed: { Icon: CircleHelp, circle: 'bg-muted-foreground' },
  fields_changed: { Icon: Layers, circle: 'bg-primary' },
};

/** Últimas diferenças da execução mais recente. Cada linha abre o detalhe em /diferencas/[id]. */
export function ChangesPanel({ changes, total, hasRun }: { changes: ChangeRow[]; total: number; hasRun: boolean }) {
  return (
    <Card aria-labelledby="changes-title" className="p-3">
      <CardTitle
        icon={<ArrowLeftRight />}
        aside={
          <div className="flex items-center gap-2">
            {total > 0 && (
              <Badge tone="warning" size="sm" className="px-3 py-1 text-[13px]">
                {formatInt(total)} {total === 1 ? 'mudança' : 'mudanças'}
              </Badge>
            )}
            <Link href="/diferencas" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Ver todas
            </Link>
          </div>
        }
      >
        Diferenças detectadas
      </CardTitle>

      {changes.length === 0 ? (
        <p className="mt-4 rounded-lg bg-background px-4 py-6 text-center text-sm text-muted-foreground">
          {hasRun
            ? 'Nenhuma diferença na última comparação.'
            : 'Ainda não há comparação. Conclua um mapeamento para detectar diferenças.'}
        </p>
      ) : (
        <ul className="mt-2 flex flex-col">
          {changes.map((change) => {
            const { Icon, circle } = CHANGE_ICON[change.changeType];
            const info = changeTypeInfo(change.changeType);
            return (
              <li key={change.id}>
                <Link
                  href={`/diferencas/${change.id}`}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-secondary/60"
                >
                  <span
                    aria-hidden="true"
                    className={cn('flex size-5 shrink-0 items-center justify-center rounded-full text-white [&_svg]:size-3', circle)}
                  >
                    <Icon />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    <span className="sr-only">{info.label}: </span>
                    {describeChange(change)}
                  </span>
                  <Badge tone={info.tone} className="hidden sm:inline-flex">
                    {info.label}
                  </Badge>
                  <span className="hidden whitespace-nowrap text-sm text-muted-foreground md:inline">
                    {formatRelativeDay(change.detectedAt)}
                  </span>
                  <Ellipsis className="hidden size-4 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
