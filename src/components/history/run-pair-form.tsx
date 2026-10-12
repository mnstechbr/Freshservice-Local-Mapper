import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';
import type { SyncRunRow } from '@/lib/queries/runs';

const SELECT_CLASS =
  'h-[42px] min-w-[180px] rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:opacity-50';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

/**
 * Escolha de duas execuções para /historico/comparar?a=&b= (GET, sem JavaScript).
 * Por padrão compara a execução anterior (base) com a mais recente.
 */
export function RunPairForm({
  runs,
  a,
  b,
}: {
  runs: readonly SyncRunRow[];
  a?: number;
  b?: number;
}) {
  const disabled = runs.length < 2;
  const label = (run: SyncRunRow) => `#${run.id} · ${formatDateTime(run.startedAt)}`;

  return (
    <form
      action="/historico/comparar"
      method="get"
      role="search"
      aria-label="Escolher execuções para comparar"
      className="flex w-full flex-wrap items-end gap-2 sm:w-auto"
    >
      <Field label="Execução base">
        <select name="a" defaultValue={a ?? runs[1]?.id} disabled={disabled} className={SELECT_CLASS}>
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {label(run)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Execução comparada">
        <select name="b" defaultValue={b ?? runs[0]?.id} disabled={disabled} className={SELECT_CLASS}>
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {label(run)}
            </option>
          ))}
        </select>
      </Field>
      <Button type="submit" variant="secondary" disabled={disabled}>
        Comparar
      </Button>
      {disabled && <p className="w-full text-xs text-muted-foreground">São necessárias ao menos duas execuções.</p>}
    </form>
  );
}
