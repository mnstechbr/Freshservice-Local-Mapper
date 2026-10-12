import { describe, expect, it } from 'vitest';
import { diffNormalized } from '@/lib/diff/fields';

// Estrutura documentada do detalhe do item: custom_fields[] com label, required, field_type e choices[].value.
const MODULE = 'service_catalog.item_details';
const TEXT = { id: 1, label: 'Serial', field_type: 'custom_text', required: false, choices: [] };
const DROPDOWN = {
  id: 2,
  label: 'Departamento',
  field_type: 'custom_dropdown',
  required: true,
  choices: [{ value: 'TI' }, { value: 'RH' }],
};
const item = (fields: unknown[]) => ({ id: 9001, name: 'Notebook sintético', custom_fields: fields });
const summary = (diffs: ReturnType<typeof diffNormalized>) => diffs.map((d) => [d.path, d.kind, d.tag]);

describe('diff de custom_fields no formato documentado', () => {
  it('campo adicionado e removido', () => {
    const added = diffNormalized(item([TEXT]), item([TEXT, { id: 3, label: 'Novo', field_type: 'custom_number', required: false, choices: [] }]), MODULE);
    expect(summary(added)).toEqual([['custom_fields[id=3]', 'added', 'field_added']]);
    const removed = diffNormalized(item([TEXT, DROPDOWN]), item([TEXT]), MODULE);
    expect(summary(removed)).toEqual([['custom_fields[id=2]', 'removed', 'field_removed']]);
  });

  it('rótulo alterado com o mesmo id vira field_renamed', () => {
    const renamed = diffNormalized(item([DROPDOWN]), item([{ ...DROPDOWN, label: 'Setor' }]), MODULE);
    expect(summary(renamed)).toEqual([['custom_fields[id=2].label', 'modified', 'field_renamed']]);
  });

  it('required alterado vira tag required', () => {
    const changed = diffNormalized(item([DROPDOWN]), item([{ ...DROPDOWN, required: false }]), MODULE);
    expect(summary(changed)).toEqual([['custom_fields[id=2].required', 'modified', 'required']]);
  });

  it('opção adicionada e removida em choices (identidade por value)', () => {
    const changed = diffNormalized(
      item([DROPDOWN]),
      item([{ ...DROPDOWN, choices: [{ value: 'TI' }, { value: 'FIN' }] }]),
      MODULE,
    );
    expect(summary(changed)).toEqual([
      ['custom_fields[id=2].choices[value=FIN]', 'added', 'option_added'],
      ['custom_fields[id=2].choices[value=RH]', 'removed', 'option_removed'],
    ]);
  });

  it('a ordem devolvida pela API não gera diferença', () => {
    const reordered = item([DROPDOWN, TEXT].reverse().map((field) =>
      field.id === 2 ? { ...field, choices: [{ value: 'RH' }, { value: 'TI' }] } : field,
    ));
    expect(diffNormalized(item([TEXT, DROPDOWN]), reordered, MODULE)).toEqual([]);
  });
});
