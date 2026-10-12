import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CHANGE_TYPES, REVIEW_STATUSES, SEVERITIES } from '@/lib/db/schema';
import type { ChangeFilters } from '@/lib/ui/filters';
import { changeTypeInfo, reviewStatusInfo } from '@/lib/ui/status';
import { SEVERITY_LABELS } from './change-badges';

const SELECT_CLASS =
  'h-[42px] w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

/** Filtros em GET (funcionam sem JavaScript). Os valores vêm de searchParams já validados. */
export function ChangeFilterForm({
  filters,
  modules,
}: {
  filters: ChangeFilters;
  modules: readonly { key: string; label: string }[];
}) {
  return (
    <form action="/diferencas" method="get" role="search" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
      <Field label="Tipo">
        <select name="tipo" defaultValue={filters.type} className={SELECT_CLASS}>
          <option value="">Todos os tipos</option>
          {CHANGE_TYPES.map((type) => (
            <option key={type} value={type}>
              {changeTypeInfo(type).label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Módulo">
        <select name="modulo" defaultValue={filters.module} className={SELECT_CLASS}>
          <option value="">Todos os módulos</option>
          {modules.map((module) => (
            <option key={module.key} value={module.key}>
              {module.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Severidade">
        <select name="severidade" defaultValue={filters.severity} className={SELECT_CLASS}>
          <option value="">Todas</option>
          {SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>
              {SEVERITY_LABELS[severity]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Revisão">
        <select name="revisao" defaultValue={filters.review} className={SELECT_CLASS}>
          <option value="">Todas</option>
          {REVIEW_STATUSES.map((status) => (
            <option key={status} value={status}>
              {reviewStatusInfo(status).label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="De">
        <Input type="date" name="de" defaultValue={filters.from} />
      </Field>
      <Field label="Até">
        <Input type="date" name="ate" defaultValue={filters.to} />
      </Field>
      <div className="col-span-2 flex items-end gap-2 md:col-span-3 xl:col-span-1">
        <Button type="submit" className="flex-1 xl:flex-none">
          Aplicar
        </Button>
        <Link href="/diferencas" className={buttonVariants({ variant: 'outline' })}>
          Limpar
        </Link>
      </div>
    </form>
  );
}
