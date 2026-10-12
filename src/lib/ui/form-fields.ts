/**
 * Campos do formulário de um item do catálogo (service_catalog.item_details, chave custom_fields).
 * Função pura, sem imports de servidor: usada pela página /recursos/[id] e pelos testes.
 */
export interface FormFieldRow {
  label: string;
  type: string;
  required: boolean;
  options: string[];
}

const NO_LABEL = '(sem rótulo)';

/** Converte custom_fields normalizados em linhas legíveis. Entradas fora do formato são ignoradas. */
export function formFieldRows(customFields: unknown): FormFieldRow[] {
  if (!Array.isArray(customFields)) return [];
  return customFields.flatMap((entry): FormFieldRow[] => {
    if (!entry || typeof entry !== 'object') return [];
    const field = entry as Record<string, unknown>;
    const label = firstText(field.label, field.name) ?? NO_LABEL;
    const options = (Array.isArray(field.choices) ? field.choices : []).flatMap((choice): string[] => {
      if (typeof choice === 'string') return choice.trim() ? [choice.trim()] : [];
      const value = choice && typeof choice === 'object' ? (choice as Record<string, unknown>).value : undefined;
      return typeof value === 'string' && value.trim() ? [value.trim()] : [];
    });
    return [
      {
        label,
        type: firstText(field.field_type) ?? '—',
        required: field.required === true,
        options,
      },
    ];
  });
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}
