import { Activity, CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { CommandText } from '@/components/environment/command-text';
import { type BadgeTone, ISSUE_SEVERITY } from '@/components/environment/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardTitle } from '@/components/ui/card';
import type { EnvironmentIssue } from '@/lib/environment/types';
import { formatInt } from '@/lib/format';

const ICON_CLASS = 'size-3.5 shrink-0';

function CountTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-lg border border-border p-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-foreground">{formatInt(value)}</dd>
    </div>
  );
}

/** Situação geral (OK, com avisos ou com erros) e contagem de problemas por severidade. */
export function EnvironmentSummary({ issues }: { issues: EnvironmentIssue[] }) {
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.length - errors;
  const overall: { label: string; tone: BadgeTone; icon: ReactNode } =
    errors > 0
      ? { label: 'Com erros', tone: 'danger', icon: <CircleX className={ICON_CLASS} aria-hidden="true" /> }
      : warnings > 0
        ? { label: 'Com avisos', tone: 'warning', icon: <TriangleAlert className={ICON_CLASS} aria-hidden="true" /> }
        : { label: 'OK', tone: 'success', icon: <CircleCheck className={ICON_CLASS} aria-hidden="true" /> };

  return (
    <Card aria-labelledby="resumo-title" className="min-w-0">
      <CardTitle icon={<Activity />}>
        <span id="resumo-title">Resumo</span>
      </CardTitle>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="min-w-0 rounded-lg border border-border p-3">
          <dt className="text-xs font-medium text-muted-foreground">Situação geral</dt>
          <dd className="mt-2">
            <Badge tone={overall.tone} className="whitespace-normal">
              {overall.icon}
              {overall.label}
            </Badge>
          </dd>
        </div>
        <CountTile label="Erros" value={errors} />
        <CountTile label="Avisos" value={warnings} />
      </dl>
    </Card>
  );
}

/** Problemas com severidade em texto, área, mensagem e instrução de correção. */
export function IssuesCard({ issues }: { issues: EnvironmentIssue[] }) {
  return (
    <Card aria-labelledby="problemas-title" className="min-w-0">
      <CardTitle icon={<TriangleAlert />}>
        <span id="problemas-title">Problemas identificados e como resolver</span>
      </CardTitle>
      {issues.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nenhum problema identificado.</p>
      ) : (
        <ul className="mt-3 flex min-w-0 flex-col gap-3">
          {issues.map((issue, index) => {
            const severity = ISSUE_SEVERITY[issue.severity];
            const Icon = issue.severity === 'error' ? CircleX : TriangleAlert;
            return (
              <li key={`${index}-${issue.area}`} className="min-w-0 rounded-lg border border-border p-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge tone={severity.tone} className="whitespace-normal">
                    <Icon className={ICON_CLASS} aria-hidden="true" />
                    {severity.label}
                  </Badge>
                  <span className="min-w-0 break-words text-sm font-medium text-foreground">{issue.area}</span>
                </div>
                <p className="mt-2 break-words text-sm text-foreground">{issue.message}</p>
                <p className="mt-1.5 break-words text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Como resolver: </span>
                  <CommandText text={issue.fix} />
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
