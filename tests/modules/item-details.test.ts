import { describe, expect, it } from 'vitest';
import { getAdapter, registryProblems } from '@/lib/freshservice/modules';
import { requestTarget } from '@/lib/sync/fetch-pages';
import { ModuleIncompleteError } from '@/lib/sync/types';

// Fixtures sintéticas. Formato conforme a documentação: GET /api/v2/service_catalog/items/{display_id}
// responde { service_item: {...} } com custom_fields (label, required, field_type, choices[].value).
const RAW_ITEM = {
  id: 9001,
  display_id: 56,
  name: 'Notebook sintético',
  description: 'Descrição sintética',
  category_id: 77,
  visibility: 1,
  created_at: '2019-09-16T09:38:20Z',
  updated_at: '2019-11-18T10:06:23Z',
  _links: { self: 'https://exemplo.invalid/item' },
  attachments: [{ id: 1, attachment_url: 'https://exemplo.invalid/a?token=sintetico' }],
  primary_email: 'contato@exemplo.invalid',
};

const DETAIL = {
  service_item: {
    id: 9001,
    display_id: 56,
    name: 'Notebook sintético',
    custom_fields: [
      { id: 2, label: 'Departamento', field_type: 'custom_dropdown', required: true, choices: [{ value: 'TI' }, { value: 'RH' }] },
      { id: 1, label: 'Serial', field_type: 'custom_text', required: false, choices: [] },
    ],
  },
};

describe('service_catalog.item_details (detalhe do item, filho por display_id)', () => {
  const detail = getAdapter('service_catalog.item_details');

  it('é filho de service_catalog.items com placement path e caminho com {display_id}', () => {
    expect(detail?.child).toEqual({ parentKey: 'service_catalog.items', parentParam: 'display_id', placement: 'path' });
    expect(detail?.path).toBe('/api/v2/service_catalog/items/{display_id}');
    expect(detail?.paginated).toBe(false);
    expect(registryProblems()).toEqual([]);
  });

  it('requestTarget substitui display_id no caminho (codificado) e tira o parâmetro da query', () => {
    expect(requestTarget(detail!, { display_id: '56' })).toEqual({ path: '/api/v2/service_catalog/items/56', query: {} });
    expect(requestTarget(detail!, { display_id: '5/6' }).path).toBe('/api/v2/service_catalog/items/5%2F6');
  });

  it('requestTarget sem referência do pai falha sem chamar a API', () => {
    expect(() => requestTarget(detail!, {})).toThrow(ModuleIncompleteError);
  });

  it('extractList lê a chave service_item e devolve lista de um item', () => {
    const list = detail!.extractList(DETAIL);
    expect(list).toHaveLength(1);
    expect((list[0] as { id: number }).id).toBe(9001);
    expect(() => detail!.extractList({ outra: {} })).toThrow();
  });

  it('custom_fields e choices saem ordenados por id e value (ordem da API não muda o hash)', () => {
    const record = detail!.toResource(DETAIL.service_item);
    const fields = record?.normalized.custom_fields as Array<{ id: number; choices: Array<{ value: string }> }>;
    expect(fields.map((field) => field.id)).toEqual([1, 2]);
    expect(fields[1]?.choices.map((choice) => choice.value)).toEqual(['RH', 'TI']);
  });
});

describe('normalização ampla com exclusões', () => {
  const items = getAdapter('service_catalog.items');

  it('traz atributos além de uma whitelist e remove ruído global e contato', () => {
    const record = items?.toResource(RAW_ITEM);
    expect(record?.normalized.created_at).toBe('2019-09-16T09:38:20Z');
    expect(record?.normalized.visibility).toBe(1);
    expect(record?.normalized).not.toHaveProperty('_links');
    expect(record?.normalized).not.toHaveProperty('attachments');
    expect(record?.normalized).not.toHaveProperty('primary_email');
  });

  it('refValue é display_id no items; externalId continua sendo id', () => {
    const record = items?.toResource(RAW_ITEM);
    expect(record?.externalId).toBe('9001');
    expect(record?.refValue).toBe('56');
  });
});
