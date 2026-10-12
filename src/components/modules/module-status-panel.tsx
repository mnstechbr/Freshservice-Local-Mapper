import { Activity } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';
import { moduleLabel } from '@/lib/modules/catalog';
import type { ApiModuleRow } from '@/lib/queries/modules';
import { apiAccessInfo } from '@/lib/ui/status';

/**
 * Estado de acesso dos endpoints de um grupo (listApiModules). Sem registro, mostra "Não testado".
 * Nunca exibe dados: só o estado do teste de acesso.
 */
export function ModuleStatusPanel({
  moduleKeys,
  rows,
  hasInstance,
}: {
  moduleKeys: readonly string[];
  rows: readonly ApiModuleRow[];
  hasInstance: boolean;
}) {
  const byKey = new Map(rows.map((row) => [row.moduleKey, row]));
  const accessible = moduleKeys.filter((key) => byKey.get(key)?.accessStatus === 'accessible').length;
  const forbidden = moduleKeys.filter((key) => byKey.get(key)?.accessStatus === 'forbidden').length;

  return (
    <Card aria-labelledby="module-status-title" className="h-fit min-w-0">
      <CardTitle icon={<Activity />}>
        <span id="module-status-title">Status dos endpoints</span>
      </CardTitle>

      {!hasInstance ? (
        <p className="mt-3 text-sm text-muted-foreground">Sem instância ativa não há teste de acesso aos endpoints.</p>
      ) : moduleKeys.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nenhum endpoint mapeado para este segmento nesta versão.</p>
      ) : (
        <>
          <p className="mt-3 text-xs text-muted-foreground">
            {accessible} de {moduleKeys.length} endpoints acessíveis
          </p>
          {forbidden > 0 && accessible === 0 && (
            <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
              Sem permissão (403) para este módulo. Verifique os escopos da conta ou do app OAuth e teste de novo.
            </p>
          )}
        <ul className="mt-2 divide-y divide-border">
          {moduleKeys.map((key) => {
            const row = byKey.get(key);
            const info = apiAccessInfo(row?.accessStatus, row?.accessDetail);
            return (
              <li key={key} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium text-foreground">{moduleLabel(key)}</p>
                  <Badge tone={info.tone}>{info.label}</Badge>
                </div>
                <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <dt>Endpoint</dt>
                  <dd className="min-w-0 break-all">{row ? `${row.method} ${row.path}` : 'Sem registro'}</dd>
                  <dt>Código HTTP</dt>
                  <dd>{row?.httpStatus ?? '—'}</dd>
                  <dt>Última tentativa</dt>
                  <dd>{row?.lastAttemptAt ? formatDateTime(row.lastAttemptAt) : 'Nunca testado'}</dd>
                </dl>
                {row?.errorMessage && <p className="mt-1.5 text-xs text-danger">{row.errorMessage}</p>}
              </li>
            );
          })}
        </ul>
        </>
      )}
    </Card>
  );
}
