import type { FormFieldRow } from '@/lib/ui/form-fields';

const HEAD = 'py-2 pr-3 text-left text-xs font-medium text-muted-foreground';

/** Tabela de campos do formulário de um item do catálogo. Só apresentação, sem estado. */
export function FormFieldsTable({ rows }: { rows: FormFieldRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className={HEAD}>Campo</th>
            <th scope="col" className={HEAD}>Tipo</th>
            <th scope="col" className={HEAD}>Obrigatório</th>
            <th scope="col" className={HEAD}>Opções</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${index}-${row.label}`} className="border-t border-border/60 align-top">
              <td className="py-2 pr-3 text-foreground">{row.label}</td>
              <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">{row.type}</td>
              <td className="py-2 pr-3">{row.required ? 'Sim' : 'Não'}</td>
              <td className="py-2 text-muted-foreground">{row.options.length > 0 ? row.options.join(', ') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
