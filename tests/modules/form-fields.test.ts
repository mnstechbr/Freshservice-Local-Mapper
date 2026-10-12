import { describe, expect, it } from 'vitest';
import { moduleLabel } from '../../src/lib/modules/catalog';
import { formFieldRows } from '../../src/lib/ui/form-fields';

/** Item do catálogo com campos sintéticos (formato de custom_fields da doc, normalizado). */
const CUSTOM_FIELDS = [
  {
    label: 'Prioridade',
    placeholder: 'Escolha',
    required: true,
    field_type: 'custom_dropdown',
    choices: [{ value: 'Alta' }, { value: 'Baixa' }],
  },
  { label: 'Descrição do pedido', required: false, field_type: 'custom_paragraph', choices: [] },
  { name: 'codigo_interno', required: false, field_type: 'custom_text' },
];

describe('formFieldRows: custom_fields do item de catálogo', () => {
  it('mostra rótulo, tipo, obrigatório e opções de cada campo', () => {
    expect(formFieldRows(CUSTOM_FIELDS)).toEqual([
      { label: 'Prioridade', type: 'custom_dropdown', required: true, options: ['Alta', 'Baixa'] },
      { label: 'Descrição do pedido', type: 'custom_paragraph', required: false, options: [] },
      { label: 'codigo_interno', type: 'custom_text', required: false, options: [] },
    ]);
  });

  it('aceita opções como texto simples e ignora opções vazias', () => {
    const rows = formFieldRows([{ label: 'Cor', field_type: 'custom_dropdown', choices: ['Azul', '  ', { value: '' }] }]);
    expect(rows[0]?.options).toEqual(['Azul']);
  });

  it('sem rótulo nem nome, usa texto neutro; sem tipo, usa travessão', () => {
    expect(formFieldRows([{ required: true }])).toEqual([
      { label: '(sem rótulo)', type: '—', required: true, options: [] },
    ]);
  });

  it('valores fora do formato (não lista, entradas nulas ou escalares) não quebram a tela', () => {
    expect(formFieldRows(undefined)).toEqual([]);
    expect(formFieldRows({ label: 'solto' })).toEqual([]);
    expect(formFieldRows([null, 'texto', 3])).toEqual([]);
  });

  it('required só vale como verdadeiro quando é true', () => {
    expect(formFieldRows([{ label: 'A', required: 'true' }])[0]?.required).toBe(false);
  });
});

describe('rótulo legível do item de catálogo', () => {
  it('service_catalog.item_details tem rótulo do adaptador, não a chave técnica', () => {
    expect(moduleLabel('service_catalog.item_details')).toBe('Detalhe do item: campos do formulário');
  });
});
