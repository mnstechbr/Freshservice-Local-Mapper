import { Rocket } from 'lucide-react';
import { CommandText } from '@/components/environment/command-text';
import { DetailItem, MonoText } from '@/components/environment/detail-item';
import {
  formatIsoDateTime,
  formatMigrations,
  INVOKED_BY_LABEL,
  MODE_LABEL,
  PHASE_LABEL,
  STEP_STATUS,
  yesNo,
} from '@/components/environment/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardTitle } from '@/components/ui/card';
import type { BootstrapStatus } from '@/lib/environment/types';

/** Último registro de bootstrap-status.json (gravado por pnpm dev). Sem registro = null. */
export function BootstrapSection({ bootstrap }: { bootstrap: BootstrapStatus | null }) {
  return (
    <Card aria-labelledby="bootstrap-title" className="min-w-0">
      <CardTitle icon={<Rocket />}>
        <span id="bootstrap-title">Inicialização (bootstrap)</span>
      </CardTitle>

      {bootstrap === null ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Sem registro da última inicialização (inicie com npm run dev).
        </p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <DetailItem label="Fase">
              <Badge tone={PHASE_LABEL[bootstrap.phase].tone}>{PHASE_LABEL[bootstrap.phase].label}</Badge>
            </DetailItem>
            <DetailItem label="Modo">{MODE_LABEL[bootstrap.mode]}</DetailItem>
            <DetailItem label="Iniciado em">{formatIsoDateTime(bootstrap.startedAt)}</DetailItem>
            <DetailItem label="Última atualização">{formatIsoDateTime(bootstrap.updatedAt)}</DetailItem>
            <DetailItem label="Gerenciador que invocou">
              {INVOKED_BY_LABEL[bootstrap.packageManager.invokedBy]}
            </DetailItem>
            <DetailItem label="Porta">{bootstrap.port}</DetailItem>
            <DetailItem label="Dependências instaladas agora">
              {yesNo(bootstrap.dependencies.installedNow)}
            </DetailItem>
            <DetailItem label="Banco criado agora">{yesNo(bootstrap.database.createdNow)}</DetailItem>
            <DetailItem label="Migrações aplicadas agora">
              {formatMigrations(bootstrap.database.migrationsApplied, bootstrap.database.migrationsTotal)}
            </DetailItem>
            <DetailItem label="Backup do banco">
              {bootstrap.database.backupFile ? <MonoText>{bootstrap.database.backupFile}</MonoText> : 'Nenhum'}
            </DetailItem>
          </dl>

          {bootstrap.steps.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Nenhum passo registrado.</p>
          ) : (
            <div className="mt-4 min-w-0 overflow-x-auto">
              <table aria-label="Passos da inicialização" className="w-full min-w-[640px] border-collapse text-sm">
                <thead className="border-b border-border text-left text-xs font-medium text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-2 py-2">Status</th>
                    <th scope="col" className="px-2 py-2">Etapa</th>
                    <th scope="col" className="px-2 py-2">Mensagem</th>
                    <th scope="col" className="px-2 py-2">Dica</th>
                  </tr>
                </thead>
                <tbody>
                  {bootstrap.steps.map((step) => (
                    <tr key={step.id} className="border-b border-border/70 align-top last:border-0">
                      <td className="px-2 py-2.5">
                        <Badge tone={STEP_STATUS[step.status].tone}>{STEP_STATUS[step.status].label}</Badge>
                      </td>
                      <th scope="row" className="break-words px-2 py-2.5 text-left font-medium text-foreground">
                        {step.label}
                      </th>
                      <td className="break-words px-2 py-2.5 text-foreground">{step.message}</td>
                      <td className="break-words px-2 py-2.5 text-muted-foreground">
                        {step.hint ? <CommandText text={step.hint} /> : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
